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
      // A values entry can be a bare display string (legacy) or a
      // {name, entityId} object linking straight to a Library entity (Loom's
      // System editor) — either way, rendering only ever needs the display
      // name, so normalize before it's used as dropdown option data.
      const normalizedValues = Array.isArray(node.values)
        ? node.values.map((entry) => (entry && typeof entry === "object" ? entry.name : entry))
        : node.values;
      const candidateValues = [normalizedValues, node.examples, node.example, node.sample, node.preview, node.default];
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

// `description` (a System Source entry's own flavor/rules text — e.g. a
// Blades in the Dark special ability's rules text, an armor type's own
// blurb) rides along as a third, optional field alongside value/label —
// carried through so a Checkbox/Radio group can show it under each option
// (see component-renderers.js's own radio/checkbox rendering) instead of
// silently dropping it the way this function used to for every consumer.
// Empty string, never undefined, so callers can check truthiness uniformly
// without an extra `?? ""` at every call site.
// `raw` (the original, unprocessed source entry) also rides along now —
// harmless for Select/Checkbox (they only ever read value/label/description)
// but needed by Source-driven Tabs (Container's own tabLabelsSourceBinding),
// which needs the actual entry — an object's own nested array, for Blades
// in the Dark's `playbooks.Cutter = [...]` shape — not just its derived
// display label.
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
          // resolveSystemFieldValues, for a `type: "object"` System field
          // (Blades in the Dark's restructured `playbooks`, each child a
          // `type: "array"` sub-field named after a playbook), returns that
          // field's own `children` — an array of SUB-FIELD DEFINITIONS
          // (`{type, key, label, values}`), not plain data rows. Their own
          // `.key` is a synthetic, dotted, prefixed path ("playbooks.Cutter")
          // — it would otherwise win as this option's VALUE below (the
          // generic `entry.key` fallback), which breaks anything that
          // writes that value back (e.g. the `@playbook` Select's own
          // `sourceBinding: "@playbooks"`, which needs the option's own
          // `.label` — "Cutter" — matching already-migrated character data,
          // not "playbooks.Cutter"). Matches resolveTabEntries' identical
          // handling of the same shape.
          if (typeof entry.type === "string" && Array.isArray(entry.values)) {
            const label = entry.label != null ? String(entry.label) : String(entry.key ?? index);
            return { value: label, label, description: "", raw: entry };
          }
          const rawValue = entry.value ?? entry.id ?? entry.key ?? entry.slug ?? entry.name ?? entry.label ?? index;
          if (rawValue == null) {
            return null;
          }
          const rawLabel = entry.label ?? entry.name ?? entry.title ?? entry.text ?? rawValue;
          return {
            value: String(rawValue),
            label: rawLabel != null ? String(rawLabel) : String(rawValue),
            description: entry.description != null ? String(entry.description) : "",
            raw: entry,
          };
        }
        return { value: String(entry), label: String(entry), description: "", raw: entry };
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
          description: entry.description != null ? String(entry.description) : "",
          raw: entry,
        };
      }
      // `entry` is an array (a Source-driven Tab's own bare-array shape —
      // see the header comment) or a primitive — neither has a `.label`/
      // `.name` of its own to show, and `String(entry)` on an array would
      // join it into a garbage comma list (`"[object Object],[object
      // Object]"`). The object's own KEY is the only meaningful identity
      // and display text either way.
      return {
        value: String(key),
        label: String(key),
        description: "",
        raw: entry,
      };
    });
  }
  return [];
}

// Source-driven Tabs (Container's own tabLabelsSourceBinding) need one more
// unwrapping step beyond normalizeOptionEntries: when the Source binding
// points at a `type: "object"` System field (Blades in the Dark's
// restructured `playbooks`, each child a `type: "array"` sub-field named
// after a playbook), resolveSystemFieldValues (workbench-character-view.js/
// workbench-template-view.js, both pages) returns that field's own
// `children` — an array of SUB-FIELD DEFINITIONS (each `{type, key, label,
// values}`), not the actual per-playbook data. normalizeOptionEntries alone
// stops at `raw: entry` being that whole field-definition object; a tab's
// own item needs to be the definition's own nested `values` array instead
// (the bare abilities list), and its own stable key needs to be the
// friendly `label` ("Cutter"), not the dotted `key` a nested field
// definition carries ("playbooks.Cutter") — the ability-write path's own
// `{item}` substitution (see workbench-character-view.js's
// resolveTabItemPath) needs the short form to match already-migrated
// character data (`specialAbilitiesPurchased.cutter`).
// `sourceValues` is whatever resolveSystemFieldValues already returned
// (raw `field.values` or `field.children` — this function doesn't care
// which, only what shape each entry turns out to be after normalizing).
export function resolveTabEntries(sourceValues) {
  return normalizeOptionEntries(sourceValues).map((entry) => {
    const raw = entry.raw;
    const isFieldDefinition = raw && typeof raw === "object" && !Array.isArray(raw) && Array.isArray(raw.values);
    return {
      label: entry.label,
      key: entry.label,
      item: isFieldDefinition ? raw.values : raw,
    };
  });
}
