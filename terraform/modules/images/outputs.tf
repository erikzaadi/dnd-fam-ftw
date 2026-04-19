output "bucket_name" {
  value = aws_s3_bucket.images.bucket
}

output "bucket_id" {
  value = aws_s3_bucket.images.id
}

output "bucket_domain_name" {
  value = aws_s3_bucket.images.bucket_regional_domain_name
}

output "bucket_arn" {
  value = aws_s3_bucket.images.arn
}
