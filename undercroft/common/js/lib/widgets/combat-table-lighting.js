// Table lighting for the Combat Tracker — lights the current combatant's
// segment on a WLED strip around the table (and optionally whoever is on
// deck). This file is the tracker-independent half: the saved settings'
// shape, which segment and look a combatant gets, the scene for one moment
// of combat, and the settings panel. combat-tracker.js owns watching the
// encounter and sending the scenes.
//
// Settings live in the tracker widget's own contentRef under `lighting`:
//   enabled, deviceIp (a saved WLED device), gmSegment,
//   assignments {characterId: segmentName}, looks {segmentName: look},
//   onDeck {enabled, look}
// Assignments are keyed by CHARACTER id, so seats are set once and survive
// every encounter; segments are named, never numbered (ids shift).
import { el } from "../dom.js";
import { createCollapseToggleButton, setElementCollapsed } from "../collapsible.js";
import { createIconButton } from "../ui-components.js";
import { fetchWledDevices, loadWledChoices } from "./wled.js";
import { createCheck, fillChoiceSelect } from "./wled-look-fields.js";
import { createWledControl } from "./wled-control.js";

// WLED's "Solid" is always effect 0 — a fixed firmware ID, not a per-device
// list position — so the default look needs no lookup on the device.
const SOLID_EFFECT = 0;
const PLAYER_COLOR = "#00ff00";
const GM_COLOR = "#ff0000";
// On deck starts as a copy of the segment's own turn look at 10% brightness
// (26/255) — shown in that segment's On deck fields, never applied out of sight.
const ON_DECK_BRIGHTNESS = 26;

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function normalizeLighting(raw) {
  const source = plainObject(raw);
  const assignments = {};
  Object.entries(plainObject(source.assignments)).forEach(([characterId, segment]) => {
    if (typeof segment === "string" && segment) assignments[characterId] = segment;
  });
  const onDeck = plainObject(source.onDeck);
  return {
    enabled: Boolean(source.enabled),
    deviceIp: typeof source.deviceIp === "string" ? source.deviceIp : "",
    gmSegment: typeof source.gmSegment === "string" ? source.gmSegment : "",
    assignments,
    looks: plainObject(source.looks),
    onDeck: { enabled: Boolean(onDeck.enabled), looks: plainObject(onDeck.looks) },
  };
}

// Every segment this feature owns — the only ones it ever switches off, so a
// decorative or base-layer segment on the same strip is left alone.
export function tableSegmentNames(lighting) {
  return Array.from(new Set([lighting.gmSegment, ...Object.values(lighting.assignments)].filter(Boolean)));
}

// Which segment a combatant lights, or null for "nothing". A hidden
// combatant never lights anything (that would tell the table something is
// there), and a PC with no assigned seat has no segment to light. Everyone
// who isn't a PC — monsters, NPCs, freeform entries — shares the GM segment.
export function segmentForCombatant(combatant, lighting) {
  if (!combatant || combatant.hidden) return null;
  if (combatant.isPc || combatant.refKind === "character") {
    return (combatant.refId && lighting.assignments[combatant.refId]) || null;
  }
  return lighting.gmSegment || null;
}

// What a segment's look starts as: a real primary color (green for players,
// red for the GM) and full brightness. The panel shows exactly these values
// in its fields, and they're saved when a segment is assigned — a default
// the author can't see would be one they can't change. (The effect is
// WLED's Solid, which the Effect field's "Default (Solid)" option names.)
export function defaultSegmentLook(lighting, segmentName) {
  return { col: [segmentName === lighting.gmSegment ? GM_COLOR : PLAYER_COLOR], bri: 255 };
}

// The look as the panel shows it: what's saved, or the starting values for a
// segment that has nothing saved yet.
export function segmentLookForEditing(lighting, segmentName) {
  const saved = lighting.looks[segmentName];
  return saved && typeof saved === "object" ? saved : defaultSegmentLook(lighting, segmentName);
}

// What gets sent: exactly the look shown, nothing implied beyond the Solid
// effect that "Default" names.
export function activeLook(lighting, segmentName) {
  const look = segmentLookForEditing(lighting, segmentName);
  return { fx: look.fx ?? SOLID_EFFECT, pal: look.pal, col: look.col, bri: look.bri };
}

// A segment's on-deck look as the panel shows it: what's saved, or — until
// the author edits it — a copy of the segment's current turn look at 10%
// brightness, so it follows the turn look it was derived from until it's
// changed. Editing it saves the whole look, detaching it from the turn look.
export function onDeckLookForEditing(lighting, segmentName) {
  const saved = lighting.onDeck.looks[segmentName];
  if (saved && typeof saved === "object") return saved;
  return { ...segmentLookForEditing(lighting, segmentName), bri: ON_DECK_BRIGHTNESS };
}

