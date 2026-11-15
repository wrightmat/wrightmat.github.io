// The Systems and Settings this visitor can see, and any System's own vocabulary (the fields its fieldRoles name,
// plus the Library kinds tagged for it), fetched on first use and kept for the page. The command bar's suggestions
// read it; anything else needing the same lists can share it instead of fetching them again.
import { listAllSystems } from "./generator-kit.js";
import { resolveFieldRole, resolveFieldRoles } from "./field-roles.js";
import { resolveGroupContext } from "./widgets/group-context.js";

let catalog = null;

function entryTitle(entry) {
  return entry?.body?.name || entry?.body?.title || entry?.id || "";
}

function valueName(value) {
  if (typeof value === "string") return value;
  return value?.name || value?.label || value?.shortName || value?.id || "";
}

function idsOf(body, key, legacyKey) {
  if (Array.isArray(body?.[key])) return body[key];
  return body?.[legacyKey] ? [body[legacyKey]] : [];
}

function createCatalog(dataManager) {
  const cache = new Map();
  const remember = (key, load) => {
    if (!cache.has(key)) {
      cache.set(
        key,
        load().catch(() => {
          cache.delete(key);
          return null;
        })
      );
    }
    return cache.get(key);
  };
  const forget = (prefix) => [...cache.keys()].filter((key) => key.startsWith(prefix)).forEach((key) => cache.delete(key));

  const bulk = (kind, systemIds) =>
    remember(`kind:${kind}:${systemIds?.join(",") || ""}`, async () => {
      const { items } = await dataManager.getBulk(kind, systemIds?.length ? { systemIds } : {});
      return items.filter((item) => item?.id && item.body).map((item) => ({ id: item.id, title: entryTitle(item), body: item.body }));
    }).then((entries) => entries || []);

  const api = {
    dataManager,
    groupContext: () => remember("group", () => resolveGroupContext(dataManager)),
    systems: () => remember("systems", () => listAllSystems(dataManager)).then((list) => list || []),
    system: (systemId) =>
      systemId
        ? remember(`system:${systemId}`, async () => (await dataManager.get("systems", systemId, { preferLocal: false }))?.payload || null)
        : Promise.resolve(null),
    // The given System, else the active group's.
    resolveSystemId: async (systemId = "") => systemId || (await api.groupContext())?.systemId || "",
    settings: async (systemId = "") =>
      (await bulk("setting")).filter((entry) => {
        const ids = idsOf(entry.body, "systemIds");
        return !systemId || !ids.length || ids.includes(systemId);
      }),
    locations: async (settingId = "") =>
      (await bulk("location")).filter((entry) => !settingId || idsOf(entry.body, "settingIds", "settingId").includes(settingId)),
    // Library records of `kind` tagged for the System (an untagged record belongs to every System).
    kindEntries: (kind, systemId = "") => bulk(kind, systemId ? [systemId] : null),
    fieldValues: async (systemId, key) => {
      const system = await api.system(systemId);
      const field = (system?.fields || []).find((entry) => entry?.key === key);
      return Array.isArray(field?.values) ? field.values : [];
    },
    // `{ label, values }` of the field the System names for a role, or null when it declares none.
    roleField: async (systemId, role) => {
      const resolved = resolveFieldRole(await api.system(systemId), role);
      return resolved ? { key: resolved.fieldDef.key, label: resolved.fieldDef.label || resolved.fieldDef.key, values: resolved.fieldDef.values || [] } : null;
    },
    roleFields: async (systemId, role) =>
      resolveFieldRoles(await api.system(systemId), role).map((entry) => ({
        key: entry.fieldDef.key,
        label: entry.fieldDef.label || entry.fieldDef.key,
        values: entry.fieldDef.values || [],
      })),
    valueName,
  };

  window.addEventListener("workbench:active-group-changed", () => forget("group"));
  window.addEventListener("undercroft:auth-changed", () => cache.clear());
  const onContentChange = (event) => {
    const bucket = event.detail?.bucket;
    if (bucket === "systems") forget("system");
    else if (bucket) forget(`kind:${bucket}:`);
  };
  window.addEventListener("workbench:content-saved", onContentChange);
  window.addEventListener("workbench:content-deleted", onContentChange);
  return api;
}

export function getSystemCatalog(dataManager) {
  if (!catalog) catalog = createCatalog(dataManager);
  return catalog;
}
