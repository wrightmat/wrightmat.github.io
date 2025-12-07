Project Undercroft: Press – Roadmap

Vision

Create Undercroft Press, a browser-based printing utility that:
- Produces perfectly aligned, double-sided printable assets (cards, sheets, booklets) that match the on-screen preview exactly.
- Uses the same three-panel, component-driven philosophy as Undercroft Workbench.
- Lets users pull content from multiple Sources (D&D Beyond, 5e API, plain JSON files, etc.) and map that content into customizable Templates and Sizes.
Press is the spiritual successor to Scriptorium, but with a more flexible, component-driven layout model and a unified Undercroft UX shell.


Guiding Principles

Print fidelity first
Printed output must match the on-screen preview exactly, including double-sided alignment. If PDF export is used, it must preserve this guarantee.

Multiple sources, one experience
Press must support multiple content Sources, including but not limited to D&D Beyond, 5e API, and plain JSON files. The user selects a Source and any necessary input (e.g., an ID or file path), and Press treats the resulting data uniformly from a layout point of view.

Template–driven layouts
Layouts are defined by Templates that determine where content appears on the page. Existing Scriptorium HTML templates should be reused where practical, but the system must be able to support new templates where needed to enable richer customization.

Component-driven editing
Press follows a component-driven model similar to Workbench: users can edit sections, and drag-and-drop components into a layout or palette. Templates are built from components (text blocks, stat blocks, icons, etc.) that can be rearranged, shown/hidden, and styled without breaking the overall layout.

User choices: Source, Template, Size, Orientation
For each print job, the user always chooses:
- Source (e.g., D&D Beyond, 5e API, JSON file, manual input)
- Template (the layout definition into which source data is slotted)
- Size (physical media type, such as playing card, notecard, full page, booklet)
- Orientation (portrait or landscape, where applicable)

Live customization
Users can interact directly with the preview to adjust content and presentation: hover or click to select a block, then change font size or similar properties on the fly in an inspector, with immediate visual feedback.

Consistency with Undercroft Workbench
Press should share the three-panel structure and general UX philosophy of Workbench: navigation and high-level settings on the left, a live central preview, and detailed editing/inspector controls on the right.

Progressive enhancement
Core printing and layout must work with local, one-off jobs without requiring login. Account-level persistence and monetization are later concerns, not part of this roadmap.


Core Concepts

Sources
A Source represents where the content comes from. Examples include D&D Beyond (via the Undercroft parser), 5e API, uploaded JSON files, or other Undercroft data. The user selects a Source and provides any necessary parameters (such as an ID or file). Press then treats the resulting content as input for Templates.

Templates
Templates define how content is arranged on a page or card. They describe what components exist (e.g., title, stat block, traits, notes) and where they are placed. Existing Scriptorium HTML templates are the starting point; new templates can be created where necessary to support component-level customization, drag-and-drop, or new Sizes.

Sizes and Orientation
Sizes represent the physical format to be printed: playing cards, tarot-sized cards, notecards, US Letter pages, A4, booklets, etc. Orientation governs portrait vs. landscape where applicable. Each Template must declare which Sizes and orientations it supports.

Components and Palettes
Templates are composed of components (e.g., text blocks, images, stat clusters, icons). Press exposes these components in a palette so users can:
- Add, remove, or rearrange components within the bounds of the Template.
- Edit component content and presentation (e.g., text, font size, visibility).
This mirrors Workbench’s component-driven, pane-based editing model.

Preview and Print Modes
The center-panel preview shows exactly what will print for the chosen Source, Template, Size, and Orientation. It supports:
- Single-sided and double-sided page previews.
- Page navigation when multiple pages are involved.
- Optional overlays (cut lines, fold lines, margins) for print planning.

Epics

Epic 1 – Print Fidelity and Layout Foundations
- Define the minimal set of page and card formats Press must support to match current Scriptorium capabilities. Establish clear assumptions about page sizes, margins, and how fronts and backs align.
- Implement the basic layout and preview flow for a small number of representative Templates (for example, a standard card grid and a full-page character sheet). Validate that what appears in the preview is what prints, including a first pass at double-sided alignment.
- Add robust support for double-sided printing for at least one card-based Template and one full-page Template. Provide a simple, predictable flow for users printing fronts and backs and turning real test prints into confirmation that alignment is correct.

Epic 2 – Sources, Templates, Sizes, Orientation
- Implement the core concept of choosing Source, Template, Size, and Orientation as the primary decision path for the user.
- Define how Press presents available Sources, including D&D Beyond, 5e API, JSON files, and any other Undercroft data sources. For each Source, implement a simple way for users to specify the necessary input (e.g., IDs, URLs, file uploads).
- Associate Templates with compatible Sizes and orientations so that when a user selects a Template, they see the valid physical formats and orientations it supports. Ensure Templates can be reused across multiple Sources where appropriate.

Epic 3 – Component-Driven Editing and Palette
- Introduce the component model within Templates. Break Templates into identifiable components (e.g., header, stat block, abilities block, notes block).
- Implement a palette and selection model:
  - Users can click or hover on components in the preview to select them.
  - The right panel shows properties of the selected component.
  - Users can reorder or toggle components where Templates allow it.
Offer simple customization controls for components, focusing first on:
  - Text edits where content is user-defined (notes, headings).
  - Visual adjustments such as font size (and possibly line spacing) that update the preview in real time and remain accurate when printed.
  - Extend the component philosophy so that, where it makes sense, users can drag-and-drop components from a palette into available regions in the Template, within constraints that preserve overall layout integrity.

Epic 4 – Scriptorium Feature Parity Under the Undercroft Shell
- Create an inventory of the existing Scriptorium utility’s capabilities: supported formats (card types, booklets, sheets), typical use cases, and any special layouts or workflows.
- Translate the highest-value Scriptorium layouts into Press Templates. Where possible, reuse the existing HTML template structure; where that structure conflicts with the component-driven goals, introduce new Template definitions that capture the same visual result with better customization support.
- Rebuild the core Scriptorium workflows in the Undercroft three-panel UI: selecting content, choosing a Template/Size/Orientation, reviewing the preview, customizing components, and printing.

Epic 5 – UX Refinement, Validation, and Documentation
- Refine the three-panel UI so Press feels consistent with Workbench in terms of layout, terminology, and basic interactions. Focus on a smooth flow for the central tasks: selecting Source, picking Template/Size/Orientation, adjusting components, and printing.
- Conduct real-world print validation across a limited set of common printers and browsers to confirm that the preview–print match holds under normal conditions. Adjust templates or guidelines as needed based on these tests.
- Document at a product level how Press is intended to be used:
  - How users choose Sources and Templates.
  - How Sizes and Orientation affect output.
  - How to adjust components and styling.
  - How to achieve reliable double-sided printing.
