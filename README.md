# Looker Dashboard Summarization

A Looker Extension Framework dashboard tile that synthesizes live dashboard queries into structured executive briefs, tile-by-tile analytical breakdowns, and Looker Conversational Analytics follow-up prompts using Gemini on Vertex AI.

![dashboard-summary](./src/assets/dashboard-summary-new.gif)

## Capabilities

1. **Fast Single-Pass & Deep Parallel Synthesis**:
   - **Single-Pass Pipeline (Default &bull; ~3-4s)**: Calls `POST /generateExecutivePackage` to analyze all dashboard tiles in a single unified Vertex AI request. Synthesizes an executive overview, quantitative key findings, prioritized next steps, follow-up conversational questions, and individual tile breakdown cards in one fast round-trip.
   - **Parallel Multi-Call Pipeline**: Map-reduce fan-out that summarizes every tile independently (`/generateQuerySummary`) before synthesizing the executive brief (`/generateSummary`). Selectable via the Tile Configuration Menu.
   - **Gemini 3.5 Flash Lite**: Default model running on Vertex AI (`locations/global`) with explicit `thinkingBudget: 0` to eliminate thinking token latency while preserving strict data grounding.
2. **Edit-Mode Tile Configuration & Auto-Run**: Entering Looker Dashboard Edit mode (`tileHostData.isDashboardEditing`) opens an integrated Tile Configuration Menu backed by Looker's `CustomerArtifactStore` (`artifact` / `update_artifacts`), allowing authors to configure:
   - **Execution Pipeline**: Toggle between Fast Single-Pass (~3s) and Parallel Multi-Call.
   - **Auto-Run**: Automatically generate insights on dashboard load.
   - **Filter Change Behavior**: Toggle between instant auto-refresh or a 1-click "Refresh Brief" banner.
   - **Viewer Permissions**: Enable or disable viewer prompt refinement (`Refine` button).
   - **Section Visibility**: Show or hide `Recommended Next Steps` and `Suggested Follow-Up Questions`.
   - **Default Prompt & Persona**: Choose from built-in personas (Executive, Analyst, Stakeholder, Action Plan) or provide tailored analytical instructions.
3. **Dual Mount Modes — Embedded Dashboard Tile & Standalone Split-Workspace**:
   - **Dashboard Tile Mount (`dashboard_tile: yes`)**: Runs directly inside any Looker dashboard with a slim single-line header (`title_hidden: true` compatible) and `@container` responsive wide-screen grids.
   - **Standalone Split-Workspace Mount (`standalone: yes`)**: Launches as a full-screen Looker application (`/extensions/...`) that embeds any Looker dashboard on the main left canvas via `@looker/embed-sdk` (`getEmbedSDK()`) alongside a collapsible right-hand **AI Dashboard Insights Drawer** (`500px` Standard / `660px` Wide / `44px` Collapsed Rail). Includes a **Workspace Settings** modal with live dashboard search (`search_dashboards` / `all_dashboards`), URL route synchronization (`/dashboards/<id>?dashboard_id=<id>&<Filter>=<Value>` modeled after `lkrdev/dashboard-tabs`), and real-time filter/run event syncing (`dashboard:loaded`, `dashboard:filters:changed`, `dashboard:run:start`, `page:changed`).
4. **Collaboration Exports & Conversational Analytics**: Supports Looker Conversational Analytics follow-up prompts (`/agents/<LOOKER_AGENT_ID>`), one-click Markdown copy, Google Chat OAuth export, and Slack Block Kit OAuth export.

## Architecture

```mermaid
flowchart LR
  subgraph Looker["Looker Instance"]
    Tile["Dashboard Summarization Tile<br/>(React 19 + Vite Single Bundle)"]
    CoreAPI["Looker Core 4.0 API<br/>(User-Context Queries)"]
    Proxy["Looker ExternalApiProxy<br/>(Scoped Secret Injection)"]
    CA["Conversational Analytics<br/>(/agents/LOOKER_AGENT_ID)"]
  end

  subgraph GCP["Google Cloud Project"]
    Run["Cloud Run REST Service<br/>(Node 22 + Express 5)"]
    Secret["Secret Manager<br/>(GENAI_CLIENT_SECRET)"]
    Vertex["Vertex AI<br/>(@google/genai · gemini-3.5-flash-lite)"]
  end

  Tile -->|"1. Fetch metadata & run_inline_query"| CoreAPI
  Tile -->|"2. serverProxy (/generateExecutivePackage)"| Proxy
  Proxy -->|"3. Inject X-Genai-Client-Secret"| Run
  Secret -.->|"Mount secret"| Run
  Run -->|"4. ADC generateContent (responseSchema · thinkingBudget: 0)"| Vertex
  Tile -->|"5. Launch follow-up question"| CA
```

