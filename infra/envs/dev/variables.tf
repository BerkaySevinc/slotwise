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
