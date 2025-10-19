const ARRAY_INDEX_PATTERN = /^\d+$/;

export function normalizeBindingValue(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

export function parseBindingPathSegments(binding) {
  const normalized = normalizeBindingValue(binding);
  if (!normalized || !normalized.startsWith("@")) {
    return null;
  }
  let expression = normalized.slice(1).trim();
  if (!expression) {
    return [];
  }
  if (expression.startsWith("{") && expression.endsWith("}")) {
    expression = expression.slice(1, -1).trim();
  }
  const segments = [];
  let buffer = "";
  let inBracket = false;
  let quoteChar = "";
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (inBracket) {
      if (quoteChar) {
        if (char === quoteChar && expression[index - 1] !== "\\") {
          quoteChar = "";
        } else {
          buffer += char;
        }
        continue;
      }
      if (char === "'" || char === '"') {
        quoteChar = char;
        continue;
      }
      if (char === "]") {
        const segment = buffer.trim();
        if (segment) {
          segments.push(segment);
        }
        buffer = "";
        inBracket = false;
        continue;
      }
      buffer += char;
      continue;
    }
    if (char === "[") {
      if (buffer.trim()) {
        segments.push(buffer.trim());
      }
      buffer = "";
      inBracket = true;
      continue;
    }
    if (char === ".") {
      if (buffer.trim()) {
        segments.push(buffer.trim());
      }
      buffer = "";
      continue;
    }
    buffer += char;
  }
  if (buffer.trim()) {
    segments.push(buffer.trim());
  }
  return segments
    .map((segment) => segment.replace(/^['"]|['"]$/g, "").trim())
    .filter((segment) => segment.length > 0);
}

function getValueAtSegments(root, segments = []) {
  if (!segments.length) {
    return root;
  }
  let cursor = root;
  for (const segment of segments) {
    if (Array.isArray(cursor) && ARRAY_INDEX_PATTERN.test(segment)) {
      const index = Number(segment);
      cursor = cursor[index];
    } else if (cursor && typeof cursor === "object" && segment in cursor) {
      cursor = cursor[segment];
    } else {
      return undefined;
    }
  }
  return cursor;
}

export function resolveBindingFromContexts(binding, contexts = []) {
  const path = parseBindingPathSegments(binding);
  if (!path || !path.length) {
    return undefined;
  }
  const normalizedContexts = Array.isArray(contexts)
    ? contexts
        .map((context) => {
          if (!context || typeof context.value !== "object" || context.value === null) {
            return null;
          }
          const prefixes = Array.isArray(context.prefixes)
            ? context.prefixes
                .map((prefix) => (typeof prefix === "string" ? prefix.trim() : ""))
                .filter((prefix) => prefix.length > 0)
            : [];
          return {
            value: context.value,
            prefixes,
            allowDirect: Boolean(context.allowDirect),
          };
        })
        .filter(Boolean)
    : [];

  for (const context of normalizedContexts) {
    if (context.allowDirect) {
      const direct = getValueAtSegments(context.value, path);
      if (direct !== undefined) {
        return direct;
      }
    }
    for (const prefix of context.prefixes) {
      if (path[0] === prefix) {
        const result = getValueAtSegments(context.value, path.slice(1));
        if (result !== undefined) {
          return result;
        }
      }
    }
  }
  return undefined;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function clonePreviewValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => clonePreviewValue(entry));
  }
  if (isPlainObject(value)) {
    return Object.entries(value).reduce((accumulator, [key, entry]) => {
      accumulator[key] = clonePreviewValue(entry);
      return accumulator;
    }, {});
  }
  return value;
}

function assignPreviewValue(target, path, value) {
  if (!Array.isArray(path) || !path.length) {
    return;
  }
  let cursor = target;
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    if (!segment) {
      return;
    }
    if (index === path.length - 1) {
      cursor[segment] = clonePreviewValue(value);
      return;
    }
    if (!isPlainObject(cursor[segment])) {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }
}

function mergePreviewRecord(target, record) {
  if (!isPlainObject(record)) {
    return;
  }
  Object.entries(record).forEach(([key, value]) => {
    if (typeof key !== "string") {
      return;
    }
    const trimmed = key.trim();
    if (!trimmed) {
      return;
    }
    const existing = target[trimmed];
    if (isPlainObject(existing) && isPlainObject(value)) {
      mergePreviewRecord(existing, value);
      return;
    }
    const cloned = clonePreviewValue(value);
    if (cloned !== undefined) {
      target[trimmed] = cloned;
    }
  });
}

export function buildSystemPreviewData(definition) {
  const preview = {};
  if (!definition || typeof definition !== "object") {
    return preview;
  }

  const MERGE_KEYS = ["preview", "sample", "samples", "values", "lists", "collections", "sources", "data"];
  MERGE_KEYS.forEach((key) => {
    const value = definition[key];
    if (isPlainObject(value)) {
      mergePreviewRecord(preview, value);
    }
  });

  function visitField(node, prefix = []) {
    if (!node || typeof node !== "object") {
      return;
    }
    const key = typeof node.key === "string" ? node.key.trim() : "";
    const nextPrefix = key ? [...prefix, key] : prefix;
    if (nextPrefix.length) {
      const candidateValues = [node.values, node.examples, node.example, node.sample, node.preview, node.default];
      const sample = candidateValues.find((candidate) => {
        if (Array.isArray(candidate)) {
          return candidate.length > 0;
        }
        if (isPlainObject(candidate)) {
          return Object.keys(candidate).length > 0;
        }
        return false;
      });
      if (sample !== undefined) {
        assignPreviewValue(preview, nextPrefix, sample);
      }
    }
    const normalizedType = typeof node.type === "string" ? node.type.trim().toLowerCase() : "";
    if (Array.isArray(node.children) && node.children.length) {
      node.children.forEach((child) => {
        visitField(child, nextPrefix);
      });
    } else if (normalizedType === "array" && node.items && typeof node.items === "object") {
      const itemCandidates = [node.items.enum, node.items.values, node.items.examples];
      const sample = itemCandidates.find((candidate) => Array.isArray(candidate) && candidate.length);
      if (sample) {
        assignPreviewValue(preview, nextPrefix, sample);
      }
    }
  }

  const fieldSets = [];
  if (Array.isArray(definition.fields)) {
    fieldSets.push(definition.fields);
  } else if (isPlainObject(definition.fields)) {
    fieldSets.push(Object.values(definition.fields));
  }
  const schemaFields = definition.schema && typeof definition.schema === "object" ? definition.schema.fields : null;
  if (Array.isArray(schemaFields)) {
    fieldSets.push(schemaFields);
  } else if (isPlainObject(schemaFields)) {
    fieldSets.push(Object.values(schemaFields));
  }
  const definitionFields =
    definition.definition && typeof definition.definition === "object" ? definition.definition.fields : null;
  if (Array.isArray(definitionFields)) {
    fieldSets.push(definitionFields);
  } else if (isPlainObject(definitionFields)) {
    fieldSets.push(Object.values(definitionFields));
  }

  fieldSets.forEach((fields) => {
    if (Array.isArray(fields)) {
      fields.forEach((field) => visitField(field, []));
    }
  });

  return preview;
}

export function normalizeOptionEntries(source) {
  if (!source) {
    return [];
  }
  if (Array.isArray(source)) {
    return source
      .map((entry, index) => {
        if (entry == null) {
          return null;
        }
        if (typeof entry === "object" && !Array.isArray(entry)) {
          const rawValue = entry.value ?? entry.id ?? entry.key ?? entry.slug ?? entry.name ?? entry.label ?? index;
          if (rawValue == null) {
            return null;
          }
          const rawLabel = entry.label ?? entry.name ?? entry.title ?? entry.text ?? rawValue;
          return {
            value: String(rawValue),
            label: rawLabel != null ? String(rawLabel) : String(rawValue),
          };
        }
        return { value: String(entry), label: String(entry) };
      })
      .filter(Boolean);
  }
  if (typeof source === "object") {
    return Object.entries(source).map(([key, entry]) => {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const rawValue = entry.value ?? entry.id ?? entry.key ?? entry.slug ?? key;
        const rawLabel = entry.label ?? entry.name ?? entry.title ?? entry.text ?? rawValue;
        return {
          value: rawValue != null ? String(rawValue) : String(key),
          label: rawLabel != null ? String(rawLabel) : String(rawValue ?? key),
        };
      }
      return {
        value: String(key),
        label: entry != null ? String(entry) : String(key),
      };
    });
  }
  return [];
}
