
function normalizeKey(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

export function normalizeColumnType(type) {
  const normalized = typeof type === "string" ? type.trim().toLowerCase() : "";
  if (normalized === "number" || normalized === "boolean") {
    return normalized;
  }
  return "string";
}

export function normalizeListColumn(column = {}) {
  const uid = column?.uid || null;
  const fieldKey = normalizeKey(column?.field || column?.key);
  const mode = column?.mode === "formula" ? "formula" : "field";
  const baseKey = mode === "field" && fieldKey ? fieldKey : uid || "";
  const normalizedKey = baseKey || `col-${Math.random().toString(36).slice(2, 8)}`;
  return {
    uid: uid || normalizedKey,
    key: normalizedKey,
    field: mode === "field" ? fieldKey : "",
    label:
      typeof column?.label === "string" && column.label.trim()
        ? column.label.trim()
        : fieldKey || normalizedKey || "Column",
    type: normalizeColumnType(column?.type),
    visible: column?.visible !== false,
    mode,
    formula: mode === "formula" ? (column?.formula || "").trim() : "",
    readOnly: mode === "formula" ? true : Boolean(column?.readOnly),
    removable: mode === "formula" ? true : Boolean(column?.removable),
  };
}

export function normalizeListColumns(columns) {
  if (!Array.isArray(columns)) {
    return [];
  }
  return columns.map((column) => normalizeListColumn(column));
}

export function getVisibleListColumns(columns) {
  return normalizeListColumns(columns).filter((column) => column.visible !== false);
}

export function resolveDisplayColumn(columns, preferredKey = "") {
  const normalized = normalizeListColumns(columns);
  const visible = normalized.filter((column) => column.visible !== false);
  if (!visible.length) {
    return { columns: normalized, visible, displayField: "" };
  }
  const match = preferredKey ? visible.find((column) => column.key === preferredKey) : null;
  const fallback = match || visible[0];
  return { columns: normalized, visible, displayField: fallback.key };
}

export function cloneListColumns(columns) {
  return normalizeListColumns(columns).map((column) => ({ ...column }));
}
