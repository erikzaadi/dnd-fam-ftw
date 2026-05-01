output "bucket_name" {
  value = aws_s3_bucket.snapshots.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.snapshots.arn
}

output "access_key_id" {
  value     = aws_iam_access_key.ci.id
  sensitive = true
}

output "secret_access_key" {
  value     = aws_iam_access_key.ci.secret
  sensitive = true
}
