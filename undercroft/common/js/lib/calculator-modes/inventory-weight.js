// Pure data-reading/math for the Dashboard Calculator's "Inventory Weight"
// mode (common/js/lib/widgets/calculator.js) — no DOM here, same split
// travel-means.js already has from calculator.js's own Travel Time mode.
//
// Character inventory/currency shapes vary completely per System (D&D 5e:
// inventory[]/currencies.{cp,sp,ep,gp,pp}; Daggerheart: inventory[] with no
// weight key at all, currency is an entirely different gold.{handfuls,...}
// shape; Blades in the Dark: neither concept exists) — every read here is
// defensive by construction and simply contributes 0 when the expected
// shape isn't there, never throwing and never inventing a number.

// Reserved-key convention, matching server/groups.py's own
// _find_system_inventory_field precedent for "where a character's inventory
// lives" (a character-record concern, unlike combatScaling/currency/levels
// which live on the SYSTEM record).
export function extractInventoryWeight(characterPayload) {
  const items = Array.isArray(characterPayload?.inventory) ? characterPayload.inventory : [];
  return items.reduce((sum, item) => {
    const weight = typeof item?.weight === "number" ? item.weight : 0;
    const quantity = typeof item?.quantity === "number" ? item.quantity : 1;
    return sum + weight * quantity;
  }, 0);
}

// Matches a character's currencies.{shortName} held-count object against the
// active System's own `currency` array field values by the same `shortName`
// both already share. `anyWeightDefined` lets the caller distinguish "this
// System's currency has no weight data at all" from "the character holds
// zero coins" — both produce a total of 0, but only the first should
// disable the "include currency weight" control.
export function extractCurrencyWeight(characterPayload, systemDefinition) {
  const fields = Array.isArray(systemDefinition?.fields) ? systemDefinition.fields : [];
  const currencyField = fields.find((entry) => entry?.type === "array" && entry.key === "currency");
  const values = Array.isArray(currencyField?.values) ? currencyField.values : [];
  const held = characterPayload?.currencies && typeof characterPayload.currencies === "object" ? characterPayload.currencies : {};
  let total = 0;
  let anyWeightDefined = false;
  values.forEach((denomination) => {
    if (typeof denomination?.weight !== "number") return;
    anyWeightDefined = true;
    const count = Number(held[denomination.shortName]) || 0;
    total += denomination.weight * count;
  });
  return { total, anyWeightDefined };
}

export function computeCharacterTotalWeight(characterPayload, systemDefinition, { includeCurrency = true } = {}) {
  const inventoryWeight = extractInventoryWeight(characterPayload);
  const currency = includeCurrency
    ? extractCurrencyWeight(characterPayload, systemDefinition)
    : { total: 0, anyWeightDefined: false };
  return {
    inventoryWeight,
    currencyWeight: currency.total,
    currencyWeightAvailable: currency.anyWeightDefined,
    total: inventoryWeight + currency.total,
  };
}

// No unit is ever hardcoded ("lb") — extracted from whatever the System's
// own inventory[].weight sub-field already calls itself (sys.dnd5e.json's
// own "Weight (lb)" label needs zero new authoring to work here), falling
// back to a generic "units" for a System with no such label to read
// (Daggerheart's inventory has no weight sub-field at all).
const UNIT_LABEL_PATTERN = /\(([^)]+)\)/;

export function resolveWeightUnitLabel(systemDefinition) {
  const fields = Array.isArray(systemDefinition?.fields) ? systemDefinition.fields : [];
  const inventoryField = fields.find((entry) => entry?.type === "array" && entry.key === "inventory");
  const children = Array.isArray(inventoryField?.item?.children) ? inventoryField.item.children : [];
  const weightChild = children.find((child) => child?.key === "inventory[].weight");
  const match = typeof weightChild?.label === "string" ? UNIT_LABEL_PATTERN.exec(weightChild.label) : null;
  return match ? match[1] : "units";
}
