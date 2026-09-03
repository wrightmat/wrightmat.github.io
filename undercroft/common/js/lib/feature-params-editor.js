// Shared weapon-attack/rider/save-effect/`options`-menu/tier/generic-
// active-params editor UI for a selected Feature's per-record numbers —
// shared by Crucible and Vault so a rider kind or params shape change never
// needs syncing across two copies.
//
// Which TIER of a Feature's `tiers` array a record uses is editable here
// (renderFeatureTierEditor) — a real UI for `record.featureTiers[feature.id]`.
// Authoring the tiers array itself is still Loom-only, same as every other
// structural edit to a shared Feature's definition.
//
// Every dependency on a specific tool's own module-level state is injected
// via `createFeatureParamsEditor(hooks)` rather than hardcoded — this file
// knows nothing about Crucible's or Vault's own selection state.
import { createIconButton } from "./ui-components.js";
import { disposeTooltips, refreshTooltips } from "./tooltips.js";
import { setElementVisible } from "./dom.js";

// Small local field-building helpers — every editor below needs several.
function featureParamFieldRow(labelText, inputEl) {
  const wrap = document.createElement("div");
  wrap.className = "d-flex flex-column gap-1";
  const label = document.createElement("label");
  label.className = "form-label small mb-0 text-body-secondary";
  label.textContent = labelText;
  wrap.append(label, inputEl);
  return wrap;
}

function featureParamTextInput(value, onChange) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "form-control form-control-sm";
  input.value = value ?? "";
  input.addEventListener("change", () => onChange(input.value));
  return input;
}

function featureParamNumberInput(value, onChange) {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "form-control form-control-sm";
  if (value !== undefined && value !== null) input.value = value;
  input.addEventListener("change", () => onChange(input.value === "" ? undefined : Number(input.value)));
  return input;
}

function featureParamSelect(options, value, onChange) {
  const select = document.createElement("select");
  select.className = "form-select form-select-sm";
  options.forEach(({ value: optValue, label }) => {
    const option = document.createElement("option");
    option.value = optValue;
    option.textContent = label;
    option.selected = optValue === (value ?? "");
    select.appendChild(option);
  });
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function slugifyOptionName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "option";
}