### Technology Stack

- **Frontend**: React 19, TypeScript 5.8, Vite 6 (single classic IIFE bundle with inlined CSS), `react-markdown` + `remark-gfm` + `rehype-sanitize`, `lucide-react`
- **Looker Integration**: `@looker/extension-sdk` (`26.22.0`), `@looker/sdk` (`26.22.0`), `@looker/embed-sdk` (`2.0.10`)
- **Backend Service**: Node.js 22+, Express 5, `@google/genai` (`vertexai: true`), defaulting to `gemini-3.5-flash-lite` on `locations/global` with `THINKING_BUDGET=0`
- **Infrastructure**: Cloud Run v2, Secret Manager, least-privilege IAM (`roles/aiplatform.user` + `roles/secretmanager.secretAccessor`) provisioned via Terraform

---

## 1. Cloud Run Vertex AI Service Setup

### Local Development

1. Navigate to the backend service directory and install dependencies:

   ```bash
   cd restful-service/src
   npm install
   ```

2. Authenticate Google Cloud Application Default Credentials:

   ```bash
   gcloud auth application-default login
   ```

3. Export required environment variables and start the server (listens on `http://127.0.0.1:5000` by default):

   ```bash
   export GOOGLE_CLOUD_PROJECT="<PROJECT_ID>"
   export GOOGLE_CLOUD_LOCATION="global"
   export MODEL_ID="gemini-3.5-flash-lite"
   export THINKING_BUDGET="0"
   export GENAI_CLIENT_SECRET="<SHARED_SECRET>"
   npm start
   ```

4. Run backend unit tests:

   ```bash
   npm test
   ```

### Cloud Run Deployment (Artifact Registry + Terraform)

1. Create an Artifact Registry Docker repository in your target region:

   ```bash
   gcloud artifacts repositories create dashboard-summarization-docker-repo \
     --repository-format=docker \
     --location="<REGION>" \
     --project="<PROJECT_ID>"
   ```

2. Build and push the container image from `restful-service/src`:

   ```bash
   cd restful-service/src
   gcloud builds submit \
     --project="<PROJECT_ID>" \
     --region="<REGION>" \
     --config="../../src/assets/cloudbuild.yaml" \
     --substitutions="_REGION=<REGION>"
   ```

3. Deploy the Cloud Run service, service account, and Secret Manager secret with Terraform:

   ```bash
   cd ../terraform
   terraform init
   terraform apply \
     -var="project_id=<PROJECT_ID>" \
     -var="deployment_region=<REGION>" \
     -var="vertex_location=global" \
     -var="model_id=gemini-3.5-flash-lite" \
     -var="thinking_budget=0" \
     -var="docker_image=<REGION>-docker.pkg.dev/<PROJECT_ID>/dashboard-summarization-docker-repo/dashboard-summarization-service:latest" \
     -var="genai_client_secret_value=<SHARED_SECRET>"
   ```

4. Record the `url` output returned by Terraform for configuring `.env` and `manifest.lkml`.

> [!IMPORTANT]
> **Looker (Google Cloud core) Custom Domain Requirement**: Looker Core tenant VPCs configure an authoritative Private Cloud DNS zone for `run.app.` (used internally for Looker services), causing Looker's `ExternalApiProxy` (`extensionSDK.serverProxy`) to return `404 Not Found` for default `*.run.app` URLs. Map a **custom public domain** to the Cloud Run service (for example via Cloud Run Domain Mappings pointing a `CNAME` to `ghs.googlehosted.com.`, or an External Application Load Balancer) and use that custom `https://...` domain in `RESTFUL_WEBSERVICE`, `manifest.lkml` (`external_api_urls`), and the Looker User Attribute **Domain Allowlist**.

