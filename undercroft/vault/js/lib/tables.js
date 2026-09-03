// Data loading for Vault's reference data: the shared `feature` kind and the
// active System's `propertyTypes` field. Mirrors Crucible's tables.js.
// fetchKindEntriesForSystem filters by systemId server-side before reading any
// file (server/storage.py); the `.filter()` below stays as the correctness
// guarantee for when it falls back to an unfiltered fetch.
import { fetchKindEntriesForSystem } from "../../../common/js/lib/content-fetch.js";

export async function listFeaturesForSystem(dataManager, systemId) {
  const entries = await fetchKindEntriesForSystem(dataManager, "feature", systemId);
  return entries
    .map((entry) => ({ id: entry.id, ...entry.entity }))
    .filter((entry) => {
      const ids = Array.isArray(entry.systemIds) ? entry.systemIds : [];
      return !systemId || !ids.length || ids.includes(systemId);
    });
}

// Vault's own generated-output kind — lets the Wonder picker (app.js) offer
// every saved wonder for the active System. Mirrors listMonstersForSystem.
export async function listWondersForSystem(dataManager, systemId) {
  const entries = await fetchKindEntriesForSystem(dataManager, "wonder", systemId);
  return entries
    .map((entry) => ({ id: entry.id, ...entry.entity }))
    .filter((entry) => {
      const ids = Array.isArray(entry.systemIds) ? entry.systemIds : [];
      return !systemId || !ids.length || ids.includes(systemId);
    });
}

// Generator properties (Rarity, Activation, Item Form, ...) are just ordinary
// array-type fields on a System record — a field qualifies when at least one
// value carries a numeric `cost` or `targetBudget` (see hasCostShape/
// isGeneratorPropertyField below), translated to the legacy
// `{id, label, setsBudgetCeiling, values: [{id, label, cost, targetBudget}]}`
// shape so the rest of Vault needs no changes.
//
// Shape-only detection risks false positives: a field can accidentally
// qualify just by using the same key names for an unrelated purpose.
// `challengeRating` (Crucible's Combat Scaling) and `currency` (each
// denomination's conversion-rate `cost`) both did — excluded here as a
// Vault-local exception, not a flag on the System record, since a System's
// fields describe the game, not which tool may read them.
const NON_VAULT_PROPERTY_FIELD_KEYS = new Set(["challengeRating", "currency"]);

function hasCostShape(value) {
  return typeof value?.cost === "number" || typeof value?.targetBudget === "number";
}

// `some`, not `every` — a field can mix costed values (Vault's own) with
// uncosted ones added for an unrelated lookup (e.g. a DDB-import enum);
// requiring every value to carry a cost would disqualify the whole field.
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

// Best-effort guess for which eligible field should set the budget ceiling —
// pre-fills the budgetCeilingField settings preference when a GM hasn't
// chosen one, never the sole source of truth. Name-preference only, since
// isGeneratorPropertyField already narrowed to real candidates. "rarity" is
// the majority case (the hardcoded fallback); "restriction" (d20 Modern) and
// "tier" (Daggerheart) are the confirmed alternates. Takes candidate KEYS
// directly so both getSystemPropertyTypes below and Vault's Settings modal
// can call it with zero extra round trips.
const BUDGET_CEILING_FIELD_NAME_PREFERENCE = ["rarity", "restriction", "tier"];

export function guessBudgetCeilingFieldKey(candidateKeys) {
  const keys = new Set(Array.isArray(candidateKeys) ? candidateKeys : []);
  return BUDGET_CEILING_FIELD_NAME_PREFERENCE.find((name) => keys.has(name)) || "";
}

// setsBudgetCeiling isn't System data — which field acts as the ceiling is
// Vault's own tool-level preference (app.js's local budgetCeilingField,
// stored per System), supplied by the caller, not read off the System record.
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

// propertyTypes lives on one System record — fetched via dataManager.get,
// same as Loom's own System editor. preferLocal: false so a Loom edit to
// the System's fields is visible immediately, not hidden behind a stale cache.
//
// `budgetCeilingField` is the GM's explicit preference if stored; empty
// falls through to guessBudgetCeilingFieldKey, then "rarity" as last resort.
// Without SOME ceiling resolving, every property type is treated as spend
// against the fixed DEFAULT_TARGET_BUDGET of 10 with nothing ever setting a
// real ceiling (confirmed cause of a "Target stuck at 10" bug).
export async function getSystemPropertyTypes(dataManager, systemId, budgetCeilingField = "") {
  if (!dataManager || !systemId) return [];
  try {
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
    const eligibleFields = fields.filter(isGeneratorPropertyField);
    const key = budgetCeilingField || guessBudgetCeilingFieldKey(eligibleFields.map((field) => field.key)) || "rarity";
    return eligibleFields.map((field) => toLegacyPropertyType(field, key));
  } catch (error) {
    return [];
  }
}

// A System's own casting classes — an ordinary array field keyed "classes"
// (also used by DDB-import lookups), NOT a generator-property field (no
// cost/targetBudget). A class's own `allowedFeatureTags` (matched against a
// Feature's `tags.propertyHints` by matchesClass, generator.js) lives in its
// Extra-properties JSON catch-all; absent on most classes and on any System
// with no "classes" field, in which case the Casting Class selector never shows.
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
