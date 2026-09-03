import { resolveDottedPath } from "./dotted-path.js";

const SAFE_PATTERN = /^[0-9+\-*/().,@\s<>=!?&|%:'"_\[\]A-Za-z]+$/;

const BASE_FUNCTIONS = {
  abs: Math.abs,
  ceil: Math.ceil,
  clamp(value, min, max) {
    const v = Number(value);
    return Math.min(Math.max(v, Number(min)), Number(max));
  },
  floor: Math.floor,
  max: (...values) => Math.max(...values.map(Number)),
  min: (...values) => Math.min(...values.map(Number)),
  round: Math.round,
  sum: (...values) => values.reduce((total, current) => total + Number(current || 0), 0),
  avg: (...values) => {
    if (!values.length) {
      return 0;
    }
    const total = values.reduce((acc, current) => acc + Number(current || 0), 0);
    return total / values.length;
  },
  mod: (dividend, divisor) => Number(dividend) % Number(divisor),
  pow: (base, exponent) => Math.pow(Number(base), Number(exponent)),
  sqrt: (value) => Math.sqrt(Number(value)),
  if(condition, whenTrue, whenFalse) {
    return condition ? whenTrue : whenFalse;
  },
  and: (...values) => values.every(Boolean),
  or: (...values) => values.some(Boolean),
  not: (value) => !value,
  // String helpers — deliberately plain, no regex (SAFE_PATTERN can't
  // express a regex literal, and a template author shouldn't need to know
  // regex). `value` is always the first arg, unlike String.prototype's order.
  len: (value) => {
    if (Array.isArray(value)) return value.length;
    if (value === undefined || value === null) return 0;
    return String(value).length;
  },
  upper: (value) => String(value ?? "").toUpperCase(),
  lower: (value) => String(value ?? "").toLowerCase(),
  split: (value, separator) => String(value ?? "").split(separator ?? ""),
  // split/join (not String.prototype.replace) for whole-string, all-
  // occurrence substitution with no regex reinterpretation of the search term.
  replace: (value, search, replacement) => {
    const str = String(value ?? "");
    const searchStr = String(search ?? "");
    if (!searchStr) return str;
    return str.split(searchStr).join(String(replacement ?? ""));
  },
};

function coerceValue(value) {
  if (value === undefined || value === null) {
    return 0;
  }
  if (typeof value === "number") {
    return value;
  }
  if (!Number.isNaN(Number(value))) {
    return Number(value);
  }
  return value;
}

export function evaluateFormula(formula, context = {}, options = {}) {
  if (typeof formula !== "string" || !formula.trim()) {
    return null;
  }
  const trimmed = formula.trim();
  if (!SAFE_PATTERN.test(trimmed)) {
    throw new Error("Formula contains unsupported characters");
  }
  const sanitized = trimmed.startsWith("=") ? trimmed.slice(1).trim() : trimmed;
  const expression = sanitized.replace(/@([A-Za-z0-9_.]+)/g, (_, path) => {
    return `__get("${path}")`;
  });
  const normalizedExpression = expression.replace(/\bif\s*\(/gi, "__fn.if(");

  const { functions = {}, onRoll, rollContext, random, rollDice } =
    typeof options === "object" && options !== null ? options : {};
  const runtimeFunctions = { ...BASE_FUNCTIONS, ...functions };
  runtimeFunctions.roller = (notation, fallback = 0) => {
    if (typeof notation !== "string") {
      return fallback ?? 0;
    }
    const trimmedNotation = notation.trim();
    if (!trimmedNotation) {
      return fallback ?? 0;
    }
    if (typeof onRoll === "function") {
      onRoll(trimmedNotation);
    }
    if (typeof rollDice !== "function") {
      return fallback ?? 0;
    }
    try {
      const roll = rollDice(trimmedNotation, {
        context: rollContext !== undefined ? rollContext : context,
        random,
      });
      return Number.isFinite(roll?.total) ? roll.total : fallback ?? 0;
    } catch (error) {
      console.warn("Formula roller(): unable to evaluate dice expression", error);
      return fallback ?? 0;
    }
  };

  const functionNames = Object.keys(runtimeFunctions).filter((name) => name !== "if");
  const evaluator = new Function(
    "__get",
    "__fn",
    `const { ${functionNames.join(", ")} } = __fn; return (${normalizedExpression});`
  );

  // Missing path coerces to 0 here since a formula is always a math context;
  // bindings.js deliberately does NOT do this (see its own comment).
  const getter = (path) => coerceValue(resolveDottedPath(context, path));
  return evaluator(getter, runtimeFunctions);
}

// roller/lookup/lookupField are injected per-caller via options.functions
// (see roller above, bindings.js's createLookupFn/createLookupFieldFn) rather
// than living in BASE_FUNCTIONS, but every real caller provides all three —
// listed here anyway so formula-metadata.js's autocomplete suggests them.
export function listFormulaFunctions() {
  return [...new Set([...Object.keys(BASE_FUNCTIONS), "roller", "lookup", "lookupField"])];
}
