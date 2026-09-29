terraform {
  required_version = ">= 1.8.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  backend "s3" {
    bucket         = "cortex-tfstate"
    key            = "production/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "cortex-tflock"
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = { Project = "cortex", Environment = var.environment, ManagedBy = "terraform" }
  }
}

variable "aws_region"   { default = "us-east-1" }
variable "environment"  { default = "production" }
variable "app_name"     { default = "cortex" }
