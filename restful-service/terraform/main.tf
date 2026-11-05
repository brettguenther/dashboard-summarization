provider "google" {
  project = var.project_id
}

module "project-services" {
  source                      = "terraform-google-modules/project-factory/google//modules/project_services"
  version                     = "~> 17.0"
  disable_services_on_destroy = false

  project_id  = var.project_id
  enable_apis = true

  activate_apis = [
    "cloudresourcemanager.googleapis.com",
    "cloudapis.googleapis.com",
    "cloudbuild.googleapis.com",
    "run.googleapis.com",
    "iam.googleapis.com",
    "serviceusage.googleapis.com",
    "storage-api.googleapis.com",
    "storage.googleapis.com",
    "aiplatform.googleapis.com",
    "compute.googleapis.com",
    "secretmanager.googleapis.com"
  ]
}

resource "time_sleep" "wait_after_apis_activate" {
  depends_on      = [module.project-services]
  create_duration = "120s"
}

resource "google_secret_manager_secret" "genai_secret" {
  secret_id = "GENAI_CLIENT_SECRET"
  project   = var.project_id

  replication {
    auto {}
  }
  depends_on = [module.project-services]
}

resource "google_secret_manager_secret_version" "genai_secret_version" {
  secret      = google_secret_manager_secret.genai_secret.id
  secret_data = var.genai_client_secret_value
}

resource "google_service_account" "cloud_run_sa" {
  account_id   = "dashboard-summary-sa"
  display_name = "Cloud Run Service Account for dashboard summary extension"
  project      = var.project_id
}

resource "google_secret_manager_secret_iam_member" "secret_access" {
  secret_id = google_secret_manager_secret.genai_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run_sa.email}"
  project   = var.project_id
}

resource "google_project_iam_member" "vertex_ai_user" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

resource "google_cloud_run_v2_service" "default" {
  name     = var.cloud_run_service_name
  location = var.deployment_region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    scaling {
      max_instance_count = 20
      min_instance_count = 0
    }
    timeout                          = "300s"
    max_instance_request_concurrency = 80
    service_account                  = google_service_account.cloud_run_sa.email

    containers {
      image = var.docker_image

      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }

      env {
        name  = "GOOGLE_CLOUD_LOCATION"
        value = var.vertex_location
      }

      env {
        name  = "MODEL_ID"
        value = var.model_id
      }

      env {
        name = "GENAI_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.genai_secret.secret_id
            version = "latest"
          }
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1024Mi"
        }
      }
    }
  }
  depends_on = [
    google_secret_manager_secret_version.genai_secret_version,
    google_secret_manager_secret_iam_member.secret_access,
    google_project_iam_member.vertex_ai_user
  ]
}

# TODO(security): Cloud Run service accepts requests from Looker's ExternalApiProxy (serverProxy),
# which authenticates via the Secret Manager-backed GENAI_CLIENT_SECRET using timingSafeEqual.
data "google_iam_policy" "noauth" {
  binding {
    role = "roles/run.invoker"
    members = [
      "allUsers",
    ]
  }
}

resource "google_cloud_run_v2_service_iam_policy" "noauth" {
  location    = var.deployment_region
  project     = var.project_id
  name        = var.cloud_run_service_name
  policy_data = data.google_iam_policy.noauth.policy_data
  depends_on  = [google_cloud_run_v2_service.default]
}

output "url" {
  value = google_cloud_run_v2_service.default.uri
}
