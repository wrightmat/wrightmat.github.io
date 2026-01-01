const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_ARRAY_ITEMS = 3;

function getValueType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function normalizeKey(key) {
  if (typeof key !== "string") return "";
  return key.trim();
}

function pushEntry(results, seen, path, value) {
  if (!path) return;
  if (seen.has(path)) return;
  seen.add(path);
  results.push({ path, value, type: getValueType(value) });
}

function traverseValue(value, path, depth, options, results, seen) {
  if (depth > options.maxDepth) return;
  if (path) {
    pushEntry(results, seen, path, value);
  }

  if (Array.isArray(value)) {
    const limit = Math.min(value.length, options.maxArrayItems);
    for (let index = 0; index < limit; index += 1) {
      const nextPath = path ? `${path}.${index}` : String(index);
      traverseValue(value[index], nextPath, depth + 1, options, results, seen);
    }
    return;
  }

  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    keys.forEach((key) => {
      const normalizedKey = normalizeKey(key);
      if (!normalizedKey) return;
      const nextPath = path ? `${path}.${normalizedKey}` : normalizedKey;
      traverseValue(value[key], nextPath, depth + 1, options, results, seen);
    });
  }
}

export function collectDataFields(data, options = {}) {
  if (!data || typeof data !== "object") {
    return [];
  }
  const normalizedOptions = {
    maxDepth:
      Number.isFinite(options.maxDepth) && options.maxDepth >= 1
        ? Math.floor(options.maxDepth)
        : DEFAULT_MAX_DEPTH,
    maxArrayItems:
      Number.isFinite(options.maxArrayItems) && options.maxArrayItems >= 1
        ? Math.floor(options.maxArrayItems)
        : DEFAULT_MAX_ARRAY_ITEMS,
  };
  const results = [];
  const seen = new Set();
  traverseValue(data, "", 0, normalizedOptions, results, seen);
  return results;
}

export default collectDataFields;
