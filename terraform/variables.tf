variable "project_id" {
  description = "GCP project ID where xmarks GSM resources will live."
  type        = string
}

variable "service_account_id" {
  description = "Account ID for the xmarks service account (the local part before @<project>.iam.gserviceaccount.com)."
  type        = string
  default     = "xmarks-routine"
}

variable "prefix" {
  description = "Prefix for GSM secret resource names. Must match GSM_SECRET_PREFIX in the xmarks runtime env."
  type        = string
  default     = "xmarks"
}
