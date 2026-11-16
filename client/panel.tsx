import {
  type PluginAgentPanelProps,
  useRpc,
  useTabState,
} from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Markdown, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Pressable, Text, View } from "react-native";
import { z } from "zod";
import {
  deleteHeartbeat,
  getHeartbeat,
  runHeartbeatOnce,
  setHeartbeatPaused,
  updateHeartbeat,
  type HeartbeatDetail,
  type HeartbeatRun,
  type HeartbeatSummary,
} from "../shared/heartbeats";
import type { HeartbeatDirectory, HeartbeatSelection } from "./directory";
import {
  draftFrom,
  draftProblems,
  isEmptyUpdate,
  sameDraft,
  updateFromDraft,
  type HeartbeatDraft,
} from "./draft";
import {
  errorMessage,
  formatDateTime,
  formatDuration,
  formatInterval,
  heartbeatTitle,
} from "./format";
import { useHeartbeatText, type HeartbeatText } from "./labels";
import { Button, StatusDot, statusColor, useStyles, type Styles } from "./ui";

const TabStateSchema = z.object({ selectedId: z.string().nullable() });
const NO_HEARTBEATS: readonly HeartbeatSummary[] = [];

function heartbeatQueryKey(id: string) {
  return ["heartbeat", id] as const;
}

/** The Explorer panel for one agent: its heartbeats, the selected one's form, and its runs. */
export function createHeartbeatPanel({
  directory,
  selection,
}: {
  directory: HeartbeatDirectory;
  selection: HeartbeatSelection;
}) {
  return function HeartbeatPanel({ theme, layout, params, revision, tab }: PluginAgentPanelProps) {
    const agentId = params.agentId;
    const styles = useStyles(theme, layout.compact);
    const text = useHeartbeatText();
    const snapshot = useSyncExternalStore(directory.subscribe, directory.getSnapshot);
    const heartbeats = snapshot.byAgent.get(agentId) ?? NO_HEARTBEATS;
    const picked = useSyncExternalStore(selection.subscribe, () => selection.get(agentId));
    const [tabState, setTabState] = useTabState(tab, TabStateSchema, { selectedId: null });
    const preferred = picked ?? tabState.selectedId;
    const selected = heartbeats.find((heartbeat) => heartbeat.id === preferred) ?? heartbeats[0];

    // Drafts survive switching between heartbeats; they are dropped on save or discard.
    const [drafts, setDrafts] = useState<Record<string, HeartbeatDraft>>({});
    const setDraft = useCallback((id: string, draft: HeartbeatDraft | null) => {
      setDrafts((current) => {
        if (draft) return { ...current, [id]: draft };
        if (!(id in current)) return current;
        const { [id]: _dropped, ...rest } = current;
        return rest;
      });
    }, []);
    // Drafts of heartbeats deleted elsewhere no longer count as unsaved work.
    const modified = heartbeats.some((heartbeat) => heartbeat.id in drafts);

    useEffect(() => {
      tab.setModified(modified);
    }, [tab, modified]);

    // Opening the panel again, from the pill or a tab restore, picks up fresh data.
    useEffect(() => {
      void directory.refresh();
    }, [revision]);

    useEffect(() => {
      if (picked && picked !== tabState.selectedId) setTabState({ selectedId: picked });
    }, [picked, tabState.selectedId, setTabState]);

    const choose = (id: string) => {
      selection.select(agentId, id);
      setTabState({ selectedId: id });
    };

    let body: ReactNode;
    if (!snapshot.loaded) {
      body = <Text style={styles.muted}>{text.t("panel.loading")}</Text>;
    } else if (!selected) {
      body = (
        <View style={styles.section}>
          <Text style={styles.muted}>{text.t("panel.empty")}</Text>
          {snapshot.error ? <Text style={styles.danger}>{snapshot.error}</Text> : null}
        </View>
      );
    } else {
      body = (
        <HeartbeatEditor
          key={selected.id}
          summary={selected}
          draft={drafts[selected.id] ?? null}
          setDraft={setDraft}
          directory={directory}
          theme={theme}
          styles={styles}
          text={text}
        />
      );
    }

    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {heartbeats.length > 1 ? (
          <View style={{ gap: 2 }}>
            {heartbeats.map((heartbeat) => (
              <HeartbeatListItem
                key={heartbeat.id}
                heartbeat={heartbeat}
                selected={heartbeat.id === selected?.id}
                edited={heartbeat.id in drafts}
                onPress={() => choose(heartbeat.id)}
                theme={theme}
                styles={styles}
                text={text}
              />
            ))}
          </View>
        ) : null}
        {body}
      </ScrollView>
    );
  };
}

