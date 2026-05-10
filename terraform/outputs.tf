output "service_account_email" {
  description = "Service account email. Use with `gcloud iam service-accounts keys create` to generate a key JSON."
  value       = google_service_account.xmarks_routine.email
}

output "secret_id" {
  description = "Full resource path of the OAuth tokens secret."
  value       = google_secret_manager_secret.x_oauth_tokens.id
}

output "secret_short_name" {
  description = "Short name of the secret (matches xmarks code: <prefix>-x-oauth-tokens)."
  value       = google_secret_manager_secret.x_oauth_tokens.secret_id
}

output "key_create_command" {
  description = "Run this to generate the SA key JSON (saved locally; do NOT commit)."
  value       = "gcloud iam service-accounts keys create ./sa-key.json --iam-account=${google_service_account.xmarks_routine.email}"
}
