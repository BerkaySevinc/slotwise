variable "region" {
  description = "AWS Region. The account is fixed to a single Region."
  type        = string
  default     = "eu-north-1"
}

variable "project" {
  description = "Prefix of every resource name."
  type        = string
  default     = "slotwise"
}

variable "github_repository" {
  description = "GitHub repository allowed to assume the deploy role, as owner/name."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$", var.github_repository))
    error_message = "Use the form owner/name."
  }
}
