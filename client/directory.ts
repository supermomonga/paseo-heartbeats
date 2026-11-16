import type { HeartbeatSummary } from "../shared/heartbeats";

export interface DirectorySnapshot {
  /** False until the first listing settles. */
  readonly loaded: boolean;
  /** The last listing error; the previous heartbeats stay available. */
  readonly error: string | null;
  readonly heartbeats: readonly HeartbeatSummary[];
  readonly byAgent: ReadonlyMap<string, readonly HeartbeatSummary[]>;
}

const NO_HEARTBEATS: readonly HeartbeatSummary[] = Object.freeze([]);

const INITIAL: DirectorySnapshot = Object.freeze({
  loaded: false,
  error: null,
  heartbeats: NO_HEARTBEATS,
  byAgent: new Map(),
});

/**
 * The client's view of every heartbeat on one host. Paseo sends no schedule
 * events, so it polls and refreshes after this plugin changes a heartbeat.
 * Snapshots are replaced only when their content changes, which keeps them
 * usable with `useSyncExternalStore`.
 */
export class HeartbeatDirectory {
  private snapshot: DirectorySnapshot = INITIAL;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private queued: Promise<void> | null = null;
  private active = true;
  private stopped = false;

  constructor(
    private readonly load: () => Promise<readonly HeartbeatSummary[]>,
    private readonly intervalMs = 30_000,
  ) {}

  start(): void {
    if (this.stopped || this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => {
      if (this.active) void this.refresh();
    }, this.intervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  /** Pauses polling while the app is in the background and catches up on return. */
  setActive(active: boolean): void {
    const resumed = active && !this.active;
    this.active = active;
    if (resumed) void this.refresh();
  }

  /** A refresh requested during a listing runs once more after it, so it sees later changes. */
  refresh(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (!this.running) {
      this.running = this.loadOnce().finally(() => {
        this.running = null;
      });
      return this.running;
    }
    if (!this.queued) {
      this.queued = this.running.then(() => {
        this.queued = null;
        return this.refresh();
      });
    }
    return this.queued;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): DirectorySnapshot => this.snapshot;

  forAgent(agentId: string): readonly HeartbeatSummary[] {
    return this.snapshot.byAgent.get(agentId) ?? NO_HEARTBEATS;
  }

  private async loadOnce(): Promise<void> {
    try {
      const heartbeats = await this.load();
      if (this.stopped) return;
      this.publish(heartbeats, null);
    } catch (error) {
      if (this.stopped) return;
      this.publish(this.snapshot.heartbeats, error instanceof Error ? error.message : String(error));
    }
  }

  private publish(heartbeats: readonly HeartbeatSummary[], error: string | null): void {
    const current = this.snapshot;
    if (
      current.loaded &&
      current.error === error &&
      JSON.stringify(current.heartbeats) === JSON.stringify(heartbeats)
    ) {
      return;
    }
    const byAgent = new Map<string, HeartbeatSummary[]>();
    for (const heartbeat of [...heartbeats].sort(compareHeartbeats)) {
      const list = byAgent.get(heartbeat.agentId);
      if (list) list.push(heartbeat);
      else byAgent.set(heartbeat.agentId, [heartbeat]);
    }
    this.snapshot = Object.freeze({ loaded: true, error, heartbeats, byAgent });
    for (const listener of [...this.listeners]) listener();
  }
}

const STATUS_ORDER: Record<string, number> = { active: 0, paused: 1, completed: 2 };

/** Active first, then paused, then finished; soonest run first within a status. */
export function compareHeartbeats(left: HeartbeatSummary, right: HeartbeatSummary): number {
  const byStatus = (STATUS_ORDER[left.status] ?? 1.5) - (STATUS_ORDER[right.status] ?? 1.5);
  if (byStatus !== 0) return byStatus;
  const leftNext = left.nextRunAt ? Date.parse(left.nextRunAt) : Number.POSITIVE_INFINITY;
  const rightNext = right.nextRunAt ? Date.parse(right.nextRunAt) : Number.POSITIVE_INFINITY;
  if (leftNext !== rightNext) return leftNext - rightNext;
  return left.id.localeCompare(right.id);
}

/** Which heartbeat each agent's panel shows; the pill popover sets it before opening the panel. */
export class HeartbeatSelection {
  private readonly selected = new Map<string, string>();
  private readonly listeners = new Set<() => void>();

  select(agentId: string, heartbeatId: string): void {
    if (this.selected.get(agentId) === heartbeatId) return;
    this.selected.set(agentId, heartbeatId);
    for (const listener of [...this.listeners]) listener();
  }

  get(agentId: string): string | null {
    return this.selected.get(agentId) ?? null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}
