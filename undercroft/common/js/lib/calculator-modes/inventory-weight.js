// Pure data-reading/math for the Dashboard Calculator's "Inventory Weight"
// mode — no DOM here, same split travel-means.js has from calculator.js's
// own Travel Time mode.
//
// Character inventory/currency shapes vary completely per System (D&D 5e:
// inventory[]/currencies.{cp,sp,...}; Daggerheart: no weight key, a
// different gold.{handfuls,...} shape; Blades in the Dark: neither
// concept exists) — every read here is defensive, contributing 0 when the
// expected shape isn't there.

// Matches server/groups.py's _find_system_inventory_field precedent —
// inventory lives on the CHARACTER record, unlike combatScaling/currency/
// levels, which live on the System.
export function extractInventoryWeight(characterPayload) {
  const items = Array.isArray(characterPayload?.inventory) ? characterPayload.inventory : [];
  return items.reduce((sum, item) => {
    const weight = typeof item?.weight === "number" ? item.weight : 0;
    const quantity = typeof item?.quantity === "number" ? item.quantity : 1;
    return sum + weight * quantity;
  }, 0);
}

// Matches currencies.{shortName} held counts against the System's own
// `currency` field values by shortName. `anyWeightDefined` distinguishes
// "no weight data at all" from "holds zero coins" — both total 0, but
// only the first should disable the "include currency weight" control.
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
// own inventory[].weight sub-field calls itself ("Weight (lb)"), falling
// back to a generic "units" when no such label exists.
const UNIT_LABEL_PATTERN = /\(([^)]+)\)/;

export function resolveWeightUnitLabel(systemDefinition) {
  const fields = Array.isArray(systemDefinition?.fields) ? systemDefinition.fields : [];
  const inventoryField = fields.find((entry) => entry?.type === "array" && entry.key === "inventory");
  const children = Array.isArray(inventoryField?.item?.children) ? inventoryField.item.children : [];
  const weightChild = children.find((child) => child?.key === "inventory[].weight");
  const match = typeof weightChild?.label === "string" ? UNIT_LABEL_PATTERN.exec(weightChild.label) : null;
  return match ? match[1] : "units";
}
