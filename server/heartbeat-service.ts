import type { HeartbeatDetail, HeartbeatSummary, HeartbeatUpdate } from "../shared/heartbeats";
import type { ScheduleClient } from "./daemon";
import {
  hasChanges,
  heartbeatAgentId,
  newestRunStatus,
  parseScheduleRecord,
  parseScheduleRecords,
  toHeartbeatDetail,
  toHeartbeatRuns,
  toHeartbeatSummary,
  toUpdateOptions,
  type ScheduleRecord,
} from "./schedules";

export interface RunOnceResult {
  state: "started" | "finished";
  status: string | null;
  error: string | null;
}

/** Looks up the workspace an agent belongs to; null when the agent is unknown. */
export type WorkspaceResolver = (agentId: string) => Promise<string | null>;

export interface HeartbeatServiceOptions {
  /** Concurrent list calls within this window share one listing. */
  listTtlMs?: number;
  /** How long `runOnce` waits for an early failure before reporting "started". */
  runStartGraceMs?: number;
  now?: () => number;
  log?: (message: string, error?: unknown) => void;
}

const INSPECT_CONCURRENCY = 4;

/**
 * Heartbeats are the daemon's schedules that target an existing agent.
 * `schedule/list` omits run history, so the outcome of each heartbeat's
 * latest run is read once per `lastRunAt`.
 */
export class HeartbeatService {
  private readonly lastRuns = new Map<string, { lastRunAt: string; status: string | null }>();
  private readonly workspaces = new Map<string, string>();
  private listing: Promise<HeartbeatSummary[]> | null = null;
  private listed: { at: number; value: HeartbeatSummary[] } | null = null;
  private readonly listTtlMs: number;
  private readonly runStartGraceMs: number;
  private readonly now: () => number;
  private readonly log: (message: string, error?: unknown) => void;

  constructor(
    private readonly schedules: ScheduleClient,
    options: HeartbeatServiceOptions = {},
  ) {
    this.listTtlMs = options.listTtlMs ?? 2_000;
    this.runStartGraceMs = options.runStartGraceMs ?? 2_000;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((message, error) => console.error(message, error));
  }

  list(resolveWorkspace: WorkspaceResolver): Promise<HeartbeatSummary[]> {
    if (this.listed && this.now() - this.listed.at < this.listTtlMs) {
      return Promise.resolve(this.listed.value);
    }
    if (!this.listing) {
      this.listing = this.loadList(resolveWorkspace).finally(() => {
        this.listing = null;
      });
    }
    return this.listing;
  }

  async get(id: string, resolveWorkspace: WorkspaceResolver): Promise<HeartbeatDetail> {
    return this.detail(await this.requireHeartbeat(id), resolveWorkspace);
  }

  async update(update: HeartbeatUpdate, resolveWorkspace: WorkspaceResolver) {
    await this.requireHeartbeat(update.id);
    if (!hasChanges(update)) return this.get(update.id, resolveWorkspace);
    const record = parseScheduleRecord(await this.schedules.update(toUpdateOptions(update)));
    this.invalidateList();
    return this.detail(record, resolveWorkspace);
  }

  async setPaused(id: string, paused: boolean, resolveWorkspace: WorkspaceResolver) {
    await this.requireHeartbeat(id);
    if (paused) await this.schedules.pause(id);
    else await this.schedules.resume(id);
    this.invalidateList();
    return this.get(id, resolveWorkspace);
  }

