import { listFormulaFunctions } from "./formula-engine.js";

const FORMULA_FUNCTION_SIGNATURES = {
  abs: "abs(value)",
  avg: "avg(...values)",
  ceil: "ceil(value)",
  clamp: "clamp(value, min, max)",
  floor: "floor(value)",
  if: "if(condition, whenTrue, whenFalse)",
  max: "max(...values)",
  min: "min(...values)",
  mod: "mod(dividend, divisor)",
  not: "not(value)",
  or: "or(...values)",
  and: "and(...values)",
  pow: "pow(base, exponent)",
  round: "round(value)",
  sqrt: "sqrt(value)",
  sum: "sum(...values)",
  roller: "roller(notation, fallback)",
  lookup: "lookup(table, key)",
  lookupField: "lookupField(table, matchField, matchValue, targetField)",
  signed: "signed(value)",
  len: "len(value)",
  upper: "upper(value)",
  lower: "lower(value)",
  split: "split(value, separator)",
  replace: "replace(value, search, replacement)",
  libraryEntries: "libraryEntries(kind, path, value)",
  restrictByCharacterKind: "restrictByCharacterKind(entries, kind)",
};

// `extraNames` — names of any additional formula functions the CALLER's own
// registry actually provides beyond formula-engine.js's base set (e.g.
// "libraryEntries" wherever a dataManager is available; "restrictByCharacterKind"
// only in Workbench's own Character view) — so autocomplete only ever
// suggests what's really callable in that context, not one global list
// that's either missing real functions (as this was, for years, for
// libraryEntries) or advertises ones that don't exist there.
export function listFormulaFunctionMetadata(extraNames = []) {
  const names = [...listFormulaFunctions(), ...extraNames];
  return [...new Set(names)].map((name) => ({
    name,
    signature: FORMULA_FUNCTION_SIGNATURES[name] || `${name}(...)`,
  }));
}

export default listFormulaFunctionMetadata;
