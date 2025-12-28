# Undercroft Orrery

Undercroft Orrery is the system-agnostic mapping tool for the suite. It shares
Undercroft's three-pane shell and focuses on the foundational map model and base
map interactions.

## Current State (Epic 3)
- Unified map model with base map selection, view state, layers, groups, and
  property bags.
- Tile, Image, and Canvas base maps with consistent pan/zoom controls.
- Layer and group lists with selection and visibility tracking.
- Interactive grid layers with multi-select cell picking and per-cell properties.
- Live JSON preview of the map model for quick inspection.

## Usage
1. Open `index.html` in a browser (served relative to this folder).
2. Use the left pane to switch the base map type and adjust its settings.
3. Add layers or groups to populate the map model.
4. Inspect selection details and the JSON preview in the right pane.
5. Pan the map by dragging and zoom with the mouse wheel or view controls.

## Interface Guide
- **Layers**: Build the map by adding vector, grid, raster, or marker layers.
- **Groups**: Bundle related layers or grid cells to manage shared metadata.
- **Views**: Save visibility presets and access tiers for the map experience.
- **JSON Preview**: Inspect the current map model to validate exports.
- **Base Map**: Configure the foundational tile, image, or canvas background.
- **Selection**: Edit the active layer, group, view, or grid cells in detail.

Hover over the help icons next to section headers for quick in-app guidance.

## Map Model Overview
The Orrery map model captures the core structure used by all future epics.

- `baseMap`: Active base map configuration and per-type settings.
- `view`: Shared view state (mode, zoom, center, pan) for the map viewport.
- `layers`: Array of layer descriptors with visibility, opacity, and element
  collections (including grid cell elements with per-cell properties).
- `groups`: Cross-layer group definitions with member references and properties.
- `views`: Curated view presets that describe visible layers/groups, tier access,
  and descriptive intent for the map experience.
- `properties`: Arbitrary metadata attached to maps, layers, elements, and groups.
