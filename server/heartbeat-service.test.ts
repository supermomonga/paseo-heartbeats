import { describe, expect, it, vi } from "vitest";
import type { ScheduleClient } from "./daemon";
import { HeartbeatService } from "./heartbeat-service";

const AGENT_ID = "e940f281-3a80-4a97-a755-da416733c87e";

function heartbeat(overrides: Record<string, unknown> = {}) {
  return {
    id: "hb000001",
    name: "Check CI",
    prompt: "Look at the CI status",
    cadence: { type: "cron", expression: "*/10 * * * *" },
    target: { type: "agent", agentId: AGENT_ID },
    status: "active",
    createdAt: "2026-11-16T00:00:00.000Z",
    updatedAt: "2026-11-16T00:00:00.000Z",
    nextRunAt: "2026-11-16T10:10:00.000Z",
    lastRunAt: "2026-11-16T10:00:00.000Z",
    pausedAt: null,
    expiresAt: null,
    maxRuns: null,
    ...overrides,
  };
}

const RUNS = [
  {
    id: "run-1",
    scheduledFor: "2026-11-16T09:50:00.000Z",
    startedAt: "2026-11-16T09:50:01.000Z",
    endedAt: "2026-11-16T09:50:30.000Z",
    status: "succeeded",
    agentId: AGENT_ID,
    output: "ok",
    error: null,
  },
  {
    id: "run-2",
    scheduledFor: "2026-11-16T10:00:00.000Z",
    startedAt: "2026-11-16T10:00:01.000Z",
    endedAt: "2026-11-16T10:00:02.000Z",
    status: "failed",
    agentId: AGENT_ID,
    output: null,
    error: `Agent ${AGENT_ID} already has an active run`,
  },
];

const newAgentSchedule = heartbeat({
  id: "sched001",
  target: { type: "new-agent", config: { provider: "claude", cwd: "/tmp" } },
});

function fakeSchedules(overrides: Partial<ScheduleClient> = {}) {
  const calls: string[] = [];
  const record = (name: string) => calls.push(name);
  const schedules: ScheduleClient = {
    list: async () => (record("list"), [heartbeat(), newAgentSchedule]),
    inspect: async (id) => {
      record(`inspect:${id}`);
      return id === "sched001" ? { ...newAgentSchedule, runs: [] } : { ...heartbeat(), runs: RUNS };
    },
    update: async (options) => (record("update"), { ...heartbeat(), ...options, runs: RUNS }),
    pause: async () => void record("pause"),
    resume: async () => void record("resume"),
    runOnce: async () => (record("runOnce"), { ...heartbeat(), runs: RUNS }),
    delete: async () => void record("delete"),
    ...overrides,
  };
  const count = (name: string) => calls.filter((call) => call === name).length;
  return { schedules, calls, count };
}

const resolveWorkspace = async () => "wks_1";

describe("HeartbeatService.list", () => {
  it("keeps agent-targeted schedules with their latest run outcome", async () => {
    const fake = fakeSchedules();
    const list = await new HeartbeatService(fake.schedules).list(resolveWorkspace);
    expect(list).toEqual([
      expect.objectContaining({
        id: "hb000001",
        agentId: AGENT_ID,
        workspaceId: "wks_1",
        lastRunStatus: "failed",
        promptPreview: "Look at the CI status",
      }),
    ]);
  });

  it("reads runs again only after lastRunAt moves", async () => {
    let now = 0;
    let lastRunAt = "2026-11-16T10:00:00.000Z";
    const fake = fakeSchedules({ list: async () => [heartbeat({ lastRunAt })] });
    const service = new HeartbeatService(fake.schedules, { now: () => now, listTtlMs: 0 });
    await service.list(resolveWorkspace);
    now = 1;
    await service.list(resolveWorkspace);
    expect(fake.count("inspect:hb000001")).toBe(1);
    lastRunAt = "2026-11-16T10:10:00.000Z";
    now = 2;
    await service.list(resolveWorkspace);
    expect(fake.count("inspect:hb000001")).toBe(2);
  });

  it("does not read runs for a heartbeat that never ran", async () => {
    const fake = fakeSchedules({ list: async () => [heartbeat({ lastRunAt: null })] });
    const [summary] = await new HeartbeatService(fake.schedules).list(resolveWorkspace);
    expect(summary?.lastRunStatus).toBeNull();
    expect(fake.count("inspect:hb000001")).toBe(0);
  });

  it("shares one listing between concurrent callers", async () => {
    const fake = fakeSchedules();
    const service = new HeartbeatService(fake.schedules);
    await Promise.all([service.list(resolveWorkspace), service.list(resolveWorkspace)]);
    expect(fake.count("list")).toBe(1);
  });

  it("skips records it cannot read", async () => {
    const log = vi.fn();
    const fake = fakeSchedules({ list: async () => [{ id: "broken" }, heartbeat()] });
    const list = await new HeartbeatService(fake.schedules, { log }).list(resolveWorkspace);
    expect(list.map((item) => item.id)).toEqual(["hb000001"]);
    expect(log).toHaveBeenCalledOnce();
  });

  it("looks up an unknown agent's workspace again on the next listing", async () => {
    let now = 0;
    const fake = fakeSchedules();
    const service = new HeartbeatService(fake.schedules, { now: () => now, listTtlMs: 0 });
    const lookup = vi.fn<() => Promise<string | null>>().mockResolvedValueOnce(null);
    lookup.mockResolvedValue("wks_2");
    expect((await service.list(lookup))[0]?.workspaceId).toBeNull();
    now = 1;
    expect((await service.list(lookup))[0]?.workspaceId).toBe("wks_2");
  });
});

