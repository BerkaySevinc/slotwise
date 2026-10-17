# Throwaway smoke test for the deploy chain. Remove it once real functions exist.

data "archive_file" "hello" {
  type        = "zip"
  source_file = "${path.module}/../../../backend/functions/hello/dist/index.mjs"
  output_path = "${path.module}/build/hello.zip"
}

resource "aws_cloudwatch_log_group" "hello" {
  name              = "/aws/lambda/${local.name_prefix}-hello"
  retention_in_days = 14
}

data "aws_iam_policy_document" "hello_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "hello" {
  name               = "${local.name_prefix}-hello"
  assume_role_policy = data.aws_iam_policy_document.hello_trust.json
}

data "aws_iam_policy_document" "hello_logs" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.hello.arn}:*"]
  }
}

resource "aws_iam_role_policy" "hello_logs" {
  name   = "logs"
  role   = aws_iam_role.hello.id
  policy = data.aws_iam_policy_document.hello_logs.json
}

resource "aws_lambda_function" "hello" {
  function_name    = "${local.name_prefix}-hello"
  role             = aws_iam_role.hello.arn
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.hello.output_path
  source_code_hash = data.archive_file.hello.output_base64sha256
  timeout          = 5
  memory_size      = 128

  depends_on = [aws_cloudwatch_log_group.hello, aws_iam_role_policy.hello_logs]
}
