# These outputs are consumed by CI/CD and app configuration.
# After `terraform apply`, run `terraform output -json` to get these values.

# Used as VITE_BASE_PATH in frontend builds and as the public app URL
output "frontend_url" {
  value = "https://${var.frontend_domain}"
}

# Used as VITE_API_BASE_URL in frontend production builds
output "api_url" {
  value = "https://${var.api_domain}"
}

# Used in Nginx config and TLS cert provisioning
output "lightsail_static_ip" {
  value = module.lightsail.static_ip
}

# Used by CI to invalidate the CloudFront cache after frontend deploys
output "cloudfront_distribution_id" {
  value = module.frontend.cloudfront_distribution_id
}

# Used as S3_IMAGE_PUBLIC_BASE_URL in app env - served via CloudFront, not direct S3
output "image_bucket_url" {
  value = "https://${var.frontend_domain}"
}

output "frontend_bucket_name" {
  value = var.frontend_bucket_name
}

output "image_bucket_name" {
  value = var.image_bucket_name
}

output "attached_disk_name" {
  value = module.lightsail.disk_name
}

output "lightsail_instance_name" {
  value = module.lightsail.instance_name
}

# IAM credentials for the app - sensitive, never printed in CI logs
output "app_access_key_id" {
  value     = module.iam.access_key_id
  sensitive = true
}

output "app_secret_access_key" {
  value     = module.iam.secret_access_key
  sensitive = true
}

output "ssm_parameter_names" {
  value = module.ssm.parameter_names
}

# Used by scripts/provision-cert.sh - pulled locally, never logged
output "certbot_access_key_id" {
  value     = module.iam.certbot_access_key_id
  sensitive = true
}

output "certbot_secret_access_key" {
  value     = module.iam.certbot_secret_access_key
  sensitive = true
}
