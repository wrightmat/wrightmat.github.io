# Epic 2 – Data Layer & Authoring Enhancements

This document captures the implementation details for Epic 2. The work delivers the new schema tooling, template language revamp, and character runtime capabilities described in the roadmap.

## System Schema Editor

* The editor now drives a nested tree of fields. Field types (`string`, `number`, `integer`, `boolean`, `array`, `object`, `group`) expose type-specific controls for validation and composition.
* Arrays support `minItems`, `maxItems`, inline item schemas, and optional fragment references (`itemFragment`). Objects toggle an additional-properties schema. Groups and objects can spawn arbitrary child fields.
* Schema fragments live alongside systems and can be merged into fields through the `fragment` selector. This keeps common structures (e.g., an inventory item) reusable across systems or array item templates.
* Metadata catalogs (`sys.metadata`) capture reusable option lists with inline values or future external sources. Field inspectors surface metadata references through the `optionsFrom` selector to drive choice sets in templates.
* Fields, fragments, metadata entries, and formulas can be reordered and deleted without leaving the editor. The inspector is context-aware for every node in the tree.

## Template Language & Editor

* Templates now use a formal layout tree rooted at `layout`. Supported primitives are:
  * `stack` – vertical flow container.
  * `row` – flex row with column spans.
  * `tabs` – tabbed container with labeled panes.
  * `repeater` – data-bound list rendering a nested template per item.
  * `field` – leaf widgets (`input`, `text`, `roller`, `toggle`, `tags`, `clock`, `timer`).
* The editor exposes a structural outline for the entire layout. Selecting nodes, columns, or tabs drives the inspector with contextual actions (add, reorder, delete, update spans/labels, etc.).
* Field inspectors expose component-specific properties (input types, numeric bounds, formulas, dice expressions, metadata-backed options, etc.).
* Template formulas move to the top-level `formulas` array so derived values can be defined once per template and evaluated deterministically.

## Formula Evaluation

* `FormulaEngine` now parses dependency references (`@path`) and evaluates formulas in a deterministic order. Cycles are avoided with a bounded iteration; dependencies are cached so renderers can reason about how calculations relate to sheet data.
* The evaluator rewrites expressions through a safe `__read(path)` indirection to guard against missing paths while still supporting the existing math helpers (`floor`, `ceil`, `sum`, etc.).

## Character Runtime

* The runtime mounts templates through a `CharacterStore`, which tracks the character payload, emits change notifications, and preserves undo/redo history.
* Data binding is reactive: field edits update the store and trigger a lightweight re-render of the layout without reloading the page. Lists use repeater templates and mutate the store without forcing a full refresh.
* The character page now exposes undo/redo controls plus import/export via a JSON text area so characters can be backed up or side-loaded during playtests.
* Metadata references resolve into toggle/tag options, and timers persist through the store's state helpers. Dice rolls log through the existing hooks API.

## Sample Data

* `sys.dnd5e` has been migrated to the new schema format, including inventory fragments and trait metadata.
* `tpl.5e.flex-basic` demonstrates the new layout primitives, repeater usage, and metadata-driven fields.
* Character data remains compatible; existing sheets automatically benefit from reactive updates and history.