  /**
   * The daemon answers `run-once` only after the agent's turn ends. Report an
   * early failure (already running, completed schedule) and otherwise let the
   * run continue; its outcome shows up in the heartbeat's runs.
   */
  async runOnce(id: string): Promise<RunOnceResult> {
    await this.requireHeartbeat(id);
    this.invalidateList();
    const outcome = this.schedules.runOnce(id).then(
      (schedule) => ({ ok: true as const, schedule }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = new Promise<"started">((resolve) => {
      timer = setTimeout(() => resolve("started"), this.runStartGraceMs);
    });
    const first = await Promise.race([outcome, started]);
    clearTimeout(timer);
    this.invalidateList();
    if (first === "started") {
      void outcome.then((result) => {
        // A long turn outlasts the client's request timeout; the daemon keeps running it.
        if (!result.ok) this.log(`Stopped waiting for the manual run of heartbeat ${id}`, result.error);
        this.invalidateList();
      });
      return { state: "started", status: null, error: null };
    }
    if (!first.ok) throw first.error;
    const run = toHeartbeatRuns(parseScheduleRecord(first.schedule))[0];
    return { state: "finished", status: run?.status ?? null, error: run?.error ?? null };
  }

  async delete(id: string): Promise<{ id: string }> {
    await this.requireHeartbeat(id);
    await this.schedules.delete(id);
    this.lastRuns.delete(id);
    this.invalidateList();
    return { id };
  }

  private async loadList(resolveWorkspace: WorkspaceResolver): Promise<HeartbeatSummary[]> {
    const records = parseScheduleRecords(await this.schedules.list(), (error) =>
      this.log("Skipped a schedule this plugin cannot read", error),
    ).filter((record) => heartbeatAgentId(record) !== null);
    const ids = new Set(records.map((record) => record.id));
    for (const id of this.lastRuns.keys()) if (!ids.has(id)) this.lastRuns.delete(id);
    const value = await mapWithConcurrency(records, INSPECT_CONCURRENCY, async (record) =>
      toHeartbeatSummary(
        record,
        await this.workspaceFor(heartbeatAgentId(record)!, resolveWorkspace),
        await this.lastRunStatus(record),
      ),
    );
    this.listed = { at: this.now(), value };
    return value;
  }

  private async lastRunStatus(record: ScheduleRecord): Promise<string | null> {
    if (!record.lastRunAt) return null;
    const known = this.lastRuns.get(record.id);
    if (known?.lastRunAt === record.lastRunAt) return known.status;
    try {
      const inspected = parseScheduleRecord(await this.schedules.inspect(record.id));
      return this.rememberLastRun(inspected);
    } catch (error) {
      this.log(`Failed to read the runs of heartbeat ${record.id}`, error);
      return known?.status ?? null;
    }
  }

  private rememberLastRun(record: ScheduleRecord): string | null {
    const status = newestRunStatus(record);
    if (record.lastRunAt) this.lastRuns.set(record.id, { lastRunAt: record.lastRunAt, status });
    return status;
  }

  private async detail(record: ScheduleRecord, resolveWorkspace: WorkspaceResolver) {
    const agentId = heartbeatAgentId(record);
    if (!agentId) throw new Error(`Schedule ${record.id} is not a heartbeat`);
    if (record.runs) this.rememberLastRun(record);
    return toHeartbeatDetail(record, await this.workspaceFor(agentId, resolveWorkspace));
  }

  /** Refuses schedules that start new agents; this plugin only manages heartbeats. */
  private async requireHeartbeat(id: string): Promise<ScheduleRecord> {
    const record = parseScheduleRecord(await this.schedules.inspect(id));
    if (!heartbeatAgentId(record)) throw new Error(`Schedule ${id} is not a heartbeat`);
    return record;
  }

  private async workspaceFor(
    agentId: string,
    resolveWorkspace: WorkspaceResolver,
  ): Promise<string | null> {
    const known = this.workspaces.get(agentId);
    if (known) return known;
    let workspaceId: string | null = null;
    try {
      workspaceId = await resolveWorkspace(agentId);
    } catch (error) {
      this.log(`Failed to look up the workspace of agent ${agentId}`, error);
    }
    if (workspaceId) this.workspaces.set(agentId, workspaceId);
    return workspaceId;
  }

  private invalidateList(): void {
    this.listed = null;
  }
}

async function mapWithConcurrency<Item, Result>(
  items: readonly Item[],
  limit: number,
  map: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await map(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}
