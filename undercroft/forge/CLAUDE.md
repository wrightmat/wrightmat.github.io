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
- **Name** — generated via a 4-column d20 Markov syllable chain; GM rolls 2–4 columns and may reorder freely
- **Race** — d20, weighted by realistic population distribution for the selected location
- **Archetype** — 2d12 (range 2–24), using D&D 5e Monster Manual NPC stat blocks, weighted toward common NPCs via bell curve distribution; rolls 22–23 are location-specific entries, roll 24 is Wildcard
- **Alignment** — d10 (9 alignments + Unaligned), equal weighting
- **Gender** — d8 (Male ×3, Female ×3, Androgynous ×1, Non-Binary ×1)
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

### Name Table (d20 × 4 columns)

| d20 | Col 1 | Col 2 | Col 3 | Col 4 |
|-----|-------|-------|-------|-------|
| 1 | Al | an | dra | ck |
| 2 | Bel | en | fen | is |
| 3 | Cor | in | gar | on |
| 4 | Dal | or | har | us |
| 5 | El | ar | ith | an |
| 6 | Far | eth | ker | en |
| 7 | Gar | iel | lan | oth |
| 8 | Hal | im | mar | ra |
| 9 | Ir | on | nar | el |
| 10 | Jas | ath | ren | in |
| 11 | Kel | wyn | sar | ax |
| 12 | Lor | ess | tar | ia |
| 13 | Mor | ith | val | or |
| 14 | Nar | och | wen | us |
| 15 | Or | ane | xar | yn |
| 16 | Pel | era | zan | ael |
| 17 | Ran | ost | ber | ish |
| 18 | Sal | uin | dor | om |
| 19 | Tor | avar | mir | eth |
| 20 | Wyn | elen | ris | ash |

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

## Location System

The GM selects a location before generating. Location configuration drives:
- Race table weights (population distribution appropriate to that location)
- Archetype table setting-specific entries (rolls 22–23)
- Any other Identity configuration relevant to that setting

The 4D tables are never location-dependent.

### Location Builder
Forge includes a front-end UI for building and editing locations. The location builder allows the GM to:
- Name the location and associate it with a game system and setting
- Configure race weights across 20 faces, including an "Other" catchall
- Define the two setting-specific archetype entries (rolls 22–23)
- Save the location as a lightweight JSON file for ingestion by Forge

Locations are stored as standalone JSON and loaded by the tool at runtime. This keeps location data portable and easy to share or modify outside the tool.

Forge should ship with at least two pre-built locations: Sword Coast (Forgotten Realms, default) and Sharn (Eberron, as the primary real-world example).

---

## LLM Synthesis (Optional)

Generating a character note via LLM is entirely optional. The GM may generate and save an NPC with no LLM involvement whatsoever — all rolled values stand on their own as the character record.

When the GM opts in, all rolled Identity values (excluding Name) and all 4D values are sent to the Claude API (Haiku model) via a dedicated endpoint added to the existing server script. The returned character note must conform exactly to this format:

`Name (Alignment Gender Race Archetype). [2–3 sentences weaving Description, Demeanor, Drive, and Direction into a vivid but concise character note.]`

The system prompt must enforce this format strictly and return no additional commentary.

---

## Saved Characters

Generated NPCs can be saved within Forge as character records. A saved character stores all rolled values, the optional character note if generated, and the location it was generated for. Saved characters can be retrieved, edited, and exported as JSON for use in Press or other Undercroft tools.

User account integration exists in the core Undercroft application and can be wired into Forge at any point to scope saved characters to individual users.

---

## Press Template

Forge should produce a companion Press template defining the layout for a location-configured NPC reference sheet. The template describes a two-sided letter-size landscape document:

**Side 1 — Identity:** Race and Archetype tables across the top (larger, as these have more entries), Alignment, Gender, and Attitude tables in a row below, and the Name table spanning the full width at the bottom. All Identity tables reflect the specific location configuration — race weights and setting-specific archetypes are embedded in the template data.

**Side 2 — 4D:** All four d20 tables (Description, Demeanor, Drive, Direction) side by side in a single row across the full width. These are always identical regardless of location.

The Press template is a JSON structure that Press can ingest, populate with table data, and render for printing.