output "state_bucket" {
  description = "Name of the remote state bucket used by the environment roots."
  value       = aws_s3_bucket.state.id
}
