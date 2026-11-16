import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readDaemonListen, readLocalCredential, resolvePaseoHome } from "./daemon";
import { heartbeatAgentId, previewPrompt, toUpdateOptions } from "./schedules";

describe("heartbeatAgentId", () => {
  it("accepts agent and legacy self targets only", () => {
    expect(heartbeatAgentId({ target: { type: "agent", agentId: "a" } })).toBe("a");
    expect(heartbeatAgentId({ target: { type: "self", agentId: "a" } })).toBe("a");
    expect(heartbeatAgentId({ target: { type: "new-agent" } })).toBeNull();
  });
});

describe("toUpdateOptions", () => {
  it("replaces the cadence and omits an empty time zone", () => {
    expect(
      toUpdateOptions({ id: "hb1", cron: { expression: " 0 9 * * 1-5 ", timezone: "Asia/Tokyo" } }),
    ).toEqual({
      id: "hb1",
      cadence: { type: "cron", expression: "0 9 * * 1-5", timezone: "Asia/Tokyo" },
    });
    expect(toUpdateOptions({ id: "hb1", cron: { expression: "0 9 * * *" } }).cadence).toEqual({
      type: "cron",
      expression: "0 9 * * *",
    });
  });

  it("clears a blank name", () => {
    expect(toUpdateOptions({ id: "hb1", name: "  " })).toEqual({ id: "hb1", name: null });
  });
});

describe("previewPrompt", () => {
  it("collapses whitespace and truncates", () => {
    expect(previewPrompt("  a\n\n b ")).toBe("a b");
    expect(previewPrompt("x".repeat(300))).toHaveLength(200);
  });
});

describe("daemon home", () => {
  let home: string | null = null;
  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
    home = null;
  });

  it("uses PASEO_HOME and falls back to ~/.paseo", () => {
    expect(resolvePaseoHome({ PASEO_HOME: " /srv/paseo " })).toBe("/srv/paseo");
    expect(resolvePaseoHome({})).toMatch(/\.paseo$/);
  });

  it("reads the listen address and a well-formed credential", () => {
    home = mkdtempSync(join(tmpdir(), "paseo-heartbeats-"));
    writeFileSync(join(home, "paseo.pid"), JSON.stringify({ pid: 1, listen: "127.0.0.1:6767" }));
    writeFileSync(join(home, "local-credential"), `${"a".repeat(43)}\n`);
    expect(readDaemonListen(home)).toBe("127.0.0.1:6767");
    expect(readLocalCredential(home)).toBe("a".repeat(43));
    writeFileSync(join(home, "local-credential"), "short\n");
    expect(readLocalCredential(home)).toBeUndefined();
  });

  it("explains a missing daemon", () => {
    home = mkdtempSync(join(tmpdir(), "paseo-heartbeats-"));
    expect(() => readDaemonListen(home!)).toThrow("Could not read the Paseo daemon endpoint");
  });
});
