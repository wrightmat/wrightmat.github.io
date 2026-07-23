# CLAUDE.md — Undercroft Forge

## Project Overview

Undercroft Forge is the NPC generation module of the Undercroft suite. Its sole responsibility is generating NPC data — either for live on-screen use during a session, or as structured JSON to be passed to Undercroft Press for prep and printing. Forge does not handle printing or templating directly.

The tool allows a GM to configure a location, roll or generate NPCs for that location, optionally enrich them with an LLM-synthesized character note, save characters, and export structured JSON.

---

## Undercroft Suite Context

Forge is one module within a broader Undercroft suite. Relevant integration points:

- **Undercroft Press** — a separate tool that ingests structured JSON from Forge, embeds it into print templates, and produces printable output. Forge's JSON schema must be designed with Press compatibility in mind.
- **Undercroft (core)** — user accounts and permissions already exist in the core application. Forge should wire into this existing auth system when permissions are needed. This is not in scope for initial development but the architecture must not preclude it.
- **API server** — Forge's LLM functionality requires an additional Claude API endpoint added to the existing server script.

---

## Conceptual Architecture

NPC generation is split into two layers that must remain cleanly separated:

### Identity Layer (system and setting specific)
Categorical attributes that orient who the NPC is in the world. These tables are location-configured and vary by game system and setting. The GM selects a location before generating, and Forge loads the appropriate Identity configuration for that location.