function HeartbeatListItem({
  heartbeat,
  selected,
  edited,
  onPress,
  theme,
  styles,
  text,
}: {
  heartbeat: HeartbeatSummary;
  selected: boolean;
  edited: boolean;
  onPress(): void;
  theme: PluginTheme;
  styles: Styles;
  text: HeartbeatText;
}) {
  const title = heartbeatTitle(heartbeat);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.listItem, selected ? styles.listItemSelected : null]}
    >
      <View style={styles.row}>
        <StatusDot theme={theme} status={heartbeat.status} />
        <Text style={[styles.title, { flex: 1 }]} numberOfLines={1}>
          {edited ? `${title} •` : title}
        </Text>
      </View>
      <Text style={styles.muted} numberOfLines={1}>
        {[text.cadence(heartbeat.cadence), text.when(heartbeat)].join(" · ")}
      </Text>
    </Pressable>
  );
}

function HeartbeatEditor({
  summary,
  draft,
  setDraft,
  directory,
  theme,
  styles,
  text,
}: {
  summary: HeartbeatSummary;
  draft: HeartbeatDraft | null;
  setDraft(id: string, draft: HeartbeatDraft | null): void;
  directory: HeartbeatDirectory;
  theme: PluginTheme;
  styles: Styles;
  text: HeartbeatText;
}) {
  const { t } = text;
  const id = summary.id;
  const fetchHeartbeat = useRpc(getHeartbeat);
  const query = useQuery({
    queryKey: heartbeatQueryKey(id),
    queryFn: async () => (await fetchHeartbeat({ id })).heartbeat,
    refetchInterval: 30_000,
  });
  const { refetch } = query;

  // A run, a pause, or an edit elsewhere moves the summary; reload the details then.
  const summaryKey = [summary.name, summary.status, summary.nextRunAt, summary.lastRunAt].join("|");
  const seenSummaryKey = useRef(summaryKey);
  useEffect(() => {
    if (seenSummaryKey.current === summaryKey) return;
    seenSummaryKey.current = summaryKey;
    void refetch();
  }, [summaryKey, refetch]);

  if (!query.data) {
    if (query.isError) {
      return (
        <View style={styles.section}>
          <Text style={styles.danger}>{t("panel.loadFailed")}</Text>
          <Text style={styles.muted} selectable>
            {errorMessage(query.error)}
          </Text>
          <View style={styles.row}>
            <Button theme={theme} label={t("panel.retry")} icon="RefreshCw" onPress={() => void refetch()} />
          </View>
        </View>
      );
    }
    return <Text style={styles.muted}>{t("panel.loading")}</Text>;
  }

  return (
    <LoadedHeartbeat
      detail={query.data}
      draft={draft}
      setDraft={(next) => setDraft(id, next)}
      onChanged={() => void refetch()}
      directory={directory}
      theme={theme}
      styles={styles}
      text={text}
    />
  );
}

