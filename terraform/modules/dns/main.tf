# Frontend: CloudFront alias record
resource "aws_route53_record" "frontend" {
  zone_id = var.hosted_zone_id
  name    = var.frontend_domain
  type    = "A"

  alias {
    name                   = var.cloudfront_domain_name
    zone_id                = var.cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

# API: A record pointing at the Lightsail static IP
resource "aws_route53_record" "api" {
  zone_id = var.hosted_zone_id
  name    = var.api_domain
  type    = "A"
  ttl     = 300
  records = [var.lightsail_static_ip]
}