Identity attributes:
- **Name** — generated per-species via exemplar interpolation, not a discrete roll table: each Species Name Profile defines a pool of canonical example names, and a character-level Markov model built from that pool produces novel names that phonemically resemble it without repeating an exact entry. See "Name Generation" below for the full model, including cross-species cultural mixing.
- **Species** — weighted by realistic population distribution for the selected location (a genuine weighted-random draw, not a uniform die — see "Location System")
- **Archetype** — 2d12 (range 2–24), using D&D 5e Monster Manual NPC stat blocks, weighted toward common NPCs via bell curve distribution; rolls 22–23 are location-specific entries, roll 24 is Wildcard
- **Alignment** — d10 (9 alignments + Unaligned), equal weighting
- **Gender** — d8 (Male ×3, Female ×3, Androgynous ×1, Non-Binary ×1)
- **Age** — d5, evenly weighted life-stage groupings (Young Adult, Adult, Middle Aged, Older Adult, Elderly) rather than a specific number
- **Relationship** — two independent rolls combined into one field: d8 relationship status (Single, Dating, Engaged, Married, Separated, Divorced, Widowed, It's Complicated) and d6 sexual orientation (Heterosexual, Homosexual, Bisexual, Asexual, Pansexual, Questioning)
- **Attitude toward PCs** — d6, numeric scale Hostile (1) to Helpful (6); relevant for social encounters

### 4D Layer (system agnostic)
Four d20 tables that define personality and situation. These never change regardless of location or system. Each uses single-word descriptors designed to stack — multiple rolls on the same table produce additive, non-contradictory results that create interesting character tension. These are improv prompts, not prescriptions.

- **Description** — physical quality or impression
- **Demeanor** — current emotional register
- **Drive** — internal motivation
- **Direction** — current situational circumstance

---

## Table Data

### 4D Tables (d20 each)

**Description:** Wiry, Heavyset, Frail, Compact, Looming, Scarred, Tattooed, Weathered, Ashen, Stylish, Disheveled, Adorned, Striking, Forgettable, Soft, Maimed, Imposing, Graceful, Rough-hewn, Immaculate

**Demeanor:** Guarded, Warm, Jovial, Melancholy, Nervous, Confident, Suspicious, Distracted, Intense, Aloof, Eager, Weary, Bitter, Serene, Erratic, Calculating, Gregarious, Haunted, Lazy, Detached

**Drive:** Survival, Wealth, Power, Revenge, Love, Duty, Faith, Knowledge, Recognition, Redemption, Protection, Freedom, Belonging, Ambition, Pleasure, Justice, Grief, Fear, Curiosity, Legacy

**Direction:** Hunted, Searching, Hiding, Grieving, Indebted, Sworn, Exiled, Deceiving, Protecting, Pursuing, Recovering, Betrayed, Recruited, Blackmailed, Ascending, Falling, Escaping, Waiting, Lost, Chosen

### D&D 5e Archetype Table (2d12)

| Roll | Archetype | Roll | Archetype |
|------|-----------|------|-----------|
| 2 | Archmage | 13 | Commoner |
| 3 | Cult Fanatic | 14 | Guard |
| 4 | Berserker | 15 | Bandit |
| 5 | Gladiator | 16 | Acolyte |
| 6 | Tribal Warrior | 17 | Thug |
| 7 | Druid | 18 | Scout |
| 8 | Knight | 19 | Cultist |
| 9 | Veteran | 20 | Mage |
| 10 | Spy | 21 | Bandit Captain |
| 11 | Priest | 22 | Setting Specific |
| 12 | Noble | 23 | Setting Specific |
| — | — | 24 | Wildcard |

---

## Name Generation

Names are generated per species using exemplar interpolation, not a discrete roll table.

### Species Name Profiles
Each species defines a Species Name Profile: a first-name exemplar pool, whether last names exist and what form they take (family, clan, patronymic — or none), a last-name exemplar pool if applicable, and a **name mode**. Profiles are reusable across every Location, managed independently of any one location, and sourced from published sourcebooks or GM-defined lists.

Name mode is a per-species toggle between two entirely different generation mechanics:

- **Blended** (default) — for species whose names are an invented phonetic language (Elf, Dwarf, Tiefling, most humanoid species). Generation builds a character-level Markov model from the pool and walks it to produce names that phonemically resemble the pool without ever repeating an exact entry. This relies on the pool sharing real sub-word phonetic structure (endings, syllable clusters) for the recombination to sound plausible.
- **Synonyms** — for species whose names are recognizable whole words in a shared thematic register rather than an invented language (Changeling's Ashen/Doubt/Mirage, Warforged's Rivet/Piston/Bastion, Shifter's Wren/Briar/Talon). Statistically recombining letters across words like that produces garbage, since there's no shared phonetic pattern to learn — Synonyms mode instead treats the pool as a curated, closed vocabulary and draws a name from it directly, unmodified. The "generation" here is in curating a wide pool, not in mutating it.

### Cultural Mixing
Each Location defines a single mixing coefficient (0 = isolated, 1 = fully cosmopolitan) that drives every axis of name blending simultaneously:

- **Whether a name blends at all** — at 0, never; the likelihood rises with the coefficient.
- **Blending partner selection** — at low coefficient, blending (when it happens) favors the location's most prevalent species; at high coefficient, the partner is drawn weighted-randomly from the full location species pool.
- **Blending mode** — at low coefficient, mixing is surface-level: affix borrowing, where one species contributes the whole name and the other contributes a short prefix or suffix. At high coefficient, mixing is structural: a seam where one portion of the name comes from one species' pool and the remainder from the other's. Intermediate coefficients blend probabilistically between both modes.
- **Last names** — for species with last names, the structural seam falls naturally between first and last name, each drawn from a different species' pool. For first-name-only species, the same structural blending invents a synthetic mid-name seam instead.

One coefficient. Multiple axes. Depth of mixing reflects depth of cultural integration.

Synonyms-mode species are the one exception to all of the above: they never blend, in either direction. A curated whole word can't be sensibly grafted onto (or grafted with) a phonetic fragment or another whole word, so a Synonyms-mode species is always excluded both as a blend primary and as a candidate blend partner, regardless of the location's mixing coefficient.

---

## Location System

The GM selects a location before generating. Location configuration drives:
- Species table weights (population distribution appropriate to that location)
- The mixing coefficient (see "Name Generation" above)
- Archetype table setting-specific entries (rolls 22–23)
- Any other Identity configuration relevant to that setting

The 4D tables are never location-dependent.

### Location Builder
Forge includes a front-end UI for building and editing locations. The location builder allows the GM to:
- Name the location and associate it with a game system and setting
- Configure species weights by selecting from saved Species Name Profiles (managed separately, reusable across locations) and assigning each a relative weight, including an "Other" catchall
- Set the mixing coefficient (see "Name Generation")
- Define the two setting-specific archetype entries (rolls 22–23)
- Save the location as a lightweight JSON file for ingestion by Forge

Locations are stored as standalone JSON and loaded by the tool at runtime. This keeps location data portable and easy to share or modify outside the tool.

Forge should ship with at least two pre-built locations: Sword Coast (Forgotten Realms, default, culturally insular — a low mixing coefficient) and Sharn (Eberron, the primary cosmopolitan example — a high mixing coefficient).

---

## LLM Synthesis (Optional)

Generating a character note via LLM is entirely optional. The GM may generate and save an NPC with no LLM involvement whatsoever — all rolled values stand on their own as the character record.

When the GM opts in, all rolled Identity values (excluding Name) and all 4D values are sent to the Claude API (Haiku model) via a dedicated endpoint added to the existing server script. The returned character note must conform exactly to this format:

`Name (Alignment Gender Species Archetype). [2–3 sentences weaving Description, Demeanor, Drive, and Direction into a vivid but concise character note.]`

The system prompt must enforce this format strictly and return no additional commentary.

---

## Saved Characters

Generated NPCs can be saved within Forge as character records. A saved character stores all rolled values, the optional character note if generated, and the location it was generated for. Saved characters can be retrieved, edited, and exported as JSON for use in Press or other Undercroft tools.

Saved NPCs are written to the shared Library (`undercroft/common/data/npc/`, via the "npc" Library kind), not a Forge-only directory — this is what actually makes them reachable from Press or any other tool, not just Forge itself. Locations moved the same way: they're now the shared "location" Library kind (`undercroft/common/data/location/`), managed from Loom's Places panel, not a Forge-only directory.

User account integration exists in the core Undercroft application and can be wired into Forge at any point to scope saved characters to individual users.

---

## Press Template

Forge should produce a companion Press template defining the layout for a location-configured NPC reference sheet. The template describes a two-sided letter-size landscape document:

**Side 1 — Identity:** Species and Archetype tables across the top (larger, as these have more entries), Alignment, Gender, and Attitude tables in a row below, and the Name table spanning the full width at the bottom. Species and Archetype reflect the specific location configuration, embedded directly in the template data. The Name table has no fixed content to embed (there's no discrete table backing it anymore) — it's still a genuine d20 roll table, but its 20 rows are names freshly produced by the exemplar-interpolation engine (drawing from this location's own species population and mixing coefficient) at export time, so re-exporting the same location produces a different, equally legitimate table.

**Side 2 — 4D:** All four d20 tables (Description, Demeanor, Drive, Direction) side by side in a single row across the full width. These are always identical regardless of location.

The Press template is a JSON structure that Press can ingest, populate with table data, and render for printing.