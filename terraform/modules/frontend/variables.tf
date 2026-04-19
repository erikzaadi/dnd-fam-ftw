variable "bucket_name" {
  description = "S3 bucket name for frontend static assets"
  type        = string
}

variable "domain" {
  description = "CloudFront alternate domain name"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID for ACM DNS validation records"
  type        = string
}

variable "image_bucket_domain" {
  description = "S3 regional domain name for the images bucket (used as CloudFront origin for /generated/*)"
  type        = string
}

variable "image_bucket_arn" {
  description = "ARN of the images S3 bucket (used to grant CloudFront OAC read access)"
  type        = string
}

variable "image_bucket_id" {
  description = "ID (bucket name) of the images S3 bucket (used to attach the OAC bucket policy)"
  type        = string
}
