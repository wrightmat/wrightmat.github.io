# Epic 1 – Server Modernization Plan

## 1. Context & Goals
The current `web-server.py` powers the Universal TTRPG Sheets editors by exposing JSON CRUD endpoints backed by on-disk buckets and SQLite metadata. It also hard-codes mounts for other repo projects (e.g., `codex`) so they can reuse the same host. We want to turn this script into a reusable development server that can:

- Serve static HTML/CSS/JS for any project in the repo (Sheets, Codex, future apps).
- Provide authenticated JSON APIs with role-aware access control for sheets content.
- Keep the lightweight, dependency-free approach (stdlib Python) while improving maintainability.
- Remain friendly to offline/air-gapped workflows—configuration should be file-based and discoverable.

## 2. Current Server Audit
### 2.1 Request Handling
- The handler subclasses `SimpleHTTPRequestHandler` but bypasses the parent `do_GET` and `do_POST`, implementing its own JSON-only routing. Static file serving is effectively unavailable for mounts, so Codex templates cannot be rendered through the server without separate tooling.【F:web-server.py†L130-L225】
- Routing is manual, matching hard-coded path patterns (`/list/{bucket}`, `/content/{bucket}/{id}`, `/auth/*`, `/shares/*`, `/import`). There is no catch-all fallback for static files.【F:web-server.py†L225-L420】

### 2.2 Storage Layout
- Buckets are defined in the `MOUNTS` dictionary and eagerly created as directories. Bucket names double as SQLite table names for sheets content (`characters`, `templates`, `systems`). Additional Codex mounts (`codex_data`, `codex_templates`) point to raw folders but have no metadata records.【F:web-server.py†L33-L56】【F:web-server.py†L208-L224】
- The SQLite database lives under `sheet/data/database.sqlite` (note the missing "s"), which is inconsistent with the actual `sheets/` folder. Moving to a configurable path will avoid future typos and allow per-environment DBs.【F:web-server.py†L37-L41】

### 2.3 Authentication & Sessions
- Passwords use PBKDF2 (stdlib). Sessions are stored server-side with TTL refresh on access. However, role upgrades never occur: new users default to `free` and there are no endpoints to elevate them, yet write operations require `master` or `creator` tiers.【F:web-server.py†L60-L132】【F:web-server.py†L420-L575】

### 2.4 Access Control & Metadata
- Ownership metadata is maintained per bucket table. Permissions checks compare the user tier against fixed values (`require_role(user, "master")`). Shares grant view/edit but are limited to core buckets. Codex files bypass metadata entirely, so there is no notion of access control for those assets.【F:web-server.py†L225-L575】

### 2.5 Importer & Utilities
- The importer endpoint applies schema-defined JSONPath mappings and transformation helpers. This functionality should remain but be modularized so it can be reused via CLI or future batch jobs.【F:web-server.py†L132-L224】【F:web-server.py†L510-L575】

## 3. Pain Points & Risks
1. **Static content gap:** Because `do_GET` never calls the superclass implementation, requests for `/sheets/index.html` or `/codex/bestiarium.htm` return JSON 404s instead of static files. Developers need a separate HTTP server to preview non-API assets.
2. **Tightly coupled routing:** All behavior lives in one 600+ line handler, making it difficult to extend or test. Adding new buckets or endpoints risks regressions.
3. **Role dead-ends:** Without upgrade flows, most write endpoints are effectively unusable for new users, blocking template/system editing.
4. **Configuration rigidity:** Mounts and DB path are hard-coded constants. Supporting per-project overrides or future buckets requires code edits.
5. **Codex integration risk:** Codex folders are listed in `MOUNTS` but never served. Modernization must ensure these HTML templates stay accessible (ideally with directory listing disabled and content-type inferred).
6. **Lack of observability:** Logging is minimal (default `BaseHTTPRequestHandler` logging). Debugging issues in production-like environments is cumbersome.

