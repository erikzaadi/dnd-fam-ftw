variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID for the sending domain's DNS records"
  type        = string
}

variable "mail_domain" {
  description = "Dedicated sending (sub)domain, e.g. mail.yourdomain.com"
  type        = string
}

variable "aws_region" {
  description = "SES region (must match SES_REGION / AWS_REGION used by the app)"
  type        = string
}

variable "dmarc_report_email" {
  description = "Optional mailbox for DMARC aggregate reports (rua). Empty disables reports."
  type        = string
  default     = ""
}
