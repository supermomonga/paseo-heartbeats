import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// A heartbeat is a Paseo schedule whose target is an existing agent. These
// schemas mirror the fields the plugin reads from `paseo schedule inspect`.

export const HeartbeatCadenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("every"), everyMs: z.number() }),
  z.object({
    type: z.literal("cron"),
    expression: z.string(),
    timezone: z.string().optional(),
  }),
]);
export type HeartbeatCadence = z.infer<typeof HeartbeatCadenceSchema>;

// Known values are "active", "paused", and "completed" (schedule) and
// "running", "succeeded", and "failed" (run). They stay plain strings so a
// newer daemon with another value does not break validation.
export const HeartbeatRunSchema = z.object({
  id: z.string(),
  scheduledFor: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  status: z.string(),
  output: z.string().nullable(),
  error: z.string().nullable(),
});
export type HeartbeatRun = z.infer<typeof HeartbeatRunSchema>;

export const HeartbeatSummarySchema = z.object({
  id: z.string(),
  agentId: z.string(),
  workspaceId: z.string().nullable(),
  name: z.string().nullable(),
  promptPreview: z.string(),
  cadence: HeartbeatCadenceSchema,
  status: z.string(),
  nextRunAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  lastRunStatus: z.string().nullable(),
});
export type HeartbeatSummary = z.infer<typeof HeartbeatSummarySchema>;

export const HeartbeatDetailSchema = HeartbeatSummarySchema.extend({
  prompt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  pausedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  maxRuns: z.number().nullable(),
  /** Newest first. */
  runs: z.array(HeartbeatRunSchema),
});
export type HeartbeatDetail = z.infer<typeof HeartbeatDetailSchema>;

const HeartbeatIdInput = z.object({ id: z.string().min(1) });
const HeartbeatOutput = z.object({ heartbeat: HeartbeatDetailSchema });

export const listHeartbeats = defineRpc({
  name: "heartbeats.list",
  input: z.object({}),
  output: z.object({ heartbeats: z.array(HeartbeatSummarySchema) }),
});

export const getHeartbeat = defineRpc({
  name: "heartbeats.get",
  input: HeartbeatIdInput,
  output: HeartbeatOutput,
});

export const HeartbeatUpdateSchema = z.object({
  id: z.string().min(1),
  /** An empty string clears the name. */
  name: z.string().optional(),
  prompt: z.string().trim().min(1).optional(),
  cron: z
    .object({
      expression: z.string().trim().min(1),
      /** Omit to use the daemon's local time zone. */
      timezone: z.string().trim().min(1).optional(),
    })
    .optional(),
});
export type HeartbeatUpdate = z.infer<typeof HeartbeatUpdateSchema>;

export const updateHeartbeat = defineRpc({
  name: "heartbeats.update",
  input: HeartbeatUpdateSchema,
  output: HeartbeatOutput,
});

export const setHeartbeatPaused = defineRpc({
  name: "heartbeats.set_paused",
  input: z.object({ id: z.string().min(1), paused: z.boolean() }),
  output: HeartbeatOutput,
});

export const runHeartbeatOnce = defineRpc({
  name: "heartbeats.run_once",
  input: HeartbeatIdInput,
  // "started": the run continues in the background; `status` and `error` are null.
  // "finished": the run already ended with this outcome, for example because the
  // agent was busy.
  output: z.object({
    state: z.enum(["started", "finished"]),
    status: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

export const deleteHeartbeat = defineRpc({
  name: "heartbeats.delete",
  input: HeartbeatIdInput,
  output: z.object({ id: z.string() }),
});
