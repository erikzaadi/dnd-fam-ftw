output "parameter_names" {
  value = concat(
    [for p in aws_ssm_parameter.secure : p.name],
    [for p in aws_ssm_parameter.string : p.name]
  )
}
