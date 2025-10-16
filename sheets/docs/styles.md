# Styling Notes

The UI now relies on the Tailwind CDN for utility classes and a lightweight `styles.css` file for shared tokens.

## Assets

- `https://cdn.tailwindcss.com/3.4.5` – loaded directly in each entry point with `darkMode: 'class'` so the theme toggle can switch without a build step.
- `sheets/css/styles.css` – human-authored design tokens for stacks, toolbars, form controls, and dark-mode overrides shared across the editors and runtime.

## Component Mapping

| Area | Approach |
|------|----------|
| Layout shell | Constructed in `AppShell.js` with Tailwind utilities for spacing and background plus minimal CSS grid helpers in `styles.css`. |
| Buttons | `createButton` applies the `.btn` token, with light/dark variants handled in `styles.css`. |
| Forms & lists | Inputs, inspector groups, tree rows, and repeaters share the design tokens defined in `styles.css`, keeping markup simple while remaining Tailwind-compatible. |
| Status footer | Built dynamically in `AppShell` with Tailwind utility classes for color and backdrop blur. |

## Guidelines

- Prefer Tailwind utility classes for one-off layout or spacing tweaks; extend `styles.css` only when a pattern is reused across tools.
- When adding new shared components, document the class tokens here so other editors can reuse them without duplicating CSS.
