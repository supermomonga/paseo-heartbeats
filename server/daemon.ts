import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHostClient } from "@getpaseo/client/node";
import type { DaemonClient, UpdateScheduleOptions } from "@getpaseo/client/internal/daemon-client";

// The plugin SDK exposes no schedules, and the `paseo schedule` CLI and MCP
// tools leave heartbeats out. The daemon's own schedule RPCs cover them, so
// the plugin opens a session to its local daemon the way the CLI does: the
// endpoint from `paseo.pid` and the token from `local-credential` in the
// daemon home (or PASEO_PASSWORD when set). See docs/adr.

/** The schedule RPCs the plugin uses. Results are validated by the caller. */
export interface ScheduleClient {
  list(): Promise<unknown[]>;
  inspect(id: string): Promise<unknown>;
  update(options: UpdateScheduleOptions): Promise<unknown>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  /** Resolves with the schedule once the run ends; the client stops waiting after 60 seconds. */
  runOnce(id: string): Promise<unknown>;
  delete(id: string): Promise<void>;
}

export function resolvePaseoHome(env: NodeJS.ProcessEnv): string {
  return env.PASEO_HOME?.trim() || join(homedir(), ".paseo");
}

export function readDaemonListen(home: string): string {
  let lock: { listen?: unknown };
  try {
    lock = JSON.parse(readFileSync(join(home, "paseo.pid"), "utf8")) as { listen?: unknown };
  } catch (error) {
    throw new Error(`Could not read the Paseo daemon endpoint from ${home}: ${describe(error)}`);
  }
  if (typeof lock.listen !== "string" || !lock.listen.trim()) {
    throw new Error(`The Paseo daemon in ${home} does not report a listen address`);
  }
  return lock.listen.trim();
}

const LOCAL_CREDENTIAL = /^[A-Za-z0-9_-]{43}$/;

export function readLocalCredential(home: string): string | undefined {
  try {
    const token = readFileSync(join(home, "local-credential"), "utf8").trim();
    return LOCAL_CREDENTIAL.test(token) ? token : undefined;
  } catch {
    return undefined;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Throws the daemon's error string from a schedule response payload. */
function unwrap<Payload extends { error: string | null }>(payload: Payload): Payload {
  if (payload.error) throw new Error(payload.error);
  return payload;
}

/**
 * One session to the local daemon, opened on first use and reopened after the
 * daemon restarts. Endpoint and credential are read again on every open.
 */
export class LocalDaemonSchedules implements ScheduleClient {
  private client: DaemonClient | null = null;
  private opening: Promise<DaemonClient> | null = null;
  private disposed = false;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async list(): Promise<unknown[]> {
    const client = await this.connection();
    return unwrap(await client.scheduleList()).schedules;
  }

  async inspect(id: string): Promise<unknown> {
    const client = await this.connection();
    return unwrap(await client.scheduleInspect({ id })).schedule;
  }

  async update(options: UpdateScheduleOptions): Promise<unknown> {
    const client = await this.connection();
    return unwrap(await client.scheduleUpdate(options)).schedule;
  }

  async pause(id: string): Promise<void> {
    const client = await this.connection();
    unwrap(await client.schedulePause({ id }));
  }

  async resume(id: string): Promise<void> {
    const client = await this.connection();
    unwrap(await client.scheduleResume({ id }));
  }

  async runOnce(id: string): Promise<unknown> {
    const client = await this.connection();
    return unwrap(await client.scheduleRunOnce({ id })).schedule;
  }

  async delete(id: string): Promise<void> {
    const client = await this.connection();
    unwrap(await client.scheduleDelete({ id }));
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const client = this.client;
    this.client = null;
    await client?.close().catch(() => undefined);
  }

  private connection(): Promise<DaemonClient> {
    if (this.disposed) return Promise.reject(new Error("The heartbeats plugin is stopping"));
    if (this.client?.isConnected) return Promise.resolve(this.client);
    if (!this.opening) {
      this.opening = this.open().finally(() => {
        this.opening = null;
      });
    }
    return this.opening;
  }

  private async open(): Promise<DaemonClient> {
    const stale = this.client;
    this.client = null;
    await stale?.close().catch(() => undefined);

    const home = resolvePaseoHome(this.env);
    const listen = readDaemonListen(home);
    const password = this.env.PASEO_PASSWORD?.trim();
    const client = createHostClient(listen, {
      // `plugin:` IDs are reserved for the daemon's own plugin sessions.
      clientId: `paseo-heartbeats-${randomUUID()}`,
      clientType: "cli",
      ...(password ? { password } : { localCredential: () => readLocalCredential(home) }),
      connectTimeoutMs: 10_000,
      reconnect: { enabled: false },
    });
    try {
      await client.connect();
    } catch (error) {
      await client.close().catch(() => undefined);
      throw new Error(`Could not connect to the Paseo daemon at ${listen}: ${describe(error)}`);
    }
    if (this.disposed) {
      await client.close().catch(() => undefined);
      throw new Error("The heartbeats plugin is stopping");
    }
    this.client = client;
    return client;
  }
}
