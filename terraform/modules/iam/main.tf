resource "aws_iam_user" "app" {
  name = "dnd-fam-ftw-app"
}

data "aws_iam_policy_document" "app" {
  # Image bucket access
  statement {
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
    ]
    resources = ["arn:aws:s3:::${var.image_bucket_name}/*"]
  }

  statement {
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${var.image_bucket_name}"]
  }

  # SSM secrets access
  statement {
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
    ]
    # Note: prefix must not end with /
    resources = ["arn:aws:ssm:*:*:parameter${var.ssm_parameter_prefix}/*"]
  }
}

resource "aws_iam_user_policy" "app" {
  name   = "dnd-fam-ftw-app-policy"
  user   = aws_iam_user.app.name
  policy = data.aws_iam_policy_document.app.json
}

resource "aws_iam_access_key" "app" {
  user = aws_iam_user.app.name
}

# Certbot user - only needs Route 53 access for DNS-01 challenge
resource "aws_iam_user" "certbot" {
  name = "dnd-fam-ftw-certbot"
}

data "aws_iam_policy_document" "certbot" {
  statement {
    actions   = ["route53:GetChange"]
    resources = ["arn:aws:route53:::change/*"]
  }

  statement {
    actions   = ["route53:ChangeResourceRecordSets"]
    resources = ["arn:aws:route53:::hostedzone/${var.hosted_zone_id}"]
  }

  statement {
    actions   = ["route53:ListHostedZones"]
    resources = ["*"]
  }
}

resource "aws_iam_user_policy" "certbot" {
  name   = "dnd-fam-ftw-certbot-policy"
  user   = aws_iam_user.certbot.name
  policy = data.aws_iam_policy_document.certbot.json
}

resource "aws_iam_access_key" "certbot" {
  user = aws_iam_user.certbot.name
}
