resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

# Only workflows of this repository that run on main or on a version tag can assume the role.
data "aws_iam_policy_document" "deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repository}:ref:refs/heads/main",
        "repo:${var.github_repository}:ref:refs/tags/v*",
      ]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name                 = "${var.project}-github-deploy"
  assume_role_policy   = data.aws_iam_policy_document.deploy_trust.json
  max_session_duration = 3600
}

locals {
  region_account = "${var.region}:${local.account_id}"
}

# Resources are limited to the project name prefix. Services that cannot be scoped by name
# (Cognito user pool creation, CloudFront, API Gateway) are limited to the project Regions instead.
data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "StateBucketList"
    actions   = ["s3:ListBucket", "s3:GetBucketVersioning"]
    resources = [aws_s3_bucket.state.arn]
  }

  statement {
    sid       = "StateObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.state.arn}/envs/*"]
  }

  statement {
    sid = "ProjectResourcesByName"
    actions = [
      "lambda:*",
      "dynamodb:*",
      "sqs:*",
      "events:*",
      "scheduler:*",
      "logs:*",
      "cloudwatch:*",
      "ssm:*",
      "secretsmanager:*",
      "s3:*",
    ]
    resources = [
      "arn:aws:lambda:${local.region_account}:function:${var.project}-*",
      "arn:aws:dynamodb:${local.region_account}:table/${var.project}-*",
      "arn:aws:dynamodb:${local.region_account}:table/${var.project}-*/*",
      "arn:aws:sqs:${local.region_account}:${var.project}-*",
      "arn:aws:events:${local.region_account}:rule/${var.project}-*",
      "arn:aws:events:${local.region_account}:event-bus/${var.project}-*",
      "arn:aws:scheduler:${local.region_account}:schedule/*/${var.project}-*",
      "arn:aws:scheduler:${local.region_account}:schedule-group/${var.project}-*",
      "arn:aws:logs:${local.region_account}:log-group:/aws/lambda/${var.project}-*",
      "arn:aws:logs:${local.region_account}:log-group:/aws/lambda/${var.project}-*:*",
      "arn:aws:logs:${local.region_account}:log-group:/${var.project}/*",
      "arn:aws:cloudwatch:${local.region_account}:alarm:${var.project}-*",
      "arn:aws:ssm:${local.region_account}:parameter/${var.project}/*",
      "arn:aws:secretsmanager:${local.region_account}:secret:${var.project}/*",
      "arn:aws:s3:::${var.project}-*",
      "arn:aws:s3:::${var.project}-*/*",
    ]
  }

  statement {
    sid = "RegionScopedServices"
    actions = [
      "apigateway:*",
      "cognito-idp:*",
      "cloudfront:*",
      "ses:*",
      "xray:*",
      "logs:DescribeLogGroups",
      "cloudwatch:DescribeAlarms",
      "lambda:CreateEventSourceMapping",
      "lambda:UpdateEventSourceMapping",
      "lambda:DeleteEventSourceMapping",
      "lambda:GetEventSourceMapping",
      "lambda:ListEventSourceMappings",
    ]
    resources = ["*"]

    condition {
      test     = "StringEqualsIfExists"
      variable = "aws:RequestedRegion"
      values   = [var.region, "us-east-1"]
    }
  }

  statement {
    sid = "ProjectRoles"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:UpdateRole",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:PutRolePolicy",
      "iam:GetRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
      "iam:UpdateAssumeRolePolicy",
    ]
    resources = ["arn:aws:iam::${local.account_id}:role/${var.project}-*"]
  }

  statement {
    sid       = "PassProjectRoles"
    actions   = ["iam:PassRole"]
    resources = ["arn:aws:iam::${local.account_id}:role/${var.project}-*"]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values = [
        "lambda.amazonaws.com",
        "scheduler.amazonaws.com",
        "events.amazonaws.com",
        "apigateway.amazonaws.com",
      ]
    }
  }

  statement {
    sid = "ProjectPolicies"
    actions = [
      "iam:CreatePolicy",
      "iam:DeletePolicy",
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
      "iam:ListPolicyVersions",
      "iam:CreatePolicyVersion",
      "iam:DeletePolicyVersion",
      "iam:TagPolicy",
    ]
    resources = ["arn:aws:iam::${local.account_id}:policy/${var.project}-*"]
  }
}

resource "aws_iam_policy" "deploy" {
  name   = "${var.project}-github-deploy"
  policy = data.aws_iam_policy_document.deploy.json
}

resource "aws_iam_role_policy_attachment" "deploy" {
  role       = aws_iam_role.deploy.name
  policy_arn = aws_iam_policy.deploy.arn
}
