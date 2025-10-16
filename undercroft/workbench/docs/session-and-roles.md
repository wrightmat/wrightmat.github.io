# Session, Role, and Storage Flows

This document summarises how authentication tiers interact with local-first editing in the Workbench tooling and how the new `DataManager` integrates with the Python server.

## Local-First Editing

- All edits begin in the browser. Anonymous visitors can load systems, templates, and characters directly from JSON files and store changes in `localStorage`.
- The `DataManager` keeps per-bucket caches under the `undercroft.workbench:bucket:{name}` keys so multiple tabs can read/update the same draft content.
- Local records remain available for the lifetime of the browser storage, enabling one-click demos and shared links without requiring an account.

## Promoting to the Server

- Once a visitor registers or logs in, the `DataManager` stores the issued session token and automatically adds `Authorization` headers to subsequent API calls.
- Calling `save()` with `mode="auto"` will write to the server whenever a session is present and fall back to local storage otherwise. Drafts can be promoted explicitly later via `promote()` which replays the cached payload to the `/content/{bucket}/{id}` endpoint.
- Successful server writes persist files under the configured mounts and synchronise the SQLite catalogue so `/list/{bucket}` responses include the new record in the `owned` collection for the authenticated user.

## Role Expectations

The server recognises the following tiers (in ascending order): `free`, `player`, `gm`, `master`, `creator`, and `admin`. Each mount in `server.config.json` specifies which tiers can read or write. The default configuration grants:

- **Characters** – Read/write for `free` users so anyone can manage their own sheets once authenticated.
- **Templates** – Writable by `gm` and above, ensuring anonymous players cannot overwrite shared templates.
- **Systems** – Writable by `creator` and `admin`, mirroring the expectation that full system definitions come from trusted maintainers.

Anonymous access is still possible because:

- `/content/{bucket}/{id}` treats records without catalogue metadata as public, allowing published examples to load without logging in.
- `/list/{bucket}` returns the `public` catalogue when no session token is provided, exposing curated examples without revealing private drafts.

## Session Lifecycle

1. **Register/Login** – `/auth/register` (201) and `/auth/login` (200) both return `{ token, user }`. The `DataManager` caches this session payload and reuses it until logout.
2. **Authenticated Calls** – Requests automatically reuse the token; errors bubble up with descriptive messages so editors can show inline feedback.
3. **Logout** – `/auth/logout` clears the server session and triggers the `DataManager` to drop the stored token while retaining local drafts.
4. **Upgrade Path** – Admins may use `/auth/upgrade` to elevate other accounts. UI surfaces can read the cached `session.user.tier` to toggle authoring features without another round trip.

By aligning the editors around this flow we guarantee that guest play, registered persistence, and administrator tooling can coexist without fragmenting the UX.
