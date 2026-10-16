output "state_bucket" {
  description = "Name of the remote state bucket used by the environment roots."
  value       = aws_s3_bucket.state.id
}

output "deploy_role_arn" {
  description = "Role that GitHub Actions assumes through OIDC."
  value       = aws_iam_role.deploy.arn
}
