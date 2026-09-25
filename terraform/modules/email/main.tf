# Amazon SES sending identity for sign-in codes and operator notices.
# After apply, request SES production access in this region (the sandbox can only
# send to verified addresses). That request is a manual step in the AWS console.

resource "aws_sesv2_email_identity" "mail" {
  email_identity = var.mail_domain

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

# Easy DKIM: three CNAMEs published under the sending domain.
resource "aws_route53_record" "dkim" {
  count   = 3
  zone_id = var.hosted_zone_id
  name    = "${aws_sesv2_email_identity.mail.dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.mail_domain}"
  type    = "CNAME"
  ttl     = 1800
  records = ["${aws_sesv2_email_identity.mail.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}

# Custom MAIL FROM so SPF aligns with the sending domain.
resource "aws_sesv2_email_identity_mail_from_attributes" "mail" {
  email_identity         = aws_sesv2_email_identity.mail.email_identity
  mail_from_domain       = "bounce.${var.mail_domain}"
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

resource "aws_route53_record" "mail_from_mx" {
  zone_id = var.hosted_zone_id
  name    = "bounce.${var.mail_domain}"
  type    = "MX"
  ttl     = 1800
  records = ["10 feedback-smtp.${var.aws_region}.amazonses.com"]
}

resource "aws_route53_record" "mail_from_spf" {
  zone_id = var.hosted_zone_id
  name    = "bounce.${var.mail_domain}"
  type    = "TXT"
  ttl     = 1800
  records = ["v=spf1 include:amazonses.com ~all"]
}

resource "aws_route53_record" "dmarc" {
  zone_id = var.hosted_zone_id
  name    = "_dmarc.${var.mail_domain}"
  type    = "TXT"
  ttl     = 1800
  records = [var.dmarc_report_email == "" ? "v=DMARC1; p=none;" : "v=DMARC1; p=none; rua=mailto:${var.dmarc_report_email}"]
}

# Stop sending to addresses that hard-bounced or complained, account-wide.
resource "aws_sesv2_account_suppression_attributes" "account" {
  suppressed_reasons = ["BOUNCE", "COMPLAINT"]
}
