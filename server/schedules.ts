import type { UpdateScheduleOptions } from "@getpaseo/client/internal/daemon-client";
import { z } from "zod";
import {
  HeartbeatCadenceSchema,
  type HeartbeatDetail,
  type HeartbeatRun,
  type HeartbeatSummary,
  type HeartbeatUpdate,
} from "../shared/heartbeats";

// Parsing of the daemon's schedule records into heartbeats, and the reverse
// for updates. Free of I/O so it can be tested directly.

const ScheduleRunRecordSchema = z.object({
  id: z.string(),
  scheduledFor: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable().optional(),
  status: z.string(),
  output: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

/** `schedule/list` items; `schedule/inspect` adds `runs`. */
export const ScheduleRecordSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  prompt: z.string(),
  cadence: HeartbeatCadenceSchema,
  target: z.object({ type: z.string(), agentId: z.string().optional() }).passthrough(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  nextRunAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  pausedAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  maxRuns: z.number().nullable().optional(),
  runs: z.array(ScheduleRunRecordSchema).optional(),
});
export type ScheduleRecord = z.infer<typeof ScheduleRecordSchema>;

/** Run history returned to clients, newest first. */
export const MAX_RUNS = 30;
const PROMPT_PREVIEW_LENGTH = 200;

/** Skips records this plugin cannot read instead of failing the whole list. */
export function parseScheduleRecords(
  values: readonly unknown[],
  onInvalid: (error: z.ZodError) => void = () => undefined,
): ScheduleRecord[] {
  const records: ScheduleRecord[] = [];
  for (const value of values) {
    const parsed = ScheduleRecordSchema.safeParse(value);
    if (parsed.success) records.push(parsed.data);
    else onInvalid(parsed.error);
  }
  return records;
}

export function parseScheduleRecord(value: unknown): ScheduleRecord {
  if (value === null || value === undefined) throw new Error("The daemon returned no schedule");
  return ScheduleRecordSchema.parse(value);
}

/** Heartbeats target an existing agent; `self` is the legacy spelling. */
export function heartbeatAgentId(record: Pick<ScheduleRecord, "target">): string | null {
  const { target } = record;
  if (target.type !== "agent" && target.type !== "self") return null;
  return typeof target.agentId === "string" && target.agentId ? target.agentId : null;
}

/** The record's runs, newest first. */
export function toHeartbeatRuns(record: ScheduleRecord): HeartbeatRun[] {
  return sortRunsNewestFirst(record.runs ?? []);
}

export function newestRunStatus(record: ScheduleRecord): string | null {
  return toHeartbeatRuns(record)[0]?.status ?? null;
}

export function toHeartbeatSummary(
  record: ScheduleRecord,
  workspaceId: string | null,
  lastRunStatus: string | null,
): HeartbeatSummary {
  const agentId = heartbeatAgentId(record);
  if (!agentId) throw new Error(`Schedule ${record.id} is not a heartbeat`);
  return {
    id: record.id,
    agentId,
    workspaceId,
    name: record.name,
    promptPreview: previewPrompt(record.prompt),
    cadence: record.cadence,
    status: record.status,
    nextRunAt: record.nextRunAt,
    lastRunAt: record.lastRunAt,
    lastRunStatus,
  };
}

export function toHeartbeatDetail(
  record: ScheduleRecord,
  workspaceId: string | null,
): HeartbeatDetail {
  const runs = toHeartbeatRuns(record).slice(0, MAX_RUNS);
  return {
    ...toHeartbeatSummary(record, workspaceId, runs[0]?.status ?? null),
    prompt: record.prompt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    pausedAt: record.pausedAt ?? null,
    expiresAt: record.expiresAt ?? null,
    maxRuns: record.maxRuns ?? null,
    runs,
  };
}

function sortRunsNewestFirst(runs: z.infer<typeof ScheduleRunRecordSchema>[]): HeartbeatRun[] {
  return runs
    .map((run) => ({
      id: run.id,
      scheduledFor: run.scheduledFor,
      startedAt: run.startedAt,
      endedAt: run.endedAt ?? null,
      status: run.status,
      output: run.output ?? null,
      error: run.error ?? null,
    }))
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
}

export function previewPrompt(prompt: string): string {
  const collapsed = prompt.trim().replace(/\s+/g, " ");
  return collapsed.length > PROMPT_PREVIEW_LENGTH
    ? `${collapsed.slice(0, PROMPT_PREVIEW_LENGTH - 1)}…`
    : collapsed;
}

/** An empty name clears it; a cron change replaces the whole cadence. */
export function toUpdateOptions(update: HeartbeatUpdate): UpdateScheduleOptions {
  const options: UpdateScheduleOptions = { id: update.id };
  if (update.name !== undefined) options.name = update.name.trim() || null;
  if (update.prompt !== undefined) options.prompt = update.prompt;
  if (update.cron) {
    options.cadence = {
      type: "cron",
      expression: update.cron.expression.trim(),
      ...(update.cron.timezone ? { timezone: update.cron.timezone.trim() } : {}),
    };
  }
  return options;
}

export function hasChanges(update: HeartbeatUpdate): boolean {
  return update.name !== undefined || update.prompt !== undefined || update.cron !== undefined;
}
