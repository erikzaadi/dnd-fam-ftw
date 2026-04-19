# --- Region ---

variable "aws_region" {
  description = "Primary AWS region for all resources"
  type        = string
  default     = "eu-west-1"
}

# --- Domains (no defaults - set in terraform.tfvars) ---

variable "hosted_zone_name" {
  description = "Root domain of the existing Route 53 hosted zone (e.g. yourdomain.com)"
  type        = string
}

variable "frontend_domain" {
  description = "Full domain for the frontend CloudFront distribution (e.g. app.yourdomain.com)"
  type        = string
}

variable "api_domain" {
  description = "Full domain for the backend API on Lightsail (e.g. api.app.yourdomain.com)"
  type        = string
}

# --- S3 buckets (no defaults - bucket names must be globally unique) ---

variable "frontend_bucket_name" {
  description = "S3 bucket name for frontend static assets (must be globally unique)"
  type        = string
}

variable "image_bucket_name" {
  description = "S3 bucket name for AI-generated images (must be globally unique)"
  type        = string
}

# --- Lightsail ---

variable "lightsail_bundle_id" {
  description = "Lightsail instance bundle ID"
  type        = string
  default     = "nano_3_0"
}

variable "lightsail_blueprint_id" {
  description = "Lightsail OS blueprint ID"
  type        = string
  default     = "ubuntu_22_04"
}

variable "db_disk_size_gb" {
  description = "Size of the attached disk for SQLite data (GB)"
  type        = number
  default     = 8
}

# --- SSM ---

variable "ssm_parameter_prefix" {
  description = "Path prefix for SSM parameter store secrets"
  type        = string
  default     = "/dnd-fam-ftw/prod"
}
