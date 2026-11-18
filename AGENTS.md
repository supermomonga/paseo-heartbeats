# Repository Guidelines

## Project Structure

## Development and Verification Commands

## Coding Conventions

## Testing Guidelines

## Commits and Pull Requests

## Design and Configuration Guidelines

- 依存関係のロックファイルは `npm-shrinkwrap.json`。npm パッケージに同梱して、ユーザーの環境に入る依存関係を固定する（Paseo のプラグインレジストリの審査で必要）。`package-lock.json` は作らない。依存関係を変えたら `npm install` で `npm-shrinkwrap.json` を更新する。
- `OVERVIEW.md` はプラグインレジストリの一覧ページに載る。変えたら `OVERVIEW.zh-CN.md` も同じ内容に直す。説明文は `package.json` の `description`、`paseo-plugin.json` の `description` と `translations` でそろえる。
- OVERVIEW には `paseo plugin add`、`npm install`、`npm i` を書かない（レジストリの検証で弾かれる）。インストールの手順は README に書く。
- `assets/listing/` の画像は一覧ページと README で使う。UI の見た目を変えたら撮り直す。

## Releasing

- `release.yml` は `package.json` の version が変わったときだけ publish する。version を勝手に変えない。リリースは Version Bump ワークフローの PR を経由する。
- 初回リリース（まだ npm にパッケージが無い間）は、先に人が手元で `npm publish` を実行し、続けて `npm trust github paseo-heartbeats --file release.yml --repo supermomonga/paseo-heartbeats --allow-publish -y` を実行する必要がある（パスキー認証。エージェントは実行できない）。リリースを頼まれたら、この手順をユーザーに案内すること。詳細は README の Releasing を参照。
