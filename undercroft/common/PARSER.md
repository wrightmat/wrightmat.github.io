Implement a redesigned D&D Beyond character parser for Undercroft using a simple, single-file, rules-based architecture.

The parser converts raw DDB character JSON into an internal Undercroft character JSON. All transformation logic is driven by a central rules table rather than a monolithic function. The rules table serves as the high-level map of how DDB fields become Undercroft fields and must remain easy to read and modify.

The parser must live entirely in one file. No multi-file decomposition.

Create a rules table where each entry represents one output section of the final character JSON. Each entry defines:
1) the name of the output section,
2) the DDB JSON fields required to produce that section,
3) the single handler function responsible for generating that section’s output.

Handlers receive three inputs: a context object containing only the DDB JSON fields listed in the rule’s “from” array, the full raw DDB JSON object, and an options object. All logic for that section must remain inside its handler. Handlers may use shared constants or helper utilities when genuinely necessary, but avoid unnecessary function fragmentation. Maintain the KISS principle by keeping logic consolidated and easy to read.

Implement a minimal core engine function that:
1) iterates over the rules table,
2) builds the context object for each rule from the raw DDB JSON,
3) calls the associated handler with the context, the full raw JSON, and the options object,
4) writes the handler’s output into the final character JSON under the rule’s section name.

The core engine contains no special-case logic for any section. Its sole responsibility is dispatching rules and assembling the result.

All sections of the final character JSON must be produced through rules; do not append or modify output outside the rules table. Adding a new output section should require only adding an entry to the rules table and writing a corresponding handler.

The parser must allow evolution of the internal Undercroft character schema without major refactors. Updating a section’s structure or behavior should require modifying only that section’s handler and, if needed, adjusting the rule’s list of DDB fields. Edge cases and new DDB behaviors should be handled by updating or adding rules rather than modifying the core engine.

Handlers must degrade gracefully when fields in the DDB JSON are missing or incomplete. Defaults and reasonable fallbacks are expected. Only invalid or unusable input should produce hard failures.

Accept an options object and pass it through to all handlers. Options may be used for future behavior adjustments but do not require complex override systems at this stage.

The final outcome of this architecture is a simple, declarative mapping system where the rules table describes the flow of data, the core engine executes it, and each handler cleanly defines how a single part of the DDB JSON becomes a single part of the Undercroft character JSON.
