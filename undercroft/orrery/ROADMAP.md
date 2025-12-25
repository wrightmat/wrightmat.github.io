## Vision
Orrery is Undercroft’s system-agnostic mapping tool, designed to support maps at any scale and level of abstraction. It enables users to build maps by choosing a base map type, layering structured spatial data on top, and organizing that data into meaningful regions through grouping. Orrery focuses exclusively on spatial representation, visualization, and metadata, serving as a foundation that other Undercroft tools can reference and build upon.

The core design goal is conceptual simplicity with maximum expressive power: a small number of base map types, a small number of layer types, and a single, consistent grouping model. These primitives must be flexible enough to represent world maps, battle maps, hex crawls, point crawls, political divisions, vertical cities, and abstract diagrams without introducing system-specific rules or assumptions.

---

## Base Map Types

Each map has exactly one base map, which defines the underlying spatial surface and coordinate space.

- **Tile Base Map** (Leaflet)
  Zoomable, multi-resolution maps sourced from tiled providers (e.g. satellite, terrain, world maps). Intended for large-scale and continuous spatial representations.

- **Image Base Map**  
  A single raster image calibrated to map space. Used for battlemaps, scanned maps, and fixed-scale regional artwork.

- **Canvas Base Map**  
  A blank or lightly structured surface for abstract maps, point crawls, hand-drawn layouts, and non-geographic representations.

---

## Layer Types

Users may add any number of layers of any type. All layers support visibility toggling, positioning/scaling within the map space, and arbitrary key/value properties.

- **Vector Layer**  
  Stores drawn or ingested geometric elements (points, lines, polygons, labels). Used for borders, regions, routes, annotations, point-crawl graphs, and authored shapes. Possible to import standard GeoJSON data to being a new layer.

- **Grid Layer**  
  Square or hex grids composed of coordinate-addressed cells. Each cell can store properties and participate in grouping. Used for hex crawls, environmental maps, territory control, and encounter zones.

- **Raster Layer**  
  Positioned raster imagery rendered over the base map. Used for overlays, textures, reference imagery, and obscuration.

- **Marker Layer**  
  Interactive point elements with additional affordances such as movement and linking. Used for settlements, landmarks, characters, and other discrete map entities.

---

## Groups

Groups are a cross-cutting organizational concept used to define regions and logical collections.

- Groups are referential collections of elements and may include elements from any layer type.
- Groups do not render independently and are not layers.
- Each group has:
  - a unique identifier
  - a list of child element references
  - arbitrary user-defined properties
- Group properties override layer properties for their member elements.

Groups are used to represent concepts such as biomes, political regions, factions, districts, or multi-layer locations, while remaining visually non-intrusive.

---

## Implementation Epics

### Epic 1 — Core Map Model and Base Maps
- Define the foundational map object, including base map selection, coordinate systems, and shared behaviors such as pan and zoom.
- Implement the three base map types (Tile, Image, Canvas) as equal first-class options, ensuring a unified interaction model regardless of base.
- Establish the core data structures for layers, elements, properties, and groups so that all subsequent functionality builds on a stable and extensible map model.
- Ensure UX fidelity with existing Undercroft tools (Workbench, Press), including the three-pane interface. Left pane: Palette to define base map and add map layers; Center pane: the working map itself, which spans the entire page behind the other panes that sit on top; Right pane: properties and other definitions for selected elements.

### Epic 2 — Layer System and Editing
- Implement the full layer system, supporting unlimited layers of all four types.
- Provide creation, deletion, ordering, and visibility controls for layers, along with editing tools appropriate to each type (drawing vectors, painting grid cells, placing rasters, managing markers).
- Ensure that layers can define their own property schemas and that elements within layers can store and override properties as needed.

### Epic 3 — Grids and Groups
- Make grid lays fully interactive, allowing the user to select cell(s) and assign properties.
  - Cell-level interaction: click selection of individual cells, including multi-select
  - Cell property editing: per-cell key/value properties editable via inspector; bulk edit across selection; copy/paste properties between cells.
- Introduce groups as a first-class organizational feature. Enable users to create groups, assign and remove elements (grid cells, markers, etc) across layers, and define group-level properties.
- Support clear inspection and selection workflows, including visual highlighting of group members on the map.
- Ensure consistent property precedence rules so group-level data cleanly overrides layer-level defaults without ambiguity.

### Epic 4 — Views and Map Interaction UX
- Define tool-level views that control visibility, interaction affordances, and presentation of the map for different contexts (e.g. GM vs player). Views are not user-authored data, but curated UX states that shape how maps are experienced and interacted with. This epic focuses on making complex, layered maps usable without exposing unnecessary complexity.
- These views function on saved maps (by reference to an ID or similar) and take into account user tier. It allows the map creator to define what views are available for different user tiers.

### Epic 5 — Documentation
- Document all Orrery features, consistent with other Undercroft tools.
- Add help topics and (?) icons to appropriate locations with user-facing information. Examples include but aren't limited to sections headers in the left and right panes.

---

## Outcome
At completion, Orrery provides a complete, flexible mapping foundation for Undercroft: three base map types, four layer types, and a single grouping model capable of expressing all discussed use cases. The result is a clear, extensible map system that remains focused on spatial data while enabling future composition with other tools.