### Optional: Cloud Logging Sink for Token Usage Monitoring

Each Vertex AI call writes a structured Cloud Logging entry (`component: "dashboard-summarization-logs"`) including `model` and `usageMetadata` token counts (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`). Filter logs in Cloud Logging or route them to BigQuery with:

```text
resource.type = "cloud_run_revision"
resource.labels.service_name = "dashboard-summarization-service"
jsonPayload.component = "dashboard-summarization-logs"
```

---

## 2. Looker Extension Setup

### Local Development

1. From the repository root, copy `.env.example` to `.env` and populate configuration values:

   ```bash
   cp .env.example .env
   ```

   ```ini
   RESTFUL_WEBSERVICE=http://127.0.0.1:5000
   # Used only in local development; production builds strip this variable and use Looker's scoped secret tag
   GENAI_CLIENT_SECRET=<SHARED_SECRET>

   # Optional: Looker Conversational Analytics Agent ID (deep-links to https://<your-instance>.cloud.looker.com/agents/<AGENT_ID>)
   LOOKER_AGENT_ID=

   # Optional: Google Chat & Slack OAuth client IDs and target destinations
   GOOGLE_CLIENT_ID=
   SPACE_ID=
   SLACK_CLIENT_ID=
   CHANNEL_ID=
   ```

2. Install dependencies and start the HTTPS Vite dev server:

   ```bash
   npm install
   npm run develop
   ```

   - Looker dev bundle endpoint: `https://localhost:3000/dashboard_summarization.js`
   - Local UI preview (Dashboard Tile mode): `https://localhost:3000/?preview=1`
   - Local UI preview (Standalone Split-Workspace mode): `https://localhost:3000/?preview=1&mount=standalone`

3. Run typechecking and frontend unit tests:

   ```bash
   npm run typecheck
   npm test
   ```

4. Create a blank LookML project in Looker, add `manifest.lkml`, and include your Cloud Run URL in `external_api_urls`:

   ```lkml
   project_name: "dashboard-summarization-extension"

   application: dashboard-summarization {
     label: "Dashboard Insights Powered by Vertex AI"
     # file: "dashboard_summarization.js"
     url: "https://localhost:3000/dashboard_summarization.js"
     mount_points: {
       dashboard_vis: no
       dashboard_tile: yes
       standalone: yes
     }
     entitlements: {
       local_storage: yes
       navigation: yes
       use_embeds: yes
       use_iframes: yes
       use_form_submit: yes
       use_clipboard: yes
       new_window: yes
       new_window_external_urls: ["https://*.looker.com/*", "https://slack.com/*"]
       core_api_methods: ["me", "run_inline_query", "run_query", "all_lookml_models", "dashboard", "dashboard_dashboard_elements", "all_dashboards", "search_dashboards", "artifact", "update_artifacts"]
       external_api_urls: [
         "https://<YOUR_CLOUD_RUN_SERVICE_URL>",
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
         "https://www.googleapis.com/auth/userinfo.profile",
         "https://www.googleapis.com/auth/chat.spaces.readonly",
         "https://www.googleapis.com/auth/chat.bot",
         "https://www.googleapis.com/auth/chat.messages",
         "https://www.googleapis.com/auth/chat.messages.create",
         "https://slack.com/oauth/v2/authorize"
       ]
       scoped_user_attributes: ["genai_client_secret"]
     }
   }
   ```

### LookML Manifest Entitlements Reference

Each entitlement in `manifest.lkml` is scoped to a specific capability across the Dashboard Tile and Standalone Split-Workspace mount points:

| Manifest Setting / Entitlement | Why It Is Used |
| :--- | :--- |
| `mount_points.dashboard_tile: yes` | Allows the extension to be added directly as a tile inside any Looker dashboard. |
| `mount_points.standalone: yes` | Allows the extension to be launched from **Applications** (`/extensions/...`) in Standalone Split-Workspace mode (embedded Looker dashboard on the left + collapsible AI Insights drawer on the right). |
| `use_embeds: yes` & `use_iframes: yes` | Required by `@looker/embed-sdk` (`getEmbedSDK()`) in Standalone mode to embed the selected Looker dashboard (`/embed/dashboards/<id>`) inside the left-hand workspace canvas and receive live `dashboard:loaded`, `dashboard:filters:changed`, `dashboard:run:start`, and `page:changed` events. |
| `navigation: yes` | Enables URL route synchronization (`extensionSDK.clientRouteChanged` / `setInitialRoute` / `hostChangedRoute`) in Standalone mode so the active dashboard ID and filter state are reflected in the browser URL (`/dashboards/<id>?dashboard_id=<id>&...`) for bookmarking and sharing. |
| `core_api_methods: ["dashboard", "dashboard_dashboard_elements", "run_inline_query", "run_query"]` | Fetches dashboard metadata, tile queries, and filter listeners, and executes each tile's underlying Looker query in the viewer's security context. |
| `core_api_methods: ["all_dashboards", "search_dashboards"]` | Powers the searchable dashboard picker in the Standalone Workspace Settings modal so users can search and switch between available Looker dashboards by title or ID. |
| `core_api_methods: ["artifact", "update_artifacts"]` | Persists per-tile configuration (`tile_<dashboardId>_<elementId>`) and default Standalone Workspace preferences (`standalone_workspace_config`) in Looker's `CustomerArtifactStore` (`namespace: "dashboard_summarization_config"`). |
| `local_storage: yes` | Provides client-side fallback persistence for tile and standalone workspace settings when `CustomerArtifactStore` permissions are restricted. |
| `use_clipboard: yes` | Enables one-click copying of the Executive Brief, individual tile summaries, and Conversational Analytics follow-up prompts. |
| `new_window: yes` & `new_window_external_urls` | Allows opening the native Looker dashboard or Looker Conversational Analytics (`/agents/<LOOKER_AGENT_ID>`) in a new browser tab. |
| `scoped_user_attributes: ["genai_client_secret"]` | Injects the shared `X-Genai-Client-Secret` header server-side via `extensionSDK.serverProxy` when calling the Cloud Run Vertex AI service without exposing secrets in browser code. |

### Production Bundle Deployment

1. Build the self-contained Looker bundle (with `RESTFUL_WEBSERVICE` set to your deployed Cloud Run URL in `.env`):

   ```bash
   npm run build
   ```

   This produces a single file (`dist/dashboard_summarization.js`) with all styles inlined.

2. Upload `dist/dashboard_summarization.js` to your LookML project, switch `manifest.lkml` from `url:` to `file: "dashboard_summarization.js"`, and deploy to production.
3. Create a hidden Looker User Attribute named `<extension_id>_genai_client_secret` (replacing `-` and `::` in the extension ID with `_`, e.g. `dashboard_summarization_extension_dashboard_summarization_genai_client_secret`), restrict its **Domain Allowlist** to `https://<YOUR_CUSTOM_CLOUD_RUN_DOMAIN>/*`, and set its default value to `<SHARED_SECRET>`. (If updating an existing hidden User Attribute's Domain Allowlist, clear `default_value` to `null` first, update `hidden_value_domain_whitelist`, and then re-apply `default_value`.)

---

## 3. Optional Collaboration Exports

### Slack OAuth Setup

1. Create a [Slack OAuth v2 application](https://api.slack.com/authentication/oauth-v2) with `chat:write` and `channels:read` scopes.
2. Add `SLACK_CLIENT_ID` and `CHANNEL_ID` to the frontend `.env` before building.
3. Configure `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` as environment variables (or Secret Manager references) on the Cloud Run service so `/slack/oauth-exchange` exchanges authorization codes server-side without exposing `SLACK_CLIENT_SECRET` in browser code.

### Google Chat OAuth Setup

1. Configure a Google Cloud OAuth 2.0 Web Client and enable the Google Chat API.
2. Add `GOOGLE_CLIENT_ID` and target `SPACE_ID` to `.env`, and add the Chat app to your target space.

---

## Grounding Recommendations

- **Dashboard Descriptions**: Populate the dashboard's **Details -> Description** field in Looker to give Gemini overarching business context and KPI definitions.
- **Tile Notes**: Add concise notes on individual dashboard tiles to clarify metric nuances, targets, or caveats that Gemini should incorporate into tile and executive summaries.
