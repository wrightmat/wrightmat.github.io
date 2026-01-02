import { evaluateFormula } from "../../common/js/lib/formula-engine.js";

const SIMPLE_BINDING_PATTERN = /^@[A-Za-z0-9_.]+$/;
const FORMULA_HINT_PATTERN = /[+*/<>=!?&|()-]|\bif\s*\(/;

function shouldEvaluateFormula(value) {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith("=")) {
    return trimmed.length > 1;
  }
  if (!trimmed.includes("@")) {
    return false;
  }
  if (SIMPLE_BINDING_PATTERN.test(trimmed)) {
    return false;
  }
  return FORMULA_HINT_PATTERN.test(trimmed);
}

export function resolveBinding(binding, context) {
  if (typeof binding !== "string") {
    return binding;
  }
  const trimmed = binding.trim();
  if (!trimmed) {
    return binding;
  }
  const resolvePath = (path) => {
    const segments = path.slice(1).split(".");
    return segments.reduce((acc, key) => {
      if (acc && typeof acc === "object" && key in acc) {
        return acc[key];
      }
      return undefined;
    }, context);
  };
  if (shouldEvaluateFormula(trimmed)) {
    try {
      return evaluateFormula(trimmed, context ?? {});
    } catch (error) {
      console.warn("Press bindings: unable to evaluate formula", error);
      if (trimmed.startsWith("@")) {
        return resolvePath(trimmed);
      }
      return "";
    }
  }
  if (!trimmed.startsWith("@")) {
    return binding;
  }
  return resolvePath(trimmed);
}
