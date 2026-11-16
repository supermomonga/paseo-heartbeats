import type { HeartbeatDetail, HeartbeatUpdate } from "../shared/heartbeats";

/** The editable fields as the form shows them. */
export interface HeartbeatDraft {
  name: string;
  prompt: string;
  cron: string;
  timezone: string;
}

export type DraftProblem = "promptRequired" | "cronRequired" | "timezoneRequired";

export function draftFrom(detail: HeartbeatDetail): HeartbeatDraft {
  const cron = detail.cadence.type === "cron" ? detail.cadence : null;
  return {
    name: detail.name ?? "",
    prompt: detail.prompt,
    cron: cron?.expression ?? "",
    timezone: cron?.timezone ?? "",
  };
}

export function sameDraft(left: HeartbeatDraft, right: HeartbeatDraft): boolean {
  return (
    left.name === right.name &&
    left.prompt === right.prompt &&
    left.cron === right.cron &&
    left.timezone === right.timezone
  );
}

export function draftProblems(detail: HeartbeatDetail, draft: HeartbeatDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (!draft.prompt.trim()) problems.push("promptRequired");
  // An interval cadence keeps running unchanged while the cron field is empty.
  if (detail.cadence.type === "cron" && !draft.cron.trim()) problems.push("cronRequired");
  // The daemon keeps the previous time zone when an update leaves it out.
  if (draftFrom(detail).timezone && !draft.timezone.trim()) problems.push("timezoneRequired");
  return problems;
}

/** Only the fields that differ from the saved heartbeat. */
export function updateFromDraft(detail: HeartbeatDetail, draft: HeartbeatDraft): HeartbeatUpdate {
  const saved = draftFrom(detail);
  const update: HeartbeatUpdate = { id: detail.id };
  const name = draft.name.trim();
  if (name !== saved.name) update.name = name;
  if (draft.prompt.trim() !== saved.prompt.trim()) update.prompt = draft.prompt.trim();
  const cron = draft.cron.trim();
  const timezone = draft.timezone.trim();
  if (cron && (cron !== saved.cron || timezone !== saved.timezone)) {
    update.cron = timezone ? { expression: cron, timezone } : { expression: cron };
  }
  return update;
}

export function isEmptyUpdate(update: HeartbeatUpdate): boolean {
  return update.name === undefined && update.prompt === undefined && update.cron === undefined;
}
