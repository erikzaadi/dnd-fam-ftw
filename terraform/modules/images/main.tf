# Private S3 bucket for AI-generated images.
# Served via CloudFront (frontend distribution) at /generated/* using OAC - no public access.

resource "aws_s3_bucket" "images" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_public_access_block" "images" {
  bucket                  = aws_s3_bucket.images.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
