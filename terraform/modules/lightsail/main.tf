resource "aws_lightsail_instance" "app" {
  name              = "dnd-fam-ftw"
  availability_zone = "${var.aws_region}a"
  blueprint_id      = var.blueprint_id
  bundle_id         = var.bundle_id

  # Cloud-init: format and mount the attached data disk on first boot.
  # The disk is attached separately below; this script waits briefly for it.
  user_data = <<-EOT
    #!/bin/bash
    set -e
    # Give the disk attachment a moment to settle
    sleep 15
    DISK=/dev/xvdf
    if ! blkid "$DISK" > /dev/null 2>&1; then
      mkfs.ext4 "$DISK"
    fi
    mkdir -p /mnt/dnd-fam-ftw-data
    mount "$DISK" /mnt/dnd-fam-ftw-data || true
    grep -q '/mnt/dnd-fam-ftw-data' /etc/fstab || \
      echo "$DISK /mnt/dnd-fam-ftw-data ext4 defaults,nofail 0 2" >> /etc/fstab
    chown ubuntu:ubuntu /mnt/dnd-fam-ftw-data
  EOT
}

resource "aws_lightsail_static_ip" "app" {
  name = "dnd-fam-ftw-ip"
}

resource "aws_lightsail_static_ip_attachment" "app" {
  static_ip_name = aws_lightsail_static_ip.app.name
  instance_name  = aws_lightsail_instance.app.name
}

resource "aws_lightsail_disk" "data" {
  name              = "dnd-fam-ftw-data"
  size_in_gb        = var.disk_size_gb
  availability_zone = aws_lightsail_instance.app.availability_zone
}

resource "aws_lightsail_disk_attachment" "data" {
  disk_name     = aws_lightsail_disk.data.name
  instance_name = aws_lightsail_instance.app.name
  disk_path     = "/dev/xvdf"

  # Attach disk before the instance user_data runs
  depends_on = [aws_lightsail_instance.app]
}

resource "aws_lightsail_instance_public_ports" "app" {
  instance_name = aws_lightsail_instance.app.name

  port_info {
    protocol  = "tcp"
    from_port = 443
    to_port   = 443
    cidrs     = ["0.0.0.0/0"]
  }

  port_info {
    protocol  = "tcp"
    from_port = 80
    to_port   = 80
    cidrs     = ["0.0.0.0/0"]
  }

  # Port 22 is NOT managed here - opened/closed dynamically per deploy/renew script run.
}
