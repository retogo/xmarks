# xmarks Terraform

GCP resources for xmarks (Google Secret Manager backend used by Claude Code Routines).

## What this manages

- Enables `secretmanager.googleapis.com` on the project
- Creates a service account `xmarks-routine` (configurable)
- Grants the service account three Secret Manager roles:
  - `secretAccessor` (read)
  - `secretVersionAdder` (write)
  - `secretVersionManager` (destroy old versions)
- Creates the secret `xmarks-x-oauth-tokens` with automatic replication

The SA key JSON is **NOT** managed here (keys would be stored in tfstate). Generate it manually with `gcloud` after `terraform apply` (see below).

## Prerequisites

- `terraform` >= 1.5
- `gcloud` CLI authenticated (`gcloud auth application-default login`)
- An existing GCP project (with billing enabled) where you have `roles/owner` or sufficient IAM perms

## Usage

```bash
cd terraform

# 1. Init
terraform init

# 2. Apply (provide your project id)
terraform apply -var="project_id=YOUR_PROJECT_ID"

# 3. Generate SA key (output of `terraform output key_create_command`)
$(terraform output -raw key_create_command)

# 4. Use the key from xmarks
export SECRET_BACKEND=gsm
export GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID
export GOOGLE_APPLICATION_CREDENTIALS=$PWD/sa-key.json
cd ..
bun run auth        # writes initial OAuth tokens to GSM
bun run me          # reads them back
```

## For Claude Code Routines

Once `bun run auth` has populated GSM with tokens, drop GCP-side cred files and use the inline JSON variable in the Routine env:

```
SECRET_BACKEND=gsm
GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID
GCP_SA_KEY_JSON=<paste sa-key.json content here>
X_CLIENT_ID=<...>
X_CLIENT_SECRET=<...>
```

The xmarks bootstrap (`src/adapters/driven/secrets/bootstrap.ts`) writes the JSON to a temp file and sets `GOOGLE_APPLICATION_CREDENTIALS` automatically.

## Customization

Override defaults with `-var`:

```bash
terraform apply \
  -var="project_id=my-proj" \
  -var="service_account_id=xmarks-bot" \
  -var="prefix=xm"
```

If you change `prefix`, set `GSM_SECRET_PREFIX` to the same value in the xmarks runtime env.

## Cleanup

```bash
terraform destroy -var="project_id=YOUR_PROJECT_ID"
```

Note: `secretmanager.googleapis.com` is left enabled by default (`disable_on_destroy = false`) so other workloads in the same project are not disrupted.
