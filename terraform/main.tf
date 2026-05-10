terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
}

resource "google_project_service" "secret_manager" {
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

resource "google_service_account" "xmarks_routine" {
  account_id   = var.service_account_id
  display_name = "xmarks routine"
  description  = "Used by Claude Code Routines to harvest X likes/bookmarks"

  depends_on = [google_project_service.secret_manager]
}

locals {
  sa_member = "serviceAccount:${google_service_account.xmarks_routine.email}"
  roles = [
    "roles/secretmanager.secretAccessor",
    "roles/secretmanager.secretVersionAdder",
    "roles/secretmanager.secretVersionManager",
  ]
}

resource "google_project_iam_member" "xmarks_routine_roles" {
  for_each = toset(local.roles)
  project  = var.project_id
  role     = each.value
  member   = local.sa_member
}

resource "google_secret_manager_secret" "x_oauth_tokens" {
  secret_id = "${var.prefix}-x-oauth-tokens"

  replication {
    auto {}
  }

  labels = {
    managed-by = "terraform"
    project    = "xmarks"
  }

  depends_on = [google_project_service.secret_manager]
}
