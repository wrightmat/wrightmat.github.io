**Codex: TTRPG Utility Suite**

**Scriptorium** (S): Prints formatted cards, booklets, and other resources (including from the other generators below).

**Reliquiarium** (R): Builds magical or mundane items.

**Vestiarium** (V): Generates and edits NPCs.

**Bestiarium** (B): Builds and saves monsters.

**Tabularium** (T): Designs or generates maps.

**Cryptarium** (C): Procedural dungeon generator.

**Grimorium** (G): Creates and manages spells.


**TO DO**:


**IDEAS**:
 - Location Builder:
  - Use the 5e API to pull in SRD equipment items. Custom JSON file, in same format as API output, for Eberron content. Separate JSON for services/food/misc offered by the Dragonmarked houses.
  - Ability to group items and services into location types. For example, House Gallandra inn with food and potions, or a shop with alchemy items. This can be in the form of categories of equipment items or individual things.
  - One button to generate a unique location, with randomly rolled items, for any location type.
  - Future state: add things like descriptions and NPCs. Need to find a good source - possibly something like Eirengrau?
  - Future state: add other item types (e.g. books to create a library).

**Server integration**

- When running behind the unified server, Codex templates are exposed via the `/list/codex-templates` endpoint. The response contains a `files` array with metadata parsed from the first lines of each template. Update any legacy `fetch('/templates/list')` calls to use `fetch('/list/codex-templates')` and read from `response.files`.
