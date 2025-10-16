# Epic 3 – UI & Styling Plan

This document lays out the user interface blueprint for the Universal TTRPG Sheets tools before the Tailwind migration and visual refresh. It aligns with the three-pane layout across characters, templates, and systems while identifying shared components and styling conventions so the implementation remains consistent and maintainable.

## Design Goals

- **Consistency:** Preserve a shared information architecture so users and developers can rely on the same panel ordering, control placement, and visual language regardless of tool.
- **Reusability:** Prefer cross-tool components (toolbar buttons, inspectors, panel shells) that can be themed or configured instead of reimplemented.
- **Clarity:** Prioritize readable hierarchies, minimal cognitive load, and accessibility (keyboard navigation, ARIA labels, color contrast).
- **Progressive Enhancement:** Ensure the layout functions without JavaScript enhancements, then layer drag-and-drop, live previews, and responsive adjustments.
- **Tailwind Alignment:** Map every UI element to Tailwind utility patterns or extracted components so bespoke CSS is phased out.

## Tailwind Adoption Plan

1. **Build Tooling**
   - Use the Tailwind CLI in watch mode during development and produce a single `tailwind.css` output committed to the repo for now (no bundler required).
   - Configure `tailwind.config.js` with content paths pointing to `sheets/**/*.html` and `sheets/js/**/*.js` so utility classes generated from templates and JS-driven renderers are retained.
   - Enable dark mode via class strategy (`class: 'dark'`) to allow future theming without duplicating markup.

2. **Design Tokens & Presets**
   - Define custom color palette entries for surface, panel, accent, success, warning, and error states to maintain brand consistency.
   - Set typography scale (base font, heading sizes) and spacing scale extensions to align panel gutters across tools.
   - Create Tailwind component presets (via `@apply` or plugin) for frequently reused controls like panel headers, toolbars, buttons, tabs, and form labels.

3. **Migration Strategy**
   - Replace global layout styles first (three-pane grid, app chrome), then migrate panel contents tool-by-tool.
   - Remove redundant CSS as each feature is migrated; avoid duplicating utility combinations by extracting component classes when two or more tools share them.
   - Document the mapping from legacy class names to Tailwind equivalents in `docs/styles.md` (to be created during implementation) for easy reference.

4. **Testing & Validation**
   - Smoke-test each tool in desktop and tablet breakpoints after migration.
   - Use Tailwind's `@media` utilities for responsive tweaks instead of custom breakpoints.
   - Track accessibility regressions (focus order, screen reader semantics) and fix immediately.

## Tailwind Configuration Details

- **Config Entrypoint:** Create `tailwind.config.js` at the repo root with a single configuration shared by all Sheets tools.
  ```js
  module.exports = {
    content: [
      './sheets/**/*.html',
      './sheets/js/**/*.js'
    ],
    darkMode: 'class',
    theme: {
      extend: {
        colors: {
          surface: '#0f1115',
          panel: '#171a21',
          muted: '#9aa4af',
          accent: '#6aa1ff',
          success: '#3bd671',
          warning: '#f4c152',
          danger: '#ff6a6a'
        },
        fontFamily: {
          sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif']
        },
        boxShadow: {
          panel: '0 8px 20px rgba(12, 15, 20, 0.35)'
        },
        spacing: {
          18: '4.5rem',
          22: '5.5rem'
        }
      }
    },
    safelist: [
      {
        pattern: /grid-cols-(1|2|3|4|5|6)/
      },
      {
        pattern: /(col|row)-span-(1|2|3|4|5|6)/
      },
      'flex-1',
      'shrink-0'
    ],
    plugins: [
      require('@tailwindcss/forms'),
      require('@tailwindcss/typography')
    ]
  };
  ```
- **Output Pipeline:** Run `npx tailwindcss -i sheets/css/tailwind.css -o sheets/css/generated.css --watch` during development and commit the compiled `generated.css` until a bundler is introduced.
- **Utility Conventions:** Promote frequently reused combinations (panel chrome, toolbars, tab headers) into `@layer components` definitions inside `tailwind.css` so we avoid recreating utility sequences.
- **Dark Mode Toggle:** Expose a single `data-theme` toggle on `<html>` managed by `AppShell` to switch `dark` class while preserving legacy tokens for transition.

## CSS Inventory & Migration Targets

