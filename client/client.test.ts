import { describe, expect, it } from "vitest";
import type { HeartbeatDetail } from "../shared/heartbeats";
import { HeartbeatDirectory } from "./directory";
import { draftFrom, draftProblems, isEmptyUpdate, updateFromDraft } from "./draft";
import { errorMessage, formatInterval, formatShortTime, nextRunAt } from "./format";

const detail: HeartbeatDetail = {
  id: "hb1",
  agentId: "agent-1",
  workspaceId: "wks_1",
  name: "Check CI",
  promptPreview: "Look at CI",
  prompt: "Look at CI",
  cadence: { type: "cron", expression: "*/10 * * * *", timezone: "Asia/Tokyo" },
  status: "active",
  nextRunAt: "2026-11-16T10:10:00.000Z",
  lastRunAt: null,
  lastRunStatus: null,
  createdAt: "2026-11-16T00:00:00.000Z",
  updatedAt: "2026-11-16T00:00:00.000Z",
  pausedAt: null,
  expiresAt: null,
  maxRuns: null,
  runs: [],
};

describe("updateFromDraft", () => {
  it("is empty for an unchanged draft", () => {
    expect(isEmptyUpdate(updateFromDraft(detail, draftFrom(detail)))).toBe(true);
  });

  it("clears the name with an empty string", () => {
    expect(updateFromDraft(detail, { ...draftFrom(detail), name: "  " })).toEqual({
      id: "hb1",
      name: "",
    });
  });

  it("sends the cadence when only the time zone changes", () => {
    expect(updateFromDraft(detail, { ...draftFrom(detail), timezone: "UTC" }).cron).toEqual({
      expression: "*/10 * * * *",
      timezone: "UTC",
    });
  });

  it("leaves an interval cadence alone while the cron field is empty", () => {
    const every: HeartbeatDetail = { ...detail, cadence: { type: "every", everyMs: 300_000 } };
    const draft = { ...draftFrom(every), timezone: "UTC" };
    expect(updateFromDraft(every, draft).cron).toBeUndefined();
    expect(draftProblems(every, draft)).toEqual([]);
  });
});

describe("draftProblems", () => {
  it("requires a prompt and, for cron cadences, an expression", () => {
    expect(draftProblems(detail, { ...draftFrom(detail), prompt: " ", cron: "" })).toEqual([
      "promptRequired",
      "cronRequired",
    ]);
  });

  it("refuses to clear a time zone the daemon would keep", () => {
    expect(draftProblems(detail, { ...draftFrom(detail), timezone: "" })).toEqual([
      "timezoneRequired",
    ]);
    const local: HeartbeatDetail = { ...detail, cadence: { type: "cron", expression: "0 9 * * *" } };
    expect(draftProblems(local, draftFrom(local))).toEqual([]);
  });
});

describe("format", () => {
  it("shortens times relative to today", () => {
    const now = new Date(2026, 10, 16, 8, 0);
    expect(formatShortTime(new Date(2026, 10, 16, 14, 5).toISOString(), now)).toBe("14:05");
    expect(formatShortTime(new Date(2026, 10, 17, 9, 0).toISOString(), now)).toBe("11/17 09:00");
    expect(formatShortTime(new Date(2027, 0, 5, 9, 0).toISOString(), now)).toBe("2027/1/5 09:00");
  });

  it("strips RPC transport details from errors", () => {
    expect(
      errorMessage(
        new Error(
          "Request failed: Schedule a1 is not a heartbeat requestType=plugin.rpc.invoke.request code=handler_error",
        ),
      ),
    ).toBe("Schedule a1 is not a heartbeat");
    expect(errorMessage("plain")).toBe("plain");
  });

  it("formats intervals", () => {
    expect(formatInterval(300_000)).toBe("5m");
    expect(formatInterval(5_400_000)).toBe("1h30m");
    expect(formatInterval(0)).toBe("0s");
  });

  it("finds the soonest active run", () => {
    expect(
      nextRunAt([
        { ...detail, nextRunAt: "2026-11-16T12:00:00.000Z" },
        { ...detail, id: "hb2", nextRunAt: "2026-11-16T11:00:00.000Z" },
        { ...detail, id: "hb3", status: "paused", nextRunAt: "2026-11-16T09:00:00.000Z" },
      ]),
    ).toBe("2026-11-16T11:00:00.000Z");
    expect(nextRunAt([{ ...detail, status: "paused" }])).toBeNull();
  });
});

describe("HeartbeatDirectory", () => {
  it("keeps the snapshot when a listing returns the same heartbeats", async () => {
    const directory = new HeartbeatDirectory(async () => [detail]);
    await directory.refresh();
    const first = directory.getSnapshot();
    await directory.refresh();
    expect(directory.getSnapshot()).toBe(first);
    expect(directory.forAgent("agent-1")).toHaveLength(1);
  });

  it("runs once more when refreshed during a listing", async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const directory = new HeartbeatDirectory(async () => {
      calls += 1;
      if (calls === 1) await new Promise<void>((resolve) => (release = resolve));
      return [];
    });
    const first = directory.refresh();
    const second = directory.refresh();
    const third = directory.refresh();
    release();
    await Promise.all([first, second, third]);
    expect(calls).toBe(2);
  });

  it("keeps the previous heartbeats when a listing fails", async () => {
    let fail = false;
    const directory = new HeartbeatDirectory(async () => {
      if (fail) throw new Error("CLI not found");
      return [detail];
    });
    await directory.refresh();
    fail = true;
    await directory.refresh();
    expect(directory.getSnapshot()).toMatchObject({ error: "CLI not found" });
    expect(directory.forAgent("agent-1")).toHaveLength(1);
  });
});
