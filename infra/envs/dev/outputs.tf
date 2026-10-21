output "api_url" {
  description = "Base URL of the dev HTTP API."
  value       = aws_apigatewayv2_api.http.api_endpoint
}

output "user_pool_id" {
  description = "Id of the Cognito user pool."
  value       = aws_cognito_user_pool.main.id
}

output "user_pool_client_id" {
  description = "Id of the browser app client."
  value       = aws_cognito_user_pool_client.web.id
}

output "user_pool_issuer" {
  description = "Issuer URL of the user pool, used by the API Gateway JWT authorizer."
  value       = "https://${aws_cognito_user_pool.main.endpoint}"
}