function onDeckLook(lighting, segmentName) {
  const look = onDeckLookForEditing(lighting, segmentName);
  return { fx: look.fx ?? SOLID_EFFECT, pal: look.pal, col: look.col, bri: look.bri };
}

// What the table should show right now: the active combatant's segment lit
// (plus the next combatant's on deck, when enabled), every other table
// segment off. An empty `lit` means "dark" — combat stopped, or the turn
// belongs to someone with no segment or who's hidden. `key` changes exactly
// when the scene would, including any settings edit, so the caller can send
// only on a real change.
export function computeTableScene(encounter, lighting) {
  const combatants = Array.isArray(encounter?.combatants) ? encounter.combatants : [];
  const started = Boolean(encounter?.started) && combatants.length > 0;
  const active = started ? combatants[encounter.activeIndex] : null;
  const activeName = segmentForCombatant(active, lighting);
  const lit = [];
  let next = null;
  if (activeName) {
    lit.push({ name: activeName, look: activeLook(lighting, activeName) });
    if (lighting.onDeck.enabled && combatants.length > 1) {
      next = combatants[(encounter.activeIndex + 1) % combatants.length];
      const nextName = segmentForCombatant(next, lighting);
      if (nextName && nextName !== activeName) lit.push({ name: nextName, look: onDeckLook(lighting, nextName) });
    }
  }
  const litNames = new Set(lit.map((entry) => entry.name));
  return {
    key: JSON.stringify([encounter?.id || "", started, active?.id || "", next?.id || "", lighting]),
    lit,
    off: tableSegmentNames(lighting).filter((name) => !litNames.has(name)),
  };
}

// A single segment lit on its own (the panel's test button) — the same shape
// as a scene, so the tracker sends it the same way.
export function previewScene(lighting, segmentName) {
  return {
    lit: [{ name: segmentName, look: activeLook(lighting, segmentName) }],
    off: tableSegmentNames(lighting).filter((name) => name !== segmentName),
  };
}

function makeSelect() {
  const select = document.createElement("select");
  select.className = "form-select form-select-sm";
  return select;
}

