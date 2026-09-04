# Undercroft

Undercroft is a suite of TTRPG tools for building content and running sessions — in a fully system-agnostic way (D&D 5e-flavored out of the box). Each tool is useful on its own, but they share one account system, one content library, and one campaign model, so a GM can prep across several tools and then run an actual session without leaving the suite.

This document covers the suite at the architecture level: what each tool does, how content and accounts work across all of them, and (further down) the technical conventions for anyone working on the codebase. For how to actually use a specific feature, use the in-app help ("?") badges next to that feature, or the account page's help browser — that's the maintained, user-facing reference, not this file. Function- and module-level documentation lives as comments in the code itself.

---

## Getting Started

Undercroft is a vanilla JavaScript + Bootstrap (CDN) front end with a small Python backend. No build step, no npm, no `package.json`.

1. Clone the repo.
2. Make sure Python 3 is installed.
3. From the repo root, run `python web-server.py` (or `web-server.bat` on Windows).
4. Open `http://127.0.0.1:8000/undercroft/` in a browser.

`web-server.py` reads `server.config.json` (repo root) for host/port (default `127.0.0.1:8000`), session length, the SQLite database path (`data/database.sqlite`, created automatically), and a default admin account (`admin`/`admin`) seeded for local development. Pass `--config <path>` to point at a different config file.

The server otherwise runs on the Python standard library alone. One optional dependency — `pip install -r server/requirements.txt` — is only needed for the Home Assistant integration's credential encryption; everything else works with no install step at all.

---

## The Tools

| Tool | Role |
| --- | --- |
| **Orrery** | Map creator and viewer — system-agnostic base maps, layers, grids, groups, and entity-referencing markers. |
| **Press** | Versatile printing utility — turns any saved record into a card, sheet, or booklet via authored templates. |
| **Repository** | Wiki-style campaign journal. |
| **Workbench** | Character sheet and template editor, plus the live Play view a table uses during a session (game log, dice rolls, "Now showing" cards). |
| **Crucible** | Monster and adversary creator — Creature Type + Archetype + Role, built from a shared feature graph. |
| **Forge** | NPC generator — identity, 4D personality axes, optional AI-written character notes. |
| **Sanctum** | Location and dungeon generator, and the authoring surface for Setting/Location. |
| **Vault** | Spell and magic item generator — a budget-based feature economy built from the same feature graph as Crucible. |
| **Loom** | Manage data or import external content — the generic Library/System editor, and where external content (e.g. D&D Beyond) gets imported via mappings. |

There's no separate "Admin" tool — account tiers, content ownership, sharing, and Campaign Group management live inside Loom (tier-gated tabs) and the account page (`common/account.html`), both reachable from the signed-in menu in every tool's header. Every tool shares the same header chrome, the same three-pane shell, and the same save/share/print plumbing described next.

---

## Shared Architecture

### The Library

Nearly everything any tool produces — a System, a Location, an NPC, a Monster, a Wonder, a Template, a Map — is a **Library item**: one row in a single database table, addressed by a `kind` and an `id`. A new kind needs no new server code — dropping a `common/data/kind/<kind>.json` registry file in is enough for every generic save/list/get/delete/share route to support it immediately.

