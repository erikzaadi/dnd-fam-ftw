variable "bundle_id" {
  description = "Lightsail instance bundle (nano_3_0, micro_3_0, etc.)"
  type        = string
  default     = "nano_3_0"
}

variable "blueprint_id" {
  description = "Lightsail OS blueprint ID"
  type        = string
  default     = "ubuntu_22_04"
}

variable "disk_size_gb" {
  description = "Attached disk size in GB"
  type        = number
  default     = 8
}

variable "aws_region" {
  description = "AWS region - used to derive availability zone"
  type        = string
}
