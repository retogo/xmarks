# xmarks

X の「いいね」「ブックマーク」を Notion Knowledge Base に取り込むツール。
**Claude Code から `/xmarks` skill 経由で実行する前提**で設計されている。

## 役割分担

- **xmarks CLI (このリポジトリ)**: X API への取得操作を提供する原子CLI。OAuth と JSON出力のみを担当。
- **Notion 側**: Notion MCP (`mcp__notion__*`) を skill から直接呼ぶ。CLI には Notion アダプタを置かない。
- **判断**: 「何をノートにするか / Tags / Title / 本文の整形」は skill 内で Claude が判断する。

## CLI サブコマンド

| コマンド | 出力 | 用途 |
|---|---|---|
| `bun run auth` | stderr | OAuth 2.0 PKCE フロー、トークン保存 |
| `bun run me` | JSON | 認証済みユーザーの確認 |
| `bun run fetch --source likes\|bookmarks [--limit 5..100] [--since ISO] [--until ISO] [--out FILE]` | JSON配列 | ポスト取得 |
| `bun run thread <conv-id> <author-id> [--out FILE]` | JSON or null | 投稿主スレッド取得 |
| `bun run tweet <tweet-id> [--out FILE]` | JSON or null | 任意の tweet/article を1件取得 |
| `bun run article <tweet-id> [--out FILE]` | markdown | X article 本文を Grok 経由で取得（要 XAI_API_KEY）|
| `bun run video <tweet-id> [--out FILE]` | markdown | 添付動画の中身を Grok の view_x_video で要約（要 XAI_API_KEY）|

`--out` でローカルキャッシュ（`.xmarks/cache/*.json` 等）にも書き出す。skill が再試行時に再 fetch を避けるため。

## Architecture

- **言語**: TypeScript (Bun ランタイム)
- **アーキテクチャ**: Hexagonal (Ports and Adapters)
  - `domain/`: エンティティ・値オブジェクト (Post / Thread)
  - `ports/driving/`: 駆動側インターフェース (Harvest)
  - `ports/driven/`: 被駆動側インターフェース (XSource / XInsightSource / SecretStore)
  - `application/`: ユースケース (harvest, x-insight)
  - `adapters/driving/`: CLI 実装
  - `adapters/driven/`: X API / Grok API / Secret Store 実装
  - `config.ts`: 環境変数からの設定組み立て

## Directory layout

```
.claude/skills/xmarks/SKILL.md               # skill: ワークフローと判断基準
terraform/                                   # GCP 側 IaC (GSM secret / SA / IAM)
src/
├── domain/post.ts                           # Post / Thread / Article info
├── ports/
│   ├── driving/harvest.ts                   # Harvest interface
│   └── driven/{x-source,x-insight,secret-store}.ts
├── application/{harvest,x-insight}.ts       # ユースケース
├── adapters/
│   ├── driving/cli/index.ts                 # auth/me/fetch/thread/tweet/article/video
│   └── driven/
│       ├── x/{auth,client,mapper}.ts        # arctic + X API v2
│       ├── grok/{api,insight}.ts            # 汎用 Grok client + article/video 実装
│       └── secrets/{local,gsm,bootstrap,index}.ts
└── config.ts
index.ts                                     # CLI エントリ
```

依存方向は `adapters → application → ports → domain` の一方向。`domain` と `ports` は外部ライブラリに依存しない。

## Claude Code Routines による自動実行

毎日決まった時間に `/xmarks` を実行する場合の構成。

### GCP 側準備（Terraform 管理）

`terraform/` 以下で IaC 管理。詳細は `terraform/README.md`。

```bash
cd terraform
terraform init
terraform apply -var="project_id=<PROJECT>"
$(terraform output -raw key_create_command)   # SA key JSON 発行（gcloud 経由）
cd ..
```

Terraform が作るもの:
- `secretmanager.googleapis.com` 有効化
- service account `xmarks-routine`
- ロール: `secretmanager.{secretAccessor, secretVersionAdder, secretVersionManager}`
- secret `xmarks-x-oauth-tokens`（空、初回 `bun run auth` で初期 version が入る）

SA key は tfstate に残さないため Terraform 管理外。`terraform output key_create_command` の通り `gcloud` で発行する。

### ローカルでの初回ブートストラップ

GSM へ初回トークンを書き込む:

```bash
SECRET_BACKEND=gsm \
GOOGLE_CLOUD_PROJECT=<PROJECT> \
GOOGLE_APPLICATION_CREDENTIALS=$PWD/terraform/sa-key.json \
X_CLIENT_ID=<...> bun run auth
```

ブラウザ認可後、GSM の `xmarks-x-oauth-tokens` に最新 token が保存される。
以降のローカル動作確認は同じ env で `bun run me` 等。

### Claude Code Routines 設定

- **Repository**: GitHub にこのリポジトリを push し routine から指定
- **Connectors**: Notion を有効に（持ち回される）
- **Schedule**: daily 07:00（ローカルTZ）など
- **Environment variables**:
  ```
  X_CLIENT_ID=<...>
  X_CLIENT_SECRET=<Native App なら空>
  SECRET_BACKEND=gsm
  GOOGLE_CLOUD_PROJECT=<project>
  GCP_SA_KEY_JSON=<SA key の JSON 全体（ファイル不要、文字列で投入）>
  ```
- **Prompt**: `/xmarks` （引数つけてもよい）

`GCP_SA_KEY_JSON` を渡すと、起動時に一時ファイルへ展開して `GOOGLE_APPLICATION_CREDENTIALS` を自動設定する（`adapters/driven/secrets/bootstrap.ts`）。ファイル配置不要。

### コスト

- X API: post 件数課金（Basic = 月10K）。skill が「判定→thread取得」順なので無駄なthread fetchを回避
- GSM: token を refresh するたび新 version が増えるが、`gsm.ts put()` が古い version を destroy するので **active version は常に1（無料枠 6 以内）**
- Routines 実行: Pro = 5/day、Max = 15/day の範囲内に収まる（1日1回）

---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