| File | Primary Responsibilities | Tailwind Migration Notes |
|------|-------------------------|--------------------------|
| `sheets/css/styles.css` | Defines global dark theme variables, three-pane grid, panel chrome, buttons, form controls, tab bar, and assorted utility classes. | Replace progressively with Tailwind utilities. Each section maps to: AppShell grid (`grid`, `col-span-*`), shared controls (converted via `@apply`), and color tokens (moved into Tailwind theme). Track remaining selectors in a checklist within `docs/styles.md`. |
| Inline `<style>` blocks (editors & runtime) | Local overrides for component spacing, drag/drop highlights, and temporary experiments. | Audit during migration; fold stable rules into Tailwind component classes and eliminate experimental leftovers. |

During implementation we will keep `styles.css` in place, pruning sections as they are represented in Tailwind until the file only contains non-migrated legacy styles (ideally approaching zero).

## Global Layout Architecture

All tools adopt a responsive three-pane layout:

- **Left Panel – Global Controls:** Fixed-width column housing actions that operate on the entire resource (sheet/template/system). Contents stack vertically with grouped sections separated by subtle dividers.
- **Center Canvas – Primary Workspace:** Flexible column that expands to fill available space, hosting either the rendered character sheet or the structural canvas (template/system). Supports vertical scrolling while keeping headers sticky when necessary.
- **Right Panel – Contextual Tools:** Fixed-width column for contextual utilities (dice roller, component palette, inspector). Panels collapse into accordions on narrow viewports.

A shared `AppShell` component will manage the three-column CSS grid, panel headers, and the floating status footer that materializes only when there is actionable feedback (autosave, validation, connectivity). Tailwind utility variants control spacing, scroll containers, and background colors.

### Shared UI Elements

| Component | Description | Usage |
|-----------|-------------|-------|
| **App Header** | Displays tool title, active resource name, user badge, and quick links (docs/help). | All tools. |
| **Action Toolbar** | Horizontal button group for primary actions (Save, Publish, Share, Preview). Supports icons via inline SVG or Heroicons. | Left panel top section. |
| **History Controls** | Undo/redo buttons with keyboard shortcut hints. | Left panel. |
| **Data I/O Panel** | Import/export JSON, file upload/download, clipboard actions. | Left panel collapsible section. |
| **Status & Notifications** | Floating ad hoc footer that only appears when there are unsaved changes, validation errors, or connectivity warnings. | AppShell-managed overlay spanning the bottom edge. |
| **Inspector Panel** | Context-sensitive property editor. Renders form controls based on selected entity schema. | Right panel for template/system; modal drawer for character where appropriate. |
| **Modal Layer** | Shared modal system (Tailwind with backdrop blur) for confirmations, new resource dialogs, and help overlays. | All tools. |
| **Tab Navigation** | Standard tab styling used both in layout primitives (template tabs) and inspector sub-sections. | Center canvas & right panel. |

## Character Experience Plan

### Left Panel – Session Controls

1. **Primary Actions**
   - Save Character (available when logged in with appropriate tier).
   - Duplicate / Export (JSON download).
   - Import (file upload or paste).
2. **History & Session**
   - Undo / Redo buttons with history depth indicator.
   - Session log toggle to expose dice history or event feed.
3. **Character Management**
   - Character selector dropdown (for switching between owned/shared characters) with filter.
   - Share link generator (copy to clipboard) respecting permissions.
4. **Status Blocks**
   - Autosave status, validation warnings (e.g., unfilled required fields), and offline indicator.

### Center Canvas – Interactive Sheet

- Rendered via the shared `RenderingEngine` using the active template with support for stack, row, repeater, and tab primitives.
- Each section renders with Tailwind grid/flex utilities. Sticky headers for major categories.
- Inline editing controls (inputs, toggles, clocks) styled with consistent form components.
- Formula outputs and derived stats highlight changes with subtle animations.
- Collapsible sections (e.g., inventory) share an accordion pattern consistent with template editor.
- Character-specific states such as conditions, buffs, and timers live directly on the sheet so they remain part of the saved data model.

### Right Panel – Play Tools

1. **Dice Roller**
   - Quick roll presets (d4/d6/d8/d10/d12/d20) and custom formula input.
   - History log with tags referencing sheet fields.
2. **Session Notes & Log**
   - Rich text editor (Toast UI) for session-only notes with autosave.
   - Optional quick-note chips for bookmarking key moments.
3. **Reference Library**
   - Searchable metadata (spells, feats) pulled from system catalogs.
   - Quick links to rules documentation and FAQ.
4. **GM Tools (visible with permission)**
   - Initiative tracker, party share controls, broadcast messages.
   - Encounter timers and shared handouts launcher.

