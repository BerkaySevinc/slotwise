# Owners and staff sign in here. See ADR-0001 (tenancy) and ADR-0007 (registration and sign-in).

resource "aws_cognito_user_pool" "main" {
  name                     = "${local.name_prefix}-users"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OFF"

  # Essentials is the default plan. Pinned so it is visible: the first 10,000 monthly active users
  # are free, and it keeps access-token customization and passwordless sign-in available (ADR-0007).
  user_pool_tier = "ESSENTIALS"

  password_policy {
    minimum_length    = 10
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = false
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # The default Cognito sender is limited to 50 emails per day per AWS account (not adjustable).
  # Enough for development. Before real owners sign up, switch to "DEVELOPER" with a verified
  # SES identity in the same Region and take the account out of the SES sandbox (ADR-0007).
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  # Custom attributes cannot be changed or removed after the pool exists; a change here replaces
  # the pool and deletes its users. Only the backend writes them (the app client below cannot).
  schema {
    name                     = "tenant_id"
    attribute_data_type      = "String"
    mutable                  = true
    required                 = false
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 1
      max_length = 64
    }
  }

  schema {
    name                     = "role"
    attribute_data_type      = "String"
    mutable                  = true
    required                 = false
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 1
      max_length = 32
    }
  }
}

# Browser app client: no secret, SRP sign-in only. It may read the tenant attributes but write only
# the email, so a user can never give themselves a tenant or a role.
resource "aws_cognito_user_pool_client" "web" {
  name         = "${local.name_prefix}-web"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret               = false
  explicit_auth_flows           = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  read_attributes  = ["email", "email_verified", "custom:tenant_id", "custom:role"]
  write_attributes = ["email"]
}
