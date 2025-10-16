# Reboot Notes

## Lessons from the Previous Iteration
- **Server modularity is valuable.** The config-driven Python server, storage abstraction, and catalog endpoints provide a solid foundation. We will retain and lightly document these pieces rather than rewriting them.
- **Front-end scope expanded too quickly.** Attempting to deliver every editor feature at once led to complex state management and overlapping UI patterns. The reboot will layer functionality gradually, validating each step with working flows.
- **Tailwind usage needs constraints.** Mixing generated CSS with ad hoc classes created bloat. Going forward, Tailwind will load from a CDN and custom CSS will live in a single `css/styles.css` file reserved for true utility gaps.
- **Anonymous workflows are primary.** All tools must run without authentication, persisting to local storage when the server is unavailable. Server persistence and role-based features enhance—rather than gate—the experience.
- **Shared renderer is critical.** Template and character views should use the same rendering primitives so authored layouts match the runtime experience. Palette components in the editors will be thin wrappers around these primitives.

## Restart Goals
1. **Reset the front-end codebase** to a minimal app shell that demonstrates the three-pane layout, theme toggle, and placeholder panes.
2. **Define reusable utilities** (catalog fetching, status notifications, pane toggles) before rebuilding editors, ensuring consistency across tools.
3. **Plan drag-and-drop integration** with SortableJS for canvas reordering while keeping the code vanilla and testable.
4. **Document data expectations** (IDs, metadata, storage paths) so the remaining backend matches what the new UI needs.
5. **Incrementally reintroduce features**—System editor → Template editor → Character experience—verifying each with sample data before proceeding.

## Suggested Workflow
1. **Documentation Sprint**  
   - Finalise roadmap entries and confirm constraints in `AGENTS.md` (completed).  
   - Outline front-end milestones as detailed implementation tasks (wireframes, component checklists).
2. **Foundation Implementation**  
   - Build the shared app shell, theme toggle, and pane controls using Tailwind utilities.  
   - Provide placeholder content and logging to confirm layout behaviour across devices.
3. **Data & Utilities**  
   - Reintroduce the `DataManager` with catalog/list helpers tied to server endpoints and local fallbacks.  
   - Implement shared utility modules (status footer, select population, undo history container) before individual editors.
4. **Editor Rebuild Sequence**  
   - **System Editor:** focus on schema tree navigation, field inspector, and SortableJS-powered ordering.  
   - **Template Editor:** reuse renderer primitives, enable component palette drag/drop, and hook bindings to selected schema elements.  
   - **Character Sheet:** connect to templates, support live formulas, add dice roller and notes in right pane.
5. **Polish & QA**  
   - Add unit tests around data utilities and renderer functions.  
   - Document manual QA scripts for anonymous and registered workflows.  
   - Capture follow-up enhancements (admin UI, multiplayer, additional content types) without blocking the core experience.

By treating the reboot as an incremental rebuild with strong documentation and minimal dependencies, we retain the strengths of the previous iteration while avoiding the complexity that made it difficult to maintain.
