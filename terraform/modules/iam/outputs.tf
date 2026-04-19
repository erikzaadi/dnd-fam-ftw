output "access_key_id" {
  value     = aws_iam_access_key.app.id
  sensitive = true
}

output "secret_access_key" {
  value     = aws_iam_access_key.app.secret
  sensitive = true
}

output "user_arn" {
  value = aws_iam_user.app.arn
}

output "certbot_access_key_id" {
  value     = aws_iam_access_key.certbot.id
  sensitive = true
}

output "certbot_secret_access_key" {
  value     = aws_iam_access_key.certbot.secret
  sensitive = true
}
