// Loom's declarative mapping engine: interprets a "mapping definition" (a JSON
// tree) against a raw source object and produces a standardized target JSON
// value. Every node produces a JSON value (unlike press/js/template-renderer.js,
// which interprets a similar tree shape but produces DOM).
//
// Node types:
//   object   { type:"object", fields: { key: node, ... } }        -> { key: value, ... }
//   field    { type:"field", bind:"@path" | "=formula" }           -> scalar value
//   pipeline { type:"pipeline", source, steps:[...] }              -> array or object
//   custom   { type:"custom", fn:"name", args:{...} }              -> whatever fn returns
//   with     { type:"with", bindings:{name:node,...}, body:node }  -> body evaluated with
//                                                                     each binding's result
//                                                                     merged into context first
//                                                                     (sequential: later bindings
//                                                                     can reference earlier ones) —
//                                                                     for shared subcomputations
//                                                                     (e.g. resolved modifiers,
//                                                                     ability scores) multiple
//                                                                     sibling fields need without
//                                                                     recomputing per field.
//
// Pipeline steps operate on the current value (coerced to an array unless it's
// already an object, for group-by/flatten's object-of-arrays case):
//   { step:"map", item: node }                    - apply `item` to every element
//   { step:"filter", bind }                        - keep elements where bind is truthy
//   { step:"flatten" }                              - array-of-arrays or object-of-arrays -> one array
//   { step:"group-by", bind }                       - -> { [bind result]: [elements...] }
//   { step:"sort", bind, direction:"asc"|"desc" }   - order by bind result
//   { step:"dedup", bind }                          - keep first element per distinct bind result
//   { step:"custom", fn, args }                     - escape hatch: fn(currentValue, context, args, env)
//
// A `source` (on `pipeline`) is either a bind string ("@raw.array") or a
// `{ fn, args }` custom-function reference, for cases where the starting array
// has to be assembled from several bespoke places before declarative steps apply.
//
// Inside `map`/`filter`/`sort`/`dedup`, the current element is exposed to bindings
// both spread directly (so `@name` reaches an object element's own `name` field)
// and under the reserved key `value` (so `@value` reaches a primitive element,
// or an object element as a whole).

import { resolveBinding } from "./bindings.js";

function makeLookupFn(lookupTables) {
  return (tableName, key) => {
    const table = lookupTables?.[tableName];
    if (table == null) return undefined;
    if (Array.isArray(table)) {
      if (table.length && typeof table[0] === "object" && table[0] !== null) {
        return table.find((entry) => entry.id === key || entry.name === key);
      }
      return table[Number(key)];
    }
    if (typeof table === "object") {
      return table[key];
    }
    return undefined;
  };
}

function bind(bindExpr, context, env) {
  return resolveBinding(bindExpr, context, env.formulaOptions);
}

function itemContext(item, context) {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    return { ...context, ...item, value: item };
  }
  return { ...context, value: item };
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (typeof value === "object") return Object.values(value);
  return [value];
}

function runCustom(name, env, ...args) {
  const fn = env.customFunctions?.[name];
  if (typeof fn !== "function") {
    throw new Error(`Loom mapping engine: unknown custom function "${name}"`);
  }
  return fn(...args);
}

function resolveSource(source, context, env) {
  if (typeof source === "string") {
    return bind(source, context, env);
  }
  if (source && typeof source === "object" && source.fn) {
    return runCustom(source.fn, env, context, source.args || {}, env);
  }
  return undefined;
}

function applyStep(value, step, context, env) {
  switch (step.step) {
    case "map": {
      return toArray(value).map((item) => evalNode(step.item, itemContext(item, context), env));
    }
    case "filter": {
      return toArray(value).filter((item) => Boolean(bind(step.bind, itemContext(item, context), env)));
    }
    case "flatten": {
      const parts = Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value) : [];
      return parts.reduce((all, entry) => all.concat(Array.isArray(entry) ? entry : entry == null ? [] : [entry]), []);
    }
    case "group-by": {
      const groups = {};
      toArray(value).forEach((item) => {
        const key = bind(step.bind, itemContext(item, context), env);
        const groupKey = key == null ? "" : String(key);
        (groups[groupKey] = groups[groupKey] || []).push(item);
      });
      return groups;
    }
    case "sort": {
      const direction = step.direction === "desc" ? -1 : 1;
      return toArray(value)
        .map((item) => ({ item, key: bind(step.bind, itemContext(item, context), env) }))
        .sort((a, b) => {
          if (a.key < b.key) return -1 * direction;
          if (a.key > b.key) return 1 * direction;
          return 0;
        })
        .map((entry) => entry.item);
    }
    case "dedup": {
      const seen = new Set();
      return toArray(value).filter((item) => {
        const key = bind(step.bind, itemContext(item, context), env);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    case "custom": {
      return runCustom(step.fn, env, value, context, step.args || {}, env);
    }
    default:
      throw new Error(`Loom mapping engine: unknown pipeline step "${step.step}"`);
  }
}

function evalObject(node, context, env) {
  const result = {};
  const fields = node.fields || {};
  Object.keys(fields).forEach((key) => {
    result[key] = evalNode(fields[key], context, env);
  });
  return result;
}

function evalPipeline(node, context, env) {
  let value = resolveSource(node.source, context, env);
  (node.steps || []).forEach((step) => {
    value = applyStep(value, step, context, env);
  });
  return value;
}

function evalWith(node, context, env) {
  const bindings = node.bindings || {};
  const enriched = { ...context };
  Object.keys(bindings).forEach((key) => {
    enriched[key] = evalNode(bindings[key], enriched, env);
  });
  return evalNode(node.body, enriched, env);
}

function evalNode(node, context, env) {
  if (node == null) return node;
  if (typeof node !== "object") return node;
  switch (node.type) {
    case "object":
      return evalObject(node, context, env);
    case "field":
      return bind(node.bind, context, env);
    case "pipeline":
      return evalPipeline(node, context, env);
    case "custom":
      return runCustom(node.fn, env, context, node.args || {}, env);
    case "with":
      return evalWith(node, context, env);
    default:
      throw new Error(`Loom mapping engine: unknown node type "${node.type}"`);
  }
}

export function applyMapping(definition, rawInput, { lookupTables = {}, customFunctions = {} } = {}) {
  const env = {
    lookupTables,
    customFunctions,
    formulaOptions: { functions: { lookup: makeLookupFn(lookupTables) } },
  };
  const rootContext = rawInput && typeof rawInput === "object" ? { ...rawInput, root: rawInput } : { root: rawInput };
  return evalNode(definition, rootContext, env);
}