A System is just another Library item — an id, a title, and a `fields` array. Every "System-shaped" capability elsewhere in the suite (Vault's generator properties, Crucible's Creature Type/Combat Scaling, Sanctum's Environment, dice, Travel Means) reads its own reserved-key field off that array only if present, so a System never has to declare anything the game itself doesn't have.

### Accounts and tiers

Every account has one tier: **free < player < gm < creator < admin**. Each Library kind declares a `readTier` and a `writeTier` — an unregistered kind defaults to "anyone can read, only an admin can write." Most generator output is wide open; authoring-heavy kinds (Locations, Settings, Systems) require `creator` tier or higher. Tier changes are an admin action, from Loom's Users tab, or a user upgrade path from Account Settings (paid eventually, but currently free while in alpha/beta).

### Local-first saving

None of the generator tools require signing in. An anonymous visitor's saves go to their own browser's local storage; a signed-in user's saves go to the server as a real, ownable, shareable record. Signing in later doesn't strand anonymous work — every tool's save path is "local, unless authenticated," never "local only for guests."

### Sharing

Every Library kind supports the same model: a record can be made public, or shared with a specific user or a Campaign Group, each grant carrying `view` or `edit` permission. A share targeting a group applies to every current member and stays current as membership changes. "Public" isn't its own mechanism — it's sharing with a special "All Users" pseudo-target, always view-only; Loom's Public checkbox is a one-click shortcut for exactly that.

---

## Campaigns

A **Campaign Group** (managed in Loom) is how a GM organizes a table — a roster of member characters, a share target, and a live game log (dice rolls, messages, spotlighted cards) both signed-in members and anonymous visitors on a public share link can watch. Once a GM has at least one group, every tool's header grows an **active campaign** selector — a single, shared selection every tool sees immediately, so sharing dialogs across the suite can offer a one-click "Share with [active campaign]."

The piece that makes a live session actually work: a GM can put a generated card up in front of the table, live, from a Handout widget on their own Dashboard — no exporting, no switching to Press. What's visible to players is exactly what the GM's Dashboard shows as toggled on; Workbench's Play view (and a group's public share link) renders it through Press's own template engine, the same one the Handout widget itself uses.

For the practical how-to — creating a group, spotlighting a Handout, sharing a record — see the in-app help topics under "Campaigns" and "Collaboration".

---

## For Developers

`server/` is the shared Python backend (auth, the generic Library save/list/get/delete/share routes, Campaign Groups, kind-registry tier policy) — no per-kind server code is needed for a new Library kind. `common/` is the shared JS/data layer: `js/lib/` for cross-tool utilities (notably `data-manager.js` for all client/server data access), `data/` for the kind registry and shared content. `CLAUDE.md` (this directory) has the suite-wide behavioral guidelines for anyone (human or AI) editing this codebase — this section is the technical/conventions counterpart for a human reader.

### UI & Style Conventions

Layout, color, and interaction conventions across all nine tools plus the shared `common/` shell.

**Shared suite assets** — `common/css/shell.css` (base UI shell, pane scaffolding, status toasts, shared inspector-control styles; always link before a tool's own `css/styles.css`); `common/js/lib/ui-components.js` (`createIconButton`/`createCollapsibleSection`/`createJsonDataPanel`/`createToolbarButtonGroup`, the DOM-building factories every tool composes its most-repeated markup shapes from — prefer these over hand-writing an equivalent shape); `common/js/lib/panes.js` / `collapsible.js` (pane-level vs. section-level collapse, see below); `common/js/lib/help.js` + `common/data/help-topics.json` (the shared contextual-help system); also `dnd.js` (SortableJS drag-and-drop), `json-preview.js`, `clipboard.js` (`bindCopyButton`); `tooltips.js` is the sole canonical module for any tooltip suite-wide — no file may call `new bootstrap.Tooltip` directly.

**Shell layout** — the header is built entirely by `initAppShell` (`common/js/lib/app-shell.js`), not hand-typed markup; a page just needs a `<div data-app-shell-header></div>` mount point. Only the main canvas (`.workbench-main`) scrolls; the app frame locks to viewport height.

**Three-pane layout** — every tool follows the same split: left pane is the primary/selection surface, center pane is the actual content, right pane is the inspector for whatever's selected in the center. Cards keep their default Bootstrap border (never `border-0`); the center `<main>` stays plain (no background utility, no centered wrapper) so cards sit full-bleed. Orrery's `<main>` is the one exception — a full-viewport map can't live inside a scrolling flex column.

**Panes vs. collapsible sections** — two different mechanisms for two different jobs: panes (`panes.js`) collapse a whole left/right sidebar; collapsible sections (`collapsible.js`, `bindCollapsibleToggle`) collapse one section within a pane — the only mechanism used for that job, never `bootstrap.Collapse` directly.

**Toolbar buttons** — fixed order: New → Save → Duplicate → Delete → Undo → Redo, using only the slots a toolbar actually needs. New is always `outline-primary`, never filled — including a generator tool's own "Generate X" button, which fills the New slot conceptually. Import/Export are NOT toolbar-cluster slots — they live in the JSON Data section instead (see `createJsonDataPanel`'s own Import → Export → Copy action order); Print and Rename are tool-specific placements outside this cluster too (Press's own standalone center-pane Print button, Loom's per-tab Rename Mapping), not part of the fixed six. Icon-only with a visually-hidden label + tooltip, never a visible text label. See `createToolbarButtonGroup` (`ui-components.js`) for color conventions and the button-count limit. A new cross-cutting action always gets its own separate UI region — never squeezed in next to an existing picker, and never a 5th slot or extra row bolted onto the primary group.

