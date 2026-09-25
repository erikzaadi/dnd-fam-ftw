output "identity_arn" {
  value = aws_sesv2_email_identity.mail.arn
}

output "mail_domain" {
  value = var.mail_domain
}
