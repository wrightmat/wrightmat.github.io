// The shared "Relationships" list editor — one row per `relationship`
// Library record touching the current record (either direction), plus an
// "Add a relationship" row. Backs Forge's NPCs first, then every other tool
// relationship-graph.js's own header comment lists. Rebuilt fresh on every
// render() call, same "no diffing" convention every generator tool in this
// suite already follows for its own reference lists (Sanctum's Assets/Needs,
// Crucible's recipe slots, ...).
import { createListRow, createIconButton } from "./ui-components.js";
import { openContentPicker } from "./widgets/content-picker.js";
import { buildKindToolUrl, kindToolLabel } from "./kind-tool-route.js";
import {
  fetchEdgesTouching,
  saveRelationship,
  deleteRelationship,
  resolveLabelsForTargets,
  loadKindLabels,
} from "./relationship-graph.js";
import { disposeTooltips, refreshTooltips, updateTooltipContent } from "./tooltips.js";

function edgeOtherEnd(edge, sourceKind, sourceId) {
  const outgoing = edge.fromKind === sourceKind && edge.fromId === sourceId;
  return { outgoing, kind: outgoing ? edge.toKind : edge.fromKind, id: outgoing ? edge.toId : edge.fromId };
}

// renderRelationshipEditor({container, sourceKind, sourceId, targetKinds,
// typeSuggestions, dataManager, status, onChange}) — targetKinds is
// {id, label}[], the kinds this tool's own Add row offers (Forge: npc/
// location/monster/character, not wonder/template); typeSuggestions is a
// plain string[] for the type input's <datalist>, never a hard enum.
// `onChange` fires after every add/remove so the caller can refresh whatever
// else depends on this record's own relationships (e.g. its Graph toggle).
// Re-fetches its own edges on every call — cheap (one `relationship` list
// fetch), and keeps this component stateless between renders the same way
// every other list-editing section in this suite already is.
export async function renderRelationshipEditor({
  container,
  sourceKind,
  sourceId,
  targetKinds = [],
  typeSuggestions = [],
  dataManager,
  status,
  onChange,
} = {}) {
  if (!container || !sourceKind || !sourceId || !dataManager) return;
  disposeTooltips(container);
  container.innerHTML = "";

  const listMount = document.createElement("div");
  listMount.className = "d-flex flex-column gap-1";
  container.appendChild(listMount);

  const edges = await fetchEdgesTouching(dataManager, { kind: sourceKind, id: sourceId });
  const otherEndTargets = edges.map((edge) => edgeOtherEnd(edge, sourceKind, sourceId));
  const [labels, kindLabels] = await Promise.all([
    resolveLabelsForTargets(dataManager, otherEndTargets),
    loadKindLabels(),
  ]);

  if (!edges.length) {
    listMount.innerHTML = '<p class="small text-body-secondary mb-0">No relationships yet.</p>';
  } else {
    edges.forEach((edge) => {
      const other = edgeOtherEnd(edge, sourceKind, sourceId);
      const otherLabel = labels.get(`${other.kind}:${other.id}`) || other.id;
      // The entity TYPE ("NPC," "Location"), not which tool owns it
      // ("Forge," "Sanctum") — kindToolLabel stays reserved for the Open
      // action below, a genuinely different label for a genuinely
      // different purpose (which tool to open, not what this thing is).
      const otherKindLabel = kindLabels[other.kind] || other.kind;
      const otherToolLabel = kindToolLabel(other.kind) || other.kind;
      const detailParts = [`${otherLabel} (${otherKindLabel})`];
      if (edge.label) detailParts.push(edge.label);
      if (edge.value) detailParts.push(`Value: ${edge.value}`);
      const actions = [];
      const url = buildKindToolUrl(other.kind, other.id);
      if (url) {
        actions.push({
          icon: "tabler:external-link",
          label: `Open in ${otherToolLabel}`,
          onClick: () => window.open(url, "_blank", "noopener,noreferrer"),
        });
      }
      const row = createListRow({
        title: other.outgoing ? `${edge.type || "Related to"} →` : `← ${edge.type || "Related to"}`,
        description: detailParts.join(" — "),
        actions,
        onRemove: async () => {
          try {
            await deleteRelationship(dataManager, edge.id);
          } catch (error) {
            status?.show?.(error?.message || "Unable to remove that relationship.", { type: "error" });
            return;
          }
          await onChange?.();
        },
        removeLabel: "Remove relationship",
      });
      listMount.appendChild(row);
    });
  }

  // --- Add a relationship -------------------------------------------------
  // Three rows: [target kind] [search icon] [Type input] [picked-target
  // feedback] genuinely all on the first line (flex-nowrap — every element
  // that needs to give up space gets an explicit min-width: 0, since a flex
  // item's default min-width is its own content size, which is what was
  // forcing Type/the picked-target label onto their own line before), then
  // [Note] [Value] each exactly half width on the second row, then the Add
  // button on its own third row. Same layout in every tool that mounts this
  // editor.
  const addWrap = document.createElement("div");
  addWrap.className = "d-flex flex-column gap-2 mt-2";

  let pickedTarget = null; // {kind, id, name} | null

  const pickerRow = document.createElement("div");
  pickerRow.className = "d-flex flex-nowrap align-items-center gap-1";

  const kindSelect = document.createElement("select");
  kindSelect.className = "form-select form-select-sm flex-shrink-0";
  kindSelect.style.width = "7rem";
  targetKinds.forEach((kind) => {
    const option = document.createElement("option");
    option.value = kind.id;
    option.textContent = kind.label || kind.id;
    kindSelect.appendChild(option);
  });
  pickerRow.appendChild(kindSelect);

  const pickButton = createIconButton({
    icon: "tabler:search",
    label: "Choose a target",
    className: "flex-shrink-0",
    onClick: async () => {
      const targetKind = kindSelect.value;
      const kindLabel = targetKinds.find((entry) => entry.id === targetKind)?.label || targetKind;
      const id = await openContentPicker({
        dataManager,
        kind: targetKind,
        title: `Choose a ${kindLabel}`,
        excludeIds: targetKind === sourceKind ? [sourceId] : [],
      });
      if (!id) return;
      // A single known id — dataManager.get() itself already checks local
      // before remote, so this resolves an anonymous GM's own local-only
      // pick correctly with no extra local-vs-remote branching needed here.
      const result = await dataManager.get(targetKind, id, { preferLocal: true }).catch(() => null);
      const record = result?.payload || {};
      const name = record?.data?.name || record?.name || record?.title || id;
      pickedTarget = { kind: targetKind, id, name };
      pickedLabelEl.textContent = `${name} (${kindLabel})`;
      updateTooltipContent(pickedLabelEl, pickedLabelEl.textContent);
      addButton.disabled = !typeInput.value.trim();
    },
  });
  pickerRow.appendChild(pickButton);

  const typeInput = document.createElement("input");
  typeInput.type = "text";
  // Bounded, not flex-grow-1 — Type is a short word/phrase ("Member of"),
  // it doesn't need to claim leftover row space at the picked-target
  // label's expense the way an unbounded grow did.
  typeInput.className = "form-control form-control-sm flex-shrink-1";
  typeInput.style.minWidth = "0";
  typeInput.style.flexBasis = "7rem";
  typeInput.placeholder = "Type (e.g. Member of)";
  typeInput.setAttribute("list", `relationship-type-suggestions-${sourceKind}`);
  const datalist = document.createElement("datalist");
  datalist.id = `relationship-type-suggestions-${sourceKind}`;
  typeSuggestions.forEach((suggestion) => {
    const option = document.createElement("option");
    option.value = suggestion;
    datalist.appendChild(option);
  });
  pickerRow.append(typeInput, datalist);

  const pickedLabelEl = document.createElement("span");
  // flex-grow-1 — the picked-target name gets whatever room Type doesn't
  // need, instead of sitting pinned to a small flex-basis while Type
  // ballooned. Still truncates with an ellipsis (not wrap/overflow) once
  // the row is genuinely out of room; a tooltip (kept in sync via
  // updateTooltipContent alongside textContent above) surfaces the
  // untruncated name on hover.
  pickedLabelEl.className = "small text-body-secondary text-truncate flex-grow-1 flex-shrink-1";
  pickedLabelEl.style.minWidth = "0";
  pickedLabelEl.textContent = "No target chosen yet.";
  pickerRow.appendChild(pickedLabelEl);
  addWrap.appendChild(pickerRow);

  // Bootstrap's own grid (not plain flex + width%) — the only way to get a
  // guaranteed exact 50/50 split regardless of how much longer one
  // placeholder's text is than the other's.
  const detailRow = document.createElement("div");
  detailRow.className = "row g-1";
  const labelCol = document.createElement("div");
  labelCol.className = "col-6";
  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.className = "form-control form-control-sm";
  labelInput.placeholder = "Note (optional)";
  labelCol.appendChild(labelInput);
  const valueCol = document.createElement("div");
  valueCol.className = "col-6";
  const valueInput = document.createElement("input");
  valueInput.type = "text";
  valueInput.className = "form-control form-control-sm";
  valueInput.placeholder = "Value (optional — e.g. Friendly)";
  valueCol.appendChild(valueInput);
  detailRow.append(labelCol, valueCol);
  addWrap.appendChild(detailRow);

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "btn btn-outline-primary btn-sm align-self-start";
  addButton.textContent = "Add relationship";
  addButton.disabled = true;
  typeInput.addEventListener("input", () => {
    addButton.disabled = !pickedTarget || !typeInput.value.trim();
  });
  addButton.addEventListener("click", async () => {
    if (!pickedTarget || !typeInput.value.trim()) return;
    try {
      await saveRelationship(dataManager, {
        fromKind: sourceKind,
        fromId: sourceId,
        toKind: pickedTarget.kind,
        toId: pickedTarget.id,
        type: typeInput.value.trim(),
        label: labelInput.value.trim(),
        value: valueInput.value.trim(),
      });
      await onChange?.();
    } catch (error) {
      status?.show?.(error?.message || "Unable to save that relationship.", { type: "error" });
    }
  });
  addWrap.appendChild(addButton);

  container.appendChild(addWrap);
  refreshTooltips(container);
}
