// Single source of truth for "what icon represents this component type,"
// shared across every tool. Previously Press's own paletteComponents array
// and Workbench's own COMPONENT_ICONS map each hardcoded icon values
// independently — for the two type names both tools register (icon, text),
// they'd drifted to different icons entirely (Press: tabler:star for Icon,
// tabler:align-left for Text; Workbench: tabler:icons, tabler:typography).
// Union of every type registered by any tool; each tool imports only the
// keys it actually uses.
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
