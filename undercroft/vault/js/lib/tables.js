// Data loading for Vault's reference data: the shared `feature` kind
// (retrofitted with `tags.categories`, same Library kind Crucible reads) and
// the active System's `propertyTypes` field. Mirrors Crucible's tables.js.
import { fetchKindEntriesWithIds } from "../../../common/js/lib/content-fetch.js";

export async function listFeaturesForSystem(dataManager, systemId) {
  const entries = await fetchKindEntriesWithIds(dataManager, "feature");
  return entries
    .map((entry) => ({ id: entry.id, ...entry.entity }))
    .filter((entry) => {
      const ids = Array.isArray(entry.systemIds) ? entry.systemIds : [];
      return !systemId || !ids.length || ids.includes(systemId);
    });
}

// Vault's own generated-output kind — lets the Effect picker (app.js) offer
// every previously-saved effect for the active System, the same way
// Sanctum's Location picker lists saved Locations. Mirrors Crucible's own
// listMonstersForSystem.
export async function listEffectsForSystem(dataManager, systemId) {
  const entries = await fetchKindEntriesWithIds(dataManager, "effect");
  return entries
    .map((entry) => ({ id: entry.id, ...entry.entity }))
    .filter((entry) => {
      const ids = Array.isArray(entry.systemIds) ? entry.systemIds : [];
      return !systemId || !ids.length || ids.includes(systemId);
    });
}

// Generator properties (Rarity, Activation, Item Form, ...) are just ordinary
// array-type fields on a System record's `fields` (Loom's "Properties"
// editor) — no separate "propertyTypes" concept exists anymore. A field
// counts as a generator property when at least one of its values carries a
// numeric `cost` or `targetBudget` (only those values are actually exposed
// to Vault — see hasCostShape/isGeneratorPropertyField below); this is
// translated to the legacy
// `{id, label, setsBudgetCeiling, values: [{id, label, cost, targetBudget}]}`
// shape below so the rest of Vault (app.js, generator.js) needs no changes.
//
// That shape-only detection is a real, known false-positive risk: a field
// meant for an entirely different mechanism can accidentally qualify just by
// coincidentally using the same `cost`/`targetBudget` key names. Confirmed
// case — `sys.dnd5e.json`'s `challengeRating` (Crucible's own Combat Scaling
// levels, each value's `targetBudget` feeding Crucible's encounter-difficulty
// math, nothing to do with spells/items) used to leak into Vault's own
// Identity section as a selectable property purely by accident.
//
// Fixed as an exception in Vault's own code, NOT a flag stored on the System
// record — a System's fields describe the game, not which Undercroft tool is
// allowed to read them, so that association belongs here, not in System data.
// `currency` is the same false-positive shape: every denomination carries a
// numeric `cost` (its conversion rate to copper, e.g. Platinum = 1000), which
// is enough to accidentally satisfy isGeneratorPropertyField below even
// though currency has nothing to do with spell/item budget — confirmed by a
// real report where a random "Platinum" pick silently blew a generated
// effect's budget by -1000.
const NON_VAULT_PROPERTY_FIELD_KEYS = new Set(["challengeRating", "currency"]);

function hasCostShape(value) {
  return typeof value?.cost === "number" || typeof value?.targetBudget === "number";
}

// `some`, not `every` — confirmed a real field (sys.dnd5e's "activation") is
// shared between Vault (its own 4 real, costed options: Action/Bonus Action/
// Reaction/Ritual) and the DDB character-import lookup table (4 more values
// — Seconds/Minutes/Hours/Special — carrying only `sourceId`, no `cost`,
// added purely to resolve DDB's own spell-casting-time enum). Requiring
// EVERY value to carry a cost silently disqualified the whole field the
// moment those DDB-only values were added, even though Vault's own 4
// options were untouched — Activation never appeared in Vault at all despite
// being documented starter content. toLegacyPropertyType below filters to
// just the costed values, so the DDB-only ones are simply invisible to
// Vault rather than needing a fake cost of their own.
function isGeneratorPropertyField(field) {
  if (!field || field.type !== "array") return false;
  if (NON_VAULT_PROPERTY_FIELD_KEYS.has(field.key)) return false;
  const values = Array.isArray(field.values) ? field.values : [];
  return values.some(hasCostShape);
}

