terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ACM certificates for CloudFront must be in us-east-1
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

# Look up the existing Route 53 hosted zone - do not manage it here
data "aws_route53_zone" "main" {
  name         = var.hosted_zone_name
  private_zone = false
}

module "images" {
  source      = "./modules/images"
  bucket_name = var.image_bucket_name
}

module "frontend" {
  source              = "./modules/frontend"
  bucket_name         = var.frontend_bucket_name
  domain              = var.frontend_domain
  hosted_zone_id      = data.aws_route53_zone.main.zone_id
  image_bucket_domain = module.images.bucket_domain_name
  image_bucket_arn    = module.images.bucket_arn
  image_bucket_id     = module.images.bucket_id

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
}

module "lightsail" {
  source            = "./modules/lightsail"
  bundle_id    = var.lightsail_bundle_id
  blueprint_id = var.lightsail_blueprint_id
  disk_size_gb = var.db_disk_size_gb
  aws_region   = var.aws_region
}

module "dns" {
  source                    = "./modules/dns"
  hosted_zone_id            = data.aws_route53_zone.main.zone_id
  frontend_domain           = var.frontend_domain
  api_domain                = var.api_domain
  cloudfront_domain_name    = module.frontend.cloudfront_domain_name
  cloudfront_hosted_zone_id = module.frontend.cloudfront_hosted_zone_id
  lightsail_static_ip       = module.lightsail.static_ip
}

module "iam" {
  source               = "./modules/iam"
  image_bucket_name    = var.image_bucket_name
  ssm_parameter_prefix = var.ssm_parameter_prefix
  hosted_zone_id       = data.aws_route53_zone.main.zone_id
}

# App IAM credentials - stored in SSM so deploy workflows read them automatically
resource "aws_ssm_parameter" "app_key_id" {
  name  = "${var.ssm_parameter_prefix}/AWS_ACCESS_KEY_ID"
  type  = "String"
  value = module.iam.access_key_id
}

resource "aws_ssm_parameter" "app_secret" {
  name  = "${var.ssm_parameter_prefix}/AWS_SECRET_ACCESS_KEY"
  type  = "SecureString"
  value = module.iam.secret_access_key
}

# Certbot credentials are known after apply - store directly, no placeholder needed
resource "aws_ssm_parameter" "certbot_key_id" {
  name  = "${var.ssm_parameter_prefix}/CERTBOT_AWS_ACCESS_KEY_ID"
  type  = "String"
  value = module.iam.certbot_access_key_id
}

resource "aws_ssm_parameter" "certbot_secret" {
  name  = "${var.ssm_parameter_prefix}/CERTBOT_AWS_SECRET_ACCESS_KEY"
  type  = "SecureString"
  value = module.iam.certbot_secret_access_key
}

module "ssm" {
  source           = "./modules/ssm"
  parameter_prefix = var.ssm_parameter_prefix
}
