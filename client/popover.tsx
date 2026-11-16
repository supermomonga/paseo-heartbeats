import type { PluginButtonContentProps, PluginClientContext } from "@getpaseo/plugin/client";
import { useEffect, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import type { HeartbeatDirectory, HeartbeatSelection } from "./directory";
import { heartbeatTitle } from "./format";
import { useHeartbeatText } from "./labels";
import { PANEL_ID } from "./ids";
import { StatusDot, useStyles } from "./ui";

/** The pill's list: one row per heartbeat of the agent, opening it in the Explorer. */
export function createHeartbeatPopover({
  client,
  directory,
  selection,
}: {
  client: PluginClientContext;
  directory: HeartbeatDirectory;
  selection: HeartbeatSelection;
}) {
  return function HeartbeatPopover(props: PluginButtonContentProps) {
    const { theme, layout, close, workspaceId } = props;
    const agentId = props.context === "agent" ? props.agentId : null;
    const styles = useStyles(theme, layout.compact);
    const text = useHeartbeatText();
    useSyncExternalStore(directory.subscribe, directory.getSnapshot);
    const heartbeats = agentId ? directory.forAgent(agentId) : [];

    useEffect(() => {
      void directory.refresh();
    }, []);

    if (!agentId) return null;
    if (heartbeats.length === 0) {
      return <Text style={styles.muted}>{text.t("panel.empty")}</Text>;
    }

    const open = (heartbeatId: string) => {
      selection.select(agentId, heartbeatId);
      client.openPanel(PANEL_ID, { workspaceId, agentId, location: "explorer" });
      close();
    };

    return (
      <View style={{ gap: 2, minWidth: layout.compact ? undefined : 280, maxWidth: 380 }}>
        {heartbeats.map((heartbeat) => {
          const title = heartbeatTitle(heartbeat);
          const last = text.last(heartbeat);
          return (
            <Pressable
              key={heartbeat.id}
              accessibilityRole="button"
              accessibilityLabel={title}
              onPress={() => open(heartbeat.id)}
              style={({ pressed }) => [
                styles.listItem,
                pressed ? { backgroundColor: theme.colors.surface2 } : null,
              ]}
            >
              <View style={styles.row}>
                <StatusDot theme={theme} status={heartbeat.status} />
                <Text style={[styles.title, { flex: 1 }]} numberOfLines={1}>
                  {title}
                </Text>
              </View>
              <Text style={styles.muted} numberOfLines={1}>
                {[text.cadence(heartbeat.cadence), text.when(heartbeat), last]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              {heartbeat.lastRunStatus === "failed" ? (
                <Text style={styles.danger}>{text.t("schedule.lastRunFailed")}</Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    );
  };
}
