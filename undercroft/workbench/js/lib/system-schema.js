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
    case "list":
      return "array";
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

function resolveNodePath(parentPath, key) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) {
    return parentPath;
  }
  if (!parentPath) {
    return normalizedKey;
  }
  const startsWithParentDot = normalizedKey.startsWith(`${parentPath}.`);
  const startsWithParentBracket = normalizedKey.startsWith(`${parentPath}[`);
  if (normalizedKey === parentPath || startsWithParentDot || startsWithParentBracket) {
    return normalizedKey;
  }
  return `${parentPath}.${normalizedKey}`;
}

function pushPath(results, path, node) {
  if (!path) {
    return;
  }
  const rawLabel = typeof node.label === "string" ? node.label.trim() : "";
  const fallbackSegment = path.split(".").pop() || path;
  const fallbackLabel = fallbackSegment.replace(/\[\]/g, "");
  const label = rawLabel || fallbackLabel || path;
  const rawType = typeof node.type === "string" ? node.type : "";
  const type = rawType || "value";
  const rawDisplayField = typeof node.displayField === "string" ? node.displayField.trim() : "";
  const itemDisplayField =
    node && typeof node.item === "object" && typeof node.item.displayField === "string"
      ? node.item.displayField.trim()
      : "";
  const displayField = rawDisplayField || itemDisplayField || "";
  results.push({ path, label, type, category: categorizeFieldType(rawType), displayField });
}

function traverseField(node, parentPath, results) {
  if (!node || typeof node !== "object") {
    return;
  }
  const key = normalizeKey(node.key);
  const type = normalizeType(node.type);
  const nextPath = resolveNodePath(parentPath, key);
  if (nextPath) {
    pushPath(results, nextPath, node);
  }

  if (type === "object") {
    const childParent = nextPath || parentPath;
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach((child) => {
      traverseField(child, childParent, results);
    });
    return;
  }

  if (type === "array") {
    const arrayParent = nextPath ? (nextPath.endsWith("[]") ? nextPath : `${nextPath}[]`) : parentPath;
    let children = Array.isArray(node.children) ? node.children : [];
    if (!children.length && node.item && typeof node.item === "object" && Array.isArray(node.item.children)) {
      children = node.item.children;
    }
    children.forEach((child) => {
      traverseField(child, arrayParent, results);
    });
  }
}

export function collectSystemFields(system) {
  if (!system || typeof system !== "object") {
    return [];
  }
  const results = [];
  const seen = new Set();
  const candidateSets = [];
  if (Array.isArray(system.fields)) {
    candidateSets.push(system.fields);
  } else if (system.fields && typeof system.fields === "object") {
    candidateSets.push(Object.values(system.fields));
  }
  const schemaFields = system.schema && typeof system.schema === "object" ? system.schema.fields : null;
  if (Array.isArray(schemaFields)) {
    candidateSets.push(schemaFields);
  } else if (schemaFields && typeof schemaFields === "object") {
    candidateSets.push(Object.values(schemaFields));
  }
  const definitionFields = system.definition && typeof system.definition === "object" ? system.definition.fields : null;
  if (Array.isArray(definitionFields)) {
    candidateSets.push(definitionFields);
  } else if (definitionFields && typeof definitionFields === "object") {
    candidateSets.push(Object.values(definitionFields));
  }
  candidateSets.forEach((fields) => {
    if (Array.isArray(fields)) {
      fields.forEach((field) => {
        traverseField(field, "", results);
      });
    }
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
