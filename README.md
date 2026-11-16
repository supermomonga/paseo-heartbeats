# paseo-heartbeats

Paseo plugin: show a session's heartbeats as a pill, with detail and editing in the side panel

## Installation

```
paseo plugin add npm:paseo-heartbeats
```

Git の場合: `paseo plugin add github:supermomonga/paseo-heartbeats`

## 仕組み

プラグイン SDK・`paseo schedule` CLI・Paseo の MCP ツールは、ほかのエージェントの Heartbeat を扱えない。そのため daemon 側のコード（`server/daemon.ts`）が、CLI と同じローカル認証（daemon ホームの `paseo.pid` と `local-credential`、または `PASEO_PASSWORD`）で自分の daemon に接続し、スケジュールの RPC を直接呼ぶ。経緯は [ADR 0002](docs/adr/0002-manage-heartbeats-through-a-direct-session-to-the-local-daemon.md) を参照。

## Development

```
npm ci
npm run typecheck
npm test
```

## Releasing

Version Bump ワークフローを main から実行する（patch / minor / major、または明示バージョン）。`release/v<version>` の PR が作られるので、CI が通ったらマージする。Release ワークフローがタグ付け、npm publish（trusted publishing）、GitHub release の作成を行う。

### 初回リリース（初めて npm に公開するとき）

npm の trusted publishing は、パッケージが npm に存在しないと登録できない。初回だけ、次の 2 つを手元の端末で順に実行する（npm の 2FA はパスキー認証で、ブラウザでの承認が要る）。

```
npm publish
npm trust github paseo-heartbeats --file release.yml --repo supermomonga/paseo-heartbeats --allow-publish -y
```

2 回目以降は上記の手順（Version Bump の PR をマージ）だけで publish される。
