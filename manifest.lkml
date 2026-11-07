project_name: "dashboard-summarization"

application: dashboard-summarization {
  label: "Dashboard Insights Powered by Vertex AI"
  url: "https://localhost:3000/dashboard_summarization.js"
  # file: "dashboard_summarization.js"
  mount_points: {
    dashboard_vis: no
    dashboard_tile: yes
    standalone: yes
  }
  entitlements: {
    local_storage: yes
    navigation: yes
    use_clipboard: yes
    use_embeds: yes
    use_iframes: yes
    new_window: yes
    new_window_external_urls: [
      "https://*.looker.com/*",
      "https://slack.com/*"
    ]
    use_form_submit: yes
    core_api_methods: [
      "me",
      "run_inline_query",
      "run_query",
      "all_lookml_models",
      "dashboard",
      "dashboard_dashboard_elements",
      "all_dashboards",
      "search_dashboards",
      "artifact",
      "update_artifacts"
    ]
    external_api_urls: [
      # On Looker (Google Cloud core), use a custom domain mapped to Cloud Run rather than a default *.run.app URL
      "YOUR_CLOUD_RUN_CUSTOM_DOMAIN_URL",
      "http://127.0.0.1:5000",
      "http://localhost:5000",
      "https://localhost:3000",
      "https://*.googleapis.com",
      "https://slack.com/api/*",
      "https://slack.com/*"
    ]
    oauth2_urls: [
      "https://accounts.google.com/o/oauth2/v2/auth",
      "https://www.googleapis.com/auth/chat.spaces",
      "https://www.googleapis.com/auth/chat.spaces.readonly",
      "https://www.googleapis.com/auth/chat.messages",
      "https://www.googleapis.com/auth/chat.messages.create",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://slack.com/oauth/v2/authorize"
    ]
    scoped_user_attributes: ["genai_client_secret"]
    global_user_attributes: []
  }
}
