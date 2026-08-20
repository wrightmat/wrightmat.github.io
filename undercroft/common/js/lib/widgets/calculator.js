// A general-purpose Dashboard "Calculator" widget, built to host more than
// one calculator type over time via the Type select below — "Travel Time"
// and "Dice Probability" today, a third is a new render function plus one
// more `<option>`, not a redesign. Travel Time was ported from the legacy
// `dnd/travel.js` overland-travel calculator, with its D&D5e-flavored
// content (which travel means exist, their speed/fare) moved to
// System-authored data (`common/js/lib/travel-means.js`) instead of being
// hardcoded here, and two real bugs fixed rather than reproduced: the old
// tool's "party roster" table was fully dead markup (targeted a
// `#players-table` removed from the HTML in a past commit), and its rations
// cost was computed per-player but never actually multiplied by the
// player-count field it collected.
//
// There is deliberately no hardcoded weather/random-encounter logic here —
// the suite already has a general mechanism for "something happens as the
// party travels": a GM-authored rollable table in a Repository Journal page
// (`[[Page Title#^blockId]]`, resolved by rollExpression, dice-roll.js).
// The Daily macro field just runs whatever roll/table reference the GM
// configures once per day of the computed trip (e.g.
// `dice:[[Encounters#^encounter-table]]`) and prints each day's result —
// weather itself doesn't belong to a *trip* at all (a GM might roll it once
// at the start of a session regardless of travel), so it isn't handled here;
// it's just an ordinary Board macro button elsewhere pointed at
// `dice:[[Weather#^random-weather-table]]`.
import { resolveActiveDice, rollExpression } from "./dice-roll.js";
import { extractSystemTravelMeans, computeFareCopper, formatCopperAsCurrency } from "../travel-means.js";
import { fetchKindEntriesWithIds } from "../content-fetch.js";
import { describeTableRow } from "../../../../repository/js/lib/journal-tables.js";
import { loadCombatScalingLevels } from "../combat-scaling.js";
import {
  extractLevels,
  collectTierNames,
  computePartyXpBudget,
  computeMonsterXp,
  resolveVerdict,
  autoFillRosterFromGroup,
} from "../calculator-modes/encounter-xp.js";
import { computeCharacterTotalWeight, resolveWeightUnitLabel } from "../calculator-modes/inventory-weight.js";
import { loadRarityPriceRanges, rollItemPrices, PRICE_CHECK_TIERS } from "../item-pricing.js";
// Cross-tool import of Vault's own reference-data loader — same established
// precedent as this file's own Repository imports below (journal-tables.js,
// the two autocompletes): a Dashboard widget reusing one tool's data-loading
// module isn't a layering violation in this codebase, it's how "the same
// list Vault itself uses" is guaranteed rather than re-fetched a second way.
import { listWondersForSystem } from "../../../../vault/js/lib/tables.js";
// Same `` `macro:`/`encounter:`/`dice:`/`kindId:` `` and `[[Page Title]]`
// filtered autocomplete dropdowns Board's own "Add a card" input attaches
// (board.js) — reused as-is rather than duplicated, so the Daily macro
// field behaves identically to every other reference-authoring input in the
// suite.
import { attachCodeBlockAutocomplete } from "../../../../repository/js/lib/code-block-autocomplete.js";
import { attachWikiLinkAutocomplete } from "../../../../repository/js/lib/wiki-link-autocomplete.js";
import { el, setElementVisible } from "../dom.js";

const PACE_MULTIPLIERS = { fast: 1.25, normal: 1, slow: 0.75 };
const PACE_NOTES = {
  fast: "A fast pace imposes a −5 penalty to passive Wisdom (Perception) scores.",
  normal: "",
  slow: "A slow pace lets the party use stealth while traveling.",
};

const MODE_OPTIONS = [
  { id: "traveltime", label: "Travel Time" },
  { id: "diceprob", label: "Dice Probability" },
  { id: "encounterxp", label: "Encounter Difficulty & XP" },
  { id: "inventoryweight", label: "Inventory Weight" },
  { id: "itemprice", label: "Item Price" },
];

// Same `` `dice:` `` prefix convention journal-dice.js/journal-kind-reference.js
// already recognize inline in Journal text — duplicated locally rather than
// exported/shared (same precedent those two files already set), so a GM can
// paste the exact same macro text they'd use anywhere else in the suite.
// Every other place this syntax appears is a markdown code span (`` ` ``-
// wrapped), so wrapping backticks are stripped FIRST, before the optional
// "dice:" prefix — otherwise a pasted `` `dice:[[Page#^block]]` `` (typed
// exactly like it would be in a Journal page or Board card) leaves the
// backticks attached to the expression, which the table-reference parser
// then rejects (its whole-string match fails) and rollDiceExpression's own
// parser can't tokenize either, surfacing as a confusing "Invalid dice
// expression" toast. Confirmed real bug, not reproduced.
const DICE_PREFIX_PATTERN = /^dice:\s*(.+)$/i;
function stripDicePrefix(value) {
  const unwrapped = String(value || "")
    .trim()
    .replace(/^`+/, "")
    .replace(/`+$/, "")
    .trim();
  const match = DICE_PREFIX_PATTERN.exec(unwrapped);
  return match ? match[1].trim() : unwrapped;
}

// --- Dice Probability: exact distribution via convolution, not sampling ---

const DICE_POOL_TERM_PATTERN = /([+-]?)(\d*d\d+|\d+)/gi;
const DICE_POOL_VALIDATION_PATTERN = /^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/i;

// Deliberately simpler than dice-roll.js's own expression engine (no
// keep/drop/reroll/named dice) — a plain +/- sum of NdM terms and flat
// modifiers is all a "what's the distribution of this pool" question needs.
function parseDicePool(expression) {
  const cleaned = String(expression || "").replace(/\s+/g, "");
  if (!cleaned || !DICE_POOL_VALIDATION_PATTERN.test(cleaned)) return null;
  const terms = [];
  let match;
  DICE_POOL_TERM_PATTERN.lastIndex = 0;
  while ((match = DICE_POOL_TERM_PATTERN.exec(cleaned))) {
    const sign = match[1] === "-" ? -1 : 1;
    const diceMatch = /^(\d*)d(\d+)$/i.exec(match[2]);
    if (diceMatch) {
      const count = diceMatch[1] ? parseInt(diceMatch[1], 10) : 1;
      const sides = parseInt(diceMatch[2], 10);
      if (!count || !sides) return null;
      terms.push({ type: "dice", sign, count, sides });
    } else {
      terms.push({ type: "flat", sign, value: parseInt(match[2], 10) });
    }
  }
  return terms.length ? terms : null;
}

function singleDieDistribution(sides) {
  const probability = 1 / sides;
  const dist = new Map();
  for (let face = 1; face <= sides; face += 1) dist.set(face, probability);
  return dist;
}

function convolveDistributions(a, b) {
  const result = new Map();
  a.forEach((pa, va) => {
    b.forEach((pb, vb) => {
      const sum = va + vb;
      result.set(sum, (result.get(sum) || 0) + pa * pb);
    });
  });
  return result;
}

