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
};

function resolvePath(context, path) {
  return path.split(".").reduce((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) {
      return acc[key];
    }
    return undefined;
  }, context);
}

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

  const functionNames = Object.keys(runtimeFunctions);
  const evaluator = new Function(
    "__get",
    "__fn",
    `const { ${functionNames.join(", ")} } = __fn; return (${expression});`
  );

  const getter = (path) => coerceValue(resolvePath(context, path));
  return evaluator(getter, runtimeFunctions);
}

export function extractDependencies(formula) {
  if (typeof formula !== "string") {
    return [];
  }
  const sanitized = formula.trim().startsWith("=") ? formula.trim().slice(1) : formula;
  const matches = sanitized.match(/@([A-Za-z0-9_.]+)/g) || [];
  return Array.from(new Set(matches.map((token) => token.slice(1))));
}

export function listFormulaFunctions() {
  return [...new Set([...Object.keys(BASE_FUNCTIONS), "roller"])];
}
