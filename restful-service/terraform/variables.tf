variable "project_id" {
  type        = string
  description = "Google Cloud Project ID"
  default     = "YOUR_PROJECT_ID"
}

variable "deployment_region" {
  type        = string
  description = "Cloud Run deployment region (e.g. us-central1)"
  default     = "us-central1"
}

variable "vertex_location" {
  type        = string
  description = "Vertex AI endpoint location (global recommended for latest Gemini models)"
  default     = "global"
}

variable "model_id" {
  type        = string
  description = "Gemini model ID on Vertex AI"
  default     = "gemini-3.5-flash-lite"
}

variable "thinking_budget" {
  type        = number
  description = "Thinking budget for Vertex AI Gemini models (0 to disable thinking token latency)"
  default     = 0
}

variable "docker_image" {
  type        = string
  description = "Artifact Registry container image URI"
  default     = "YOUR_DOCKER_IMAGE_URL"
}

variable "cloud_run_service_name" {
  type        = string
  description = "Cloud Run service name"
  default     = "dashboard-summary-service"
}

variable "genai_client_secret_value" {
  description = "Shared secret verified against Looker scoped user attribute genai_client_secret"
  type        = string
  sensitive   = true
}
