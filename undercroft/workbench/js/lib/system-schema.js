const OBJECT_TYPES = new Set(["object"]);

function normalizeDefinitions(system) {
  if (!system || typeof system !== "object") {
    return {};
  }
  const source = system.definitions;
  if (!source || typeof source !== "object") {
    return {};
  }
  return Object.entries(source).reduce((accumulator, [key, value]) => {
    if (typeof key !== "string" || !key.trim() || !value || typeof value !== "object") {
      return accumulator;
    }
    const trimmedKey = key.trim();
    accumulator[trimmedKey] = value;
    return accumulator;
  }, {});
}

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

function collectArrayChildren(node, definitions) {
  if (!node || typeof node !== "object") {
    return [];
  }
  if (normalizeType(node.type) === "array") {
    if (node.itemMode === "definition" && typeof node.itemRef === "string" && node.itemRef) {
      const definition = definitions?.[node.itemRef] || null;
      return Array.isArray(definition?.children) ? definition.children : [];
    }
  }
  return Array.isArray(node.children) ? node.children : [];
}

function traverseField(node, prefix, results, definitions) {
  if (!node || typeof node !== "object") {
    return;
  }
  const key = normalizeKey(node.key);
  const nextPrefix = key ? [...prefix, key] : prefix;
  if (nextPrefix.length) {
    pushPath(results, nextPrefix, node);
  }
  const type = normalizeType(node.type) || "value";
  if (OBJECT_TYPES.has(type) && Array.isArray(node.children)) {
    node.children.forEach((child) => {
      traverseField(child, nextPrefix, results, definitions);
    });
  } else if (type === "array") {
    const children = collectArrayChildren(node, definitions);
    if (children.length) {
      const base = nextPrefix.length ? `${nextPrefix[nextPrefix.length - 1]}[]` : "[]";
      const arrayPrefix = nextPrefix.length ? [...nextPrefix.slice(0, -1), base] : [base];
      children.forEach((child) => {
        traverseField(child, arrayPrefix, results, definitions);
      });
    }
  }
}

export function collectSystemFields(system) {
  if (!system || typeof system !== "object") {
    return [];
  }
  const results = [];
  const seen = new Set();
  const definitions = normalizeDefinitions(system);
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
        traverseField(field, [], results, definitions);
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

export function resolveSystemFieldPath(system, pathSegments) {
  if (!system || typeof system !== "object") {
    return null;
  }
  const segments = Array.isArray(pathSegments) ? pathSegments.map(normalizeKey).filter(Boolean) : [];
  if (!segments.length) {
    return null;
  }
  const definitions = normalizeDefinitions(system);
  let collection = Array.isArray(system.fields)
    ? system.fields
    : system.fields && typeof system.fields === "object"
    ? Object.values(system.fields)
    : [];
  let node = null;
  for (let index = 0; index < segments.length; index += 1) {
    const key = segments[index];
    if (!Array.isArray(collection)) {
      return null;
    }
    node = collection.find((field) => normalizeKey(field?.key) === key) || null;
    if (!node) {
      return null;
    }
    const type = normalizeType(node.type);
    if (type === "object") {
      collection = Array.isArray(node.children) ? node.children : [];
      continue;
    }
    if (type === "array") {
      const children = collectArrayChildren(node, definitions);
      collection = children;
      continue;
    }
    collection = [];
  }
  if (!node) {
    return null;
  }
  return { node, definitions };
}

export function resolveSystemArray(system, pathSegments) {
  const result = resolveSystemFieldPath(system, pathSegments);
  if (!result) {
    return null;
  }
  const { node, definitions } = result;
  if (normalizeType(node.type) !== "array") {
    return { node, definitions, columns: [] };
  }
  const columns = collectArrayChildren(node, definitions);
  const definition = node.itemMode === "definition" ? definitions?.[node.itemRef] || null : null;
  return { node, definitions, columns, definition };
}