**Inspector field order** — any "select an item → edit its properties" panel follows: Identity → Type → Data/Binding/Source → component-specific fields → Appearance → Behavior (always last). Press's Component Inspector is the reference example.

**Mode/View toggles for view switchers** — the standard "switch what the center pane shows" control is a `createModeToggleGroup` (a real labeled button group — e.g. NPC⇄Relationships, Monster⇄Relationships, Live Preview⇄Grid View) paired, where a mode has a secondary axis, with a `createCycleToggleButton` (a single button that steps to the other value each click — e.g. List⇄Graph within Relationships mode). Real Bootstrap `nav-tabs` is the exception now, reserved for Loom's genuinely tabbed multi-entity workflows (Import/Systems/Macros/Features/Library/Users/Groups) and Account Settings — never `nav-pills` or a custom button row, and never the default choice for a single tool's own view switching.

**Help topics over inline text** — explanatory/conceptual text a user would benefit from reading on demand goes through the help-topic system (`data-help-topic` + `help-topics.json`), never a hardcoded `<p>` hint. Written for the end user reading it in the app — never code, file paths, function names, or migration history.

**CSS organization** — shared, genuinely cross-tool rules live in `common/css/shell.css`; tool-specific rules stay in that tool's own `css/styles.css`. Promote something to `shell.css` when it's actually duplicated across tools, not because it could be. Grep the other stylesheets (and `common/data/template/*.json` — a class name can be load-bearing in stored template data) before adding a new tool-local class or assuming one is dead.

**Theme and surface colors** — use Bootstrap semantic tokens (`bg-body`, `bg-body-secondary`, `bg-body-tertiary`) instead of hard-coded colors for light/dark theme support. Avoid white backgrounds inside side panes unless a control specifically needs contrast.

### Code Conventions

**Server (`server/`)** — reads go through a dedicated read-only connection; writes go through the single write connection under a lock held only around the DB touch itself, never across I/O or LLM calls. Every delete route is a POST, never a bare DELETE verb. Tier checks always compare via `role_rank()`, never string equality against a tier name. A kind's registry policy is cached and invalidated on that kind's own registry save, so a tier-policy edit in Loom takes effect immediately.

**Shared JS layer (`common/js/lib/`)** — widget factory shape is `initXWidget(container, opts) → { destroy() }`, used throughout. `dataManager`/`status` are always injected, never a module-level singleton; `status?.show()` for all user-facing feedback, never `alert()`. Every record read/write goes through `dataManager`'s `{source: "local"|"remote", payload}` contract. The `@path`/`=formula` binding vocabulary is shared by `bindings.js`, `formula-engine.js`, and the mapping engine — don't invent a second syntax for a third consumer. Use `{ preferLocal: false }` for any System/config fetch used to derive rules/UI behavior, so a Loom edit is visible immediately instead of hidden behind a stale local cache. A handful of small, generic modules exist specifically to avoid re-duplicating near-identical logic across tools — check before writing a new version of any of: `ownership.js` (delete permission), `dotted-path.js` (path-walking), `derived-formulas.js` (`findDerivedFormula`/`evaluateDerivedFormula` — reads a System's own reserved-key `derivedFormulas` array and evaluates its `=formula` entries via `formula-engine.js`; also `parseDiceExpression`, syntax-only dice-notation parsing, and convenience composers like `abilityModifier`/`computeAttackBonus` matching the retired `dnd-rules.js`'s old call shapes), `generator-kit.js` (shared helpers for the feature/recipe-based generators — Crucible, Vault, Sanctum), `dom.js` (`setElementVisible` — use this, never plain `.hidden`, on any element with an author CSS display rule). Game-rules MATH (ability modifiers, proficiency-bonus-by-level, damage averages, ...) is never a per-System JS module, even a small "obviously fine" one — it's System-authored `=formula` data under the `derivedFormulas` reserved key (same convention as `dice`/`combatBindings`/`levelUpBindings`, see "Reserved-key System fields" below), evaluated generically through `derived-formulas.js`. `dnd-rules.js` used to be an accepted exception to this; it was retired for exactly this reason — don't reintroduce an equivalent for a new System.