function LoadedHeartbeat({
  detail,
  draft,
  setDraft,
  onChanged,
  directory,
  theme,
  styles,
  text,
}: {
  detail: HeartbeatDetail;
  draft: HeartbeatDraft | null;
  setDraft(draft: HeartbeatDraft | null): void;
  onChanged(): void;
  directory: HeartbeatDirectory;
  theme: PluginTheme;
  styles: Styles;
  text: HeartbeatText;
}) {
  const { t } = text;
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const saved = draftFrom(detail);
  const values = draft ?? saved;
  const problems = draft ? draftProblems(detail, values) : [];
  const update = updateFromDraft(detail, values);
  const canSave = draft !== null && problems.length === 0 && !isEmptyUpdate(update);

  const change = (field: keyof HeartbeatDraft, value: string) => {
    const next = { ...values, [field]: value };
    setDraft(sameDraft(next, saved) ? null : next);
  };

  const applyDetail = (heartbeat: HeartbeatDetail) => {
    queryClient.setQueryData(heartbeatQueryKey(heartbeat.id), heartbeat);
    void directory.refresh();
  };
  const reportError = (error: unknown) => toast.error(errorMessage(error));

  const callUpdate = useRpc(updateHeartbeat);
  const callSetPaused = useRpc(setHeartbeatPaused);
  const callRunOnce = useRpc(runHeartbeatOnce);
  const callDelete = useRpc(deleteHeartbeat);

  const save = useMutation({
    mutationFn: callUpdate,
    onSuccess: ({ heartbeat }) => {
      applyDetail(heartbeat);
      setDraft(null);
      toast.show(t("toast.saved"), { variant: "success" });
    },
    onError: reportError,
  });
  const pause = useMutation({
    mutationFn: callSetPaused,
    onSuccess: ({ heartbeat }, input) => {
      applyDetail(heartbeat);
      toast.show(t(input.paused ? "toast.paused" : "toast.resumed"), { variant: "success" });
    },
    onError: reportError,
  });
  const runNow = useMutation({
    mutationFn: callRunOnce,
    onSuccess: ({ state, status, error }) => {
      onChanged();
      void directory.refresh();
      if (state === "finished" && status === "failed") {
        toast.error(error ? `${t("toast.runFailed")}: ${error}` : t("toast.runFailed"));
        return;
      }
      toast.show(t(state === "started" ? "toast.runStarted" : "toast.runFinished"), {
        variant: "success",
      });
    },
    onError: reportError,
  });
  const remove = useMutation({
    mutationFn: callDelete,
    onSuccess: () => {
      setDraft(null);
      // Drop the cached details once the list no longer shows this heartbeat.
      void directory
        .refresh()
        .then(() => queryClient.removeQueries({ queryKey: heartbeatQueryKey(detail.id) }));
      toast.show(t("toast.deleted"), { variant: "success" });
    },
    onError: reportError,
  });
  const busy = save.isPending || pause.isPending || runNow.isPending || remove.isPending;
  const completed = detail.status === "completed";
  const last = text.last(detail);

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.section}>
        <Text style={[styles.title, { fontSize: 15 }]}>{heartbeatTitle(detail)}</Text>
        <View style={styles.wrapRow}>
          <View style={styles.row}>
            <StatusDot theme={theme} status={detail.status} />
            <Text style={[styles.muted, { color: statusColor(theme, detail.status) }]}>
              {text.status(detail.status)}
            </Text>
          </View>
          <Text style={styles.muted}>
            {[text.cadence(detail.cadence), detail.status === "active" ? text.when(detail) : null, last]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
        <View style={styles.wrapRow}>
          {completed ? null : detail.status === "paused" ? (
            <Button
              theme={theme}
              label={t("action.resume")}
              icon="Play"
              disabled={busy}
              onPress={() => pause.mutate({ id: detail.id, paused: false })}
            />
          ) : (
            <Button
              theme={theme}
              label={t("action.pause")}
              icon="Pause"
              disabled={busy}
              onPress={() => pause.mutate({ id: detail.id, paused: true })}
            />
          )}
          {completed ? null : (
            <Button
              theme={theme}
              label={t("action.runNow")}
              icon="Zap"
              disabled={busy}
              onPress={() => runNow.mutate({ id: detail.id })}
            />
          )}
          <Button
            theme={theme}
            label={t("action.delete")}
            icon="Trash2"
            variant="danger"
            disabled={busy || confirmingDelete}
            onPress={() => setConfirmingDelete(true)}
          />
        </View>
        {confirmingDelete ? (
          <View style={[styles.card, { borderColor: theme.colors.statusDanger }]}>
            <Text style={styles.text}>{t("action.confirmDelete")}</Text>
            <View style={styles.wrapRow}>
              <Button
                theme={theme}
                label={t("action.confirmDeleteAction")}
                variant="danger"
                disabled={busy}
                onPress={() => remove.mutate({ id: detail.id })}
              />
              <Button
                theme={theme}
                label={t("action.cancel")}
                disabled={remove.isPending}
                onPress={() => setConfirmingDelete(false)}
              />
            </View>
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Field label={t("field.name")} styles={styles}>
          <TextInput
            value={values.name}
            onChangeText={(value) => change("name", value)}
            placeholder={t("field.namePlaceholder")}
            placeholderTextColor={theme.colors.foregroundMuted}
            editable={!save.isPending}
            style={styles.input}
          />
        </Field>
        <Field label={t("field.prompt")} styles={styles}>
          <TextInput
            value={values.prompt}
            onChangeText={(value) => change("prompt", value)}
            multiline
            editable={!save.isPending}
            style={styles.promptInput}
          />
          {problems.includes("promptRequired") ? (
            <Text style={styles.danger}>{t("field.promptRequired")}</Text>
          ) : null}
        </Field>
        <Field label={t("field.cron")} styles={styles}>
          <TextInput
            value={values.cron}
            onChangeText={(value) => change("cron", value)}
            placeholder="0 9 * * *"
            placeholderTextColor={theme.colors.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!save.isPending}
            style={styles.monoInput}
          />
          <Text style={styles.muted}>{t("field.cronHint")}</Text>
          {detail.cadence.type === "every" ? (
            <Text style={styles.muted}>
              {t("field.everyNotice", { interval: formatInterval(detail.cadence.everyMs) })}
            </Text>
          ) : null}
          {problems.includes("cronRequired") ? (
            <Text style={styles.danger}>{t("field.cronRequired")}</Text>
          ) : null}
        </Field>
        <Field label={t("field.timezone")} styles={styles}>
          <TextInput
            value={values.timezone}
            onChangeText={(value) => change("timezone", value)}
            placeholder={t("field.timezonePlaceholder")}
            placeholderTextColor={theme.colors.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!save.isPending}
            style={styles.monoInput}
          />
          {problems.includes("timezoneRequired") ? (
            <Text style={styles.danger}>{t("field.timezoneRequired")}</Text>
          ) : null}
        </Field>
        <View style={styles.wrapRow}>
          <Button
            theme={theme}
            label={save.isPending ? t("action.saving") : t("action.save")}
            icon="Check"
            variant="primary"
            disabled={!canSave || busy}
            onPress={() => save.mutate(update)}
          />
          <Button
            theme={theme}
            label={t("action.discard")}
            disabled={draft === null || save.isPending}
            onPress={() => setDraft(null)}
          />
          {draft ? <Text style={styles.muted}>{t("panel.unsaved")}</Text> : null}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("runs.title")}</Text>
        {detail.runs.length === 0 ? (
          <Text style={styles.muted}>{t("runs.empty")}</Text>
        ) : (
          detail.runs.map((run) => (
            <RunItem key={run.id} run={run} theme={theme} styles={styles} text={text} />
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("details.title")}</Text>
        <DetailRow label={t("details.id")} value={detail.id} styles={styles} />
        <DetailRow label={t("details.created")} value={formatDateTime(detail.createdAt)} styles={styles} />
        <DetailRow label={t("details.updated")} value={formatDateTime(detail.updatedAt)} styles={styles} />
        <DetailRow
          label={t("details.maxRuns")}
          value={detail.maxRuns === null ? t("details.none") : String(detail.maxRuns)}
          styles={styles}
        />
        <DetailRow
          label={t("details.expires")}
          value={detail.expiresAt ? formatDateTime(detail.expiresAt) : t("details.none")}
          styles={styles}
        />
      </View>
    </View>
  );
}

function Field({
  label,
  styles,
  children,
}: {
  label: string;
  styles: Styles;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function DetailRow({ label, value, styles }: { label: string; value: string; styles: Styles }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailKey}>{label}</Text>
      <Text style={styles.detailValue} selectable>
        {value}
      </Text>
    </View>
  );
}

function RunItem({
  run,
  theme,
  styles,
  text,
}: {
  run: HeartbeatRun;
  theme: PluginTheme;
  styles: Styles;
  text: HeartbeatText;
}) {
  const { t } = text;
  const [open, setOpen] = useState(false);
  const duration = formatDuration(run.startedAt, run.endedAt);
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${formatDateTime(run.startedAt)} ${text.runStatus(run.status)}`}
        onPress={() => setOpen((value) => !value)}
        style={styles.row}
      >
        <StatusDot theme={theme} status={run.status} />
        <Text style={[styles.text, { flex: 1 }]}>{formatDateTime(run.startedAt)}</Text>
        <Text style={[styles.muted, { color: statusColor(theme, run.status) }]}>
          {duration ? `${text.runStatus(run.status)} · ${duration}` : text.runStatus(run.status)}
        </Text>
        <Icon
          name={open ? "ChevronUp" : "ChevronDown"}
          size={14}
          color={theme.colors.foregroundMuted}
        />
      </Pressable>
      {!open && run.error ? (
        <Text style={styles.danger} numberOfLines={2}>
          {run.error}
        </Text>
      ) : null}
      {open ? (
        <View style={{ gap: 6 }}>
          {run.error ? (
            <View style={styles.field}>
              <Text style={styles.label}>{t("runs.error")}</Text>
              <Text style={styles.danger} selectable>
                {run.error}
              </Text>
            </View>
          ) : null}
          <View style={styles.field}>
            <Text style={styles.label}>{t("runs.output")}</Text>
            {run.output ? (
              <Markdown>{run.output}</Markdown>
            ) : (
              <Text style={styles.muted}>{t("runs.noOutput")}</Text>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}
