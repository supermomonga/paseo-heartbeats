import type {
  PluginButtonBehavior,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import type { PluginMessage, PluginText } from "@getpaseo/plugin";
import type { HeartbeatSummary } from "../shared/heartbeats";
import type { HeartbeatDirectory } from "./directory";
import { formatShortTime, nextRunAt } from "./format";
import { PILL_ID } from "./ids";
import { messages } from "./messages";

interface PillLabel {
  /** Compared to skip updates that would not change the label. */
  key: string;
  text: PluginMessage;
}

export function pillLabel(heartbeats: readonly HeartbeatSummary[], now: Date): PillLabel {
  const count = heartbeats.length;
  const next = nextRunAt(heartbeats);
  if (next === null) {
    return count > 1
      ? { key: `paused:${count}`, text: messages.message("pill.multiplePaused", { count }) }
      : { key: "paused", text: messages.message("pill.singlePaused") };
  }
  const time = formatShortTime(next, now);
  return count > 1
    ? { key: `next:${count}:${time}`, text: messages.message("pill.multiple", { count, next: time }) }
    : { key: `next:${time}`, text: messages.message("pill.single", { next: time }) };
}

interface Pill {
  workspaceId: string;
  labelKey: string;
  registration: PluginButtonRegistration<PluginText>;
}

/**
 * Keeps one composer pill on every agent that has heartbeats and none on the
 * rest. Pills stay as they are while a listing fails.
 */
export function syncComposerPills(
  client: PluginClientContext,
  directory: HeartbeatDirectory,
  behavior: PluginButtonBehavior<PluginText>,
): () => void {
  const pills = new Map<string, Pill>();

  const sync = () => {
    const snapshot = directory.getSnapshot();
    if (!snapshot.loaded || snapshot.error) return;
    const now = new Date();
    const wanted = new Set<string>();
    for (const [agentId, all] of snapshot.byAgent) {
      // A completed heartbeat never runs again; it alone does not earn a pill.
      const heartbeats = all.filter((heartbeat) => heartbeat.status !== "completed");
      const workspaceId = heartbeats.find((heartbeat) => heartbeat.workspaceId)?.workspaceId;
      if (!workspaceId) continue;
      wanted.add(agentId);
      const label = pillLabel(heartbeats, now);
      const existing = pills.get(agentId);
      if (existing && existing.workspaceId === workspaceId) {
        if (existing.labelKey !== label.key) {
          existing.registration.update({ label: label.text });
          existing.labelKey = label.key;
        }
        continue;
      }
      existing?.registration.remove();
      const registration = client.addComposerPill({
        id: PILL_ID,
        workspaceId,
        agentId,
        button: {
          title: messages.message("pill.title"),
          icon: "HeartPulse",
          label: label.text,
          behavior,
        },
      });
      pills.set(agentId, { workspaceId, labelKey: label.key, registration });
    }
    for (const [agentId, pill] of pills) {
      if (wanted.has(agentId)) continue;
      pill.registration.remove();
      pills.delete(agentId);
    }
  };

  const unsubscribe = directory.subscribe(sync);
  // "Today" moves at midnight even when no heartbeat changes.
  const clock = setInterval(sync, 60_000);
  sync();

  return () => {
    unsubscribe();
    clearInterval(clock);
    for (const pill of pills.values()) pill.registration.remove();
    pills.clear();
  };
}
