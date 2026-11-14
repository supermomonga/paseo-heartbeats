# paseo-heartbeats

Paseo plugin: show a session's heartbeats as a pill, with detail and editing in the side panel

## Installation

```
paseo plugin add npm:paseo-heartbeats
```

Git の場合: `paseo plugin add github:supermomonga/paseo-heartbeats`

## Development

```
npm ci
npm run typecheck
npm test
```

## Releasing

Version Bump ワークフローを main から実行する（patch / minor / major、または明示バージョン）。`release/v<version>` の PR が作られるので、CI が通ったらマージする。Release ワークフローがタグ付け、npm publish（trusted publishing）、GitHub release の作成を行う。