// Capped so a fat-fingered "50d20" can't hang the tab — a real click, not a
// defensive guard against a scenario that can't happen.
const MAX_POOL_DICE = 100;

function computeDicePoolDistribution(terms) {
  const totalDice = terms.reduce((sum, term) => sum + (term.type === "dice" ? term.count : 0), 0);
  if (totalDice > MAX_POOL_DICE) return null;
  let distribution = new Map([[0, 1]]);
  terms.forEach((term) => {
    if (term.type === "flat") {
      const shifted = new Map();
      distribution.forEach((probability, value) => shifted.set(value + term.sign * term.value, probability));
      distribution = shifted;
      return;
    }
    let dieDistribution = singleDieDistribution(term.sides);
    if (term.sign < 0) {
      const negated = new Map();
      dieDistribution.forEach((probability, value) => negated.set(-value, probability));
      dieDistribution = negated;
    }
    for (let i = 0; i < term.count; i += 1) {
      distribution = convolveDistributions(distribution, dieDistribution);
    }
  });
  return distribution;
}

export function initCalculatorWidget(
  container,
  { status, dataManager, groupContext = null, contentRef = null, setContentRef, setHeaderContent } = {}
) {
  if (!container) {
    return { destroy() {} };
  }

  // Persisted per-instance: which calculator Type is showing, which Setting
  // scopes the travel-means list (see travel-means.js's own per-value
  // settingIds), the optional daily-macro reference, and Inventory Weight's
  // own scope/character pick — everything else (distance/pace/means/hours/
  // dice pool, and Encounter XP's own roster/tier/monster selections) is a
  // fresh calculation each time, not persisted, same as the Dice Roller
  // widget's own expression input isn't.
  let config = {
    mode: "traveltime",
    settingId: "",
    dailyMacro: "",
    dailyMacroChance: 100,
    inventoryScope: "character",
    pinnedCharacterId: "",
    ...(contentRef || {}),
  };
  function persistConfig(patch) {
    config = { ...config, ...patch };
    setContentRef?.(config);
  }

  let activeTravelMeans = [];
  let settingsCatalog = [];
  // {id, payload} shape attachWikiLinkAutocomplete's own getEntries expects
  // (board.js's loadReferenceData builds the identical list the same way).
  let journalEntriesForAutocomplete = [];

  // --- Encounter Difficulty & XP state ---------------------------------
  let encounterRoster = []; // [{level, count}]
  let encounterMonsters = []; // [{id, count}]
  let encounterLevels = []; // extractLevels(systemDefinition)
  let encounterTierNames = [];
  let encounterCombatScalingLevels = [];

  // --- Item Price state --------------------------------------------------
  let itemPriceRanges = []; // loadRarityPriceRanges(systemDefinition)
  let itemPriceWonders = []; // this System's saved Vault Wonders, for the optional auto-fill picker

  container.innerHTML = "";
  const wrap = el("div", "d-flex flex-column gap-2");

  // The Type select mounts into the Dashboard card's own title bar, right
  // next to this widget's "Calculator" title (setHeaderContent, dashboard.js)
  // — not as a row inside the widget's own content — so it reads as
  // "Calculator [Travel Time ▾]" in the header itself.
  const modeSelect = document.createElement("select");
  modeSelect.className = "form-select form-select-sm";
  modeSelect.style.maxWidth = "10rem";
  MODE_OPTIONS.forEach(({ id, label }) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = label;
    modeSelect.appendChild(option);
  });
  setHeaderContent?.(modeSelect);

  // Setting is only meaningful for Travel Time (it scopes which travel means
  // apply) — lives on the Calculate row (below), not up here, since it's
  // nested inside travelSection now and hidden along with the rest of it
  // whenever a different calculator Type is active.
  const settingGroup = el("div", "d-flex align-items-center gap-2 ms-auto");
  settingGroup.appendChild(el("span", "small text-body-secondary", "Setting"));
  const settingSelect = document.createElement("select");
  settingSelect.className = "form-select form-select-sm";
  settingGroup.appendChild(settingSelect);

  // --- Travel Time: trip inputs -------------------------------------------
  const travelSection = el("div", "d-flex flex-column gap-2");

  function numberField(labelText, defaultValue, min = 0) {
    const row = el("div", "d-flex align-items-center gap-2");
    row.appendChild(el("span", "small text-body-secondary flex-grow-1", labelText));
    const input = document.createElement("input");
    input.type = "number";
    input.className = "form-control form-control-sm";
    input.style.maxWidth = "6rem";
    input.min = String(min);
    input.value = String(defaultValue);
    row.appendChild(input);
    return { row, input };
  }

  // Reads like a sentence — "24 miles at Normal Pace" — same style as the
  // Travel means/Speed/Hours row below, no standalone "Distance" label.
  const distanceRow = el("div", "d-flex align-items-center gap-2 flex-wrap");
  const distanceField = numberField("Distance (miles)", 24, 0);
  distanceRow.appendChild(distanceField.input);
  distanceRow.appendChild(el("span", "small text-body-secondary", "miles at"));
  const paceSelect = document.createElement("select");
  paceSelect.className = "form-select form-select-sm";
  paceSelect.style.maxWidth = "9rem";
  [
    ["slow", "Slow Pace"],
    ["normal", "Normal Pace"],
    ["fast", "Fast Pace"],
  ].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    if (value === "normal") option.selected = true;
    paceSelect.appendChild(option);
  });
  distanceRow.appendChild(paceSelect);
  paceSelect.addEventListener("change", () => updateSpeedDisplay());

  // Reads like a sentence — "On Foot at 3 mph for 8 hours" — Travel means,
  // its live Speed readout, and Hours traveled per day all share one row
  // instead of three stacked label/control rows.
  const meansRow = el("div", "d-flex align-items-center gap-2 flex-wrap");
  const meansSelect = document.createElement("select");
  meansSelect.className = "form-select form-select-sm";
  meansSelect.style.maxWidth = "10rem";
  meansRow.appendChild(meansSelect);
  meansRow.appendChild(el("span", "small text-body-secondary", "at"));
  // A live readout, not an input — updates from the selected means' own
  // speedMph and the current Pace, same as the legacy travel calculator's
  // own up-front speed display, before Calculate is ever clicked.
  const speedDisplay = el("span", "small fw-semibold", "—");
  meansRow.appendChild(speedDisplay);
  meansRow.appendChild(el("span", "small text-body-secondary", "for"));
  const hoursField = numberField("Hours traveled per day", 8, 1);
  hoursField.input.title = "Hours traveled per day";
  meansRow.appendChild(hoursField.input);
  meansRow.appendChild(el("span", "small text-body-secondary", "hours"));

  const fareRow = el("div", "d-flex align-items-center gap-2");
  fareRow.appendChild(el("span", "small text-body-secondary flex-grow-1", "Fare class"));
  const fareSelect = document.createElement("select");
  fareSelect.className = "form-select form-select-sm";
  fareSelect.style.maxWidth = "8rem";
  fareRow.appendChild(fareSelect);

  // Same row shape as Pace/Travel means/Fare class above (label grows,
  // control sits at a fixed width on the right) so this lines up with the
  // rest of the trip controls instead of reading as a separate config box.
  // Sits below Calculate — optional, so a GM who doesn't want per-day rolls
  // never has to look at it.
  const dailyMacroRow = el("div", "d-flex align-items-center gap-2");
  dailyMacroRow.appendChild(el("span", "small text-body-secondary flex-grow-1", "Daily macro (optional)"));
  const dailyMacroInput = document.createElement("input");
  dailyMacroInput.type = "text";
  dailyMacroInput.className = "form-control form-control-sm";
  dailyMacroInput.style.maxWidth = "20rem";
  dailyMacroInput.placeholder = "dice:[[Encounters#^encounter-table]]";
  dailyMacroInput.value = config.dailyMacro || "";
  dailyMacroInput.addEventListener("change", () => persistConfig({ dailyMacro: dailyMacroInput.value.trim() }));
  // Same two autocompletes attached in the same order as Board's "Add a
  // card" input (code-block-autocomplete.js's own keydown handler must run
  // first so event.defaultPrevented is already set — not relied on here
  // since this input commits on "change", not Enter, but kept consistent
  // with the established attach order anyway).
  const dailyMacroAutocompletes = [
    attachCodeBlockAutocomplete(dailyMacroInput, { dataManager }),
    attachWikiLinkAutocomplete(dailyMacroInput, { getEntries: () => journalEntriesForAutocomplete }),
  ];
  dailyMacroRow.appendChild(dailyMacroInput);

  // Gates whether the macro fires at all each day — a 100% chance (the
  // default) behaves exactly like before this existed (always triggers).
  const dailyMacroChanceInput = document.createElement("input");
  dailyMacroChanceInput.type = "number";
  dailyMacroChanceInput.className = "form-control form-control-sm";
  dailyMacroChanceInput.style.maxWidth = "4.5rem";
  dailyMacroChanceInput.min = "0";
  dailyMacroChanceInput.max = "100";
  dailyMacroChanceInput.title = "Chance (%) the Daily macro triggers each day";
  dailyMacroChanceInput.value = String(config.dailyMacroChance);
  dailyMacroChanceInput.addEventListener("change", () => {
    const value = Math.max(0, Math.min(100, Math.round(Number(dailyMacroChanceInput.value)) || 0));
    dailyMacroChanceInput.value = String(value);
    persistConfig({ dailyMacroChance: value });
  });
  dailyMacroRow.append(dailyMacroChanceInput, el("span", "small text-body-secondary", "%"));

  const calculateButton = el("button", "btn btn-primary btn-sm", "Calculate");
  calculateButton.type = "button";
  const calculateRow = el("div", "d-flex align-items-center gap-2 flex-wrap");
  calculateRow.append(calculateButton, settingGroup);

  const resultBox = el("div", "d-flex flex-column gap-1 small");

  const dailyResultsWrap = el("div", "d-flex flex-column gap-1");
  dailyResultsWrap.appendChild(el("div", "small fw-semibold", "Daily rolls"));
  const dailyResultsBox = el("div", "d-flex flex-column gap-1 small");
  dailyResultsWrap.appendChild(dailyResultsBox);
  setElementVisible(dailyResultsWrap, false);

  travelSection.append(distanceRow, meansRow, fareRow, calculateRow, dailyMacroRow, resultBox, dailyResultsWrap);

  // --- Dice Probability ----------------------------------------------------
  const diceProbSection = el("div", "d-flex flex-column gap-2");

  const poolRow = el("div", "d-flex align-items-center gap-2");
  poolRow.appendChild(el("span", "small text-body-secondary flex-grow-1", "Dice pool"));
  const poolInput = document.createElement("input");
  poolInput.type = "text";
  poolInput.className = "form-control form-control-sm";
  poolInput.style.maxWidth = "10rem";
  poolInput.placeholder = "3d6";
  poolInput.value = "3d6";
  poolRow.appendChild(poolInput);

  const calcProbButton = el("button", "btn btn-primary btn-sm", "Calculate");
  calcProbButton.type = "button";
  poolRow.appendChild(calcProbButton);

  const probSummary = el("div", "small text-body-secondary");
  const probChart = el("div", "d-flex align-items-end gap-2 overflow-auto");

  diceProbSection.append(poolRow, probSummary, probChart);

  // --- Encounter Difficulty & XP ------------------------------------------
  const encounterSection = el("div", "d-flex flex-column gap-2");

  const rosterRowsWrap = el("div", "d-flex flex-column gap-1");
  const addRosterRowButton = el("button", "btn btn-outline-secondary btn-sm", "Add level");
  addRosterRowButton.type = "button";
  const autoFillButton = el("button", "btn btn-outline-secondary btn-sm", "Auto-fill from campaign roster");
  autoFillButton.type = "button";
  const rosterButtonsRow = el("div", "d-flex gap-2 flex-wrap");
  rosterButtonsRow.append(addRosterRowButton, autoFillButton);

  const tierRow = el("div", "d-flex align-items-center gap-2");
  tierRow.appendChild(el("span", "small text-body-secondary flex-grow-1", "Difficulty tier"));
  const tierSelect = document.createElement("select");
  tierSelect.className = "form-select form-select-sm";
  tierSelect.style.maxWidth = "10rem";
  tierRow.appendChild(tierSelect);
  const tierUnavailableNotice = el(
    "div",
    "small text-body-secondary fst-italic",
    'This System has no Levels/XP Thresholds configured — add a "levels" field via Loom\'s System Properties editor.'
  );

  const monsterPickerRow = el("div", "d-flex align-items-center gap-2 flex-wrap");
  const monsterSelect = document.createElement("select");
  monsterSelect.className = "form-select form-select-sm";
  monsterSelect.style.maxWidth = "12rem";
  const monsterCountInput = document.createElement("input");
  monsterCountInput.type = "number";
  monsterCountInput.className = "form-control form-control-sm";
  monsterCountInput.style.maxWidth = "5rem";
  monsterCountInput.min = "1";
  monsterCountInput.value = "1";
  const addMonsterButton = el("button", "btn btn-outline-secondary btn-sm", "Add");
  addMonsterButton.type = "button";
  monsterPickerRow.append(monsterSelect, monsterCountInput, addMonsterButton);
  const monsterUnavailableNotice = el(
    "div",
    "small text-body-secondary fst-italic",
    "This System has no Combat Scaling data — set it up in Crucible's Settings, or add a combatScaling field to this System."
  );
  const monsterRowsWrap = el("div", "d-flex flex-column gap-1");

  const encounterCalculateButton = el("button", "btn btn-primary btn-sm align-self-start", "Calculate");
  encounterCalculateButton.type = "button";
  const encounterResultBox = el("div", "d-flex flex-column gap-1 small");

  encounterSection.append(
    el("div", "small fw-semibold", "Party roster"),
    rosterRowsWrap,
    rosterButtonsRow,
    tierRow,
    tierUnavailableNotice,
    el("div", "small fw-semibold", "Monsters"),
    monsterRowsWrap,
    monsterPickerRow,
    monsterUnavailableNotice,
    encounterCalculateButton,
    encounterResultBox
  );

  // --- Inventory Weight ----------------------------------------------------
  const inventorySection = el("div", "d-flex flex-column gap-2");

  const scopeRow = el("div", "d-flex align-items-center gap-2");
  scopeRow.appendChild(el("span", "small text-body-secondary flex-grow-1", "Scope"));
  const scopeSelect = document.createElement("select");
  scopeSelect.className = "form-select form-select-sm";
  scopeSelect.style.maxWidth = "12rem";
  [
    ["character", "This character"],
    ["campaign", "Entire campaign"],
  ].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    scopeSelect.appendChild(option);
  });
  scopeRow.appendChild(scopeSelect);

  const characterPickerRow = el("div", "d-flex align-items-center gap-2");
  characterPickerRow.appendChild(el("span", "small text-body-secondary flex-grow-1", "Character"));
  const characterSelect = document.createElement("select");
  characterSelect.className = "form-select form-select-sm";
  characterPickerRow.appendChild(characterSelect);

  const includeCurrencyRow = el("div", "form-check");
  const includeCurrencyCheckbox = document.createElement("input");
  includeCurrencyCheckbox.type = "checkbox";
  includeCurrencyCheckbox.className = "form-check-input";
  includeCurrencyCheckbox.id = `calculator-inventory-include-currency-${Math.random().toString(36).slice(2)}`;
  includeCurrencyCheckbox.checked = true;
  const includeCurrencyLabel = document.createElement("label");
  includeCurrencyLabel.className = "form-check-label small";
  includeCurrencyLabel.htmlFor = includeCurrencyCheckbox.id;
  includeCurrencyLabel.textContent = "Include currency weight";
  includeCurrencyRow.append(includeCurrencyCheckbox, includeCurrencyLabel);

  const inventoryCalculateButton = el("button", "btn btn-primary btn-sm align-self-start", "Calculate");
  inventoryCalculateButton.type = "button";
  const inventoryResultBox = el("div", "d-flex flex-column gap-1 small");

  inventorySection.append(scopeRow, characterPickerRow, includeCurrencyRow, inventoryCalculateButton, inventoryResultBox);

  // --- Item Price ------------------------------------------------------
  const itemPriceSection = el("div", "d-flex flex-column gap-2");

  // Optional — picking a saved Wonder just auto-fills the Rarity select
  // below to whatever that Wonder's own "rarity" property resolved to
  // (see loadItemPriceOptions); it's a shortcut, not a requirement, so a
  // GM pricing something that was never generated in Vault can still pick
  // a Rarity directly.
  const itemWonderRow = el("div", "d-flex align-items-center gap-2 flex-wrap");
  itemWonderRow.appendChild(el("span", "small text-body-secondary flex-grow-1", "Wonder (optional)"));
  const itemWonderSelect = document.createElement("select");
  itemWonderSelect.className = "form-select form-select-sm";
  itemWonderSelect.style.maxWidth = "14rem";
  itemWonderRow.appendChild(itemWonderSelect);

  const itemRarityRow = el("div", "d-flex align-items-center gap-2");
  itemRarityRow.appendChild(el("span", "small text-body-secondary flex-grow-1", "Rarity"));
  const itemRaritySelect = document.createElement("select");
  itemRaritySelect.className = "form-select form-select-sm";
  itemRaritySelect.style.maxWidth = "10rem";
  itemRarityRow.appendChild(itemRaritySelect);
  const itemPriceUnavailableNotice = el(
    "div",
    "small text-body-secondary fst-italic",
    'This System has no Rarity price ranges configured — add priceMin/priceMax to its "rarity" field\'s values via Loom\'s Property editor (Extra JSON).'
  );

  // Optional — the GM's own read of how a Persuasion/Insight/appraisal-
  // flavored check the PC already rolled went, compared against whatever DC
  // the table uses. Left at "No check rolled" this has no effect at all,
  // same shape as the "Setting" blank option elsewhere in this widget.
  const itemCheckRow = el("div", "d-flex align-items-center gap-2");
  itemCheckRow.appendChild(el("span", "small text-body-secondary flex-grow-1", "PC's check"));
  const itemCheckSelect = document.createElement("select");
  itemCheckSelect.className = "form-select form-select-sm";
  itemCheckSelect.style.maxWidth = "12rem";
  PRICE_CHECK_TIERS.forEach((tier) => {
    const option = document.createElement("option");
    option.value = tier.id;
    option.textContent = tier.label;
    // "No check rolled" is the default state (no PC check happened yet),
    // not just whichever tier happens to render first in the worst-to-best
    // list order above.
    option.selected = tier.id === "none";
    itemCheckSelect.appendChild(option);
  });
  itemCheckRow.appendChild(itemCheckSelect);

  const itemPriceCalculateButton = el("button", "btn btn-primary btn-sm align-self-start", "Roll a price");
  itemPriceCalculateButton.type = "button";
  const itemPriceResultBox = el("div", "d-flex flex-column gap-1 small");

  itemPriceSection.append(
    itemWonderRow,
    itemRarityRow,
    itemCheckRow,
    itemPriceUnavailableNotice,
    itemPriceCalculateButton,
    itemPriceResultBox
  );

  wrap.append(travelSection, diceProbSection, encounterSection, inventorySection, itemPriceSection);
  container.appendChild(wrap);

  // --- Wiring: shared / mode switching --------------------------------------

  function renderMode() {
    const mode = modeSelect.value;
    // settingGroup lives inside travelSection now, so hiding/showing that
    // whole section already covers it — no separate toggle needed.
    setElementVisible(travelSection, mode === "traveltime", "flex");
    setElementVisible(diceProbSection, mode === "diceprob", "flex");
    setElementVisible(encounterSection, mode === "encounterxp", "flex");
    setElementVisible(inventorySection, mode === "inventoryweight", "flex");
    setElementVisible(itemPriceSection, mode === "itemprice", "flex");
    if (mode === "encounterxp") void loadEncounterData();
    if (mode === "inventoryweight") void loadInventoryOptions();
    if (mode === "itemprice") void loadItemPriceOptions();
  }
  const VALID_MODE_IDS = MODE_OPTIONS.map((option) => option.id);
  modeSelect.value = VALID_MODE_IDS.includes(config.mode) ? config.mode : "traveltime";
  modeSelect.addEventListener("change", () => {
    persistConfig({ mode: modeSelect.value });
    renderMode();
  });

  // --- Wiring: Travel Time ---------------------------------------------------

  function selectedMeans() {
    return activeTravelMeans.find((entry) => entry.id === meansSelect.value) || null;
  }

  function fareOptionsFor(means) {
    if (!means?.fare || typeof means.fare !== "object") return [];
    return Object.keys(means.fare).map((key) => ({
      id: key,
      label: key === "flat" ? "Standard" : key.charAt(0).toUpperCase() + key.slice(1),
      entry: means.fare[key],
    }));
  }

  function renderFareOptions() {
    const options = fareOptionsFor(selectedMeans());
    fareSelect.innerHTML = "";
    options.forEach(({ id, label }) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = label;
      fareSelect.appendChild(option);
    });
    setElementVisible(fareRow, options.length > 0, "flex");
  }

  // Picking a Travel means re-suggests Hours traveled per day (its own
  // hoursPerDay) — the same auto-fill the legacy travel calculator had.
  // Still just a suggestion: the GM's own edit to the field isn't
  // overwritten again until the means changes.
  function applySuggestedHours() {
    const means = selectedMeans();
    if (means) hoursField.input.value = String(means.hoursPerDay);
  }

  // Live Speed readout — same math Calculate uses (means.speedMph × the
  // current Pace multiplier), shown up front like the legacy travel
  // calculator's own always-visible speed display, not only after a click.
  function updateSpeedDisplay() {
    const means = selectedMeans();
    if (!means) {
      speedDisplay.textContent = "—";
      return;
    }
    const paceMultiplier = PACE_MULTIPLIERS[paceSelect.value] || 1;
    speedDisplay.textContent = `${Math.round(means.speedMph * paceMultiplier)} mph`;
  }

  function renderMeansOptions() {
    const previous = meansSelect.value;
    meansSelect.innerHTML = "";
    activeTravelMeans.forEach((means) => {
      const option = document.createElement("option");
      option.value = means.id;
      option.textContent = means.label;
      meansSelect.appendChild(option);
    });
    if (activeTravelMeans.some((entry) => entry.id === previous)) {
      meansSelect.value = previous;
    }
    applySuggestedHours();
    updateSpeedDisplay();
    renderFareOptions();
  }

  // Blank means "no explicit override for this one widget" — which then
  // falls back to the active campaign's own Setting (Group.settingId, set
  // in Loom's Groups tab) rather than "no Setting at all," so a GM doesn't
  // have to re-pick their campaign's Setting separately on every Calculator
  // card. The blank option's own label reflects whichever of those two it
  // actually resolves to, so this stays transparent instead of silently
  // using a Setting the select itself still shows as "Any."
  function resolvedSettingId() {
    return config.settingId || groupContext?.settingId || "";
  }

  function renderSettingOptions() {
    const previous = settingSelect.value || config.settingId || "";
    settingSelect.innerHTML = "";
    const anyOption = document.createElement("option");
    anyOption.value = "";
    const campaignSetting = groupContext?.settingId
      ? settingsCatalog.find((entry) => entry.id === groupContext.settingId)
      : null;
    anyOption.textContent = campaignSetting
      ? `Use campaign default (${campaignSetting.name})`
      : groupContext?.settingId
        ? "Use campaign default"
        : "Any (universal means only)";
    settingSelect.appendChild(anyOption);
    settingsCatalog.forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = entry.name;
      settingSelect.appendChild(option);
    });
    if (settingsCatalog.some((entry) => entry.id === previous)) {
      settingSelect.value = previous;
    }
  }

  async function loadTravelMeans() {
    const systemDefinition = await resolveActiveDice({ dataManager, groupContext }).catch(() => null);
    activeTravelMeans = extractSystemTravelMeans(systemDefinition, resolvedSettingId() || null);
    renderMeansOptions();
  }

  async function loadSettings() {
    if (!dataManager) return;
    const entries = await fetchKindEntriesWithIds(dataManager, "setting").catch(() => []);
    settingsCatalog = entries
      .map((entry) => ({ id: entry.id, name: entry.entity?.name || entry.id }))
      .sort((a, b) => a.name.localeCompare(b.name));
    renderSettingOptions();
  }

  async function loadJournalEntriesForAutocomplete() {
    if (!dataManager) return;
    const entries = await fetchKindEntriesWithIds(dataManager, "journal").catch(() => []);
    journalEntriesForAutocomplete = entries.map((entry) => ({ id: entry.id, payload: entry.entity }));
  }

  settingSelect.addEventListener("change", () => {
    persistConfig({ settingId: settingSelect.value });
    void loadTravelMeans();
  });
  meansSelect.addEventListener("change", () => {
    applySuggestedHours();
    updateSpeedDisplay();
    renderFareOptions();
  });

  async function runDailyMacro(days) {
    const expression = stripDicePrefix(config.dailyMacro);
    if (!expression || days <= 0) {
      setElementVisible(dailyResultsWrap, false);
      return;
    }
    const chance = Math.max(0, Math.min(100, Number(config.dailyMacroChance) || 0));
    dailyResultsBox.innerHTML = "";
    setElementVisible(dailyResultsWrap, true, "flex");
    for (let day = 1; day <= days; day += 1) {
      // A plain percentage gate, not itself a broadcast/toasted roll — this
      // is "did anything happen today at all," not a result worth reporting
      // on its own; only an actual trigger rolls (and reports) the macro.
      if (Math.random() * 100 >= chance) {
        dailyResultsBox.appendChild(el("div", "text-body-secondary", `Day ${day}: —`));
        continue;
      }
      // No `status` here on purpose — each day's result already prints in
      // the Daily rolls list below; a toast per day (on top of a multi-day
      // trip) would just be noise the GM didn't ask to see.
      const rolled = await rollExpression(expression, {
        label: `Day ${day}`,
        dataManager,
        groupContext,
        broadcast: true,
      });
      const text = rolled ? (rolled.isTable ? describeTableRow(rolled.row) : `${rolled.expression} → ${rolled.total}`) : "—";
      dailyResultsBox.appendChild(el("div", "", `Day ${day}: ${text}`));
    }
  }

  function computeTrip() {
    const means = selectedMeans();
    if (!means) {
      status?.show("This System has no Travel Means defined.", { type: "info", timeout: 2500 });
      return;
    }
    const distance = Math.max(0, Number(distanceField.input.value) || 0);
    const hoursPerDay = Math.max(1, Number(hoursField.input.value) || means.hoursPerDay);
    const paceMultiplier = PACE_MULTIPLIERS[paceSelect.value] || 1;
    const speed = Math.round(means.speedMph * paceMultiplier);
    const days = speed > 0 ? Math.ceil(distance / (speed * hoursPerDay)) : 0;

    // Speed itself is already shown live up front (updateSpeedDisplay) — not
    // repeated here.
    const lines = [`Trip length: ${days} day${days === 1 ? "" : "s"}`];
    const paceNote = PACE_NOTES[paceSelect.value];
    if (paceNote) lines.push(paceNote);

    // Forced-march exhaustion — only meaningful for an on-the-ground means
    // (hoursPerDay === 8, e.g. On Foot/Horse/Coach); a continuous conveyance
    // (a ship, an airship, the rail) doesn't tire out the traveler's own
    // body regardless of how many hours it travels.
    if (means.hoursPerDay === 8 && hoursPerDay > 8) {
      const dc = hoursPerDay - 8 + 10;
      lines.push(`Forced march: DC ${dc} Constitution save at the end of each hour beyond the 8th, or gain a level of exhaustion.`);
    }

    const fareOption = fareOptionsFor(means).find((entry) => entry.id === fareSelect.value);
    const fareCopper = fareOption ? computeFareCopper(fareOption.entry, distance) : 0;
    // Rations: flat 5 sp/day per person, doubled by horse (feeding the
    // horse too) — verified legacy behavior. Stated per person rather than
    // totaled for the party — party size doesn't affect anything else about
    // the trip, so a party-size input isn't worth the extra control.
    const rationsPerDay = means.id === "By Horse" ? 10 : 5;
    const rationsCopper = days * rationsPerDay * 10;
    const totalCopper = fareCopper + rationsCopper;
    if (totalCopper > 0) {
      lines.push(
        `Cost: ${formatCopperAsCurrency(totalCopper)} per person` +
          (fareCopper ? ` (${formatCopperAsCurrency(fareCopper)} fare, ${formatCopperAsCurrency(rationsCopper)} rations)` : " (rations only)")
      );
    } else {
      lines.push("Cost: none (no fare for this means)");
    }

    resultBox.innerHTML = "";
    lines.forEach((line) => resultBox.appendChild(el("div", "", line)));
    void runDailyMacro(days);
  }
  calculateButton.addEventListener("click", computeTrip);

  // --- Wiring: Dice Probability ----------------------------------------------

  const CHART_HEIGHT = 105;

  function renderDiceProbability() {
    const terms = parseDicePool(poolInput.value);
    if (!terms) {
      status?.show("Enter a valid dice pool, e.g. 3d6 or 2d8+1d4+1.", { type: "info", timeout: 3000 });
      return;
    }
    const distribution = computeDicePoolDistribution(terms);
    if (!distribution) {
      status?.show(`That pool has too many dice to chart (max ${MAX_POOL_DICE}).`, { type: "info", timeout: 3000 });
      return;
    }
    const entries = Array.from(distribution.entries()).sort((a, b) => a[0] - b[0]);
    const maxProbability = Math.max(...entries.map(([, probability]) => probability));
    const mean = entries.reduce((sum, [value, probability]) => sum + value * probability, 0);
    const min = entries[0][0];
    const max = entries[entries.length - 1][0];
    probSummary.textContent = `Average: ${mean.toFixed(2)} — Range: ${min} to ${max}`;

    probChart.innerHTML = "";
    entries.forEach(([value, probability]) => {
      const column = el("div", "d-flex flex-column align-items-center gap-1 flex-shrink-0");
      column.style.width = "1.75rem";
      const barArea = el("div", "d-flex flex-column-reverse align-items-stretch w-100");
      barArea.style.height = `${CHART_HEIGHT}px`;
      const bar = el("div", "rounded-top bg-primary");
      bar.style.height = `${Math.max(2, Math.round((probability / maxProbability) * CHART_HEIGHT))}px`;
      // Narrower than the label text at this font size on purpose (the bars
      // themselves needed to shrink) — nowrap lets each label overflow its
      // own thin column horizontally, centered, rather than wrapping into an
      // ugly multi-line stack.
      const pctLabel = el("div", "text-center", `${(probability * 100).toFixed(1)}%`);
      pctLabel.style.fontSize = "0.8rem";
      pctLabel.style.whiteSpace = "nowrap";
      const valueLabel = el("div", "fw-semibold text-center", String(value));
      valueLabel.style.fontSize = "1.1rem";
      valueLabel.style.whiteSpace = "nowrap";
      barArea.append(bar, pctLabel);
      column.append(barArea, valueLabel);
      probChart.appendChild(column);
    });
  }
  calcProbButton.addEventListener("click", renderDiceProbability);

  // --- Wiring: Encounter Difficulty & XP -------------------------------------

  function renderRosterRows() {
    rosterRowsWrap.innerHTML = "";
    encounterRoster.forEach((entry, index) => {
      const row = el("div", "d-flex align-items-center gap-2");
      row.appendChild(el("span", "small text-body-secondary", "Level"));
      const levelInput = document.createElement("input");
      levelInput.type = "number";
      levelInput.className = "form-control form-control-sm";
      levelInput.style.maxWidth = "5rem";
      levelInput.min = "1";
      levelInput.value = String(entry.level);
      levelInput.addEventListener("change", () => {
        entry.level = Math.max(1, Math.round(Number(levelInput.value)) || 1);
      });
      row.appendChild(levelInput);
      row.appendChild(el("span", "small text-body-secondary", "×"));
      const countInput = document.createElement("input");
      countInput.type = "number";
      countInput.className = "form-control form-control-sm";
      countInput.style.maxWidth = "5rem";
      countInput.min = "1";
      countInput.value = String(entry.count);
      countInput.addEventListener("change", () => {
        entry.count = Math.max(1, Math.round(Number(countInput.value)) || 1);
      });
      row.appendChild(countInput);
      const removeButton = el("button", "btn btn-outline-danger btn-sm", "Remove");
      removeButton.type = "button";
      removeButton.addEventListener("click", () => {
        encounterRoster.splice(index, 1);
        renderRosterRows();
      });
      row.appendChild(removeButton);
      rosterRowsWrap.appendChild(row);
    });
  }
  addRosterRowButton.addEventListener("click", () => {
    encounterRoster.push({ level: 1, count: 1 });
    renderRosterRows();
  });

  autoFillButton.addEventListener("click", async () => {
    const { roster, skipped } = await autoFillRosterFromGroup(dataManager, groupContext?.groupId);
    encounterRoster = roster;
    renderRosterRows();
    if (skipped > 0) {
      status?.show(
        `${skipped} campaign member${skipped === 1 ? "" : "s"} have no resolvable level and were skipped — add them manually if needed.`,
        { type: "info", timeout: 3500 }
      );
    } else if (!roster.length) {
      status?.show("No campaign members with a resolvable level were found.", { type: "info", timeout: 2500 });
    }
  });

  function renderMonsterRows() {
    monsterRowsWrap.innerHTML = "";
    encounterMonsters.forEach((entry, index) => {
      const level = encounterCombatScalingLevels.find((candidate) => candidate.id === entry.id);
      const row = el("div", "d-flex align-items-center gap-2");
      row.appendChild(el("span", "small flex-grow-1", `${level?.name || entry.id} × ${entry.count}`));
      const removeButton = el("button", "btn btn-outline-danger btn-sm", "Remove");
      removeButton.type = "button";
      removeButton.addEventListener("click", () => {
        encounterMonsters.splice(index, 1);
        renderMonsterRows();
      });
      row.appendChild(removeButton);
      monsterRowsWrap.appendChild(row);
    });
  }
  addMonsterButton.addEventListener("click", () => {
    if (!monsterSelect.value) return;
    const count = Math.max(1, Math.round(Number(monsterCountInput.value)) || 1);
    const existing = encounterMonsters.find((entry) => entry.id === monsterSelect.value);
    if (existing) {
      existing.count += count;
    } else {
      encounterMonsters.push({ id: monsterSelect.value, count });
    }
    renderMonsterRows();
  });

  function labelForTier(tier) {
    return tier.charAt(0).toUpperCase() + tier.slice(1);
  }

  async function loadEncounterData() {
    const systemDefinition = await resolveActiveDice({ dataManager, groupContext }).catch(() => null);
    encounterLevels = extractLevels(systemDefinition);
    encounterTierNames = collectTierNames(encounterLevels);
    tierSelect.innerHTML = "";
    encounterTierNames.forEach((tier) => {
      const option = document.createElement("option");
      option.value = tier;
      option.textContent = labelForTier(tier);
      tierSelect.appendChild(option);
    });
    const hasTiers = encounterTierNames.length > 0;
    setElementVisible(tierRow, hasTiers, "flex");
    setElementVisible(tierUnavailableNotice, !hasTiers);

    const systemId = groupContext?.systemId || "";
    // Reuses Crucible's OWN configured preference (crucible-settings bucket)
    // rather than a second, separately maintained setting — see
    // combat-scaling.js's own comment on why. A GM who's already configured
    // Crucible's Combat scaling field gets correct monster XP here with
    // nothing further to set up.
    const combatScalingField = dataManager?.getLocal?.("crucible-settings", systemId)?.combatScalingField || undefined;
    encounterCombatScalingLevels = systemId ? await loadCombatScalingLevels(dataManager, systemId, combatScalingField) : [];
    monsterSelect.innerHTML = "";
    encounterCombatScalingLevels.forEach((level) => {
      const option = document.createElement("option");
      option.value = level.id;
      option.textContent = level.name;
      monsterSelect.appendChild(option);
    });
    const hasMonsters = encounterCombatScalingLevels.length > 0;
    setElementVisible(monsterPickerRow, hasMonsters, "flex");
    setElementVisible(monsterUnavailableNotice, !hasMonsters);

    autoFillButton.disabled = !groupContext?.groupId;
    renderMonsterRows();
  }

  function computeEncounter() {
    const monsterResult = computeMonsterXp(encounterMonsters, encounterCombatScalingLevels);
    const lines = [`Total monster XP: ${monsterResult.total.toLocaleString()}`];
    if (monsterResult.missingXp.length) {
      lines.push(`No XP value for: ${monsterResult.missingXp.join(", ")}`);
    }
    if (encounterTierNames.length && tierSelect.value) {
      const selectedBudget = computePartyXpBudget(encounterRoster, encounterLevels, tierSelect.value);
      if (selectedBudget.missingLevels.length) {
        lines.push(`Party budget unavailable — no Levels data for level(s) ${selectedBudget.missingLevels.join(", ")}.`);
      } else {
        lines.push(`Party ${labelForTier(tierSelect.value)} budget: ${selectedBudget.total.toLocaleString()} XP`);
      }
      const verdict = resolveVerdict(encounterRoster, encounterLevels, encounterTierNames, monsterResult.total);
      if (verdict) {
        const verdictBudget = computePartyXpBudget(encounterRoster, encounterLevels, verdict);
        lines.push(
          `This encounter is ${labelForTier(verdict)} for this party ` +
            `(${monsterResult.total.toLocaleString()} XP vs. a ${labelForTier(verdict)} budget of ${verdictBudget.total.toLocaleString()} XP).`
        );
      } else {
        lines.push("This encounter is below this party's easiest defined budget, or level data is incomplete.");
      }
    }
    encounterResultBox.innerHTML = "";
    lines.forEach((line) => encounterResultBox.appendChild(el("div", "", line)));
  }
  encounterCalculateButton.addEventListener("click", computeEncounter);

  // --- Wiring: Inventory Weight -----------------------------------------

  function updateInventoryScopeVisibility() {
    setElementVisible(characterPickerRow, scopeSelect.value !== "campaign", "flex");
  }
  scopeSelect.value = config.inventoryScope === "campaign" ? "campaign" : "character";
  scopeSelect.addEventListener("change", () => {
    persistConfig({ inventoryScope: scopeSelect.value });
    updateInventoryScopeVisibility();
  });
  characterSelect.addEventListener("change", () => {
    persistConfig({ pinnedCharacterId: characterSelect.value });
  });

  async function loadInventoryOptions() {
    const campaignOption = scopeSelect.querySelector('option[value="campaign"]');
    if (campaignOption) campaignOption.disabled = !groupContext?.groupId;
    if (!groupContext?.groupId && scopeSelect.value === "campaign") {
      scopeSelect.value = "character";
      persistConfig({ inventoryScope: "character" });
    }
    updateInventoryScopeVisibility();

    characterSelect.innerHTML = "";
    const blankOption = document.createElement("option");
    blankOption.value = "";
    blankOption.textContent = "Pick a character…";
    characterSelect.appendChild(blankOption);
    if (!dataManager) return;
    let entries = [];
    try {
      if (dataManager.isAuthenticated?.()) {
        const listing = await dataManager.list("character", { refresh: true });
        const remote = dataManager.collectListEntries(listing.remote, ["owned"]);
        const remoteIds = new Set(remote.map((entry) => entry.id));
        const local = (dataManager.listLocalEntries("character") || []).filter((entry) => !remoteIds.has(entry.id));
        entries = [...remote, ...local];
      } else {
        entries = dataManager.listLocalEntries("character") || [];
      }
    } catch (error) {
      entries = [];
    }
    entries.forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = entry.title || entry.name || entry.payload?.name || entry.id;
      characterSelect.appendChild(option);
    });
    if (config.pinnedCharacterId && entries.some((entry) => entry.id === config.pinnedCharacterId)) {
      characterSelect.value = config.pinnedCharacterId;
    }
  }

  function characterDisplayName(payload, fallbackId) {
    return payload?.identity?.name || payload?.name || fallbackId;
  }

  async function computeInventoryWeight() {
    const systemDefinition = await resolveActiveDice({ dataManager, groupContext }).catch(() => null);
    const includeCurrency = includeCurrencyCheckbox.checked;
    const unit = resolveWeightUnitLabel(systemDefinition);
    inventoryResultBox.innerHTML = "";

    if (scopeSelect.value === "campaign") {
      if (!groupContext?.groupId || !dataManager) {
        status?.show("No campaign selected.", { type: "info", timeout: 2000 });
        return;
      }
      inventoryResultBox.appendChild(el("div", "text-body-secondary", "Loading campaign roster…"));
      let group = null;
      try {
        group = await dataManager.get("group", groupContext.groupId, { preferLocal: false });
      } catch (error) {
        group = null;
      }
      const memberIds = Array.isArray(group?.payload?.members)
        ? group.payload.members.filter((member) => member.content_type === "character").map((member) => member.content_id)
        : [];
      // allSettled, not all — one broken member reference must not blank the
      // whole result; it's listed under "Could not load" below instead.
      const results = await Promise.allSettled(memberIds.map((id) => dataManager.get("character", id)));
      inventoryResultBox.innerHTML = "";

      const table = document.createElement("table");
      table.className = "table table-sm mb-0";
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      ["Character", "Inventory", "Currency", "Total"].forEach((label, index) => {
        const th = document.createElement("th");
        th.textContent = label;
        if (index > 0) th.className = "text-end";
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      const tbody = document.createElement("tbody");
      table.append(thead, tbody);

      let grandTotal = 0;
      let anyCurrencyWeight = false;
      const failed = [];
      results.forEach((result, index) => {
        if (result.status !== "fulfilled" || !result.value?.payload) {
          failed.push(memberIds[index]);
          return;
        }
        const payload = result.value.payload;
        const totals = computeCharacterTotalWeight(payload, systemDefinition, { includeCurrency });
        if (totals.currencyWeightAvailable) anyCurrencyWeight = true;
        grandTotal += totals.total;
        const row = document.createElement("tr");
        const nameCell = document.createElement("td");
        nameCell.textContent = characterDisplayName(payload, memberIds[index]);
        row.appendChild(nameCell);
        [totals.inventoryWeight, totals.currencyWeight, totals.total].forEach((value) => {
          const cell = document.createElement("td");
          cell.className = "text-end";
          cell.textContent = value.toLocaleString();
          row.appendChild(cell);
        });
        tbody.appendChild(row);
      });

      inventoryResultBox.appendChild(table);
      inventoryResultBox.appendChild(el("div", "fw-semibold", `Grand total: ${grandTotal.toLocaleString()} ${unit}`));
      if (includeCurrency && !anyCurrencyWeight) {
        inventoryResultBox.appendChild(el("div", "text-body-secondary small", "This System's currency has no weight data."));
      }
      if (failed.length) {
        inventoryResultBox.appendChild(el("div", "text-danger small", `Could not load: ${failed.join(", ")}`));
      }
      return;
    }

    const characterId = characterSelect.value;
    if (!characterId || !dataManager) {
      status?.show("Pick a character.", { type: "info", timeout: 2000 });
      return;
    }
    let payload = null;
    try {
      const result = await dataManager.get("character", characterId);
      payload = result?.payload || null;
    } catch (error) {
      payload = null;
    }
    if (!payload) {
      inventoryResultBox.appendChild(el("div", "text-danger small", "Unable to load that character."));
      return;
    }
    const totals = computeCharacterTotalWeight(payload, systemDefinition, { includeCurrency });
    inventoryResultBox.appendChild(el("div", "", `Inventory: ${totals.inventoryWeight.toLocaleString()} ${unit}`));
    if (includeCurrency) {
      if (totals.currencyWeightAvailable) {
        inventoryResultBox.appendChild(el("div", "", `Currency: ${totals.currencyWeight.toLocaleString()} ${unit}`));
      } else {
        inventoryResultBox.appendChild(el("div", "text-body-secondary small", "This System's currency has no weight data."));
      }
    }
    inventoryResultBox.appendChild(el("div", "fw-semibold", `Total: ${totals.total.toLocaleString()} ${unit}`));
  }
  inventoryCalculateButton.addEventListener("click", () => {
    void computeInventoryWeight();
  });

  // --- Wiring: Item Price ------------------------------------------------

  // Which array field Item Price treats as Rarity — resolved, not stored,
  // so the Wonder auto-fill (below) looks up the same field's slug id the
  // range list itself was keyed by.
  let itemPriceRarityFieldKey = "rarity";

  async function loadItemPriceOptions() {
    const systemId = groupContext?.systemId || "";
    // Reuses Vault's OWN configured Budget ceiling field preference
    // (bucket "vault-settings") rather than a second, separately
    // maintained setting — same reasoning Encounter XP's own reuse of
    // Crucible's Combat scaling field preference gives above. A GM who's
    // already pointed Vault at a Rarity-equivalent field gets correct
    // price data here with nothing further to set up.
    const storedField = dataManager?.getLocal?.("vault-settings", systemId)?.budgetCeilingField;
    itemPriceRarityFieldKey = storedField || "rarity";
    itemPriceRanges = systemId ? await loadRarityPriceRanges(dataManager, systemId, itemPriceRarityFieldKey) : [];

    itemRaritySelect.innerHTML = "";
    itemPriceRanges.forEach((range) => {
      const option = document.createElement("option");
      option.value = range.id;
      option.textContent = range.name;
      itemRaritySelect.appendChild(option);
    });
    const hasRanges = itemPriceRanges.length > 0;
    setElementVisible(itemRarityRow, hasRanges, "flex");
    setElementVisible(itemCheckRow, hasRanges, "flex");
    itemPriceCalculateButton.disabled = !hasRanges;
    setElementVisible(itemPriceUnavailableNotice, !hasRanges);

    // The Wonder picker only matters once there's something to auto-fill
    // into — hidden entirely for a System with no price ranges configured,
    // or one with no saved Wonders yet.
    const fetchedWonders = systemId && hasRanges ? await listWondersForSystem(dataManager, systemId).catch(() => []) : [];
    // Same name-sort Vault's own Wonder select uses (vault/js/app.js's
    // populateWonderSelect) — without it, grouped names like "Potion of
    // Giant Strength, Hill"/"...Storm" would list in fetch order instead of
    // clustering together the way the naming was chosen to achieve.
    itemPriceWonders = [...fetchedWonders].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    itemWonderSelect.innerHTML = "";
    const blankOption = document.createElement("option");
    blankOption.value = "";
    blankOption.textContent = "Pick a saved Wonder…";
    itemWonderSelect.appendChild(blankOption);
    itemPriceWonders.forEach((wonder) => {
      const option = document.createElement("option");
      option.value = wonder.id;
      option.textContent = wonder.name || wonder.id;
      itemWonderSelect.appendChild(option);
    });
    setElementVisible(itemWonderRow, itemPriceWonders.length > 0, "flex");
  }

  // Auto-fills Rarity from whichever value the picked Wonder's own
  // generation actually resolved (`properties[rarityField]`, the same slug
  // id toLegacyPropertyType/loadRarityPriceRanges both derive from the
  // value's name) — a shortcut, so re-selecting Rarity by hand still works
  // for a Wonder that predates this field or used a different one.
  itemWonderSelect.addEventListener("change", () => {
    const wonder = itemPriceWonders.find((entry) => entry.id === itemWonderSelect.value);
    const rarityId = wonder?.properties?.[itemPriceRarityFieldKey];
    if (rarityId && itemPriceRanges.some((range) => range.id === rarityId)) {
      itemRaritySelect.value = rarityId;
    }
  });

  function computeItemPrice() {
    const range = itemPriceRanges.find((entry) => entry.id === itemRaritySelect.value);
    if (!range) {
      status?.show("Pick a Rarity with a configured price range.", { type: "info", timeout: 2500 });
      return;
    }
    // A single roll drives both figures — the check tier's multiplier always
    // favors the PC (a discount for buying, a better payout for selling), so
    // picking "Extreme success" once improves whichever of the two actually
    // applies to this transaction without the GM having to say which in
    // advance.
    const { buyPrice, sellPrice } = rollItemPrices(range.priceMin, range.priceMax, {
      checkTierId: itemCheckSelect.value,
    });
    itemPriceResultBox.innerHTML = "";
    itemPriceResultBox.appendChild(
      el("div", "text-body-secondary", `${range.name} range: ${range.priceMin.toLocaleString()}–${range.priceMax.toLocaleString()} gp`)
    );
    itemPriceResultBox.appendChild(el("div", "fw-semibold", `Buying from a shop: ${buyPrice.toLocaleString()} gp`));
    itemPriceResultBox.appendChild(el("div", "", `Selling to a shop: ${sellPrice.toLocaleString()} gp`));
  }
  itemPriceCalculateButton.addEventListener("click", computeItemPrice);

  renderMode();
  renderDiceProbability();
  void loadSettings();
  void loadTravelMeans();
  void loadJournalEntriesForAutocomplete();

  return {
    destroy() {
      setHeaderContent?.(null);
      dailyMacroAutocompletes.forEach((autocomplete) => autocomplete?.destroy?.());
      container.innerHTML = "";
    },
  };
}
