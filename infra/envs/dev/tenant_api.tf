# tenant-api: POST /tenants (US-01, ADR-0007). Build the bundle first with `npm run build`.

data "archive_file" "tenant_api" {
  type        = "zip"
  source_file = "${path.module}/../../../backend/functions/tenant-api/dist/index.mjs"
  output_path = "${path.module}/build/tenant-api.zip"
}

resource "aws_cloudwatch_log_group" "tenant_api" {
  name              = "/aws/lambda/${local.name_prefix}-tenant-api"
  retention_in_days = 14
}

data "aws_iam_policy_document" "tenant_api_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "tenant_api" {
  name               = "${local.name_prefix}-tenant-api"
  assume_role_policy = data.aws_iam_policy_document.tenant_api_trust.json
}

data "aws_iam_policy_document" "tenant_api" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.tenant_api.arn}:*"]
  }

  # TransactWriteItems is authorized through the item-level actions below.
  statement {
    sid       = "TenantData"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"]
    resources = [aws_dynamodb_table.data.arn]
  }

  statement {
    sid       = "IdempotencyRecords"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"]
    resources = [aws_dynamodb_table.idempotency.arn]
  }

  statement {
    sid       = "SetOwnerClaims"
    actions   = ["cognito-idp:AdminUpdateUserAttributes"]
    resources = [aws_cognito_user_pool.main.arn]
  }
}

resource "aws_iam_role_policy" "tenant_api" {
  name   = "tenant-api"
  role   = aws_iam_role.tenant_api.id
  policy = data.aws_iam_policy_document.tenant_api.json
}

resource "aws_lambda_function" "tenant_api" {
  function_name    = "${local.name_prefix}-tenant-api"
  role             = aws_iam_role.tenant_api.arn
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.tenant_api.output_path
  source_code_hash = data.archive_file.tenant_api.output_base64sha256
  timeout          = 15
  memory_size      = 256

  environment {
    variables = {
      DATA_TABLE        = aws_dynamodb_table.data.name
      IDEMPOTENCY_TABLE = aws_dynamodb_table.idempotency.name
      USER_POOL_ID      = aws_cognito_user_pool.main.id
      LOG_LEVEL         = "INFO"
    }
  }

  depends_on = [aws_cloudwatch_log_group.tenant_api, aws_iam_role_policy.tenant_api]
}

resource "aws_apigatewayv2_integration" "tenant_api" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.tenant_api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "create_tenant" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "POST /tenants"
  target             = "integrations/${aws_apigatewayv2_integration.tenant_api.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_lambda_permission" "tenant_api_from_api" {
  statement_id  = "AllowInvokeFromHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.tenant_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

# The Cognito step of POST /tenants failed (AC-01.16). The tenant stays `provisioning` until the
# owner repeats the call, so a permanent fault (for example a missing permission) must not be silent.
# No notification target exists yet; the alarm state is visible in CloudWatch.
resource "aws_cloudwatch_metric_alarm" "provisioning_incomplete" {
  alarm_name          = "${local.name_prefix}-provisioning-incomplete"
  alarm_description   = "POST /tenants could not set the owner's tenant and role in Cognito."
  namespace           = "Slotwise"
  metric_name         = "ProvisioningIncomplete"
  dimensions          = { service = "tenant-api" }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}
