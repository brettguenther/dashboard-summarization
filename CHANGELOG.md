# Changelog

## v2.2.0

### Added
- Structured JSON executive synthesis (`Executive Overview`, `Key Findings` with impact badges, and prioritized `Recommended Next Steps`) alongside clean GitHub Flavored Markdown export.
- Tabbed workspace separating the `Executive Brief` from collapsible `Tile Breakdown` cards, with per-tile copy, full Markdown copy, and print/PDF stylesheet support.
- Active dashboard filter pills and automatic filter-change detection prompting one-click brief refresh when Looker dashboard filters update.
- Follow-up analytical suggestion cards integrated with Looker Conversational Analytics (`/agents/<LOOKER_AGENT_ID>`) and clipboard fallback.
- Standalone local preview mode (`https://localhost:3000/?preview=1`) for rapid UI iteration outside a Looker iframe.
- Automated unit and security test suites for both backend (`node:test`) and frontend (`Vitest` + Testing Library).

### Changed
- Migrated Cloud Run Vertex AI backend from deprecated `@google-cloud/vertexai` and `gemini-2.0-flash` to the unified `@google/genai` SDK (`vertexai: true`) defaulting to `gemini-3.8-flash` (`GOOGLE_CLOUD_LOCATION=global`, configurable via `MODEL_ID`) on Node 22 + Express 5.
- Migrated frontend toolchain from Webpack 5 + Babel + React 17 to Vite 6 + TypeScript 5.8 + React 19 + `@looker/extension-sdk@26.22.0`, emitting a single self-contained `dist/dashboard_summarization.js` bundle with inlined CSS.
- Replaced client-side Slack `client_secret` exchange with server-side `/slack/oauth-exchange` on Cloud Run, hardened shared-secret verification with fail-closed `crypto.timingSafeEqual`, and sanitized rendered Markdown with `rehype-sanitize`.
- Bounded Looker `run_inline_query` execution concurrency and added in-memory session caching to prevent connection pool saturation on large dashboards.

## v2.1

### Added
- Support for LookML dashboards
- Improved README

## v2.0

### Added
- Summary Styles: custom prompts with different styles for different personas (executives, analysts, stakeholders, action plans)
- Ability to regenerate query summaries with different prompts
- UI/UX modified with styled components

### Changed
- Changed WebSocket service to RESTful service so backend endpoints can be secured or deployed privately
- Synchronous calls for tile summaries changed to async and run in parallel
- Backend secured with Looker server (`scoped_user_attributes` + Secret Manager)

## v1.1

### Added
- Refine option for shortening dashboard summary

## v1.0

### Added
- Dashboard summarization powered by Vertex AI
- WebSocket backend hosted on Cloud Run
- Export options to Slack and Google Chat
