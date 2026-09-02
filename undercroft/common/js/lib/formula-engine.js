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
  // String helpers — deliberately plain, no regex (a regex literal isn't
  // expressible through SAFE_PATTERN/the @-substitution step anyway, and
  // a template author shouldn't need to know regex to substitute text).
  // `value` first on all of these, same subject-first argument order as
  // clamp/mod/pow above, not JS's own String.prototype order.
  len: (value) => {
    if (Array.isArray(value)) return value.length;
    if (value === undefined || value === null) return 0;
    return String(value).length;
  },
  upper: (value) => String(value ?? "").toUpperCase(),
  lower: (value) => String(value ?? "").toLowerCase(),
  split: (value, separator) => String(value ?? "").split(separator ?? ""),
  // Whole-string substitution (every occurrence), not just the first —
  // split/join instead of String.prototype.replace so a literal search
  // string never gets misread as regex syntax.
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

  // coerceValue turns a missing path into 0 — correct here since a formula
  // is always a math context, but bindings.js deliberately does NOT do this
  // (see its own comment) since a resolved binding can be a string/array/
  // boolean where coercing to 0 would be wrong.
  const getter = (path) => coerceValue(resolveDottedPath(context, path));
  return evaluator(getter, runtimeFunctions);
}

// "roller", "lookup" and "lookupField" aren't in BASE_FUNCTIONS itself —
// all three are injected per-caller via options.functions instead (see
// roller's own inline definition above and bindings.js's createLookupFn/
// createLookupFieldFn). Every real caller provides all three in practice
// though, so they belong in the advertised function list too — otherwise
// the inspector's own autocomplete (formula-metadata.js) would never
// suggest any of them.
export function listFormulaFunctions() {
  return [...new Set([...Object.keys(BASE_FUNCTIONS), "roller", "lookup", "lookupField"])];
}
