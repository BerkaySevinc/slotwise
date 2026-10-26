# catalog-api: the service endpoints (US-03). Build the bundle first with `npm run build`.

data "archive_file" "catalog_api" {
  type        = "zip"
  source_file = "${path.module}/../../../backend/functions/catalog-api/dist/index.mjs"
  output_path = "${path.module}/build/catalog-api.zip"
}

resource "aws_cloudwatch_log_group" "catalog_api" {
  name              = "/aws/lambda/${local.name_prefix}-catalog-api"
  retention_in_days = 14
}

data "aws_iam_policy_document" "catalog_api_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "catalog_api" {
  name               = "${local.name_prefix}-catalog-api"
  assume_role_policy = data.aws_iam_policy_document.catalog_api_trust.json
}

data "aws_iam_policy_document" "catalog_api" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.catalog_api.arn}:*"]
  }

  # No DeleteItem: services are retired, never deleted (US-03).
  statement {
    sid       = "ServiceData"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.data.arn]
  }
}

resource "aws_iam_role_policy" "catalog_api" {
  name   = "catalog-api"
  role   = aws_iam_role.catalog_api.id
  policy = data.aws_iam_policy_document.catalog_api.json
}

resource "aws_lambda_function" "catalog_api" {
  function_name    = "${local.name_prefix}-catalog-api"
  role             = aws_iam_role.catalog_api.arn
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.catalog_api.output_path
  source_code_hash = data.archive_file.catalog_api.output_base64sha256
  timeout          = 10
  memory_size      = 256

  environment {
    variables = {
      DATA_TABLE = aws_dynamodb_table.data.name
      LOG_LEVEL  = "INFO"
    }
  }

  depends_on = [aws_cloudwatch_log_group.catalog_api, aws_iam_role_policy.catalog_api]
}

resource "aws_apigatewayv2_integration" "catalog_api" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.catalog_api.invoke_arn
  payload_format_version = "2.0"
}

# One integration, four routes: the function dispatches on the route key.
resource "aws_apigatewayv2_route" "catalog_api" {
  for_each = toset([
    "POST /services",
    "GET /services",
    "GET /services/{serviceId}",
    "PATCH /services/{serviceId}",
  ])

  api_id             = aws_apigatewayv2_api.http.id
  route_key          = each.value
  target             = "integrations/${aws_apigatewayv2_integration.catalog_api.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_lambda_permission" "catalog_api_from_api" {
  statement_id  = "AllowInvokeFromHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.catalog_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}