function slugify(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// setsBudgetCeiling isn't System data at all — which field acts as the
// ceiling is Vault's own tool-level preference (which field Vault's
// generator should treat specially), not part of the game system's schema.
// It's supplied here by the caller (see vault/js/app.js's local
// budgetCeilingField preference, stored per System in this browser) rather
// than read off the System record.
function toLegacyPropertyType(field, budgetCeilingField) {
  return {
    id: field.key,
    label: field.label || field.key,
    setsBudgetCeiling: field.key === budgetCeilingField,
    values: (field.values || []).filter(hasCostShape).map((value) => ({
      id: slugify(value.name),
      label: value.name,
      cost: value.cost,
      targetBudget: value.targetBudget,
    })),
  };
}

// propertyTypes lives on one specific System record, not a systemId-filtered
// list of a kind's entries — fetched directly via dataManager.get, the same
// way Loom's own System editor reads a System record.
// preferLocal: false — a Loom edit to the System's fields must be visible
// immediately, not hidden behind a stale local cache. Same reasoning as
// combat-tracker.js's System reads.
//
// budgetCeilingField defaults to "rarity" — the conventionally-named field —
// exactly mirroring loadCombatScalingLevels's own default-parameter fallback
// (common/js/lib/combat-scaling.js) for the same reason: without it, a
// System the GM never opened Vault's Settings modal for has NO ceiling field
// at all, so every property type (including ones with real per-value costs,
// like Activation/Item Form) is treated as pure spend against the fixed
// DEFAULT_TARGET_BUDGET of 10 instead of Rarity ever setting a real ceiling
// — confirmed as the other half of a real reported bug (Target stuck at 10).
// The caller passes `budgetCeilingField || undefined` so an explicit stored
// preference still wins and this default only applies when truly unset.
export async function getSystemPropertyTypes(dataManager, systemId, budgetCeilingField = "rarity") {
  if (!dataManager || !systemId) return [];
  try {
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
    return fields.filter(isGeneratorPropertyField).map((field) => toLegacyPropertyType(field, budgetCeilingField));
  } catch (error) {
    return [];
  }
}

// A System's own casting classes (Wizard, Cleric, ...) — an ordinary array
// field with the conventional key "classes" (already used by DDB-import
// lookups, `common/data/system/sys.dnd5e.json`), NOT a generator-property
// field (its values carry no cost/targetBudget, so isGeneratorPropertyField
// above correctly never picks it up). A class's own `allowedFeatureTags`
// (matched against a Feature's `tags.propertyHints` by matchesClass,
// `vault/js/lib/generator.js`) lives in that value's Extra properties (JSON)
// catch-all, same as every other one-off per-value field in this suite —
// absent on most classes (a non-caster like Fighter has nothing to
// restrict) and absent entirely on any System with no "classes" field at
// all (most Systems), in which case Vault simply never shows the Casting
// Class selector.
export async function getSystemClasses(dataManager, systemId) {
  if (!dataManager || !systemId) return [];
  try {
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
    const field = fields.find((entry) => entry?.type === "array" && entry.key === "classes");
    const values = Array.isArray(field?.values) ? field.values : [];
    return values
      .filter((value) => value && typeof value.name === "string" && value.name)
      .map((value) => ({
        id: slugify(value.name),
        label: value.name,
        allowedFeatureTags: Array.isArray(value.allowedFeatureTags) ? value.allowedFeatureTags : null,
      }));
  } catch (error) {
    return [];
  }
}
