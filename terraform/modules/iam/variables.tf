variable "image_bucket_name" {
  description = "S3 image bucket name - used to scope the IAM policy"
  type        = string
}

variable "ssm_parameter_prefix" {
  description = "SSM path prefix - used to scope the IAM policy"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID - used to scope the certbot DNS policy"
  type        = string
}
