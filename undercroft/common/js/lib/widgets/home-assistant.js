// Shared client-side plumbing for the Home Assistant integration — every
// call goes through the server's proxy routes (server/app.py's own
// /home-assistant/* routes), never straight to HA from the browser the way
// wled.js's own widget calls a WLED device directly: HA doesn't send CORS
// headers by default, and the access token is stored encrypted server-side
// (server/integrations.py) and never sent back to this client after the
// connect step below saves it.
//
// One connection per account, unlike WLED's own per-device list — HA
// already has a single stable entity-id namespace, so there's no "which
// device does this alias mean" resolution step the way wled.js needs;
// runHaMacroAction below calls straight through with no alias/target lookup
// at all. Consumed today by ha-light.js (the Lighting widget's HA-light
// driver) and the Macro system (HA_MACRO_ACTIONS/runHaMacroAction below) —
// no dedicated "Home Assistant" widget of its own, by design (see the plan
// this was built from).

export async function getHaConnection(dataManager) {
  try {
    return await dataManager.getHaConnection();
  } catch (error) {
    return { configured: false, baseUrl: "" };
  }
}

// Trimmed {entityId, domain, friendlyName}[] — see app.py's own
// handle_ha_entities for why the full HA state payload never reaches here.
// `domainFilter` narrows to one domain or a list of domains (e.g. the
// Lighting widget's device picker wants BOTH "light" and "group" — a Light
// Group helper's own entity can land in either domain depending on how it
// was created in HA, and there's no reliable way to tell which a GM meant
// without just offering both); omitted for the Macro editor's own picker,
// which can target any domain. `status`, if given, surfaces a failure as a
// toast — without it, a failed fetch silently returns [] and a caller
// showing a populated select has nothing to tell the GM WHY it's still
// empty (confirmed real gap: a bad token or an unreachable Home Assistant
// instance left the "Add an HA light" picker stuck on "Loading…" forever
// with zero feedback anywhere in the app). Note that DataManager._request
// sanitizes any 5xx message before it gets here (see its own comment — raw
// server exception text never reaches a toast), so a network/auth failure
// shows a generic "something went wrong" toast rather than the specific
// reason; the real reason is in the browser console (DataManager's own
// console.warn) and, as of this route's own error branches, the server's
// terminal output.
export async function listHaEntities(dataManager, { domainFilter, status } = {}) {
  try {
    const result = await dataManager.listHaEntities();
    const entities = Array.isArray(result?.entities) ? result.entities : [];
    // HA's own /api/states order is essentially registration/discovery
    // order, not anything a human would want to scan — confirmed a real
    // usability problem: a real account's own light entity sorted to the
    // very bottom of several hundred unrelated entities. Sorted once, here,
    // so every caller (this widget's own picker, the Macro editor's) gets
    // an alphabetized list for free rather than each re-sorting its own copy.
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
// "empty/null on failure, let the caller show its own error" convention
// getHaConnection/listHaEntities above already follow.
export async function fetchHaEntityState(dataManager, entityId) {
  try {
    return await dataManager.getHaEntityState(entityId);
  } catch (error) {
    return null;
  }
}

// Always opens the connect/edit modal, pre-filled with the current base URL
// (never the token — see connection-modal.js's own comment on why) — the
// explicit "manage this connection" entry point (a gear icon next to the
// Lighting widget's HA device picker), for fixing a wrong URL or
// disconnecting entirely. Confirmed a real gap without this: the only
// previous entry point (ensureHaConnection below) silently no-ops once
// already configured, so a typo'd/wrong base URL (e.g. localhost used where
// a real LAN IP was needed) had no way to be corrected short of clearing the
// row directly in the database. Leaving the token field blank on an edit
// keeps whatever's already saved (server/app.py's own
// handle_save_ha_connection) — no need to re-paste a long-lived access
// token just to fix the URL.
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

// Prompts to connect only if not already configured; resolves true the
// moment a connection exists (already configured, or just saved this run),
// false if the GM cancelled. Every entry point that just needs SOME
// connection to exist (the Lighting widget's "Add an HA light," the Macro
// editor's entity picker) calls this rather than each keeping its own "are
// we connected yet" gate. Use manageHaConnection above instead when the
// intent is specifically to view/edit/disconnect an existing one.
export async function ensureHaConnection({ dataManager, status }) {
  const existing = await getHaConnection(dataManager);
  if (existing.configured) return true;
  return manageHaConnection({ dataManager, status });
}

// --- Macro action support (common/js/lib/widgets/macro-runner.js) ---------
//
// Generic enough to cover both "control a device" and "trigger a routine":
// turnOn/turnOff/toggle call HA's own domain-agnostic homeassistant.*
// services (works across lights, switches, scripts, scenes — running a
// script or activating a scene IS "turn on" in HA's own model), and
// callService is the escape hatch for anything domain-specific (a
// media_player command, automation.trigger, a climate temperature set) —
// same "basic controls + an Advanced JSON path for everything else" split
// wled.js's own widget already uses. No widget instance to route through
// (unlike wled/soundboard/combat's own macro actions) — HA has no on-screen
// card of its own whose state would need refreshing after a command, so
// this is a plain standalone call every time, same shape as
// runBrowserMacroAction/runGamelogMacroAction in macro-runner.js.
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