**Reserved-key System fields** — beyond the `fields` array itself (see Shared architecture above), a System's own optional array fields are the general mechanism for "System-scoped vocabulary that isn't universal": dice (`dice.js`), named Rolls/Moves, Travel Means, and Vault's own generator-property fields (Rarity/Activation/Item Form — detected by shape, any array field whose values all carry a `cost`/`targetBudget`, in `vault/js/lib/tables.js`, never by hardcoded field name) all follow the same convention — a reserved field key, each value's own free-JSON payload, no dedicated top-level authoring UI. A System that doesn't declare one just has nothing eligible there, never an error. Reach for this shape before inventing a new System-level concept.

**Adding a new System or Setting** — a missing reserved-key field is invisible in Loom's own System editor (nothing prompts for it) and produces no error at runtime, just a thin, bland, or empty generator result — so the only real verification is generating with the new System, not reading the authored data back and confirming it looks complete. Gaps found repeatedly: Forge (NPC generator) needs an Archetype table or its identity results default to generic "Other"; Vault (spell/item generator) needs at least one generator-property field (Rarity/Activation/Item Form-shaped) or its budget-based feature economy has nothing to draw from; Crucible (monster generator) needs a Creature Type table and a Combat Scaling-equivalent field (set via Crucible's own Settings modal if the System's own field uses a different name) for CR/difficulty math to resolve; Sanctum (location/dungeon generator) needs an Environment field for generation to vary by biome; Workbench's Build Character wizard needs its own `buildSteps` declared at all, or the System has no wizard, not a degraded one. Content authored FOR a System (species/class/background/features) also needs to actually carry that System's own `systemIds` — every generator above only sees Library records tagged for the System currently selected.

