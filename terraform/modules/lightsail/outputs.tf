output "static_ip" {
  value       = aws_lightsail_static_ip.app.ip_address
  description = "Public static IP - used for Route 53 A record and SSH access"
}

output "disk_name" {
  value = aws_lightsail_disk.data.name
}

output "instance_name" {
  value = aws_lightsail_instance.app.name
}
