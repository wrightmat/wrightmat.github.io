# Agent Guidelines for `sheets`

## Project Overview
- The `sheets` directory hosts the Universal TTRPG Sheets prototype. It contains:
  - `index.html`, `template-editor.html`, `system-editor.html`, and `character.html` entry points.
  - `js/` with vanilla JavaScript modules for runtime, editors, data access, and utilities.
  - `css/` with the current custom stylesheets.
  - `data/` with sample schemas, templates, and characters consumed by the editors.
  - `docs/`, `ROADMAP.md`, and `COLLABORATION.md` capturing planning artifacts.

## Coding Principles
1. **No Redundancy** – Prefer extending or generalising existing functions over introducing near-duplicate logic. When adding helpers, confirm the behaviour cannot be covered by an existing abstraction.
2. **KISS (Keep It Simple, Stupid)** – Implement the simplest approach that satisfies the requirements. Avoid unnecessary layers, premature generalisation, or speculative hooks.

## Authoring Guidelines
- JavaScript remains framework-free; write ES modules that compose cleanly with the current code. Keep side effects explicit and share utilities via `js/lib` where possible.
- When updating CSS, favour incremental refactors and remove unused selectors as you go. If introducing a utility framework, document the transition plan and ensure existing pages continue to render.
- Any new HTML tooling should load assets relative to this directory so the static server can host them without extra configuration.
- Keep documentation up-to-date: when you change workflows or data formats, revise the relevant markdown files alongside the code.

## Testing & Validation
- Run any applicable unit or integration checks for areas you modify. If no automated tests exist, manually exercise the affected pages (e.g., Template Editor, System Editor) and note the steps in your summary.

These rules apply to every file within the `sheets` directory and its subdirectories.
