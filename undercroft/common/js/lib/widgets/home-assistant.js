// Shared client-side plumbing for the Home Assistant integration — every
// call goes through the server's proxy routes (server/app.py's
// /home-assistant/* routes), never straight to HA from the browser the way
// wled.js calls a WLED device directly: HA doesn't send CORS headers by
// default, and the access token is stored encrypted server-side and never
// sent back to this client after the connect step below saves it.
//
// One connection per account, unlike WLED's per-device list — HA already
// has a single stable entity-id namespace, so there's no alias-resolution
// step the way wled.js needs. Consumed by ha-light.js (the Lighting
// widget's HA-light driver) and the Macro system below — no dedicated "Home
// Assistant" widget of its own, by design.

export async function getHaConnection(dataManager) {
  try {
    return await dataManager.getHaConnection();
  } catch (error) {
    return { configured: false, baseUrl: "" };
  }
}

// Trimmed {entityId, domain, friendlyName}[] — see app.py's own
// handle_ha_entities for why the full HA state payload never reaches here.
// `domainFilter` narrows to one domain or a list (e.g. the Lighting
// widget's picker wants both "light" and "group" — a Light Group helper's
// entity can land in either depending on how it was created in HA); omitted
// for the Macro editor's picker, which can target any domain. `status`, if
// given, surfaces a failure as a toast — without it a failed fetch silently
// returns [] and the caller has no way to tell the GM why the picker is
// stuck on "Loading…" forever (a bad token or unreachable HA instance).
export async function listHaEntities(dataManager, { domainFilter, status } = {}) {
  try {
    const result = await dataManager.listHaEntities();
    const entities = Array.isArray(result?.entities) ? result.entities : [];
    // HA's /api/states order is registration/discovery order, not anything
    // a human would want to scan — sorted once here so every caller gets an
    // alphabetized list for free.
    const sorted = entities.slice().sort((a, b) => a.friendlyName.localeCompare(b.friendlyName));
    if (!domainFilter) return sorted;
    const allowedDomains = Array.isArray(domainFilter) ? domainFilter : [domainFilter];
    return sorted.filter((entity) => allowedDomains.includes(entity.domain));
  } catch (error) {
    status?.show?.(error?.message || "Unable to load Home Assistant entities.", { type: "error", timeout: 4000 });
    return [];
  }
}

export async function callHaService(dataManager, { domain, service, entityId, data } = {}) {
  return dataManager.callHaService({ domain, service, entityId, data });
}

// One entity's live state, for ha-light.js's own render — never throws, same
// "empty/null on failure, let the caller show its own error" convention as
// getHaConnection/listHaEntities above.
export async function fetchHaEntityState(dataManager, entityId) {
  try {
    return await dataManager.getHaEntityState(entityId);
  } catch (error) {
    return null;
  }
}

// Always opens the connect/edit modal, pre-filled with the current base URL
// (never the token) — the explicit "manage this connection" entry point (a
// gear icon next to the Lighting widget's HA device picker), for fixing a
// wrong URL or disconnecting entirely: ensureHaConnection below silently
// no-ops once already configured, so without this a bad base URL had no way
// to be corrected short of clearing the row directly in the database.
// Leaving the token field blank on an edit keeps whatever's already saved.
export async function manageHaConnection({ dataManager, status }) {
  const existing = await getHaConnection(dataManager);
  return promptConnectionModal({
    existing,
    title: "Connect Home Assistant",
    description:
      "Stored for your account only. The token is encrypted server-side and never shown again after saving — leave it blank to keep the one already on file.",
    urlLabel: "Base URL",
    urlPlaceholder: "http://homeassistant.local:8123",
    keyLabel: "Long-lived access token",
    keyPlaceholder: existing.configured ? "Leave blank to keep the current token" : "Paste your token",
    keyRequired: true,
    onSave: (baseUrl, token) => dataManager.saveHaConnection({ baseUrl, token }),
    onDisconnect: () => dataManager.clearHaConnection(),
    status,
  });
}

// Prompts to connect only if not already configured; resolves true once a
// connection exists, false if the GM cancelled. Every entry point that just
// needs SOME connection to exist calls this rather than keeping its own
// gate; use manageHaConnection above when the intent is specifically to
// view/edit/disconnect an existing one.
export async function ensureHaConnection({ dataManager, status }) {
  const existing = await getHaConnection(dataManager);
  if (existing.configured) return true;
  return manageHaConnection({ dataManager, status });
}

// --- Macro action support (common/js/lib/widgets/macro-runner.js) ---------
//
// turnOn/turnOff/toggle call HA's domain-agnostic homeassistant.* services
// (works across lights, switches, scripts, scenes — running a script IS
// "turn on" in HA's model); callService is the escape hatch for anything
// domain-specific, same "basic controls + Advanced JSON" split wled.js
// uses. No widget instance to route through — HA has no on-screen card
// whose state would need refreshing after a command, so this is a plain
// standalone call every time.
export const HA_MACRO_ACTIONS = {
  turnOn: { label: "Turn on / Run", params: ["entityId"] },
  turnOff: { label: "Turn off", params: ["entityId"] },
  toggle: { label: "Toggle", params: ["entityId"] },
  callService: { label: "Call a service (advanced)", params: ["domain", "service", "entityId", "data"] },
};

export async function runHaMacroAction(action, { dataManager } = {}) {
  const params = action?.params || {};
  const entityId = String(params.entityId || "").trim();
  switch (action?.action) {
    case "turnOn":
      if (!entityId) throw new Error("No entity given.");
      await callHaService(dataManager, { domain: "homeassistant", service: "turn_on", entityId });
      return;
    case "turnOff":
      if (!entityId) throw new Error("No entity given.");
      await callHaService(dataManager, { domain: "homeassistant", service: "turn_off", entityId });
      return;
    case "toggle":
      if (!entityId) throw new Error("No entity given.");
      await callHaService(dataManager, { domain: "homeassistant", service: "toggle", entityId });
      return;
    case "callService": {
      const domain = String(params.domain || "").trim();
      const service = String(params.service || "").trim();
      if (!domain || !service) throw new Error("Domain and service are both required.");
      let data;
      if (params.data && typeof params.data === "string") {
        try {
          data = JSON.parse(params.data);
        } catch (error) {
          throw new Error("Extra data must be valid JSON.");
        }
      } else if (params.data && typeof params.data === "object") {
        data = params.data;
      }
      await callHaService(dataManager, { domain, service, entityId: entityId || undefined, data });
      return;
    }
    default:
      throw new Error(`Unknown Home Assistant macro action "${action?.action}".`);
  }
}
