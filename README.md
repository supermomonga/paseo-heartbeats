<div align="center">

# paseo-heartbeats

*See and edit a session's heartbeats without leaving the session.*

[![CI](https://img.shields.io/github/actions/workflow/status/supermomonga/paseo-heartbeats/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/supermomonga/paseo-heartbeats/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/paseo-heartbeats?style=flat-square)](https://www.npmjs.com/package/paseo-heartbeats)
[![Paseo](https://img.shields.io/badge/Paseo-%3E%3D0.15.0-blue?style=flat-square)](https://paseo.sh)
[![License](https://img.shields.io/github/license/supermomonga/paseo-heartbeats?style=flat-square)](LICENSE)

[Features](#features) • [Installation](#installation) • [Usage](#usage) • [How it works](#how-it-works) • [Limitations](#limitations) • [Development](#development)

</div>

A [Paseo](https://paseo.sh) plugin that shows a session's heartbeats as a pill in the composer, and lets you inspect and edit them in the side panel.

A *heartbeat* is a recurring prompt that Paseo sends to an existing agent on a cron schedule. Agents usually create their own with `paseo heartbeat create` or Paseo's MCP tools, and the heartbeats then keep running in the background. This plugin shows them next to the session they belong to, so you can see when the next one runs and change it there.

## Features

- **Composer pill**: sessions with heartbeats get a pill next to Tasks and Subagents. It shows how many heartbeats the session has and when the next one runs, such as `2 · 14:30`, or `Paused` when all of them are paused.
- **Quick list**: pressing the pill lists the session's heartbeats, with their cadence, next run, and whether the last run failed.
- **Editor in the Explorer**: edit the name, prompt, cron expression, and time zone. Pause, resume, or run a heartbeat once now, or delete it after a confirmation.
- **Run history**: browse recent runs, with each run's outcome, duration, error, and the agent's final message.
- **Command Center entry**: open the panel with "Heartbeats" while a session is selected.
- **Stays on the machine**: the plugin talks only to the local daemon, with the same credential as the `paseo` CLI.
- **English and Japanese UI**.

## Installation

You need Paseo 0.15.0 or later, on both the daemon and the app.

Install the plugin from npm:

```bash
paseo plugin add npm:paseo-heartbeats
```

Or install it from Git:

```bash
paseo plugin add github:supermomonga/paseo-heartbeats
```

Then check that the plugin is `running`:

```bash
paseo plugin ls
```

> [!NOTE]
> The npm source needs `npm` on the daemon's `PATH`. The plugin's runtime ID is `heartbeats`, which you pass to other commands such as `paseo plugin update heartbeats` and `paseo plugin logs heartbeats`.

## Usage

1. Open a session that has heartbeats. The pill with the pulse icon appears in its composer.
2. Press the pill to list the session's heartbeats.
3. Choose one to open it in the Explorer. Edit the fields and press **Save**, or use **Pause**, **Resume**, **Run now**, and **Delete**.

You can also open the panel from the Command Center (<kbd>⌘K</kbd> on macOS, <kbd>Ctrl+K</kbd> on Windows and Linux) by choosing **Heartbeats** while a session is selected.

> [!TIP]
> **Run now** sends the prompt right away. If the agent is busy, Paseo records the run as failed and the plugin shows why. A run that takes longer than two seconds continues in the background, and its outcome appears under **Recent runs**.

## How it works

The plugin SDK, the `paseo schedule` CLI, and the Paseo MCP tools can't reach heartbeats of other agents. The daemon's own schedule RPCs can, so the plugin's daemon side opens a session to its local daemon the same way the `paseo` CLI does:

- the endpoint comes from `listen` in `<PASEO_HOME>/paseo.pid` (`~/.paseo` by default)
- the token comes from `<PASEO_HOME>/local-credential`, or from `PASEO_PASSWORD` when it is set

The session opens on first use and reopens after the daemon restarts. Every change goes through the daemon's own validation and scheduler, and the plugin only touches schedules that target an existing agent. Nothing leaves the daemon machine.

Paseo does not announce schedule changes, so the app checks for changes every 30 seconds while it is in the foreground, and right after you change something in the plugin.

> [!IMPORTANT]
> This approach relies on daemon internals that Paseo does not document for plugins: the `paseo.pid` and `local-credential` files and the client's schedule methods. A future Paseo release may need a plugin update. See [ADR 0002](docs/adr/0002-manage-heartbeats-through-a-direct-session-to-the-local-daemon.md) for the options considered.

## Limitations

- Changes made elsewhere, such as an agent creating a heartbeat, can take up to 30 seconds to appear.
- Finished heartbeats (completed after their maximum runs or expiry) do not get a pill. They still appear in the panel, where you can delete them.
- Once a heartbeat has a time zone, Paseo keeps it when the cron expression changes. You can change the time zone, but not remove it.
- Heartbeats that run on an interval instead of a cron expression keep their interval until you enter a cron expression.
- The plugin does not create heartbeats.

## Development

You need Node.js 22.12 or later.

```bash
npm ci
npm run typecheck
npm test
```

To try your checkout in Paseo, install it from its directory, and reload it after each change:

```bash
paseo plugin add /absolute/path/to/paseo-heartbeats
paseo plugin reload heartbeats
paseo plugin logs heartbeats
```

> [!TIP]
> If the published plugin is already installed, remove it first with `paseo plugin remove heartbeats`, so that the two copies don't share the same ID.

### Project layout

| Path | Contents |
| --- | --- |
| `index.client.tsx` | App entry: registers the composer pills, the Explorer panel, and the Command Center item |
| `index.server.ts` | Daemon entry: handles the plugin's RPCs |
| `client/` | Polling of heartbeats, pill, popover, panel, formatting, and English and Japanese text |
| `server/daemon.ts` | Session to the local daemon. The only module that uses `@getpaseo/client` |
| `server/heartbeat-service.ts`, `server/schedules.ts` | Selecting heartbeats among schedules, and converting them for the app |
| `shared/heartbeats.ts` | RPC definitions and schemas shared by both sides |
| `docs/adr/` | Architecture decision records |
| `OVERVIEW.md` | Description for the plugin's listing page |

### Releasing

Run the **Version Bump** workflow from `main`, with `patch`, `minor`, `major`, or an explicit version. It opens a `release/v<version>` pull request. Merge it once CI passes, and the **Release** workflow tags the version, publishes it to npm with trusted publishing, and creates a GitHub release.

> [!IMPORTANT]
> The Release workflow publishes only when the version in `package.json` changes. Don't change the version outside the Version Bump pull request.

<details>
<summary>First release to npm</summary>

npm trusted publishing can only be set up for a package that already exists on npm. For the first release only, run these two commands in order on your own machine. npm two-factor authentication uses a passkey, so you approve each one in the browser.

```bash
npm publish
npm trust github paseo-heartbeats --file release.yml --repo supermomonga/paseo-heartbeats --allow-publish -y
```

Later releases only need the Version Bump pull request.

</details>
