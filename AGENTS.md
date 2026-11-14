# Repository Guidelines

## Project Structure

## Development and Verification Commands

## Coding Conventions

## Testing Guidelines

## Commits and Pull Requests

## Design and Configuration Guidelines

## Releasing

- `release.yml` は `package.json` の version が変わったときだけ publish する。version を勝手に変えない。リリースは Version Bump ワークフローの PR を経由する。
- 初回リリース（まだ npm にパッケージが無い間）は、先に人が手元で `npm publish` を実行し、続けて `npm trust github paseo-heartbeats --file release.yml --repo supermomonga/paseo-heartbeats --allow-publish -y` を実行する必要がある（パスキー認証。エージェントは実行できない）。リリースを頼まれたら、この手順をユーザーに案内すること。詳細は README の Releasing を参照。
