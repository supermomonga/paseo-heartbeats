---
number: 2
title: Manage heartbeats through a direct session to the local daemon
status: accepted
date: 2026-11-16
---

# Manage heartbeats through a direct session to the local daemon

## Context and Problem Statement

The plugin lists every heartbeat on a host, shows each one's prompt and run
history, and lets the user edit, pause, resume, run, and delete it. A heartbeat
is a Paseo schedule whose target is an existing agent (`target.type === "agent"`,
or the legacy `"self"`).

As of Paseo 0.15.4, and still on the 0.16.0 `main` branch checked on 2026-11-16,
none of the interfaces meant for plugins or tools reach those schedules:

* The plugin SDK's `PaseoApi` (handler `{ paseo }` and client `usePaseo()`) has
  workspaces, agents, providers, and config, but no schedules.
* Every `paseo schedule` CLI command keeps only `new-agent` schedules
  (`ls` filters them; `inspect`, `update`, `pause`, `resume`, `run-once`, and
  `logs` reject other targets as "not found").
* `paseo heartbeat` only creates, changes the cron of, or deletes the calling
  agent's own heartbeats, and requires `PASEO_AGENT_ID`.
* The MCP schedule tools apply the same `new-agent` filter, and the MCP heartbeat
  tools are scoped to the calling agent.

The daemon's own WebSocket RPCs (`schedule/list`, `schedule/inspect`,
`schedule/update`, `schedule/pause`, `schedule/resume`, `schedule/run-once`,
`schedule/delete`) cover every target. The app's sidebar uses them.

How should the plugin's daemon-side code read and change heartbeats?

## Decision Drivers

* The plugin must read and change heartbeats of any agent, including the prompt.
* It should rely on interfaces that Paseo ships, and stay small enough to replace
  when Paseo adds a supported API.
* It must not weaken the daemon's authentication.

## Considered Options

* Drive the `paseo` CLI with `--json`
* Call the Paseo MCP tools
* Open a session to the local daemon with `createHostClient` from `@getpaseo/client/node`
* Read the schedule store files in the daemon home

## Decision Outcome

Chosen option: "Open a session to the local daemon with `createHostClient` from
`@getpaseo/client/node`". It is the only option that reaches all heartbeats
through the daemon's validation and scheduler.

`server/daemon.ts` connects the way the CLI does for a local daemon. It reads the
endpoint from `<PASEO_HOME>/paseo.pid` (`listen`) and authenticates with
`PASEO_PASSWORD` when that is set, or otherwise with the token in
`<PASEO_HOME>/local-credential`. The plugin subprocess inherits `PASEO_HOME`
from the daemon. The session is opened on first use, and opened again with
fresh endpoint and credential after a disconnect, for example after a daemon
restart. Only `server/daemon.ts` touches the client library. The rest of the
server code depends on its small `ScheduleClient` interface.

`@getpaseo/client` moves to `dependencies`, because Paseo bundles it into the
server entry at install time and does not supply it to server code.

### Consequences

* Good, because the plugin sees every heartbeat with full agent IDs, prompts,
  and run history in one `schedule/list` call, and changes go through the
  daemon's own validation and scheduling.
* Good, because the credential never leaves the daemon machine or the plugin
  subprocess, and the session uses the same local authentication as the CLI.
* Bad, because it depends on details that Paseo does not document for plugins:
  the `paseo.pid` and `local-credential` files and the `DaemonClient` schedule
  methods. A Paseo release can change them.
* Bad, because it only works when the plugin runs on the same machine as the
  daemon that owns the heartbeats. That holds for plugins, which run as daemon
  subprocesses.
* Neutral, because the plugin opens a second owner session next to the one Paseo
  gives each plugin. The plugin already had owner permissions through that
  session; the SDK just does not expose schedules.

### Confirmation

`server/schedules.test.ts` covers reading the endpoint and credential files.
`server/heartbeat-service.test.ts` checks that the plugin never changes a
schedule that is not a heartbeat. After a Paseo upgrade, list heartbeats through
the plugin RPC and edit one before releasing.

## Pros and Cons of the Options

### Drive the `paseo` CLI with `--json`

* Good, because the CLI is a documented, user-facing interface.
* Bad, because `paseo schedule` excludes heartbeats and `paseo heartbeat` is
  limited to the calling agent. It cannot list heartbeats or change prompts.
* Bad, because it also needs the CLI on the daemon's `PATH` and spawns a process
  per call.

### Call the Paseo MCP tools

* Bad, because the schedule tools exclude heartbeats and the heartbeat tools
  only cover the calling agent's own, like the CLI.
* Bad, because a plugin has no agent-scoped MCP session to call them from.

### Open a session to the local daemon with `createHostClient`

* Good, because it covers every operation the plugin needs.
* Bad, because of the undocumented dependencies listed under Consequences.

### Read the schedule store files in the daemon home

* Bad, because writes behind the daemon's back race with its scheduler and are
  not picked up by the running daemon, so it can at most cover reading.

## More Information

Revisit this decision when the plugin SDK gains schedule access or when the CLI
or MCP tools include heartbeats. `server/daemon.ts` is the only module to
replace then.
