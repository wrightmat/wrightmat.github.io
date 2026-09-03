// Single source of truth for "what icon represents this component type,"
// shared across every tool. Previously Press's paletteComponents array and
// Workbench's COMPONENT_ICONS map each hardcoded values independently —
// for the two shared type names (icon, text) they'd drifted to different
// icons entirely. Union of every type registered by any tool; each tool
// imports only the keys it uses.
export const COMPONENT_ICONS = {
  // Shared between Press and Workbench.
  icon: "tabler:icons",
  image: "tabler:photo",
  text: "tabler:typography",
  repeater: "tabler:list-details",
  // Press-only.
  grid: "tabler:layout-grid",
  layer: "tabler:stack-2",
  stat: "tabler:graph",
  // Workbench-only.
  input: "tabler:forms",
  container: "tabler:layout-grid-add",
  track: "tabler:timeline",
  "select-group": "tabler:toggle-right",
  toggle: "tabler:adjustments",
};
