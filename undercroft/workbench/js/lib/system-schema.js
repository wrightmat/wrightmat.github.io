const SEEN_TYPES = new Set(["group", "object"]);

function normalizeType(type) {
  if (typeof type !== "string") {
    return "";
  }
  return type.trim().toLowerCase();
}

export function categorizeFieldType(type) {
  const normalized = normalizeType(type);
  switch (normalized) {
    case "integer":
    case "number":
    case "float":
    case "decimal":
      return "number";
    case "boolean":
    case "bool":
      return "boolean";
    case "array":
      return "array";
    case "list":
      return "list";
    case "object":
    case "group":
      return "object";
    case "string":
    case "text":
      return "string";
    default:
      return "";
  }
}

function normalizeKey(key) {
  if (typeof key !== "string") {
    return "";
  }
  return key.trim();
}

function pushPath(results, pathSegments, node) {
  if (!Array.isArray(pathSegments) || !pathSegments.length) {
    return;
  }
  const path = pathSegments.join(".");
  const label = typeof node.label === "string" && node.label.trim()
    ? node.label.trim()
    : pathSegments[pathSegments.length - 1];
  const rawType = typeof node.type === "string" ? node.type : "";
  const type = rawType ? rawType : "value";
  results.push({ path, label, type, category: categorizeFieldType(rawType) });
}

function traverseField(node, prefix, results) {
  if (!node || typeof node !== "object") {
    return;
  }
  const key = normalizeKey(node.key);
  const nextPrefix = key ? [...prefix, key] : prefix;
  if (nextPrefix.length) {
    pushPath(results, nextPrefix, node);
  }
  const type = normalizeType(node.type) || "value";
  const shouldDrill = SEEN_TYPES.has(type.toLowerCase());
  if (shouldDrill && Array.isArray(node.children)) {
    node.children.forEach((child) => {
      traverseField(child, nextPrefix, results);
    });
  }
}

export function collectSystemFields(system) {
  if (!system || typeof system !== "object") {
    return [];
  }
  const results = [];
  const seen = new Set();
  const fields = Array.isArray(system.fields) ? system.fields : [];
  fields.forEach((field) => {
    traverseField(field, [], results);
  });
  return results
    .filter((entry) => {
      if (!entry || !entry.path) {
        return false;
      }
      if (seen.has(entry.path)) {
        return false;
      }
      seen.add(entry.path);
      return true;
    })
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }));
}

export default collectSystemFields;
