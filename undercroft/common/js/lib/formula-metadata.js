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
};

export function listFormulaFunctionMetadata() {
  return listFormulaFunctions().map((name) => ({
    name,
    signature: FORMULA_FUNCTION_SIGNATURES[name] || `${name}(...)`,
  }));
}

export default listFormulaFunctionMetadata;
