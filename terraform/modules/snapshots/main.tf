# Private S3 bucket for visual regression snapshots.
# No public access - only accessible by the CI IAM user.

resource "aws_s3_bucket" "snapshots" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_public_access_block" "snapshots" {
  bucket                  = aws_s3_bucket.snapshots.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_iam_user" "ci" {
  name = "dnd-fam-ftw-ci"
}

data "aws_iam_policy_document" "ci" {
  statement {
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
    ]
    resources = ["arn:aws:s3:::${var.bucket_name}/*"]
  }

  statement {
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${var.bucket_name}"]
  }
}

resource "aws_iam_user_policy" "ci" {
  name   = "dnd-fam-ftw-ci-policy"
  user   = aws_iam_user.ci.name
  policy = data.aws_iam_policy_document.ci.json
}

resource "aws_iam_access_key" "ci" {
  user = aws_iam_user.ci.name
}
