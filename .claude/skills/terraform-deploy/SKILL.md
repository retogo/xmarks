---
description: xmarks の terraform/ で GCP リソース（GSM secret / SA / IAM）を plan・apply・destroy するワークフロー。SA key 発行と初回 GSM ブートストラップまで案内する。
---

# /terraform-deploy

`terraform/` 配下の HCL を GCP に適用する。

## 前提チェック（必ず最初に実行）

以下を Bash で確認し、欠けているものがあればユーザーに行動を促してから先に進む。

```bash
command -v terraform || echo "MISSING: terraform"
command -v gcloud    || echo "MISSING: gcloud"
gcloud auth application-default print-access-token >/dev/null 2>&1 \
  && echo "ADC: ok" || echo "ADC: missing — run: gcloud auth application-default login"
test -f terraform/terraform.tfvars && echo "tfvars: present" || echo "tfvars: missing — pass -var=\"project_id=...\""
```

`terraform.tfvars` が無い場合は AskUserQuestion で project_id を聞き、tfvars を作るか `-var` で1回だけ渡すかをユーザーに選ばせる。

## モード

引数で指定。デフォルト = `plan-and-apply`。

```
/terraform-deploy [plan-and-apply | apply | plan | issue-key | status | destroy]
```

### plan-and-apply（デフォルト）

1. `cd terraform && terraform init -input=false`（idempotent）
2. `cd terraform && terraform plan -input=false`
3. plan 出力を要約してユーザーに見せる（追加・変更・削除の件数を冒頭に）
4. **AskUserQuestion** で「この plan で apply しますか？」を確認
5. Yes → `cd terraform && terraform apply -auto-approve -input=false`
6. apply 後 `terraform output` を実行し、SA email / secret 名を表示
7. SA key (`terraform/sa-key.json`) が **未発行** なら `issue-key` モードを提案

### apply

`plan-and-apply` と同じだが、ステップ4の確認をスキップしない（必ず聞く）。

### plan

ステップ1-3のみ。apply はしない。

### issue-key

```bash
cd terraform && $(terraform output -raw key_create_command)
```

成功すると `terraform/sa-key.json` が出る。**.gitignore 済みだがコミットしないよう念押し**。

続けて初回 GSM ブートストラップを促す:

```bash
SECRET_BACKEND=gsm \
GOOGLE_CLOUD_PROJECT=<project_id> \
GOOGLE_APPLICATION_CREDENTIALS=$PWD/terraform/sa-key.json \
bun run auth
```

ブラウザで X 認可 → GSM の `xmarks-x-oauth-tokens` に v1 が入る。

### status

現状確認:

```bash
cd terraform && terraform output
gcloud secrets versions list xmarks-x-oauth-tokens --project=<project_id>
```

### destroy（⚠️ 危険）

1. `cd terraform && terraform plan -destroy -input=false`
2. 破壊対象を要約してユーザーに見せる
3. **AskUserQuestion** で明示確認: 「**OAuth tokens を含む GSM secret も消えます**。本当に destroy しますか？」
4. Yes → `cd terraform && terraform destroy -auto-approve -input=false`

destroy 後の復旧には Terraform 再 apply + `bun run auth` が必要。

## 安全ルール

- `apply` / `destroy` は **必ず plan を先に提示**してから AskUserQuestion で確認する。`-auto-approve` を勝手に走らせない
- SA key (`sa-key.json`) や `*.tfstate` を **絶対に commit しない**（`terraform/.gitignore` 済み）。ステージング前に念のため `git status` で確認
- `terraform.tfvars` も gitignore 済みだが、commit しない方針を維持
- `disable_on_destroy = false` のため `terraform destroy` でも Secret Manager API は project に残る（仕様）

## エラーパターンと対処

| エラー | 原因 | 対処 |
|---|---|---|
| `application-default credentials are not found` | ADC 未設定 | `gcloud auth application-default login` |
| `Permission denied while accessing project` | IAM 不足 | プロジェクトに `roles/owner` などがあるか確認 |
| `Billing must be enabled` | billing 未 link | Cloud Console の Billing で project に billing account を紐付け |
| `Error 409: Requested entity already exists` | 既に存在するリソースを `import` 未実施で作ろうとしている | `terraform import` で既存リソースを取り込むか、別 prefix を使う |
| `tfvars: missing` チェック | project_id 未指定 | tfvars 作成 or `-var` 指定 |

## 補足

- state は **local backend**（`terraform/terraform.tfstate`、gitignore 済み）。複数マシンで運用するなら GCS backend に切替検討
- 詳細は `terraform/README.md` も参照