describe("HeartbeatService.get", () => {
  it("returns runs newest first", async () => {
    const detail = await new HeartbeatService(fakeSchedules().schedules).get(
      "hb000001",
      resolveWorkspace,
    );
    expect(detail.runs.map((run) => run.id)).toEqual(["run-2", "run-1"]);
    expect(detail.prompt).toBe("Look at the CI status");
  });

  it("refuses schedules that start new agents", async () => {
    const service = new HeartbeatService(fakeSchedules().schedules);
    await expect(service.get("sched001", resolveWorkspace)).rejects.toThrow("not a heartbeat");
  });
});

describe("HeartbeatService mutations", () => {
  it("clears the name with null and sends only changed fields", async () => {
    const update = vi.fn(async (options: object) => ({ ...heartbeat(), ...options, runs: [] }));
    const fake = fakeSchedules({ update });
    const detail = await new HeartbeatService(fake.schedules).update(
      { id: "hb000001", name: "", prompt: "New prompt" },
      resolveWorkspace,
    );
    expect(update).toHaveBeenCalledWith({ id: "hb000001", name: null, prompt: "New prompt" });
    expect(detail.name).toBeNull();
  });

  it("does not update when nothing changed", async () => {
    const fake = fakeSchedules();
    await new HeartbeatService(fake.schedules).update({ id: "hb000001" }, resolveWorkspace);
    expect(fake.count("update")).toBe(0);
  });

  it("never changes a schedule that is not a heartbeat", async () => {
    const fake = fakeSchedules();
    const service = new HeartbeatService(fake.schedules);
    await expect(service.update({ id: "sched001", prompt: "x" }, resolveWorkspace)).rejects.toThrow();
    await expect(service.setPaused("sched001", true, resolveWorkspace)).rejects.toThrow();
    await expect(service.runOnce("sched001")).rejects.toThrow();
    await expect(service.delete("sched001")).rejects.toThrow();
    expect(fake.calls.filter((call) => !call.startsWith("inspect"))).toEqual([]);
  });

  it("pauses and resumes", async () => {
    const fake = fakeSchedules();
    const service = new HeartbeatService(fake.schedules);
    await service.setPaused("hb000001", true, resolveWorkspace);
    await service.setPaused("hb000001", false, resolveWorkspace);
    expect(fake.calls.filter((call) => call === "pause" || call === "resume")).toEqual([
      "pause",
      "resume",
    ]);
  });
});

describe("HeartbeatService.runOnce", () => {
  it("reports a run that is still going as started", async () => {
    const fake = fakeSchedules({ runOnce: () => new Promise(() => undefined) });
    const service = new HeartbeatService(fake.schedules, { runStartGraceMs: 10 });
    await expect(service.runOnce("hb000001")).resolves.toEqual({
      state: "started",
      status: null,
      error: null,
    });
  });

  it("reports a run that ended within the grace period with its outcome", async () => {
    const service = new HeartbeatService(fakeSchedules().schedules, { runStartGraceMs: 1_000 });
    await expect(service.runOnce("hb000001")).resolves.toEqual({
      state: "finished",
      status: "failed",
      error: `Agent ${AGENT_ID} already has an active run`,
    });
  });

  it("rejects with an early failure", async () => {
    const fake = fakeSchedules({
      runOnce: async () => {
        throw new Error("Schedule hb000001 is already running");
      },
    });
    const service = new HeartbeatService(fake.schedules, { runStartGraceMs: 1_000 });
    await expect(service.runOnce("hb000001")).rejects.toThrow("already running");
  });

  it("logs a failure that arrives after reporting started", async () => {
    let fail: (error: Error) => void = () => undefined;
    const fake = fakeSchedules({
      runOnce: () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    });
    const log = vi.fn();
    const service = new HeartbeatService(fake.schedules, { runStartGraceMs: 10, log });
    await service.runOnce("hb000001");
    fail(new Error("late"));
    await vi.waitFor(() => expect(log).toHaveBeenCalledOnce());
  });
});