## 4. Target Architecture
### 4.1 Configuration-Driven Server
- Introduce a `server.config.json` (or `.yaml`) that defines mounts with their type (`static`, `json-bucket`) and filesystem path. Support environment overrides via CLI flags (e.g., `--config path`).
- Separate storage metadata configuration (DB path, session TTL) from mount definitions to simplify testing and future packaging.
- Ship a single server binary/config loader that behaves the same in development and production. Config watching should be opt-in via configuration or CLI flag so both environments can enable it when desired without diverging code paths.
- Implement an optional config watcher that triggers a graceful reload (restart process or rehydrate config) when the file changes. The watcher is disabled by default but can be flipped on for fast local iteration while keeping the production instance identical.

### 4.2 Modular Handler Layers
- Implement a small router that dispatches based on HTTP method and prefix.
- Split responsibilities into modules:
  - `auth.py`: registration, login, session refresh, role upgrades.
  - `storage.py`: file bucket helpers, metadata persistence, import/export utilities.
  - `shares.py`: sharing operations and permission checks.
  - `static.py`: fall back to static file serving using `SimpleHTTPRequestHandler` helpers when no API route matches.

### 4.3 Static Asset Support
- Allow mounts marked `static` to serve files directly (respecting directory roots). Codex templates would use this mode so `/codex/bestiarium.htm` renders via the same server.
- Provide optional directory index toggles (default off) and MIME type detection via `mimetypes`.

### 4.4 Role & Tier Management
- Add JSON API endpoints that allow future admin UI screens to promote/demote users through the tier ladder (free → player → GM → creator → admin). API flows are sufficient; no CLI tooling is required.
- Provide hooks for self-service upgrade requests (e.g., placeholder endpoints to be wired to payments later) while keeping enforcement centralized on the server.
- Centralize permission checks so buckets declare the minimum role required for read/write operations.
- Initial implementation does not add extra safeguards beyond authentication/authorization; hardening can be layered in a later pass once the admin UI exists.

### 4.5 Extensible Buckets & Metadata
- Represent each JSON bucket in configuration with:
  - `table`: metadata table name (optional for static-only buckets).
  - `schema`: pointer to validation schema (future use).
  - `default_visibility`: controls `is_public` default.
- Allow mounts to declare whether they persist records in SQLite. Codex should default to `static` with no metadata or database rows while still sharing the same serving infrastructure.

### 4.6 Tooling & Observability
- Standardize structured logging (at least request method/path and response status) with an option to enable debug logs.
- Add a `/healthz` JSON endpoint (already present) and consider `/metrics` hooks for future instrumentation.

## 5. Implementation Milestones
1. **Scaffolding & Configuration ✅**
   - Replaced hard-coded constants with `server.config.json`, dynamically loading mounts, database location, and core server options through `ConfigLoader`.
   - Added opt-in config watching at the HTTP server layer so the same binary can hot-reload settings in both dev and prod when `config_watch` is enabled.
   - Simplified the legacy entrypoint so `web-server.py --config ...` boots the new modular server without breaking existing scripts.
2. **Routing & Static Serving ✅**
   - Introduced a lightweight regex router and split API concerns into dedicated modules (`auth`, `storage`, `shares`, `importer`, `static`).
   - Implemented a static asset fallback that respects mount definitions and serves Codex/Sheets HTML, including index resolution and optional directory listings.
3. **Auth & Role Upgrades ✅**
   - Restored register/login/logout flows with session persistence, added admin-only tier upgrade endpoints, and centralized role gating per bucket configuration.
   - Ensured share management honours ownership/admin rules so future UIs can call the same APIs safely.
4. **Content APIs Refactor ✅**
   - Extracted JSON CRUD helpers with consistent ACL enforcement covering ownership, public visibility, and share permissions.
   - Added automated tests (`tests/test_storage.py`) that exercise save/get/list/toggle/delete paths and enforce access control regressions.
5. **Importer & Utilities Extraction ✅**
   - Moved the schema importer into `server/importer.py`, preserving the JSONPath/transform pipeline for reuse by HTTP endpoints and future tooling.
6. **Polish & Documentation ✅**
   - Documented the new configuration-driven workflow here, updated the roadmap (see below), and captured setup instructions plus compatibility notes for Codex static mounts.

## 6. Open Questions
- _None at this time; hardening work will land in a follow-up epic once the admin UI requirements are finalized._

## 7. Next Steps
- Validate the modular server against the in-browser editors and Codex flows.
- Scope Epic 2 (data layer + offline sync) now that the HTTP boundary is stable.
