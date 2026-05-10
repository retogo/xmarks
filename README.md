# xmarks

X の「いいね」「ブックマーク」を Notion Knowledge Base に取り込むツール。Claude Code から `/xmarks` skill 経由で動かす想定。

## クイックスタート

### 1. クレデンシャル

| サービス | 必須 | 取得先 |
|---|---|---|
| X OAuth 2.0 Client ID | ✅ | https://developer.x.com/ （Bookmarks/Likes 取得には Basic プラン以上）|
| GCP プロジェクト | ✅ | OAuth トークン保存に GSM を使う（billing 有効化必須） |
| xAI API Key | 任意 | https://console.x.ai/ （article / 動画 / 画像の中身を Grok で取得する場合） |
| Notion MCP | ✅ | Claude Code Web で Notion connector を有効化 |

X Developer Portal の **User authentication settings** で:
- Type of App: Native App
- Callback URI: `http://127.0.0.1:8787/callback`（完全一致）
- Scopes: `tweet.read users.read like.read bookmark.read offline.access`

### 2. セットアップ

```bash
bun install
cp .env.example .env   # X_CLIENT_ID, GOOGLE_CLOUD_PROJECT, XAI_API_KEY などを記入

# GCP リソースを Terraform で構築
gcloud auth application-default login
echo 'project_id = "<your-project>"' > terraform/terraform.tfvars
cd terraform && terraform init && terraform apply
$(terraform output -raw key_create_command)   # ./sa-key.json 発行
cd ..

# 初回 OAuth（GSM にトークン保存）
bun run auth
```

### 3. 動作確認

```bash
bun run me
bun run fetch --source bookmarks --limit 5
```

### 4. Claude Code で実行

```
/xmarks --dry-run
```

問題なければ `--dry-run` 外して本番。

---

詳細は `CLAUDE.md` / `terraform/README.md` / `.claude/skills/xmarks/SKILL.md` を参照。