Responsive behavior collapses right panel into accordions accessible via bottom drawer on mobile/tablet.

## Template Editor Plan

### Left Panel – Template Actions

1. **Template Management**
   - Save/Publish, duplicate, revert, preview (launch character view with sample data).
   - Template selector and metadata (system, version, author).
2. **History & Versions**
   - Undo/redo and version history (list of checkpoints with restore).
3. **Data Binding**
   - Schema browser tree with drag handles for binding fields directly to canvas.
   - Formula library list referencing template-level formulas (edit opens inspector focus).
4. **Import/Export**
   - JSON load/save, share with collaborators.

### Center Canvas – Layout Builder

- Primary layout tree displayed in hierarchical outline overlaying the rendered template.
- Toggle between **Design** (structural view with droppable zones) and **Preview** (rendered sheet using sample data).
- Drag-and-drop for rearranging stack/row/tab/repeater nodes with grid-aware drop targets.
- Inline controls for adjusting column spans, tab labels, repeater headers.
- Visual indicators for data bindings and formula-driven fields.

### Right Panel – Component Palette & Inspector

1. **Palette Tabs**
   - **Layout**: stack, row, tabs, repeater, divider, spacer.
   - **Fields**: input, textarea, number, select (metadata-driven), toggle, tags, roller, clock, timer, image, markdown block.
   - **Utility**: formula block, reference link, embedded metadata lists.
2. **Inspector**
   - Contextual editor for selected node with sections:
     - General: name, label, visibility conditions, help text.
     - Layout: span, alignment, responsive behavior.
     - Binding: data path (`@abilities.strength`), metadata references, default values.
     - Behavior: formulas, validation rules, dice expressions.
3. **Assets**
   - Upload manager for images/icons referenced by the template (stored via server bucket).

## System Editor Plan

### Left Panel – System Controls

1. **System Management**
   - Save/Publish, duplicate, import/export.
   - System selector with tag filters (e.g., fantasy, sci-fi).
2. **History & Validation**
   - Undo/redo, schema validation status, lint warnings.
3. **Catalog Browser**
   - Navigation tree for fragments, metadata catalogs, formulas, and rule references.
4. **Tools**
   - Quick generators (e.g., create ability score block, skill list) that insert prebuilt fragments.

### Center Canvas – Schema Workspace

- Tree view of schema fields with expandable nodes for nested objects/groups.
- Inline badges for type, required, default, and constraints.
- Drag handles for reordering siblings.
- Side-by-side diff preview when comparing published vs. draft versions.
- Optional JSON source view toggled via header button for advanced edits.

### Right Panel – Field Inspector & Catalog Editors

1. **Field Inspector**
   - Type selector, constraint inputs (min/max, regex, enumerations).
   - Fragment attachment, array item schema definitions, conditional logic.
2. **Metadata Editor**
   - Table/list editor for catalog entries (spells, feats). Supports bulk import from CSV/JSON.
3. **Formula Builder**
   - Expression editor with autocomplete for schema paths and helper functions.
4. **Documentation Pane**
   - Markdown preview for rules text linked to the selected node.

## Cross-Tool Considerations

- **State Management:** Reuse the existing `CharacterStore`/rendering engine for live previews in template and system editors by mounting draft data into mock character payloads.
- **Shortcuts & Accessibility:** Define consistent shortcuts (Ctrl+S to save, Ctrl+Z/Y for undo/redo) surfaced in tooltips. Provide skip links and focus outlines.
- **Notifications:** Shared toast system for success/error/information messages triggered by both front-end actions and server responses.
- **Internationalization:** Structure text through a localization map to enable future translation without reworking components.
- **Responsive Modes:** On smaller screens, left and right panels collapse into slide-in drawers triggered by persistent icons; the center canvas remains primary.
- **Theming:** Tailwind dark mode toggle affects surface colors, panel borders, and typography while preserving contrast ratios.

## Next Steps

1. Stand up the Tailwind build pipeline (`tailwind.css` source + `generated.css` output) and introduce the `AppShell` skeleton with placeholder panes.
2. Migrate the global three-pane layout and shared toolbar components to Tailwind utilities, removing redundant rules from `styles.css`.
3. Convert character, template, and system tool panels incrementally, ensuring the renderer primitives (stack/row/tab/repeater) emit Tailwind classes consistently.
4. Author `docs/styles.md` during migration to log deprecated selectors and newly established utility patterns.
