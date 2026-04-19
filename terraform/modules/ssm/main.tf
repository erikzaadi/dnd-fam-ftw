# SSM parameters are created as placeholders.
# Fill in real values manually in the AWS console or via CLI after `terraform apply`.
# Terraform will NOT overwrite values after initial creation (ignore_changes = [value]).

locals {
  secure_params = toset([
    "OPENAI_API_KEY",
    "GOOGLE_CLIENT_SECRET",
    "JWT_SECRET",
  ])

  string_params = toset([
    "GOOGLE_CLIENT_ID",
    "ADMIN_EMAIL",
  ])
}

resource "aws_ssm_parameter" "secure" {
  for_each = local.secure_params

  name  = "${var.parameter_prefix}/${each.value}"
  type  = "SecureString"
  value = "PLACEHOLDER"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "string" {
  for_each = local.string_params

  name  = "${var.parameter_prefix}/${each.value}"
  type  = "String"
  value = "PLACEHOLDER"

  lifecycle {
    ignore_changes = [value]
  }
}