// The settings panel. `lighting` is the normalized settings; every edit goes
// out through `onChange(nextLighting)` and the caller re-renders with the
// result, so nothing here keeps its own copy. `roster` is [{id, name}] —
// everyone who might need a seat. `openKeys` is a Set the caller owns, so a
// look editor that was open stays open across those re-renders.
export function createTableLightingPanel({ lighting, roster = [], dataManager, openKeys, onChange, onTest, onClear } = {}) {
  const root = el("div", "border rounded p-2 d-flex flex-column gap-2");
  const commit = (patch) => onChange({ ...lighting, ...patch });
  // Assigning a segment saves its starting look with it (see
  // defaultSegmentLook), so what's stored is what the fields show.
  const assignSegment = (patch, segmentName) => {
    const next = { ...lighting, ...patch };
    if (segmentName && !(next.looks[segmentName] && typeof next.looks[segmentName] === "object")) {
      next.looks = { ...next.looks, [segmentName]: defaultSegmentLook(next, segmentName) };
    }
    onChange(next);
  };

  const devicesPromise = fetchWledDevices(dataManager)
    .then((devices) => devices.filter((device) => device.type !== "haLight"))
    .catch(() => []);
  // The saved device entry (not just its IP) so the choices include its
  // remembered segment layout, not only whatever the strip reports right now.
  const loadChoices = () =>
    devicesPromise.then((devices) => {
      const device = devices.find((entry) => entry.ip === lighting.deviceIp);
      return device ? loadWledChoices(device) : {};
    });

  const head = el("div", "d-flex align-items-center justify-content-between gap-2");
  const title = el("div", "d-flex align-items-center gap-2");
  const help = el("span", "align-middle");
  help.setAttribute("data-help-topic", "dashboard.tableLighting");
  help.setAttribute("data-help-insert", "replace");
  title.append(el("span", "fw-semibold small", "Table lighting"), help);
  const headActions = el("div", "d-flex align-items-center gap-3");
  headActions.append(
    createCheck("Light the table by turn", lighting.enabled, (checked) => commit({ enabled: checked })),
    createIconButton({
      icon: "tabler:bulb-off",
      label: "Turn the table segments off",
      attrs: { disabled: !lighting.deviceIp },
      onClick: () => onClear?.(),
    })
  );
  head.append(title, headActions);
  root.appendChild(head);

  const deviceSelect = makeSelect();
  fillChoiceSelect(deviceSelect, { blank: "Select a device…", options: [], current: lighting.deviceIp });
  deviceSelect.addEventListener("change", () => commit({ deviceIp: deviceSelect.value }));
  void devicesPromise.then((devices) =>
    fillChoiceSelect(deviceSelect, {
      blank: devices.length ? "Select a device…" : "No devices saved yet — add one in the Lighting widget",
      options: devices.map((device) => ({ value: device.ip, label: device.label || device.ip })),
      current: lighting.deviceIp,
    })
  );
  const deviceRow = el("div", "d-flex flex-column gap-1");
  deviceRow.append(el("label", "form-label small mb-0 text-body-secondary", "Lighting device"), deviceSelect);
  root.appendChild(deviceRow);

  const segmentSelect = (current, onPick) => {
    const select = makeSelect();
    const blank = "No segment";
    fillChoiceSelect(select, { blank, options: [], current: current || "" });
    select.addEventListener("change", () => onPick(select.value));
    loadChoices()
      .then((choices) =>
        fillChoiceSelect(select, {
          blank,
          options: (choices.segmentNames || []).map((name) => ({ value: name, label: name })),
          current: current || "",
        })
      )
      .catch(() => {});
    return select;
  };

  // One seat: who, which segment, a test button, and (collapsed) that
  // segment's look. The look is stored by SEGMENT name, so it follows the
  // segment if the seat is reassigned.
  const buildRow = ({ key, label, segmentName, onPick }) => {
    const open = openKeys?.has(key) || false;
    const body = el("div", "d-flex flex-column gap-2 ps-4");
    setElementCollapsed(body, !open);
    const { button: toggle } = createCollapseToggleButton({
      label: `${label} look`,
      collapsed: !open,
      onToggle: (collapsed) => {
        if (collapsed) openKeys?.delete(key);
        else openKeys?.add(key);
        setElementCollapsed(body, collapsed);
      },
    });
    const name = el("span", "small text-truncate", label);
    name.style.width = "7rem";
    name.style.flexShrink = "0";
    name.title = label;
    const select = segmentSelect(segmentName, onPick);
    select.classList.add("flex-grow-1");
    const line = el("div", "d-flex align-items-center gap-2");
    line.append(
      toggle,
      name,
      select,
      createIconButton({
        icon: "tabler:bulb",
        label: "Light this segment",
        attrs: { disabled: !segmentName || !lighting.deviceIp },
        onClick: () => onTest?.(segmentName),
      })
    );
    if (segmentName) {
      // Both looks are headed only when there are two to tell apart.
      const heading = (text) => el("div", "small fw-semibold text-body-secondary", text);
      if (lighting.onDeck.enabled) body.appendChild(heading("Their turn"));
      body.appendChild(
        createWledControl({
          value: segmentLookForEditing(lighting, segmentName),
          loadChoices,
          stateKey: `table:turn:${segmentName}`,
          sections: { look: true },
          labels: { effectBlank: "Default (Solid)", paletteBlank: "Default" },
          onChange: (look) => commit({ looks: { ...lighting.looks, [segmentName]: look } }),
        })
      );
      if (lighting.onDeck.enabled) {
        body.appendChild(heading("On deck"));
        body.appendChild(
          createWledControl({
            value: onDeckLookForEditing(lighting, segmentName),
            loadChoices,
            stateKey: `table:ondeck:${segmentName}`,
            sections: { look: true },
            labels: { effectBlank: "Default (Solid)", paletteBlank: "Default" },
            onChange: (look) =>
              commit({ onDeck: { ...lighting.onDeck, looks: { ...lighting.onDeck.looks, [segmentName]: look } } }),
          })
        );
      }
    } else {
      body.appendChild(el("span", "small text-body-secondary", "Pick a segment to set its look."));
    }
    const row = el("div", "d-flex flex-column gap-2");
    row.append(line, body);
    return row;
  };

  root.appendChild(
    buildRow({
      key: "gm",
      label: "GM & monsters",
      segmentName: lighting.gmSegment,
      onPick: (value) => assignSegment({ gmSegment: value }, value),
    })
  );
  if (roster.length) {
    roster.forEach((member) => {
      root.appendChild(
        buildRow({
          key: `pc:${member.id}`,
          label: member.name,
          segmentName: lighting.assignments[member.id] || "",
          onPick: (value) => {
            const assignments = { ...lighting.assignments };
            if (value) assignments[member.id] = value;
            else delete assignments[member.id];
            assignSegment({ assignments }, value);
          },
        })
      );
    });
  } else {
    root.appendChild(el("span", "small text-body-secondary", "No party members yet — add the party to this campaign or encounter."));
  }

  root.appendChild(
    createCheck("Light whoever is on deck", lighting.onDeck.enabled, (checked) =>
      commit({ onDeck: { ...lighting.onDeck, enabled: checked } })
    )
  );
  return root;
}