// `hooks`:
//   - `getRecord()` — the record currently being edited (has `featureParams`).
//   - `onParamsChanged()` — called after a param patch is applied; the
//     caller owns persisting `getRecord()` and re-rendering whatever else
//     depends on it.
//   - `saveFeature(feature)` — async, persists a Feature-RECORD edit
//     (`options` only — everything else writes to the record's own
//     `featureParams`, never the shared Feature).
//   - `onFeatureSaved(feature)` — called after `saveFeature` resolves, so
//     the caller can re-render whatever else displays this Feature.
//   - `getAbilityFieldDefs()` — the active System's ability fields as
//     `[{key, label}]`, read live since it can load asynchronously.
//   - `onParamSelectionChanged(hasSelection)` — optional. Called whenever
//     the generic active-params grid's row selection changes — the caller
//     owns enabling/disabling its own "Delete Parameter" toolbar button.
export function createFeatureParamsEditor(hooks) {
  const { getRecord, onParamsChanged, saveFeature, onFeatureSaved, getAbilityFieldDefs, onParamSelectionChanged } = hooks;
  // Which param row (by key) of which Feature the generic active-params
  // grid currently has selected — the toolbar button that acts on this
  // lives outside this module, so this is that state's one real home.
  let selectedParamKey = null;
  let selectedParamFeature = null;

  function setSelectedParam(feature, key) {
    selectedParamFeature = feature;
    selectedParamKey = key;
    onParamSelectionChanged?.(Boolean(selectedParamKey));
  }

  // Deletes whichever param row is selected. No-op if nothing's selected,
  // so the caller's toolbar button can always be wired to this directly.
  function deleteSelectedParam() {
    if (!selectedParamFeature || !selectedParamKey) return;
    updateFeatureParams(selectedParamFeature, { [selectedParamKey]: undefined });
    const feature = selectedParamFeature;
    setSelectedParam(null, null);
    renderFeatureParamsEditor(feature, currentContainer);
  }

  // Patches `patch` onto the record's featureParams entry for `feature`
  // (creating it on first edit). `undefined`/empty-string DELETES the key
  // rather than storing a placeholder, keeping the params object honest
  // about which fields the GM has actually set.
  function updateFeatureParams(feature, patch) {
    const record = getRecord();
    if (!record) return;
    const featureParams = record.featureParams || (record.featureParams = {});
    const params = featureParams[feature.id] || (featureParams[feature.id] = {});
    Object.entries(patch).forEach(([key, value]) => {
      if (value === undefined || value === "") delete params[key];
      else params[key] = value;
    });
    onParamsChanged();
  }

  // Which of a shared Feature's `tiers` this record's copy uses —
  // `record.featureTiers[feature.id]`, the convention both Crucible's
  // monster records and Vault's effect records read.
  function updateFeatureTier(feature, tierId) {
    const record = getRecord();
    if (!record) return;
    record.featureTiers = { ...(record.featureTiers || {}) };
    if (tierId) record.featureTiers[feature.id] = tierId;
    else delete record.featureTiers[feature.id];
    onParamsChanged();
  }

  function renderFeatureTierEditor(feature) {
    const record = getRecord();
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const options = feature.tiers.map((tier) => ({ value: tier.id, label: tier.shortName ? `${tier.name} (${tier.shortName})` : tier.name }));
    const selected = record?.featureTiers?.[feature.id] || feature.tiers[0]?.id;
    wrapper.appendChild(
      featureParamFieldRow(
        "Tier",
        featureParamSelect(options, selected, (value) => {
          updateFeatureTier(feature, value);
          renderFeatureParamsEditor(feature, currentContainer);
        })
      )
    );
    // The selected tier's own `mechanics.text` (e.g. per-tier Minor/
    // Moderate/Severe/Extreme descriptions) had no UI surface before this —
    // a GM picking a tier had only its bare name to go on.
    const selectedTier = feature.tiers.find((tier) => tier.id === selected);
    const tierText = selectedTier?.mechanics?.text;
    if (tierText) {
      const description = document.createElement("p");
      description.className = "small text-body-secondary mb-0";
      description.textContent = tierText;
      wrapper.appendChild(description);
    }
    return wrapper;
  }

  // A closed, small vocabulary of param keys this editor recognizes as "an
  // ability score" and renders as a select from the active System's ability
  // fields — not a hardcoded per-Feature schema, just the one axis that's
  // genuinely System-defined vocabulary, not free text. Every other param
  // key gets a plain text/number field instead of a bespoke widget per name.
  const ABILITY_LIKE_PARAM_KEYS = new Set(["ability", "dcAbility", "saveAbility"]);

  // A JSON-text field for a param value that's an object/array (e.g.
  // Damage's `scaling: {by, values}`) — no per-shape schema to build a real
  // form from, so this shows/edits the raw JSON instead of silently
  // stringifying it (a plain text input would coerce an object to the
  // literal string "[object Object]" and save that back over the real
  // value). Invalid JSON is left uncommitted rather than guessed at — this
  // module has no toast/status hook to report a parse error through.
  function featureParamJsonTextarea(value, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "d-flex flex-column gap-1 flex-grow-1";
    const textarea = document.createElement("textarea");
    textarea.className = "form-control form-control-sm font-monospace";
    textarea.rows = Math.min(8, Math.max(3, JSON.stringify(value, null, 2).split("\n").length));
    textarea.value = JSON.stringify(value, null, 2);
    const errorText = document.createElement("div");
    errorText.className = "small text-danger d-none";
    errorText.textContent = "Invalid JSON — not saved until fixed.";
    textarea.addEventListener("change", () => {
      try {
        const parsed = JSON.parse(textarea.value);
        errorText.classList.add("d-none");
        onChange(parsed);
      } catch (error) {
        errorText.classList.remove("d-none");
      }
    });
    wrap.append(textarea, errorText);
    return wrap;
  }

  function featureParamBooleanSelect(value, onChange) {
    return featureParamSelect(
      [
        { value: "true", label: "True" },
        { value: "false", label: "False" },
      ],
      String(Boolean(value)),
      (next) => onChange(next === "true")
    );
  }

  // Damage/Healing's `scaling: {by, values: {level: dice}}` shape is common
  // enough to earn a real structured editor instead of raw JSON — a
  // level→dice table plus a By mode select. Any other object-shaped param
  // falls back to featureParamJsonTextarea below.
  function isScalingShape(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) && value.values && typeof value.values === "object";
  }

  // A minimal-footprint remove affordance — a bare "×" glyph, no button
  // chrome — for a row nested inside the already-narrow scaling table;
  // createIconButton's bordered-button style left no room for the Level input.
  function smallRedRemoveButton(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-link text-danger p-0 lh-1 border-0";
    button.style.fontSize = "1rem";
    button.style.textDecoration = "none";
    button.textContent = "×";
    button.setAttribute("aria-label", label);
    button.setAttribute("data-bs-toggle", "tooltip");
    button.setAttribute("data-bs-placement", "top");
    button.setAttribute("data-bs-title", label);
    button.addEventListener("click", onClick);
    return button;
  }

  function renderScalingParamEditor(feature, key, scaling) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const commit = (next) => updateFeatureParams(feature, { [key]: next });
    const refresh = () => renderFeatureParamsEditor(feature, currentContainer);

    wrapper.appendChild(
      featureParamFieldRow(
        "Scales By",
        featureParamSelect(
          [
            { value: "slot", label: "Spell Slot Level" },
            { value: "character-level", label: "Character Level" },
            { value: "flat", label: "Flat (no scaling)" },
          ],
          scaling.by || "flat",
          (value) => commit({ ...scaling, by: value })
        )
      )
    );

    const table = document.createElement("table");
    table.className = "table table-sm small align-middle mb-0";
    // Explicit widths (Level fixed, Dice flexible, remove-glyph minimal) —
    // an unconstrained 3-column table lets the browser starve any column.
    table.innerHTML = '<colgroup><col style="width: 3.5rem;"><col><col style="width: 1.25rem;"></colgroup>';
    const thead = document.createElement("thead");
    thead.innerHTML = '<tr><th scope="col">Level</th><th scope="col">Dice</th><th scope="col"></th></tr>';
    const tbody = document.createElement("tbody");
    table.append(thead, tbody);

    Object.entries(scaling.values)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .forEach(([level, dice]) => {
        const row = document.createElement("tr");
        const levelCell = document.createElement("td");
        levelCell.appendChild(
          featureParamNumberInput(Number(level), (nextLevel) => {
            if (nextLevel === undefined || String(nextLevel) === level) return;
            const nextValues = { ...scaling.values };
            delete nextValues[level];
            nextValues[String(nextLevel)] = dice;
            commit({ ...scaling, values: nextValues });
            refresh();
          })
        );
        const diceCell = document.createElement("td");
        diceCell.appendChild(featureParamTextInput(dice, (nextDice) => commit({ ...scaling, values: { ...scaling.values, [level]: nextDice } })));
        const removeCell = document.createElement("td");
        removeCell.appendChild(
          smallRedRemoveButton(`Remove level ${level}`, () => {
            const nextValues = { ...scaling.values };
            delete nextValues[level];
            commit({ ...scaling, values: nextValues });
            refresh();
          })
        );
        row.append(levelCell, diceCell, removeCell);
        tbody.appendChild(row);
      });
    wrapper.appendChild(table);

    const addRow = document.createElement("div");
    addRow.className = "d-flex align-items-end gap-2";
    const levelInput = document.createElement("input");
    levelInput.type = "number";
    levelInput.className = "form-control form-control-sm";
    levelInput.style.maxWidth = "4.5rem";
    const diceInput = document.createElement("input");
    diceInput.type = "text";
    diceInput.className = "form-control form-control-sm";
    diceInput.placeholder = "e.g. 2d6";
    const addButton = createIconButton({ icon: "tabler:plus", label: "Add level", variant: "outline-secondary" });
    addButton.addEventListener("click", () => {
      const level = levelInput.value.trim();
      const dice = diceInput.value.trim();
      if (!level || !dice) return;
      commit({ ...scaling, values: { ...scaling.values, [level]: dice } });
      refresh();
    });
    addRow.append(featureParamFieldRow("Level", levelInput), featureParamFieldRow("Dice", diceInput), addButton);
    wrapper.appendChild(addRow);

    return wrapper;
  }

  // The generic editor for `mechanics.type === "active"` — Vault's clause-
  // recognized spell/item Features, which have no fixed params schema the
  // way weapon-attack/save-effect do. Shown as a literal key/value grid
  // rather than a labeled form — a raw key name styled as a curated field
  // label would read as more structured than it is. Each row's value input
  // is picked by the stored value's JS type (scaling object → structured
  // editor, other object/array → raw JSON, boolean → select, number →
  // number input, ability-like key → ability select, otherwise plain text).
  //
  // Deleting a row is select-then-delete, not a per-row button: click a row
  // to select it, then the caller's "Delete Parameter" toolbar button
  // removes it — frees width for the Value column, which a per-row trash
  // icon squeezed badly for anything wider than a couple of characters.
  function renderGenericActiveParamsEditor(feature, params) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2 small";
    const abilityFieldDefs = getAbilityFieldDefs();

    const table = document.createElement("table");
    table.className = "table table-sm align-middle mb-0";
    // Key column kept narrow — a Value that's itself a nested table
    // (renderScalingParamEditor) needs the room in an already-narrow sidebar.
    table.innerHTML = '<colgroup><col style="width: 5.5rem;"><col></colgroup>';
    const thead = document.createElement("thead");
    thead.innerHTML = '<tr><th scope="col">Key</th><th scope="col">Value</th></tr>';
    const tbody = document.createElement("tbody");
    table.append(thead, tbody);

    Object.entries(params).forEach(([key, value]) => {
      const row = document.createElement("tr");
      row.dataset.paramKey = key;
      row.style.cursor = "pointer";
      row.classList.toggle("table-active", selectedParamFeature === feature && selectedParamKey === key);
      row.addEventListener("click", () => {
        setSelectedParam(feature, key);
        Array.from(tbody.querySelectorAll("tr")).forEach((entry) => entry.classList.toggle("table-active", entry === row));
      });

      const keyCell = document.createElement("td");
      keyCell.className = "font-monospace text-body-secondary align-middle text-truncate";
      keyCell.style.fontSize = "0.75rem";
      keyCell.textContent = key;

      const valueCell = document.createElement("td");
      const isAbilityLike = ABILITY_LIKE_PARAM_KEYS.has(key) && abilityFieldDefs.length > 0;
      const isScaling = key === "scaling" && isScalingShape(value);
      const isObjectLike = value !== null && typeof value === "object";
      const field = isScaling
        ? renderScalingParamEditor(feature, key, value)
        : isObjectLike
          ? featureParamJsonTextarea(value, (nextValue) => updateFeatureParams(feature, { [key]: nextValue }))
          : isAbilityLike
            ? featureParamSelect(
                abilityFieldDefs.map(({ key: abilityKey, label }) => ({ value: abilityKey, label })),
                value,
                (nextValue) => updateFeatureParams(feature, { [key]: nextValue })
              )
            : typeof value === "boolean"
              ? featureParamBooleanSelect(value, (nextValue) => updateFeatureParams(feature, { [key]: nextValue }))
              : typeof value === "number"
                ? featureParamNumberInput(value, (nextValue) => updateFeatureParams(feature, { [key]: nextValue }))
                : featureParamTextInput(value, (nextValue) => updateFeatureParams(feature, { [key]: nextValue }));
      valueCell.appendChild(field);

      row.append(keyCell, valueCell);
      tbody.appendChild(row);
    });

    wrapper.appendChild(table);

    const addRow = document.createElement("div");
    addRow.className = "d-flex align-items-end gap-2 border-top pt-2";
    const keyInput = document.createElement("input");
    keyInput.type = "text";
    keyInput.className = "form-control form-control-sm font-monospace";
    keyInput.placeholder = "new key";
    const valueInput = document.createElement("input");
    valueInput.type = "text";
    valueInput.className = "form-control form-control-sm";
    valueInput.placeholder = "value";
    const addButton = createIconButton({ icon: "tabler:plus", label: "Add parameter", variant: "outline-secondary" });
    addButton.addEventListener("click", () => {
      const key = keyInput.value.trim();
      if (!key || !valueInput.value.trim()) return;
      updateFeatureParams(feature, { [key]: valueInput.value });
      renderFeatureParamsEditor(feature, currentContainer);
    });
    addRow.append(featureParamFieldRow("Name", keyInput), featureParamFieldRow("Value", valueInput), addButton);
    wrapper.appendChild(addRow);

    return wrapper;
  }

  async function updateFeatureOptions(feature, options) {
    feature.options = options;
    await saveFeature(feature);
    onFeatureSaved(feature);
    renderFeatureParamsEditor(feature, currentContainer);
  }

  // The formula/literal mode toggle switches which fields are relevant
  // (formula mode's `ability` present means computed from an ability score).
  // A plain, honest reset rather than an attempted numeric conversion —
  // literal mode's damageDice has a modifier baked in as text (e.g.
  // "2d10 + 6"), formula mode's is a bare base die (e.g. "1d10").
  function renderWeaponAttackParamsEditor(feature, params) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";

    const isFormula = params.ability != null;
    const abilityFieldDefs = getAbilityFieldDefs();

    const modeSelect = featureParamSelect(
      [
        { value: "literal", label: "Literal (fixed numbers)" },
        { value: "formula", label: "Computed from ability score" },
      ],
      isFormula ? "formula" : "literal",
      (value) => {
        if (value === "formula") {
          updateFeatureParams(feature, { ability: params.ability || abilityFieldDefs[0]?.key || "strength", attackBonus: undefined });
        } else {
          updateFeatureParams(feature, { attackBonus: params.attackBonus ?? 0, ability: undefined });
        }
        renderFeatureParamsEditor(feature, currentContainer);
      }
    );
    wrapper.appendChild(featureParamFieldRow("Numbers", modeSelect));

    const grid = document.createElement("div");
    grid.className = "row g-2";
    const addField = (colClass, field) => {
      const col = document.createElement("div");
      col.className = colClass;
      col.appendChild(field);
      grid.appendChild(col);
    };

    addField(
      "col-6",
      featureParamFieldRow(
        "Kind",
        featureParamSelect(
          [
            { value: "Melee", label: "Melee" },
            { value: "Ranged", label: "Ranged" },
            { value: "MeleeOrRanged", label: "Melee or Ranged (finesse/thrown)" },
          ],
          params.kind || "Melee",
          (value) => {
            updateFeatureParams(feature, { kind: value });
            renderFeatureParamsEditor(feature, currentContainer);
          }
        )
      )
    );
    addField(
      "col-6",
      featureParamFieldRow(
        "Attack Kind",
        featureParamSelect(
          [
            { value: "Weapon", label: "Weapon" },
            { value: "Spell", label: "Spell" },
          ],
          params.attackKind || "Weapon",
          (value) => updateFeatureParams(feature, { attackKind: value })
        )
      )
    );
    if (params.kind === "MeleeOrRanged") {
      addField(
        "col-6",
        featureParamFieldRow("Melee Distance (ft.)", featureParamTextInput(params.meleeDistance, (value) => updateFeatureParams(feature, { meleeDistance: value })))
      );
      addField(
        "col-6",
        featureParamFieldRow("Range Distance (ft.)", featureParamTextInput(params.rangeDistance, (value) => updateFeatureParams(feature, { rangeDistance: value })))
      );
    } else {
      addField(
        "col-6",
        featureParamFieldRow(
          "Distance Label",
          featureParamSelect(
            [
              { value: "reach", label: "reach" },
              { value: "range", label: "range" },
            ],
            params.distanceLabel || "reach",
            (value) => updateFeatureParams(feature, { distanceLabel: value })
          )
        )
      );
      addField(
        "col-6",
        featureParamFieldRow("Distance (ft.)", featureParamTextInput(params.distance, (value) => updateFeatureParams(feature, { distance: value })))
      );
    }

    if (isFormula) {
      addField(
        "col-6",
        featureParamFieldRow(
          "Ability",
          featureParamSelect(
            abilityFieldDefs.map(({ key, label }) => ({ value: key, label })),
            params.ability,
            (value) => updateFeatureParams(feature, { ability: value })
          )
        )
      );
      addField(
        "col-6",
        featureParamFieldRow(
          "Damage Dice (base die, no modifier)",
          featureParamTextInput(params.damageDice, (value) => updateFeatureParams(feature, { damageDice: value }))
        )
      );
    } else {
      addField(
        "col-6",
        featureParamFieldRow("Attack Bonus", featureParamNumberInput(params.attackBonus, (value) => updateFeatureParams(feature, { attackBonus: value })))
      );
      addField(
        "col-6",
        featureParamFieldRow(
          "Damage Dice (incl. modifier)",
          featureParamTextInput(params.damageDice, (value) => updateFeatureParams(feature, { damageDice: value }))
        )
      );
    }
    addField(
      "col-12",
      featureParamFieldRow("Damage Type", featureParamTextInput(params.damageType, (value) => updateFeatureParams(feature, { damageType: value })))
    );

    wrapper.appendChild(grid);
    wrapper.appendChild(renderVersatileParamsEditor(feature, params));
    wrapper.appendChild(renderRiderParamsEditor(feature, params));
    return wrapper;
  }

  // The Versatile weapon property. A blank Damage Dice clears it (matching
  // updateFeatureParams' own "empty value deletes the key" rule).
  function renderVersatileParamsEditor(feature, params) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2 border-top pt-2 mt-1";
    const versatile = params.versatile || {};
    const enabled = Boolean(versatile.damageDice);

    const toggle = featureParamSelect(
      [
        { value: "", label: "None" },
        { value: "versatile", label: "Versatile (two-handed alternate damage)" },
      ],
      enabled ? "versatile" : "",
      (value) => updateFeatureParams(feature, { versatile: value ? { damageDice: "" } : undefined })
    );
    wrapper.appendChild(featureParamFieldRow("Versatile", toggle));

    if (enabled) {
      wrapper.appendChild(
        featureParamFieldRow(
          params.ability ? "Two-Handed Dice (base die, no modifier)" : "Two-Handed Dice (incl. modifier)",
          featureParamTextInput(versatile.damageDice, (value) => updateFeatureParams(feature, { versatile: { damageDice: value } }))
        )
      );
    }

    return wrapper;
  }

  // A rider clause tacked onto this attack/save-effect — lives in the
  // record's own params.rider, never on the shared Feature, since the same
  // base template can carry a different rider — or none — per record.
  // Kind switches which fields are relevant, same reset discipline as the
  // Literal/Formula toggle above.
  function updateRiderParams(feature, params, patch) {
    const nextRider = { ...(params.rider || {}), ...patch };
    Object.keys(nextRider).forEach((key) => {
      if (nextRider[key] === undefined || nextRider[key] === "") delete nextRider[key];
    });
    updateFeatureParams(feature, { rider: Object.keys(nextRider).length ? nextRider : undefined });
    renderFeatureParamsEditor(feature, currentContainer);
  }

  function renderRiderParamsEditor(feature, params) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2 border-top pt-2 mt-1";
    const rider = params.rider || {};
    const isSaveEffect = feature?.mechanics?.type === "save-effect";
    const abilityFieldDefs = getAbilityFieldDefs();

    const kindOptions = isSaveEffect
      ? [
          { value: "", label: "None" },
          { value: "fail-condition", label: "Fail Condition (replaces damage clause)" },
          { value: "trailing-note", label: "Trailing Note (appended after)" },
        ]
      : [
          { value: "", label: "None" },
          { value: "secondary-damage", label: "Secondary Damage" },
          { value: "save-or-condition", label: "Save-or-Condition" },
          { value: "save-or-damage", label: "Save-or-Damage" },
          { value: "charge-bonus", label: "Charge Bonus" },
          { value: "resistance-type-damage", label: "Secondary Damage (Resistance Type)" },
          { value: "condition-no-save", label: "Condition (No Save)" },
        ];
    const kindSelect = featureParamSelect(
      kindOptions,
      rider.kind || "",
      (value) =>
        updateRiderParams(feature, params, {
          kind: value || undefined,
          dice: undefined,
          damageType: undefined,
          saveAbility: undefined,
          saveDC: undefined,
          condition: undefined,
          duration: undefined,
          triggerDistance: undefined,
          conditionText: undefined,
          targetRestriction: undefined,
          trailingNote: undefined,
        })
    );
    wrapper.appendChild(featureParamFieldRow("Rider", kindSelect));

    if (rider.kind === "secondary-damage" || rider.kind === "charge-bonus") {
      const grid = document.createElement("div");
      grid.className = "row g-2";
      const addField = (colClass, field) => {
        const col = document.createElement("div");
        col.className = colClass;
        col.appendChild(field);
        grid.appendChild(col);
      };
      addField("col-6", featureParamFieldRow("Rider Dice", featureParamTextInput(rider.dice, (value) => updateRiderParams(feature, params, { dice: value }))));
      addField("col-6", featureParamFieldRow("Rider Damage Type", featureParamTextInput(rider.damageType, (value) => updateRiderParams(feature, params, { damageType: value }))));
      if (rider.kind === "charge-bonus") {
        addField(
          "col-12",
          featureParamFieldRow("Trigger Distance (ft., moved straight toward target)", featureParamNumberInput(rider.triggerDistance, (value) => updateRiderParams(feature, params, { triggerDistance: value })))
        );
      }
      wrapper.appendChild(grid);
    } else if (rider.kind === "resistance-type-damage") {
      wrapper.appendChild(featureParamFieldRow("Rider Dice", featureParamTextInput(rider.dice, (value) => updateRiderParams(feature, params, { dice: value }))));
    } else if (rider.kind === "save-or-condition") {
      const grid = document.createElement("div");
      grid.className = "row g-2";
      const addField = (colClass, field) => {
        const col = document.createElement("div");
        col.className = colClass;
        col.appendChild(field);
        grid.appendChild(col);
      };
      addField(
        "col-6",
        featureParamFieldRow(
          "Save Ability",
          featureParamSelect(abilityFieldDefs.map(({ key, label }) => ({ value: key, label })), rider.saveAbility, (value) => updateRiderParams(feature, params, { saveAbility: value }))
        )
      );
      addField("col-6", featureParamFieldRow("Save DC", featureParamNumberInput(rider.saveDC, (value) => updateRiderParams(feature, params, { saveDC: value }))));
      addField("col-6", featureParamFieldRow("Condition", featureParamTextInput(rider.condition, (value) => updateRiderParams(feature, params, { condition: value }))));
      addField("col-6", featureParamFieldRow("Duration (optional)", featureParamTextInput(rider.duration, (value) => updateRiderParams(feature, params, { duration: value }))));
      addField(
        "col-6",
        featureParamFieldRow(
          "Target Restriction (optional, default \"creature\")",
          featureParamTextInput(rider.targetRestriction, (value) => updateRiderParams(feature, params, { targetRestriction: value }))
        )
      );
      wrapper.appendChild(grid);
    } else if (rider.kind === "save-or-damage") {
      const grid = document.createElement("div");
      grid.className = "row g-2";
      const addField = (colClass, field) => {
        const col = document.createElement("div");
        col.className = colClass;
        col.appendChild(field);
        grid.appendChild(col);
      };
      addField(
        "col-6",
        featureParamFieldRow(
          "Save Ability",
          featureParamSelect(abilityFieldDefs.map(({ key, label }) => ({ value: key, label })), rider.saveAbility, (value) => updateRiderParams(feature, params, { saveAbility: value }))
        )
      );
      addField("col-6", featureParamFieldRow("Save DC", featureParamNumberInput(rider.saveDC, (value) => updateRiderParams(feature, params, { saveDC: value }))));
      addField("col-6", featureParamFieldRow("Rider Dice", featureParamTextInput(rider.dice, (value) => updateRiderParams(feature, params, { dice: value }))));
      addField("col-6", featureParamFieldRow("Rider Damage Type", featureParamTextInput(rider.damageType, (value) => updateRiderParams(feature, params, { damageType: value }))));
      addField(
        "col-12",
        featureParamFieldRow("Trailing Note (optional, appended after)", featureParamTextInput(rider.trailingNote, (value) => updateRiderParams(feature, params, { trailingNote: value })))
      );
      wrapper.appendChild(grid);
    } else if (rider.kind === "condition-no-save") {
      wrapper.appendChild(
        featureParamFieldRow(
          "Condition (e.g. \"can't regain hit points until the start of the creature's next turn\")",
          featureParamTextInput(rider.condition, (value) => updateRiderParams(feature, params, { condition: value }))
        )
      );
    } else if (rider.kind === "fail-condition") {
      wrapper.appendChild(
        featureParamFieldRow(
          "Condition Text (the full \"On a failed save, ... On a successful save, ...\" outcome, replacing the standard damage clause)",
          featureParamTextInput(rider.conditionText, (value) => updateRiderParams(feature, params, { conditionText: value }))
        )
      );
    } else if (rider.kind === "trailing-note") {
      wrapper.appendChild(
        featureParamFieldRow(
          "Trailing Note (appended after the standard damage/save sentence)",
          featureParamTextInput(rider.conditionText, (value) => updateRiderParams(feature, params, { conditionText: value }))
        )
      );
    }

    return wrapper;
  }

  // Field names/shape match parseSaveEffect (monster-feature-matching.js):
  // `dcAbility` is the acting record's ability driving the computed DC (5e's
  // breath-weapon convention defaults Constitution, but stays editable for a
  // homebrew System); `ability` is the target's saving-throw ability, never
  // computed. `lineWidth` only renders once Area Shape is "line".
  function renderSaveEffectParamsEditor(feature, params) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const grid = document.createElement("div");
    grid.className = "row g-2";
    const addField = (colClass, field) => {
      const col = document.createElement("div");
      col.className = colClass;
      col.appendChild(field);
      grid.appendChild(col);
    };
    const abilityFieldDefs = getAbilityFieldDefs();

    addField(
      "col-6",
      featureParamFieldRow(
        "Verb",
        featureParamSelect(
          ["exhales", "sprays", "releases", "emits", "breathes"].map((value) => ({ value, label: value })),
          params.verb || "exhales",
          (value) => updateFeatureParams(feature, { verb: value })
        )
      )
    );
    addField(
      "col-6",
      featureParamFieldRow("Substance", featureParamTextInput(params.substance, (value) => updateFeatureParams(feature, { substance: value })))
    );
    addField(
      "col-4",
      featureParamFieldRow("Area Size (ft.)", featureParamTextInput(params.areaSize, (value) => updateFeatureParams(feature, { areaSize: value })))
    );
    const areaShape = params.areaShape || "cone";
    addField(
      "col-4",
      featureParamFieldRow(
        "Area Shape",
        featureParamSelect(
          ["line", "cone", "sphere", "radius"].map((value) => ({ value, label: value })),
          areaShape,
          (value) => {
            updateFeatureParams(feature, { areaShape: value, ...(value === "line" ? {} : { lineWidth: undefined }) });
            renderFeatureParamsEditor(feature, currentContainer);
          }
        )
      )
    );
    if (areaShape === "line") {
      addField(
        "col-4",
        featureParamFieldRow("Line Width (ft.)", featureParamTextInput(params.lineWidth, (value) => updateFeatureParams(feature, { lineWidth: value })))
      );
    }
    addField(
      "col-6",
      featureParamFieldRow(
        "DC Ability (actor's)",
        featureParamSelect(
          abilityFieldDefs.map(({ key, label }) => ({ value: key, label })),
          params.dcAbility || "constitution",
          (value) => updateFeatureParams(feature, { dcAbility: value })
        )
      )
    );
    addField(
      "col-6",
      featureParamFieldRow(
        "Save Ability (target's)",
        featureParamSelect(
          abilityFieldDefs.map(({ key, label }) => ({ value: key, label })),
          params.ability,
          (value) => updateFeatureParams(feature, { ability: value })
        )
      )
    );
    addField(
      "col-6",
      featureParamFieldRow("Damage Dice", featureParamTextInput(params.damageDice, (value) => updateFeatureParams(feature, { damageDice: value })))
    );
    addField(
      "col-6",
      featureParamFieldRow("Damage Type", featureParamTextInput(params.damageType, (value) => updateFeatureParams(feature, { damageType: value })))
    );

    wrapper.appendChild(grid);
    wrapper.appendChild(renderRiderParamsEditor(feature, params));
    return wrapper;
  }

  // Options live on the Feature record itself (feature.options), not the
  // current record's featureParams — a departure from the weapon-attack/
  // save-effect editors above. Safe to edit directly rather than only from
  // Loom: an options-bearing Feature is always a record-specific one-off by
  // construction (saveOptionsFeature never shares one across records).
  function renderFeatureOptionsEditor(feature) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const options = Array.isArray(feature.options) ? feature.options : [];

    options.forEach((option, index) => {
      const row = document.createElement("div");
      row.className = "d-flex flex-column gap-1 border rounded-3 p-2";

      const nameRow = document.createElement("div");
      nameRow.className = "d-flex align-items-center gap-2";
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "form-control form-control-sm flex-grow-1";
      nameInput.placeholder = "Option name";
      nameInput.value = option?.name || "";
      nameInput.addEventListener("change", () => {
        const next = options.map((entry, i) => (i === index ? { ...entry, id: slugifyOptionName(nameInput.value), name: nameInput.value } : entry));
        updateFeatureOptions(feature, next);
      });
      const removeButton = createIconButton({
        icon: "tabler:trash",
        label: "Remove option",
        variant: "outline-danger",
        onClick: () => updateFeatureOptions(feature, options.filter((_, i) => i !== index)),
      });
      nameRow.append(nameInput, removeButton);

      const textInput = document.createElement("textarea");
      textInput.className = "form-control form-control-sm";
      textInput.rows = 2;
      textInput.placeholder = "Option text";
      textInput.value = option?.mechanics?.text || "";
      textInput.addEventListener("change", () => {
        const next = options.map((entry, i) => (i === index ? { ...entry, mechanics: { text: textInput.value } } : entry));
        updateFeatureOptions(feature, next);
      });

      row.append(nameRow, textInput);
      wrapper.appendChild(row);
    });

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "btn btn-outline-secondary btn-sm align-self-start";
    addButton.textContent = "Add option";
    addButton.addEventListener("click", () => {
      updateFeatureOptions(feature, [...options, { id: `option-${options.length + 1}`, name: "", mechanics: { text: "" } }]);
    });
    wrapper.appendChild(addButton);

    return wrapper;
  }

  // Tracks the container passed to the most recent top-level render call so
  // the recursive re-render calls scattered above always redraw into the
  // right place without every inner function needing its own parameter.
  let currentContainer = null;
  // Which Feature the params row-selection belongs to — reset only when a
  // genuinely different Feature is rendered, so an in-progress selection
  // survives its own edits but never leaks to the next selected Feature.
  let lastRenderedFeatureId = null;

  // Top-level entry point — shown for weapon-attack/save-effect (which keep
  // their numbers in featureParams), a Feature with a non-empty `options`
  // menu, a Feature with `tiers` (orthogonal to mechanics.type, checked
  // independently), or `mechanics.type === "active"` (see
  // renderGenericActiveParamsEditor for why that has no fixed schema).
  // `container` is hidden entirely when nothing applies.
  function renderFeatureParamsEditor(feature, container) {
    currentContainer = container;
    if (!container) return;
    if (feature?.id !== lastRenderedFeatureId) {
      lastRenderedFeatureId = feature?.id ?? null;
      setSelectedParam(null, null);
    }
    const type = feature?.mechanics?.type;
    const isWeaponAttack = type === "weapon-attack";
    const isSaveEffect = type === "save-effect";
    const isActive = type === "active";
    const hasOptions = Array.isArray(feature?.options) && feature.options.length > 0;
    const hasTiers = Array.isArray(feature?.tiers) && feature.tiers.length > 0;
    const record = getRecord();
    const shouldShow = Boolean(record) && (isWeaponAttack || isSaveEffect || hasOptions || isActive || hasTiers);
    setElementVisible(container, shouldShow, "flex");
    // Disposed before either wipe — the scaling row's remove "×" carries a
    // real tooltip, and this rebuilds on every feature-params edit.
    disposeTooltips(container);
    if (!shouldShow) {
      container.innerHTML = "";
      return;
    }

    container.innerHTML = "";
    if (hasTiers) container.appendChild(renderFeatureTierEditor(feature));
    if (hasOptions) {
      container.appendChild(renderFeatureOptionsEditor(feature));
    } else if (isWeaponAttack || isSaveEffect) {
      const params = record.featureParams?.[feature.id] || {};
      container.appendChild(isWeaponAttack ? renderWeaponAttackParamsEditor(feature, params) : renderSaveEffectParamsEditor(feature, params));
    } else if (isActive) {
      const params = record.featureParams?.[feature.id] || {};
      container.appendChild(renderGenericActiveParamsEditor(feature, params));
    }
    refreshTooltips(container);
  }

  return { renderFeatureParamsEditor, deleteSelectedParam };
}
