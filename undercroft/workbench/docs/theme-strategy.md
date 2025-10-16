# Workbench Theme Strategy

## Current Pain Points
- **CDN Tailwind warning:** The CDN build surfaces a console warning about avoiding it in production, highlighting that we lack a reproducible build pipeline and tree-shaking for the Workbench.
- **Dark theme incompatibility:** The CDN configuration only honours the default `.dark` class switch. Because we rely on `data-theme` attributes for storing preferences, we added bespoke selectors in `styles.css`. Maintaining duplicated rules defeats the goal of leaning on Tailwind utilities.
- **Fragmented styling sources:** With Tailwind utilities, inline scripts, and custom CSS attempting to cooperate, debugging why a token does not flip between light/dark now requires chasing multiple layers.

## Options Considered
### 1. Stay on Tailwind but move off the CDN
- Use the Tailwind CLI (already a dev dependency) to compile a dedicated Workbench stylesheet (`@tailwind base/components/utilities`).
- Update `tailwind.config.js` to include Workbench content globs (`undercroft/workbench/**/*.{html,js}`) and configure `darkMode` to recognise both the `.dark` class and `[data-theme="dark"]` selector.
- Keep existing Tailwind utility class usage, but remove the manually mirrored selectors we added in `styles.css` once the compiled CSS covers them.
- Pros: Minimal refactor, preserves the design tokens already expressed with Tailwind classes, unlocks additional configuration (custom theme tokens, plugins) without shipping extra runtime weight.
- Cons: Introduces a build step for Workbench assets, so we must document & automate `npm run build:workbench` (and optionally `--watch`) in development workflows.

### 2. Switch to Bootstrap (or another component framework)
- Replace Tailwind utilities with Bootstrap classes or a comparable framework that ships prebuilt CSS including dark-mode utilities.
- Pros: Bootstrap ships a ready-made bundle, so no compilation step is necessary, and its JS plugins cover some interactivity.
- Cons: Requires a wholesale rewrite of existing markup classes, diverges from the Tailwind-first conventions documented in `AGENTS.md`, and still leaves us needing to write custom CSS variables for theme switching.

### 3. Hand-roll CSS variables without a utility framework
- Strip Tailwind entirely, define our own design tokens (spacing, colors) via CSS variables, and author component styles manually.
- Pros: Zero external dependencies, total control over theming semantics.
- Cons: Significant CSS surface area to maintain, contradicts the “keep custom CSS minimal” principle, and slows future feature work that benefits from Tailwind’s utility ergonomics.

## Recommended Path Forward
1. **Adopt a compiled Tailwind build for Workbench**
   - Create `undercroft/workbench/css/tailwind.css` with the standard Tailwind directives.
   - Extend `tailwind.config.js` (or add a Workbench-specific config) with the correct content paths and `darkMode: ['class', '[data-theme="dark"]']`.
   - Add NPM scripts (e.g., `build:workbench`, `watch:workbench`) that compile to `undercroft/workbench/css/generated.css` alongside the existing Workbench stylesheet.
2. **Simplify runtime theme logic**
   - Update the theme toggler to apply a single source of truth (likely `document.documentElement.dataset.theme` plus toggling the `dark` class) so the compiled Tailwind utilities take effect without fallback CSS.
   - Remove the manual `html[data-theme="dark"]` overrides after verifying the compiled CSS renders both palettes.
3. **Document workflow updates**
   - Add instructions to `ROADMAP.md` or a dedicated `docs/development.md` on running the Tailwind build step.
   - Consider wiring the build into the Python smoke tests or a lightweight check to ensure generated CSS exists before serving.

## Future Enhancements
- Once the compiled pipeline is in place, we can explore layering design tokens (via Tailwind’s theme extension) or integrating a component library like [DaisyUI](https://daisyui.com/) if we need higher-level widgets without abandoning Tailwind.
- Evaluate extracting shared Tailwind builds if future tools under `undercroft/` need consistent styling, reducing duplication across suites.
