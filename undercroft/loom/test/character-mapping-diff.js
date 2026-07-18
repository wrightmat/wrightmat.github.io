import { applyMapping } from "../../common/js/lib/mapping-engine.js";
import { LOOKUP_TABLES } from "../../common/js/lib/lookup-tables.js";
import { customFunctions } from "../../common/js/lib/mapping-custom-functions.js";

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((entry, index) => deepEqual(entry, b[index]));
  }
  if (typeof a === "object") {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length || keysA.some((key, index) => key !== keysB[index])) return false;
    return keysA.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

// ddbParseCharacter's buildSpells returns an array of arrays ordered by
// ascending level; the mapping definition's group-by step produces an object
// keyed by level instead (arguably more useful for template binding, e.g.
// @spells.1) — normalize both to the same {level: [...]} shape before diffing
// so this deliberate shape improvement isn't reported as a mismatch.
function spellsByLevel(spellsArrayOfArrays) {
  const result = {};
  (spellsArrayOfArrays || []).forEach((levelGroup) => {
    (levelGroup || []).forEach((spell) => {
      const key = String(spell.level ?? 0);
      (result[key] = result[key] || []).push(spell);
    });
  });
  return result;
}

const CHECKS = [
  { label: "identity.id", legacy: (o) => o.identity.id, mapping: (o) => o.identity.id },
  { label: "identity.userId", legacy: (o) => o.identity.userId, mapping: (o) => o.identity.userId },
  { label: "identity.username", legacy: (o) => o.identity.username, mapping: (o) => o.identity.username },
  { label: "identity.name", legacy: (o) => o.identity.name, mapping: (o) => o.identity.name },
  { label: "identity.level", legacy: (o) => o.identity.level, mapping: (o) => o.identity.level },
  { label: "identity.classes", legacy: (o) => o.identity.classes, mapping: (o) => o.identity.classes },
  { label: "proficiency", legacy: (o) => o.proficiency, mapping: (o) => o.proficiency },
  { label: "conditions", legacy: (o) => o.conditions, mapping: (o) => o.conditions },
  { label: "abilities", legacy: (o) => o.abilities, mapping: (o) => o.abilities },
  { label: "saves", legacy: (o) => o.saves, mapping: (o) => o.saves },
  { label: "skills", legacy: (o) => o.skills, mapping: (o) => o.skills },
  { label: "currencies", legacy: (o) => o.currencies, mapping: (o) => o.currencies },
  { label: "background", legacy: (o) => o.background, mapping: (o) => o.background },
  { label: "deathSaves", legacy: (o) => o.deathSaves, mapping: (o) => o.deathSaves },
  {
    label: "notes (allies/backstory/enemies/organizations only)",
    legacy: (o) => ({
      allies: o.notes.allies,
      backstory: o.notes.backstory,
      enemies: o.notes.enemies,
      organizations: o.notes.organizations,
    }),
    mapping: (o) => o.notes,
  },
  { label: "traits", legacy: (o) => o.traits, mapping: (o) => o.traits },
  { label: "spells (normalized to {level: [...]})", legacy: (o) => spellsByLevel(o.spells), mapping: (o) => o.spells },
];

const NOT_ATTEMPTED = [
  "campaign, decorations, alignment",
  "initiative",
  "senses",
  "speeds",
  "ac",
  "hp",
  "feats",
  "proficiencies (categorized buckets)",
  "attacking, attacks",
  "limitedUses",
  "spellCasting (summary block; spellSaveDc/spellToHitBonus are computed inline per-spell instead)",
  "inventory",
  "identity.class / identity.levels.level_monk / identity.levels.level_multiclass / identity.inspiration",
];

async function main() {
  const rawSample = await fetch("fixtures/raw-character-sample.json").then((r) => r.json());
  const mappingDefinition = await fetch("../mappings/ddb-character.json").then((r) => r.json());

  const legacyOutput = window.ddbParseCharacter(rawSample);
  const mappingOutput = applyMapping(mappingDefinition, rawSample, {
    lookupTables: LOOKUP_TABLES,
    customFunctions,
  });

  document.getElementById("legacyOutput").textContent = JSON.stringify(legacyOutput, null, 2);
  document.getElementById("mappingOutput").textContent = JSON.stringify(mappingOutput, null, 2);

  const rows = CHECKS.map(({ label, legacy, mapping }) => {
    let legacyValue;
    let mappingValue;
    let error = null;
    try {
      legacyValue = legacy(legacyOutput);
    } catch (err) {
      error = `legacy accessor threw: ${err.message}`;
    }
    try {
      mappingValue = mapping(mappingOutput);
    } catch (err) {
      error = `${error ? error + "; " : ""}mapping accessor threw: ${err.message}`;
    }
    const matches = !error && deepEqual(legacyValue, mappingValue);
    return { label, matches, error, legacyValue, mappingValue };
  });

  const table = document.createElement("table");
  table.innerHTML =
    "<thead><tr><th>Section</th><th>Result</th><th>ddbParseCharacter</th><th>applyMapping</th></tr></thead>";
  const tbody = document.createElement("tbody");
  rows.forEach(({ label, matches, error, legacyValue, mappingValue }) => {
    const tr = document.createElement("tr");
    const status = error ? `ERROR: ${error}` : matches ? "MATCH" : "MISMATCH";
    const statusClass = error || !matches ? "mismatch" : "match";
    tr.innerHTML = `<td>${label}</td><td class="${statusClass}">${status}</td><td><pre>${escapeHtml(
      JSON.stringify(legacyValue, null, 1)
    )}</pre></td><td><pre>${escapeHtml(JSON.stringify(mappingValue, null, 1))}</pre></td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  const summary = document.createElement("p");
  const matchCount = rows.filter((row) => row.matches).length;
  summary.innerHTML = `<strong>${matchCount} / ${rows.length} checked sections match.</strong>`;

  const notAttempted = document.createElement("p");
  notAttempted.className = "note";
  notAttempted.textContent = `Not attempted in this Phase 1 pass (intentionally out of scope, not gaps found and abandoned): ${NOT_ATTEMPTED.join("; ")}.`;

  const report = document.getElementById("report");
  report.appendChild(summary);
  report.appendChild(table);
  report.appendChild(notAttempted);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));
}

main().catch((error) => {
  document.getElementById("report").textContent = `Failed: ${error.message}`;
  console.error(error);
});