**`buildSteps` — Workbench's Build Character wizard, fully self-contained per step.** One array field is the ENTIRE spec for the wizard: which steps exist, in what order, and everything each one needs to actually run — never split across a scatter of sibling reserved fields, and never a JS constant. Position in the sequence is exactly the array's own order, full stop — including `details`/`review`/`choices`, which are ordinary declared entries like any other, not a JS-reordered wrapper forced around the "real" steps. The one deliberate exception is the landing step: NOT declared in `buildSteps` at all (not even called "identity" — that name is left free for a System to use as a real step, e.g. a screen of free-form identity/backstory fields), always first, sourced from a single fixed JS constant (`REQUIRED_STEP_LABEL`) — reading a System-declared position/label for it would require already knowing the System, which is exactly what this step's own Template picker is how the user chooses in the first place, so it can never be data-driven and holds ONLY Name/Template, nothing optional (Pronouns lives on Details instead, since not every System wants to ask for it). A System with no `buildSteps` declared has no Build Wizard at all (`buildWizardSupported` blocks the whole wizard on this one signal; an incomplete single step's own data, e.g. `abilities` with no usable `methods`, only blocks that one step — see `renderBuildAbilitiesStep`'s own inline message). Each entry is `{step, name, ...step-specific data}`:
- `name` — every entry's own display text, full stop (the same Name every reserved-key value uses to identify itself in Loom — not a separate `label`, so there's exactly one place to author it). No JS-authored English fallback exists anywhere in the wizard; the bare step id is the absolute last resort for an entry with no `name` authored.
- A Library-kind pick (`species`/`class`/`background`) carries its own `kind` — which Library kind it fetches, never assumed identical to the step id.
- `subclass` carries `kind`/`parentKind`, and an optional `atCreation: true` (Daggerheart: subclass always chosen at creation) as the alternative to the default per-class runtime check (`getSubclassGrantLevel` — D&D's own classes grant it at level 1 or 3, varying class to class).
- `heritage` (a composite step combining 2 kind-picks in one screen, e.g. Daggerheart's Ancestry+Community) carries its own `picks: [{kind, label}, {kind, label}]` and `allowMixedAncestry` — the whole reason a separate `kindLabels` field used to exist (naming a KIND independent of any one step) is now just this step's own data; there is no other consumer of a bare kind-name-override left, so it was retired outright rather than kept around unused.
- `abilities` carries its own `methods` (what used to be the separate `abilityAssignmentMethods` field) — each method entry carries its OWN mechanics directly on itself: `array`'s own `values` (the fixed value set — D&D's Standard Array, Daggerheart's +2/+1/+1/0/0/-1), `pointBuy`'s `min`/`max`/`budget`/`costs`, `roll`'s `formula`/`count`/`label`. A declared method missing its own required shape doesn't get a fallback value from anywhere — see `getBuildAbilityMethodConfig`/`isBuildAbilityMethodUsable`.
- `input` — FULLY GENERIC, not specific to any one concept: `inputs[]` (each its own `label`/`placeholder`) renders that many free-text fields, and `targetArrayPath`/`itemKey`/`itemDefaults` say where the typed values get pushed (`{...itemDefaults, [itemKey]: typedValue}` per input, appended to the array at `targetArrayPath`). Daggerheart's own Experiences use this (2 inputs, `targetArrayPath: "@stats.experiences"`, `itemKey: "name"`, `itemDefaults: {modifier: 2}`), but nothing about the step itself is Experiences-specific — deliberately kept to this one generic step type rather than adding a new named step type per use case, so the wizard doesn't accumulate hundreds of single-purpose step types over time. See `renderBuildInputStep`.
- `choices` carries `equipmentChoices`/`startingDomainCards` (what used to be separate fields) — resolved once the character record exists, on this same step.

A future step type follows the identical rule: everything it needs lives on ITS OWN entry, so supporting a new System's own build-wizard shape is a data change, never a JS change. "No hardcoding" applies to every sibling field a step touches — methods, picks, choices, source lists — not just its own name; a step that gets its display text from data but still hardcodes one of its other fields elsewhere is only half-fixed.

The wizard's own JS only ever implements the small number of generic mechanism PATTERNS (a point-allocation method with *some* cost curve, a dice-roll-then-assign method, a Library-kind picker step, a declared step sequence); every System-specific NUMBER, LABEL, or STEP ORDER for one of those patterns is data on the System record, never a new constant or branch in the wizard code — this is the standard to hold new Systems' builder wizards to as more get added. Kind-specific data conventions (Resource, Location Type, ...) are covered by that file's own code comments, not restated here.

**Combat stat-block convention (`stats.*` — Monster/NPC/Character)** — every kind carrying combat data (Crucible's `monster`, Forge's `npc`, Workbench's `character`) stores it under one `stats` object at identical **paths and shapes**, not just the same shape each kind happens to use at its own prefix — Press templates and Dashboard widgets (the Combat Tracker especially) read these paths generically across kinds, so path drift breaks things exactly as badly as shape drift. Canonical shape: `hitPoints: {max, current, temp, diceString?}`, `armorClass` (number), `abilities` (flat `{strength: 14, ...}`, bare numbers not modifiers), `initiative: {bonus, advantage?, disadvantage?}`, `senses`, `speed: {walk, burrow, climb, fly, swim, hover?}`, `proficiencies: {defenses, languages}`, `savingThrows`/`skills` (`{name, value, ...}[]`). Monster-only: `challengeRating` (string), `hitDice`, `environments`, `sources`, `proficiencyBonus`. A field that doesn't apply to a kind stays absent — expected, not a gap.

Feature-matching (shared between Crucible's monster import and Vault's spell/item import, `common/js/lib/feature-import-core.js`) turns an imported record's raw prose or structured data into real, deduplicated Feature references automatically on every save. A Feature can carry `tiers` (a small closed set of named magnitude variants a record picks exactly one of) or `options` (a menu where every entry belongs to the ability at once) — see `monster-feature-matching.js`/`vault-feature-matching.js`/`feature-params-editor.js`, extensively commented at the point of use. Character data is always hand-authored (not imported) for a System without a DDB-style mapping — a fully supported path, not a fallback.

Tiers vs. featureParams: tiers are a magnitude ladder genuinely *independent* of whatever "which X" param the Feature also carries (resistance/immunity/vulnerability is independent of *which* damage type); a value only meaningful *paired with* a companion free-text value (a spell's own level means nothing without its own name) is one compound fact and both halves stay in featureParams together, never split across the boundary. Check whether an existing Feature already models the same axis before inventing a new shape.

**Component Inspector standards (Press/Workbench)** — Press and Workbench each render a per-component-type property panel; these converged onto one shared standard, binding for any new component type or tool: exactly two data-population field names ("Binding/Text" from the Character record or a literal; "Source/Options" from the System's own choice list, only on types that genuinely have one); a standard section order (Type Summary → Identity → Component → Appearance → Behavior → Advanced, the last three collapsed by default, auto-forced open only when values differ from a pristine default); one shared toggle/formula control (`createFormulaToggleField`, `inspector-fields.js`) for any boolean property that plausibly varies by character; one shared field-shape kit (`inspector-fields.js`/`ui-components.js`) and one shared icon registry (`component-icons.js`) — a new hand-rolled field pair or a second icon list is exactly the duplication this suite avoids.

**Event naming** — new cross-module events use an `undercroft:*` prefix. `workbench:*` is a legacy prefix from before `DataManager` became suite-wide — don't extend it.

### Architecture Reference

How the moving pieces fit together, for anyone maintaining, extending, or troubleshooting the suite.

**Front-end** — `initAppShell` (`common/js/lib/app-shell.js`) wires up theme toggles, pane controls, a status manager, keyboard shortcuts, and a persisted undo/redo stack per namespace. `initThemeControls` (`common/js/lib/theme.js`) reads/persists the theme preference; every page includes the same inline bootstrapping `<script>` in `<head>` to apply it before first paint. `DataManager` (`common/js/lib/data-manager.js`) abstracts REST calls, session persistence, and local caching for every Library kind. `initTierVisibility`/`initTierGate` (`common/js/lib/access.js`) handle access control — Loom gates the whole tool, most others gate per-element. Help topics load via `loadHelpTopics` (`help.js`); `initHelpSystem` injects "?" buttons on `data-help-topic` elements; `common/docs.html` is a full-page browser over the same catalog.

**Tool implementations** — System authoring lives entirely in Loom's Systems tab, no separate System-editing surface in Workbench. Workbench itself is a single page with a Template/Play/Edit tab switcher (`js/pages/workbench.js` orchestrates one shared status/undo stack, DataManager, auth, tier gating); Template and Character views are separate rendering engines for the same component-type vocabulary, not a unified implementation — check both when changing shared component behavior.

**Server** — `app.py` is a threading HTTP server wrapping a shared `Router`, falling back to static file serving for unknown routes. `auth.py` handles session persistence, password hashing, tier upgrades, default user seeding. `storage.py` is the unified `library_items` ownership/sharing index every Library kind shares, plus the genuinely relational tables (`shares`, `share_links`, `group_members`, `group_logs`) and auth tables — a kind's content lives as a flat JSON file on disk, not in the database; `library_items` only indexes ownership/title/metadata. `shares.py`/`groups.py` handle share-link CRUD, Campaign Group CRUD, and the group game logs backing live-session collaboration. `config.py`/`state.py` load `server.config.json` and centralize shared resources (DB connections, caches, locks) passed into every request handler.

**Workflows & data flows** — `content-registry.js` reconciles local caches with builtin definitions and seeds demo content. External content (e.g. D&D Beyond) comes in through Loom's mapping system (`loom/mappings/*.json` + `mapping-engine.js`), a standalone, GM-authored transform into this suite's data model — the suite's one working import mechanism. Mapping/glue code (`mapping-custom-functions.js`, `system-lookup-tables.js`) is allowed to know source-specific field names, since its job is translating an external wire format; but *vocabulary values* (condition names, alignments, skill lists) still live in and come from the System record edited in Loom, never duplicated as static values in JS. Inventory data modeling is schema-done/rendering-still-roadmap: an `array` field can carry an `item` contract (Enum or Records) that formulas/bindings already understand for nested paths, but the Template editor doesn't render List components from that schema yet, and the character runtime still edits array components via raw JSON.

**Error handling & diagnostics** — client modules throw descriptive `Error` instances when required dependencies are missing. Server handlers catch `AuthError`/`StorageAuthError` and translate them into HTTP 401/403; unexpected exceptions log and return 500. Status toasts via the shared `StatusManager` give feedback for every action, in every tool.
