resource "aws_sqs_queue" "ingestion_dlq" {
  name                      = "${var.app_name}-ingestion-dlq-${var.environment}"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "ingestion" {
  name                       = "${var.app_name}-ingestion-${var.environment}"
  visibility_timeout_seconds = 900  # 15 min — matches Lambda timeout
  message_retention_seconds  = 86400

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.ingestion_dlq.arn
    maxReceiveCount     = 2
  })
}

resource "aws_sqs_queue_policy" "ingestion_s3" {
  queue_url = aws_sqs_queue.ingestion.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "s3.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = aws_sqs_queue.ingestion.arn
      Condition = { ArnLike = { "aws:SourceArn" = aws_s3_bucket.documents.arn } }
    }]
  })
}

resource "aws_ecr_repository" "worker" {
  name                 = "${var.app_name}-worker"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_iam_role" "worker_lambda" {
  name = "${var.app_name}-worker-${var.environment}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "worker_basic" {
  role       = aws_iam_role.worker_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_policy" "worker_policy" {
  name = "${var.app_name}-worker-policy-${var.environment}"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.documents.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = aws_sqs_queue.ingestion.arn
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.worker_secrets.arn
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "worker_policy" {
  role       = aws_iam_role.worker_lambda.name
  policy_arn = aws_iam_policy.worker_policy.arn
}

resource "aws_secretsmanager_secret" "worker_secrets" {
  name                    = "/${var.app_name}/${var.environment}/worker"
  recovery_window_in_days = 7
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/aws/lambda/${var.app_name}-worker-${var.environment}"
  retention_in_days = 14
}

resource "aws_lambda_function" "document_processor" {
  function_name = "${var.app_name}-worker-${var.environment}"
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.worker.repository_url}:latest"
  role          = aws_iam_role.worker_lambda.arn
  timeout       = 900
  memory_size   = 1024

  environment {
    variables = {
      S3_DOCUMENTS_BUCKET = aws_s3_bucket.documents.bucket
    }
  }

  depends_on = [aws_cloudwatch_log_group.worker]
}

resource "aws_lambda_event_source_mapping" "sqs_trigger" {
  event_source_arn                   = aws_sqs_queue.ingestion.arn
  function_name                      = aws_lambda_function.document_processor.arn
  batch_size                         = 1
  maximum_batching_window_in_seconds = 0
  function_response_types            = ["ReportBatchItemFailures"]
}
