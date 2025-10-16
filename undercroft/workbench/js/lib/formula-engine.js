const SAFE_PATTERN = /^[0-9+\-*/().,@\s<>=!?&|%:'"_A-Za-z]+$/;

const SAFE_FUNCTIONS = {
  min: Math.min,
  max: Math.max,
  ceil: Math.ceil,
  floor: Math.floor,
  round: Math.round,
  abs: Math.abs,
  clamp(value, min, max) {
    const v = Number(value);
    return Math.min(Math.max(v, Number(min)), Number(max));
  },
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

export function evaluateFormula(formula, context = {}) {
  if (typeof formula !== "string" || !formula.trim()) {
    return null;
  }
  const trimmed = formula.trim();
  if (!SAFE_PATTERN.test(trimmed)) {
    throw new Error("Formula contains unsupported characters");
  }
  const expression = trimmed.replace(/@([A-Za-z0-9_.]+)/g, (_, path) => {
    return `__get("${path}")`;
  });

  const evaluator = new Function(
    "__get",
    "__fn",
    "const { min, max, ceil, floor, round, abs, clamp } = __fn; return (" + expression + ");"
  );

  const getter = (path) => coerceValue(resolvePath(context, path));
  return evaluator(getter, SAFE_FUNCTIONS);
}

export function extractDependencies(formula) {
  if (typeof formula !== "string") {
    return [];
  }
  const matches = formula.match(/@([A-Za-z0-9_.]+)/g) || [];
  return Array.from(new Set(matches.map((token) => token.slice(1))));
}
