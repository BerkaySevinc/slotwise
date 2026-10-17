output "api_url" {
  description = "Base URL of the dev HTTP API."
  value       = aws_apigatewayv2_api.http.api_endpoint
}
