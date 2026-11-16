import { useTranslation } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import type { HeartbeatCadence, HeartbeatSummary } from "../shared/heartbeats";
import { formatCron, formatInterval, formatShortTime } from "./format";
import { messages } from "./messages";

/** Translated wording shared by the popover and the panel. */
export function useHeartbeatText() {
  const { t } = useTranslation(messages);
  return useMemo(() => {
    const cadence = (value: HeartbeatCadence) =>
      value.type === "cron"
        ? formatCron(value)
        : t("schedule.every", { interval: formatInterval(value.everyMs) });

    const status = (value: string) => {
      switch (value) {
        case "active":
          return t("status.active");
        case "paused":
          return t("status.paused");
        case "completed":
          return t("status.completed");
        default:
          return value;
      }
    };

    const runStatus = (value: string) => {
      switch (value) {
        case "running":
          return t("run.running");
        case "succeeded":
          return t("run.succeeded");
        case "failed":
          return t("run.failed");
        default:
          return value;
      }
    };

    /** "Next 14:30" for active heartbeats, the status otherwise. */
    const when = (heartbeat: Pick<HeartbeatSummary, "status" | "nextRunAt">) =>
      heartbeat.status === "active" && heartbeat.nextRunAt
        ? t("schedule.next", { time: formatShortTime(heartbeat.nextRunAt) })
        : status(heartbeat.status);

    const last = (heartbeat: Pick<HeartbeatSummary, "lastRunAt">) =>
      heartbeat.lastRunAt ? t("schedule.last", { time: formatShortTime(heartbeat.lastRunAt) }) : null;

    return { t, cadence, status, runStatus, when, last };
  }, [t]);
}

export type HeartbeatText = ReturnType<typeof useHeartbeatText>;
