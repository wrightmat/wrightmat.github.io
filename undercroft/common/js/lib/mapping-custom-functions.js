// Escape-hatch custom functions for Loom mapping definitions, registered by
// name and invoked from `custom` nodes/steps (see mapping-engine.js).
//
// These are the pieces of the old ddb-parser.js logic that genuinely don't
// fit the declarative object/field/pipeline primitives: getActiveModifiers()
// cross-references modifiers against inventory equip/attunement state with
// componentId-based dedup, and several sections build on it in ways that are
// reconciliation/classification logic rather than a map/filter/sort/group-by
// shape. Ported near-verbatim rather than reimplemented, since the escape
// hatch's whole point is reusing this kind of logic, not forcing it into
// primitives that don't fit.
//
// Every root-level custom function receives (context, args, env); every
// pipeline-step custom function receives (currentValue, context, args, env).
// `context.root` is always the original raw character object, regardless of
// how deep the mapping tree has descended.
import { resolveDottedPath as resolvePath } from "./dotted-path.js";
import { evaluateDerivedFormula } from "./derived-formulas.js";

// A factory, not a static export: ABILITIES/SAVING_THROW_SUBTYPES/SKILLS/
// SIZES are derived at runtime from the active D&D 5e System record
// (system-lookup-tables.js's deriveLookupTables), so this module closes over
// whatever the caller derived, called once per DDB import rather than a
// module-level singleton.
export function createMappingCustomFunctions({
  abilities: ABILITIES,
  savingThrowSubtypes: SAVING_THROW_SUBTYPES,
  skills: SKILLS,
  sizes: SIZES,
  alignments: ALIGNMENTS,
  senses: SENSES,
  speeds: SPEEDS,
  damageTypes: DAMAGE_TYPES,
  durations: DURATIONS,
  derivedFormulas: DERIVED_FORMULAS = [],
}) {
// Short 5e API ability-score index ("dex") -> the full lowercase word
// ("dexterity") vault-feature-matching.js's featureParams.saveAbility
// convention expects. Module-level, not a property on the returned
// custom-functions object — every custom function is invoked as a bare
// `fn(...args)` call by mapping-engine.js's runCustom, so `this` is never
// bound to that object.
const ABILITY_INDEX_TO_NAME = { str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma" };

// A "this X has N charges..."/"...regains M expended charges daily at
// dawn..." clause is Wonder-level activation data, never Feature content —
// extracted structurally so it never becomes a candidate ability unit that
// vault-feature-matching.js's clause-recognizers would have to misclassify.
// Best-effort: a charges clause matching neither pattern stays in the
// remaining prose as an ordinary candidate unit, never a hard failure.
const WORD_TO_NUMBER = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function srdExtractCharges(paragraphs) {
  const joined = paragraphs.join(" ");
  const maxMatch = joined.match(/has (\d+) charges/i);
  // Some items count their limited-use resource with a different noun
  // entirely ("1d6 + 3 beads", "1d6 + 4 pinches"), and the count is
  // sometimes a dice formula, not a fixed number (kept as a string, since
  // `Number("1d6 + 3")` is meaningless). Anchored near the start of its own
  // sentence — an unanchored search can match a per-option charge cost
  // buried in an unrelated spell-menu clause instead of the item's real total.
  const qtyMatch = !maxMatch && joined.match(/(?:^|\.\s+)[\w\s]{0,40}?(\d+d\d+(?:\s*\+\s*\d+)?|\d+) (?:charges|beads|pinches|doses)\b/i);
  // "The chime can be used ten times" — a different vocabulary again (uses,
  // not charges), with a spelled-out number rather than a digit.
  const usedTimesMatch = !maxMatch && !qtyMatch && joined.match(/can be used (\w+) times\b/i);
  // "expended" is optional — some items phrase this as "regains 1d6 charges
  // daily at dawn" without that word at all.
  const rechargeMatch = joined.match(/regains ([\w\s+d]+?) (?:expended )?charges?[^.]*/i);
  if (!maxMatch && !qtyMatch && !usedTimesMatch && !rechargeMatch) return { charges: null, remaining: paragraphs };
  const maxValue = maxMatch
    ? Number(maxMatch[1])
    : qtyMatch
      ? (/^\d+$/.test(qtyMatch[1]) ? Number(qtyMatch[1]) : qtyMatch[1].replace(/\s+/g, ""))
      : usedTimesMatch
        ? WORD_TO_NUMBER[usedTimesMatch[1].toLowerCase()] || null
        : null;
  const charges = {
    ...(maxValue !== null && maxValue !== undefined ? { max: maxValue } : {}),
    ...(rechargeMatch ? { rechargeFormula: rechargeMatch[1].trim() } : {}),
  };
  // A wand/staff/rod item's charges clause very often shares a paragraph with
  // its real ability text ("This wand has 7 charges. While holding it, you
  // can use an action to cast..."). Stripping the whole paragraph whenever it
  // merely contains a charges clause silently discarded the real ability
  // text too — this strips only the matching sentence(s) within each
  // paragraph (naive split on ". ", fine since neither phrasing contains an
  // internal period), keeping the rest as a real candidate unit. The
  // beads/pinches/doses check is anchored near the start of its own sentence
  // so it doesn't match a per-option charge cost buried in an unrelated
  // "cast one of the following spells" clause.
  const remaining = paragraphs
    .map((paragraph) =>
      paragraph
        .split(/(?<=\.)\s+/)
        .filter(
          (sentence) =>
            !/\bhas \d+ charges\b/i.test(sentence) &&
            !/regains [\w\s+d]+ (?:expended )?charges?/i.test(sentence) &&
            !/^.{0,40}?\b(?:\d+d\d+(?:\s*\+\s*\d+)?|\d+)\s+(?:charges|beads|pinches|doses)\b/i.test(sentence) &&
            !/can be used \w+ times\b/i.test(sentence)
        )
        .join(" ")
        .trim()
    )
    .filter(Boolean);
  return { charges, remaining };
}

// Vault's generator-property fields (Rarity/Activation/Item Form) are
// System-agnostic by design in Vault's own code, but this file is the
// 5e-API-specific mapping layer, whose entire job is translating one
// concrete source's vocabulary into the target shape — hardcoding sys.dnd5e's
// field KEYS here is correct, not a repeat of the "don't hardcode System
// concepts" rule, which is about the shared/generic code that has no idea
// these concepts exist.
//
// What must NOT be hardcoded is the System's own DATA — which values exist
// and what their ids are. `slugify(value.name)` is duplicated below as a
// pure algorithm only (matches tables.js's slugify byte for byte); the VALUE
// NAMES are read live off the System record every time via
// resolveLivePropertyValue, so a Loom edit takes effect on the next import
// with zero code changes here.
function slugifyPropertyValueName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Matches a raw SRD-sourced name/phrase against the System's own LIVE list
// of value names for one property field. Case-insensitive, with a
// trailing-"s" fold in either direction so the SRD's plural category names
// ("Wondrous Items") resolve against the System's singular value name
// ("Wondrous Item") without a hardcoded alias table. Returns `null` (never
// fabricated) when nothing in the live list matches.
function resolveLivePropertyValue(candidateName, liveNames) {
  if (!candidateName) return null;
  const target = String(candidateName).trim().toLowerCase();
  if (!target) return null;
  const strippedTarget = target.replace(/s$/, "");
  const names = Array.isArray(liveNames) ? liveNames : [];
  const match = names.find((name) => {
    const n = String(name || "").trim().toLowerCase();
    return n === target || n === strippedTarget || n.replace(/s$/, "") === target;
  });
  return match || null;
}

// Best-effort activation CONCEPT detection from an item's prose — "use an
// action to..."/"as a bonus action..."/"as a reaction..." checked in
// specificity order, since an item mentioning "as a bonus action" also
// usually contains the bare word "action" elsewhere. Returns the raw matched
// text, not a System value id — resolveLivePropertyValue (in
// srdItemProperties below) turns this into whichever real Activation value
// the System defines. A passive item with no activation verb at all
// correctly returns `null`, omitted rather than guessed.
function srdDetectActivationConcept(text) {
  if (/\bas a bonus action\b/i.test(text)) return "bonus action";
  if (/\bas a reaction\b/i.test(text)) return "reaction";
  if (/\buse(?:s)? an action\b/i.test(text)) return "action";
  return null;
}

// Builds the `stats.properties` object vault-feature-matching.js copies onto
// `record.properties` — Vault's native `{[propertyType.id]: valueId}` shape,
// so an imported Wonder looks structurally identical to a hand-generated
// one. Every value is resolved against the System's own live field data
// (`lookupTables`), never a hardcoded copy — only sets a key once the source
// value is confidently resolved, never a partial/guessed entry.
function srdItemProperties(
  { rarityName, categoryName, activationText, weaponCategoryName, armorCategoryName, equipmentCategoryName },
  lookupTables
) {
  const properties = {};
  const rarityMatch = resolveLivePropertyValue(rarityName, lookupTables?.rarities);
  if (rarityMatch) properties.rarity = slugifyPropertyValueName(rarityMatch);
  const formMatch = resolveLivePropertyValue(categoryName, lookupTables?.itemForms);
  if (formMatch) properties.form = slugifyPropertyValueName(formMatch);
  const activationConcept = activationText ? srdDetectActivationConcept(activationText) : null;
  const activationMatch = activationConcept ? resolveLivePropertyValue(activationConcept, lookupTables?.activationTypes) : null;
  if (activationMatch) properties.activation = slugifyPropertyValueName(activationMatch);
  // The sub-classification beneath one Item Form value: Weapon's
  // Simple/Martial split, Armor's Light/Medium/Heavy/Shield split, an
  // Equipment item's Tools/Instrument/Gaming-Set/... split. Only
  // srdEquipmentStats ever passes these three; every other caller leaves
  // them undefined, so this is purely additive.
  const weaponCategoryMatch = weaponCategoryName ? resolveLivePropertyValue(weaponCategoryName, lookupTables?.weaponCategories) : null;
  if (weaponCategoryMatch) properties.weaponCategory = slugifyPropertyValueName(weaponCategoryMatch);
  const armorCategoryMatch = armorCategoryName ? resolveLivePropertyValue(armorCategoryName, lookupTables?.armorCategories) : null;
  if (armorCategoryMatch) properties.armorCategory = slugifyPropertyValueName(armorCategoryMatch);
  const equipmentCategoryMatch = equipmentCategoryName
    ? resolveLivePropertyValue(equipmentCategoryName, lookupTables?.equipmentCategories)
    : null;
  if (equipmentCategoryMatch) properties.equipmentCategory = slugifyPropertyValueName(equipmentCategoryMatch);
  return properties;
}

// Splits a paragraph on its own "* "-prefixed bullet lines (an intro
// paragraph followed by several bulleted abilities) into one candidate unit
// per bullet. A paragraph with no bullets is returned unchanged.
function srdSplitBullets(paragraph) {
  const lines = String(paragraph || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const bulletLines = lines.filter((line) => line.startsWith("*"));
  if (bulletLines.length < 2) return [paragraph];
  return bulletLines.map((line) => line.replace(/^\*\s*/, "").trim());
}

function parseHitDie(text) {
  const match = /d\s*(\d+)/i.exec(text || "");
  return match ? Number(match[1]) : null;
}

function parseLeadingNumber(text) {
  const match = /(\d+)/.exec(text || "");
  return match ? Number(match[1]) : null;
}

// `context.coreTraits` (a species page's own inline Traits summary
// paragraph) is Species' primary source for Speed/Size/Creature Type, but
// newer 2024-era species pages don't render that inline summary — each is
// its own <h4>-headed named trait instead, same shape as an actual feature.
// Pulls the full combined text of every named-trait entry sharing that exact
// name, not just the first — DDB duplicates some headings on the page (once
// as rules-glossary boilerplate, once as the species' own real statement),
// and only searching every occurrence together reliably finds the real one.
// A standalone function, not an object-literal method — see buildSkillValues
// below for why.
function speciesNamedTraitText(namedTraits, name) {
  const target = String(name || "").trim().toLowerCase();
  return (Array.isArray(namedTraits) ? namedTraits : [])
    .filter((trait) => String(trait?.name || "").trim().toLowerCase() === target)
    .flatMap((trait) => (Array.isArray(trait.descLines) ? trait.descLines : []))
    .join(" ");
}

function parseAbilityRefs(text) {
  if (!text) return [];
  const parts = String(text)
    .split(/,|\band\b/i)
    .map((part) => part.trim())
    .filter(Boolean);
  const refs = [];
  parts.forEach((part) => {
    const ability = ABILITIES.find((entry) => entry.friendlyName.toLowerCase() === part.toLowerCase());
    if (ability) refs.push({ index: ability.shortName.toLowerCase(), name: ability.shortName });
  });
  return refs;
}

function capitalize(word) {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

// "Choose 2: Animal Handling, Athletics, ... or Survival" -> the choose count,
// the original text as `desc`, and the individual option labels.
function parseChooseList(text) {
  const match = /choose\s+(\d+)\s*:\s*(.*)$/i.exec((text || "").trim());
  if (!match) return null;
  const items = match[2]
    .split(/,|\bor\b/i)
    .map((part) => part.trim())
    .filter(Boolean);
  return { choose: Number(match[1]), desc: (text || "").trim(), items };
}

// "Light and Medium armor and Shields" -> [{index:"light-armor",...},
// {index:"medium-armor",...}, {index:"shields",...}] — bare weight words
// ("Light"/"Medium"/"Heavy"/"All") implicitly mean "<weight> armor" since the
// word "armor" is usually only written once, at the end.
function parseArmorProficiencies(text) {
  if (!text) return [];
  const tokens = String(text)
    .split(/,|\band\b/i)
    .map((part) => part.trim())
    .filter(Boolean);
  const refs = [];
  tokens.forEach((token) => {
    const lower = token.toLowerCase().replace(/\s*armor$/i, "").trim();
    if (!lower) return;
    if (lower === "shields") {
      refs.push({ index: "shields", name: "Shields" });
    } else if (["light", "medium", "heavy", "all"].includes(lower)) {
      refs.push({ index: `${lower}-armor`, name: `${capitalize(lower)} Armor` });
    }
  });
  return refs;
}

// "Simple and Martial weapons" -> [{index:"simple-weapons",...},
// {index:"martial-weapons",...}].
function parseWeaponProficiencies(text) {
  if (!text) return [];
  return String(text)
    .split(/,|\band\b/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((token) => {
      const lower = token.toLowerCase().replace(/\s*weapons?$/i, "").trim();
      return lower ? { index: `${lower}-weapons`, name: `${capitalize(lower)} Weapons` } : null;
    })
    .filter(Boolean);
}

// Ability refs reshaped into the "proficiencies" array's saving-throw entry
// convention (different index/name convention than the plain ability ref
// `saving_throws` itself uses).
function parseSavingThrowProficiencyRefs(text) {
  return parseAbilityRefs(text).map((ref) => ({
    index: `saving-throw-${ref.index}`,
    name: `Saving Throw: ${ref.name}`,
  }));
}

// "Insight and Religion" -> [{index:"skill-insight",...}, {index:"skill-religion",...}]
function parseSkillProficiencyRefs(text) {
  if (!text) return [];
  return String(text)
    .split(/,|\band\b/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((label) => {
      const skill = SKILLS.find((entry) => entry.friendlyName.toLowerCase() === label.toLowerCase());
      return skill ? { index: `skill-${skill.name}`, name: `Skill: ${skill.friendlyName}` } : null;
    })
    .filter(Boolean);
}

// "Calligrapher's Supplies" -> [{index:"tool-calligraphers-supplies",...}] — no
// lookup table for tools (unlike skills/abilities), so the index is just
// slugified straight from the name.
function parseToolProficiencyRefs(text) {
  if (!text) return [];
  return String(text)
    .split(/,|\band\b/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((label) => ({ index: `tool-${slugify(label)}`, name: `Tool: ${label}` }));
}

// "Magic Initiate (Cleric)" -> {refKind:"feature", refId:"magic-initiate",
// name:"Magic Initiate", note:"Cleric"} — same {refKind,refId,name}
// convention every other Library reference uses, `refId` a bare slug
// matching what content-feature-matching.js's promotion step independently
// derives for the same Feat, no import-order dependency. `note` is real,
// distinct information (which class's spell list this Feat is flavored
// for), not decorative.
function parseFeatWithNote(text) {
  if (!text) return null;
  const match = /^(.+?)\s*\(([^)]+)\)\s*$/.exec(text.trim());
  const name = match ? match[1].trim() : text.trim();
  const feat = { refKind: "feature", refId: slugify(name), name };
  if (match) feat.note = match[2].trim();
  return feat;
}

// Crude English de-pluralization for equipment names ("Handaxes" -> "Handaxe")
// — good enough for D&D's mostly-regular item names, not a real inflector.
function singularizeItemName(name) {
  if (/ies$/i.test(name)) return name.replace(/ies$/i, "y");
  if (/s$/i.test(name) && !/ss$/i.test(name)) return name.replace(/s$/i, "");
  return name;
}

// Mirrors the 5e API's equipment-choice shape, minus the per-item `url` (DDB
// gives no 5e API item reference). Three patterns, checked in order: "4
// Handaxes" (leading count, name singularized); "Parchment (10 sheets)"
// (count in a trailing parenthetical, name not pluralized — "Calligrapher's
// Supplies" also ends in a paren but with no digit inside, meaning it's a
// note like the feat's "(Cleric)", not a count); and a bare name with
// neither (count 1, name used exactly as written, not singularized).
function parseMoneyOrItem(text) {
  const trimmed = text.trim().replace(/[.,;]+$/, "");
  const moneyMatch = /^(\d+)\s*(gp|sp|cp|pp|ep)$/i.exec(trimmed);
  if (moneyMatch) {
    return { option_type: "money", count: Number(moneyMatch[1]), unit: moneyMatch[2].toLowerCase() };
  }
  const leadingCountMatch = /^(\d+)\s+(.*)$/.exec(trimmed);
  if (leadingCountMatch) {
    const name = singularizeItemName(leadingCountMatch[2].trim());
    return { option_type: "counted_reference", count: Number(leadingCountMatch[1]), of: { index: slugify(name), name } };
  }
  const parenMatch = /^(.+?)\s*\(([^)]+)\)$/.exec(trimmed);
  if (parenMatch) {
    const name = parenMatch[1].trim();
    const inner = parenMatch[2].trim();
    const digitMatch = /^(\d+)/.exec(inner);
    if (digitMatch) {
      return { option_type: "counted_reference", count: Number(digitMatch[1]), of: { index: slugify(name), name } };
    }
    return { option_type: "counted_reference", count: 1, of: { index: slugify(name), name, note: capitalize(inner) } };
  }
  return { option_type: "counted_reference", count: 1, of: { index: slugify(trimmed), name: trimmed } };
}

// "Choose A or B: (A) Greataxe, 4 Handaxes, Explorer's Pack, and 15 GP; or
// (B) 75 GP" -> the 5e API's starting_equipment_options shape: a lettered
// option is `multiple` (a bundle) when it has more than one component, or
// that single component directly when it doesn't (matching how the real API
// represents a pure-gold option like "(B) 75 GP" unwrapped).
function parseStartingEquipmentOptions(text) {
  if (!text) return [];
  const headerMatch = /^choose\s+[a-z](?:\s*(?:or|,)\s*[a-z])*\s*:\s*(.*)$/i.exec(text.trim());
  if (!headerMatch) return [];
  const rest = headerMatch[1];
  const segments = rest
    .split(/;?\s*\bor\b\s*(?=\([A-Za-z]\))/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!segments.length) return [];
  const options = segments.map((segment) => {
    const withoutLetter = segment.replace(/^\([A-Za-z]\)\s*/, "").trim();
    const items = withoutLetter
      .split(/,|\band\b/i)
      .map((part) => part.trim())
      .filter(Boolean)
      .map(parseMoneyOrItem);
    return items.length > 1 ? { option_type: "multiple", items } : items[0];
  });
  const desc = rest.replace(/;\s*/g, " ").trim();
  return [{ desc, choose: 1, type: "equipment", from: { option_set_type: "options_array", options } }];
}

// Generic helpers (not ddb-parser.js ports): deriving a 5e-API-style `index`
// slug from a scraped page's plain name, and collapsing a scraped page's
// paragraph-array (`descLines`) into the single description string the 5e
// API uses — both string operations the formula engine has no functions for.
function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/'/g, "") // "Explorer's Pack" -> "explorers-pack", matching the 5e API's own index convention
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function formatSigned(value) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value}`;
}

// Accepts either a decimal number (5e API's raw `challenge_rating`) or a
// fraction/whole-number string ("1/8", "1/2", "5" — DDB's already-resolved
// challengeRating shortName), same dual-shape input formatChallengeRating
// handles.
function crToNumber(value) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim();
  if (!text) return NaN;
  if (text.includes("/")) {
    const [numerator, denominator] = text.split("/").map(Number);
    return denominator ? numerator / denominator : NaN;
  }
  return Number(text);
}

// DDB's `actions` bucket groups entries by source (race/class/feat/...) —
// flattened to one list since attacksTable doesn't care which source an
// attack came from.
function flattenActions(actions) {
  if (!actions || typeof actions !== "object") return [];
  return Object.values(actions).reduce((all, group) => (Array.isArray(group) ? all.concat(group) : all), []);
}

function formatActionDamage(dice) {
  if (!dice) return null;
  const base = typeof dice === "string" ? dice : dice.diceString || "";
  return base || null;
}

// A small, stable, edition-core vocabulary (10 named 5e fighting styles),
// used only to recognize a feat by its exact PHB name for the
// attacksPerAction/fightingStyle summary — kept inline rather than a new
// System field for this one lookup.
const FIGHTING_STYLES = new Set([
  "archery",
  "blind fighting",
  "defense",
  "dueling",
  "great weapon fighting",
  "interception",
  "protection",
  "superior technique",
  "thrown weapon fighting",
  "two-weapon fighting",
]);

function determineFightingStyle(feats) {
  if (!Array.isArray(feats)) return null;
  const match = feats.find((feat) => {
    const name = feat?.definition?.name || feat?.name;
    return name ? FIGHTING_STYLES.has(name.toLowerCase()) : false;
  });
  return match?.definition?.name || match?.name || null;
}

function mapStats(statsArray) {
  if (!Array.isArray(statsArray)) return {};
  return statsArray.reduce((map, entry) => {
    const ability = ABILITIES.find((candidate) => candidate.id === entry.id);
    if (ability && typeof entry.value === "number") {
      map[ability.name] = entry.value;
    }
    return map;
  }, {});
}

function getActiveModifiers(rawCharacter, options = {}) {
  if (!rawCharacter || typeof rawCharacter !== "object") return [];
  const modifiers = rawCharacter.modifiers || {};
  const inventory = Array.isArray(rawCharacter.inventory) ? rawCharacter.inventory : [];
  const activeComponentIds = new Set();
  const respectIsGranted = Boolean(options.respectIsGranted);
  const grantedComponentIds = new Set();
  const activeGranted = [];
  const seenGrantedIds = new Set();

  inventory.forEach((item) => {
    const defId = item.definition?.id;
    if (!defId) return;
    const requiresAttunement = Boolean(item.definition?.canAttune);
    const attuned = !requiresAttunement || item.isAttuned;
    const equippable = Boolean(item.definition?.canEquip);
    const equipped = equippable ? item.equipped : true;
    const usable = equipped && attuned;

    const grantedMods = Array.isArray(item.definition?.grantedModifiers) ? item.definition.grantedModifiers : [];
    grantedMods.forEach((mod) => {
      if (mod?.componentId != null) grantedComponentIds.add(mod.componentId);
      if (mod?.id != null) grantedComponentIds.add(mod.id);
    });

    if (usable) {
      activeComponentIds.add(defId);
      if (item.id) {
        activeComponentIds.add(item.id);
      }

      grantedMods.forEach((mod) => {
        if (!mod || (respectIsGranted && mod.isGranted === false)) return;
        const componentId = mod.componentId ?? defId ?? item.id;
        const id = mod.id ?? componentId;
        if (id && seenGrantedIds.has(id)) return;
        if (id) seenGrantedIds.add(id);
        activeGranted.push({ ...mod, componentId });
      });
    }
  });

  const collected = Object.entries(modifiers).reduce((all, [group, entries]) => {
    if (!Array.isArray(entries)) return all;
    entries.forEach((modifier) => {
      if (group === "item") {
        if (modifier.componentId && !activeComponentIds.has(modifier.componentId) && !grantedComponentIds.has(modifier.componentId))
          return;
        if (!modifier.componentId && !activeComponentIds.size) return;
      }
      if (respectIsGranted && modifier.isGranted === false) return;
      all.push(modifier);
    });
    return all;
  }, []);

  if (!activeGranted.length) return collected;

  const seen = new Set();
  activeGranted.forEach((mod) => {
    const key = mod.id || `${mod.type}-${mod.subType}-${mod.componentId || ""}`;
    seen.add(key);
  });

  collected.forEach((mod) => {
    const key = mod.id || `${mod.type}-${mod.subType}-${mod.componentId || ""}`;
    if (!seen.has(key)) {
      activeGranted.push(mod);
      seen.add(key);
    }
  });

  return activeGranted;
}

// True if any modifier matches one of the given subtypes AND type (e.g.
// advantage/disadvantage on a save or skill) — same subtype-matching
// convention as collectModifiers, just a boolean presence check. Used to
// attach advantage/disadvantage directly to the ability/skill it applies to
// instead of a separate generic bucket.
function hasModifierOfType(modifiers, subtypes, type) {
  if (!Array.isArray(modifiers)) return false;
  const normalized = (Array.isArray(subtypes) ? subtypes : [subtypes]).map((entry) => (entry || "").toLowerCase()).filter(Boolean);
  if (!normalized.length) return false;
  return modifiers.some(
    (modifier) => (modifier.type || "").toLowerCase() === type && normalized.includes((modifier.subType || "").toLowerCase())
  );
}

function collectModifiers(modifiers, subtype, type) {
  if (!Array.isArray(modifiers)) return 0;
  const subtypes = Array.isArray(subtype) ? subtype.filter(Boolean) : [subtype];
  const normalized = subtypes.map((entry) => (entry || "").toLowerCase()).filter(Boolean);
  if (!normalized.length) return 0;

  const types = Array.isArray(type)
    ? type.map((entry) => (entry || "").toLowerCase()).filter(Boolean)
    : type
    ? [(type || "").toLowerCase()]
    : [];

  return modifiers
    .filter((modifier) => {
      if (types.length && !types.includes((modifier.type || "").toLowerCase())) return false;
      const modSubtype = (modifier.subType || "").toLowerCase();
      const cleanedSubtype = modSubtype.startsWith("skill-") ? modSubtype.slice(6) : modSubtype;
      return normalized.includes(modSubtype) || normalized.includes(cleanedSubtype);
    })
    .reduce((total, modifier) => total + (modifier.fixedValue ?? modifier.value ?? 0), 0);
}

function collectMaxModifier(modifiers, subtype, type) {
  if (!Array.isArray(modifiers)) return 0;
  const subtypes = Array.isArray(subtype) ? subtype.filter(Boolean) : [subtype];
  const normalized = subtypes.map((entry) => (entry || "").toLowerCase()).filter(Boolean);
  if (!normalized.length) return 0;
  const types = Array.isArray(type)
    ? type.map((entry) => (entry || "").toLowerCase()).filter(Boolean)
    : type
    ? [(type || "").toLowerCase()]
    : [];

  return modifiers
    .filter((modifier) => {
      if (types.length && !types.includes((modifier.type || "").toLowerCase())) return false;
      const modSubtype = (modifier.subType || "").toLowerCase();
      const cleanedSubtype = modSubtype.startsWith("skill-") ? modSubtype.slice(6) : modSubtype;
      return normalized.includes(modSubtype) || normalized.includes(cleanedSubtype);
    })
    .reduce((max, modifier) => Math.max(max, modifier.fixedValue ?? modifier.value ?? 0), 0);
}

function collectGeneralSavingThrowBonus(modifiers) {
  if (!Array.isArray(modifiers)) return 0;
  const abilitySubtypes = new Set(Object.values(SAVING_THROW_SUBTYPES));
  const abilityNames = ABILITIES.map((ability) => ability.friendlyName.toLowerCase());
  const shortNames = ABILITIES.map((ability) => ability.shortName.toLowerCase());
  const generalBonuses = modifiers.filter((modifier) => {
    if ((modifier.type || "").toLowerCase() !== "bonus") return false;
    const subtype = (modifier.subType || "").toLowerCase();
    const friendlySubtype = (modifier.friendlySubtypeName || "").toLowerCase();
    const restriction = (modifier.restriction || "").toLowerCase();
    const matchesSaving =
      subtype === "saving-throws" ||
      subtype.includes("saving-throws") ||
      friendlySubtype.includes("saving throw") ||
      restriction.includes("saving throw");
    if (!matchesSaving) return false;
    const abilityFriendly = abilityNames.some((name) => friendlySubtype.includes(name));
    const abilityShort = shortNames.some((short) => friendlySubtype.includes(short));
    const isAbilitySpecific = abilitySubtypes.has(subtype) || abilityFriendly || abilityShort;
    return !isAbilitySpecific;
  });

  const generalMax = generalBonuses.reduce((max, modifier) => Math.max(max, modifier.fixedValue ?? modifier.value ?? 0), 0);
  const explicitMax = collectMaxModifier(modifiers, "saving-throws", "bonus");
  return Math.max(generalMax, explicitMax);
}

function collectItemSavingThrowBonus(rawCharacter) {
  if (!rawCharacter || !Array.isArray(rawCharacter.inventory)) return 0;
  return rawCharacter.inventory.reduce((max, item) => {
    const definition = item?.definition || {};
    const requiresAttunement = Boolean(definition.canAttune);
    const attuned = !requiresAttunement || item.isAttuned;
    const equippable = Boolean(definition.canEquip);
    const equipped = equippable ? item.equipped : true;
    if (!attuned || !equipped) return max;

    const granted = Array.isArray(definition.grantedModifiers) ? definition.grantedModifiers : [];
    const bonus = granted
      .filter((modifier) => {
        if (!modifier || (modifier.type || "").toLowerCase() !== "bonus") return false;
        const subtype = (modifier.subType || "").toLowerCase();
        const friendly = (modifier.friendlySubtypeName || "").toLowerCase();
        return subtype === "saving-throws" || subtype.includes("saving-throws") || friendly.includes("saving throw");
      })
      .reduce((current, modifier) => Math.max(current, modifier.fixedValue ?? modifier.value ?? 0), 0);

    return Math.max(max, bonus);
  }, 0);
}

function determineProficiencyLevel(modifiers, subtype) {
  if (!Array.isArray(modifiers)) return { level: 0, roundUp: false };
  const subtypes = Array.isArray(subtype) ? subtype.filter(Boolean) : [subtype];
  const normalized = subtypes.map((entry) => (entry || "").toLowerCase()).filter(Boolean);
  let level = 0;
  let roundUp = false;

  modifiers
    .filter((modifier) => {
      const modSubtype = (modifier.subType || "").toLowerCase();
      const cleanedSubtype = modSubtype.startsWith("skill-") ? modSubtype.slice(6) : modSubtype;
      return normalized.includes(modSubtype) || normalized.includes(cleanedSubtype);
    })
    .forEach((modifier) => {
      if (modifier.type === "proficiency") level = Math.max(level, modifier.value ?? 3);
      if (modifier.type === "expertise") level = Math.max(level, modifier.value ?? 4);
      if (modifier.type === "half-proficiency") level = Math.max(level, modifier.value ?? 1);
      if (modifier.type === "half-proficiency-round-up") {
        level = Math.max(level, modifier.value ?? 2);
        roundUp = true;
      }
    });
  return { level, roundUp };
}

function applyProficiency(level, proficiencyBonus, roundUp = false) {
  if (!level || !proficiencyBonus) return 0;
  if (level === 3) return proficiencyBonus;
  if (level === 4) return proficiencyBonus * 2;
  if (level === 1 || level === 2) {
    const scaled = proficiencyBonus / 2;
    return roundUp ? Math.ceil(scaled) : Math.floor(scaled);
  }
  return Math.floor(proficiencyBonus * level);
}

function getTotalLevelRaw(classes) {
  if (!Array.isArray(classes)) return 0;
  return classes.reduce((total, cls) => total + (cls.level || 0), 0);
}

function getProficiencyBonusRaw(totalLevel) {
  return evaluateDerivedFormula(DERIVED_FORMULAS, "proficiencyBonusForLevel", { level: totalLevel }) || 0;
}

function calculateAbilityScores(rawCharacter, modifiers) {
  const baseStats = mapStats(rawCharacter.stats);
  const bonusStats = mapStats(rawCharacter.bonusStats);
  const overrideStats = mapStats(rawCharacter.overrideStats);

  return ABILITIES.reduce((scores, ability) => {
    const base = overrideStats[ability.name] ?? baseStats[ability.name] ?? 10;
    const bonus = (bonusStats[ability.name] || 0) + collectModifiers(modifiers, `${ability.name}-score`, "bonus");
    const overrideFromModifier = collectModifiers(modifiers, `${ability.name}-score`, ["set", "set-base"]);
    scores[ability.name] = overrideFromModifier || base + bonus;
    return scores;
  }, {});
}

// Shared by skillsTable and sensesTable (passive Perception/Investigation/
// Insight need the same computed skill values) — standalone rather than
// sensesTable calling `this.skillsTable`, since these are plain
// object-literal methods and nothing guarantees the mapping engine preserves
// `this` when invoking them.
function buildSkillValues(rawCharacter) {
  const modifiers = getActiveModifiers(rawCharacter);
  const scores = calculateAbilityScores(rawCharacter, modifiers);
  const totalLevel = getTotalLevelRaw(rawCharacter?.classes);
  const proficiencyBonus = getProficiencyBonusRaw(totalLevel);

  return SKILLS.map((skill) => {
    const linkedAbility = ABILITIES[skill.stat];
    const abilityModifier = Math.floor(((scores[linkedAbility.name] || 10) - 10) / 2);
    const subtypes = [skill.name, `skill-${skill.name}`, `${linkedAbility.name}-ability-checks`, "ability-checks"];
    const { level, roundUp } = determineProficiencyLevel(modifiers, subtypes);
    const skillBonus = collectModifiers(modifiers, subtypes, "bonus");
    return {
      ...skill,
      ability: linkedAbility.shortName,
      value: abilityModifier + applyProficiency(level, proficiencyBonus, roundUp) + skillBonus,
      proficiency: level,
      advantage: hasModifierOfType(modifiers, subtypes, "advantage"),
      disadvantage: hasModifierOfType(modifiers, subtypes, "disadvantage"),
    };
  });
}

function determineSpellcastingAbility(classes) {
  if (!Array.isArray(classes)) return null;
  const caster = classes.find((cls) => cls.definition?.canCastSpells) || classes[0];
  if (!caster) return null;
  return ABILITIES.find((entry) => entry.id === caster.definition?.spellCastingAbilityId) || null;
}

// A D&D Beyond monster's specialTraitsDescription/actionsDescription is raw
// HTML: one `<p>` per trait/action, name bolded (`<strong>Name.</strong>`,
// sometimes wrapped in `<em>` too — an action's `<em>` sometimes continues
// past the name to also wrap a type label, which is why this anchors on the
// closing `</strong>`, not on where `<em>` ends). Uses the DOM (this module
// only runs in a browser) to decode entities/strip nested tags rather than a
// hand-rolled entity table.
function stripHtmlToText(html) {
  const el = document.createElement("div");
  el.innerHTML = html;
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

// A Character-domain feat/feature/racial-trait's description text is raw
// HTML too, same as a monster's specialTraitsDescription above. Unlike a
// monster's shape (always simple `<p>` paragraphs), a feat/feature's text
// can also include `<ul>/<li>` option lists, `<hr>`/`<h5>` section breaks,
// and plain paragraphs with no bolded name prefix. Rather than a second
// regex-based paragraph splitter, this walks the parsed DOM's own top-level
// child nodes directly, keeping block-level structure (paragraph breaks,
// list bullets) instead of collapsing to one line.
// A close sibling of stripHtmlToText, not a modification of it —
// stripHtmlToText's other caller (Monster's trait-block splitter) has no
// Rich Text rendering downstream, so injecting "**"/"*" markers there would
// show up as stray asterisks on a monster's stat block instead of real
// emphasis.
function stripHtmlToMarkdown(html) {
  if (typeof html !== "string" || !/<[a-z][\s\S]*>/i.test(html)) {
    return html;
  }
  const el = document.createElement("div");
  el.innerHTML = html;
  el.querySelectorAll("strong, b").forEach((node) => {
    node.replaceWith(document.createTextNode(`**${node.textContent}**`));
  });
  el.querySelectorAll("em, i").forEach((node) => {
    node.replaceWith(document.createTextNode(`*${node.textContent}*`));
  });
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

function htmlBlocksToText(html) {
  if (!html) return "";
  const container = document.createElement("div");
  container.innerHTML = String(html);
  const lines = [];
  const walk = (node) => {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === 3) {
        const text = (child.textContent || "").replace(/\s+/g, " ").trim();
        if (text) lines.push(text);
        return;
      }
      if (child.nodeType !== 1) return;
      const tag = child.tagName;
      if (tag === "HR") return;
      if (tag === "UL" || tag === "OL") {
        const ordered = tag === "OL";
        Array.from(child.children)
          .filter((li) => li.tagName === "LI")
          .forEach((li, index) => {
            const text = stripHtmlToMarkdown(li.innerHTML);
            if (text) lines.push(ordered ? `${index + 1}. ${text}` : `- ${text}`);
          });
        return;
      }
      // A "Core <Class> Traits"-style key/value table uses one
      // <th>Label</th><td>Value</td> row per fact, a different shape than
      // ddb-content-parser.js's own tableToLines handles.
      if (tag === "TABLE") {
        const rows = Array.from(child.querySelectorAll("tbody tr"))
          .map((row) => Array.from(row.querySelectorAll("th, td")).map((cell) => stripHtmlToMarkdown(cell.innerHTML)).filter(Boolean))
          .filter((cells) => cells.length);
        if (!rows.length) return;
        // 2-column case must keep matching ddb-content-parser.js's own
        // tableToLines byte-for-byte — cross-scope de-dup depends on it.
        if (rows.every((cells) => cells.length === 2)) {
          rows.forEach((cells) => {
            lines.push(/^\d+(st|nd|rd|th)?$/i.test(cells[0]) ? `Level ${cells[0]}: ${cells[1]}` : `${cells[0]}: ${cells[1]}`);
          });
          return;
        }
        // 3+ columns — a real markdown table, pushed as ONE combined line
        // (rows joined with a single "\n") since this function's final
        // `lines.join("\n\n")` would otherwise insert a blank line between
        // every row, breaking CommonMark table syntax.
        const headerCells = Array.from(child.querySelectorAll("thead th")).map((th) => stripHtmlToMarkdown(th.innerHTML));
        const columnCount = Math.max(...rows.map((cells) => cells.length));
        const header =
          headerCells.length === columnCount ? headerCells : Array.from({ length: columnCount }, (_, i) => `Column ${i + 1}`);
        const tableLines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
        rows.forEach((cells) => {
          const padded = Array.from({ length: columnCount }, (_, i) => cells[i] || "");
          tableLines.push(`| ${padded.join(" | ")} |`);
        });
        lines.push(tableLines.join("\n"));
        return;
      }
      // A wrapper DIV is transparent — recurse into its children rather than
      // treating it as opaque (DDB wraps content in these often).
      if (tag === "DIV") {
        walk(child);
        return;
      }
      const text = stripHtmlToMarkdown(child.innerHTML || child.textContent || "");
      if (text) lines.push(text);
    });
  };
  walk(container);
  return lines.join("\n\n");
}

// A `<p>` with no leading bolded name is a CONTINUATION of the previous
// trait's description, not a new entry — some traits split across two `<p>`
// tags, the second with no name at all.
function parseDdbHtmlTraitBlocks(html) {
  const text = typeof html === "string" ? html : "";
  if (!text.trim()) return [];
  const paragraphs = text.match(/<p>[\s\S]*?<\/p>/g) || [];
  const entries = [];
  paragraphs.forEach((raw) => {
    const inner = raw.replace(/^<p>/, "").replace(/<\/p>$/, "");
    const match = inner.match(/^\s*(?:<em>)?\s*<strong>([^<]+)<\/strong>\s*/);
    if (match) {
      entries.push({
        name: stripHtmlToText(match[1]),
        description: stripHtmlToText(inner.slice(match[0].length)),
      });
      return;
    }
    const continuation = stripHtmlToText(inner);
    if (!continuation) return;
    const previous = entries[entries.length - 1];
    if (previous) {
      previous.description = previous.description ? `${previous.description}\n\n${continuation}` : continuation;
    } else {
      entries.push({ name: "", description: continuation });
    }
  });
  return entries;
}

// A standalone function, not an object-literal method, so
// proficiencyDefenses/proficiencyLanguages below can call it directly
// without relying on `this` (see buildSkillValues above for why).
function buildProficiencyBuckets(context) {
  const modifiers = getActiveModifiers(context.root);
  const buckets = { armor: [], weapons: [], tools: [], languages: [], defenses: [], senses: [], other: [] };

  const defenseMap = new Map();
  const addDefense = (entry) => {
    const key = `${(entry.type || "").toLowerCase()}|${(entry.name || "").toLowerCase()}|${(entry.condition || "").toLowerCase()}`;
    const existing = defenseMap.get(key);
    if (!existing) {
      defenseMap.set(key, entry);
      buckets.defenses.push(entry);
      return;
    }
    if (entry.value != null && (!existing.value || entry.value > existing.value)) existing.value = entry.value;
  };

  const knownSenseNames = new Set(SENSES.map((sense) => sense.name));

  modifiers.forEach((modifier) => {
    const subtype = (modifier.subType || "").toLowerCase();
    const normalizedSubtype = subtype.startsWith("skill-") ? subtype.slice(6) : subtype;
    const friendly = modifier.friendlySubtypeName || modifier.subType || "Unknown";
    const modType = (modifier.type || "").toLowerCase();
    const condition = modifier.restriction || null;

    if (modifier.isGranted === false && !["proficiency", "language"].includes(modType)) return;

    if (modType === "language") {
      buckets.languages.push(friendly);
      return;
    }
    // Advantage/disadvantage on initiative, a saving throw, or a skill/
    // ability check is already exposed as its own flag on that specific
    // thing's own table (initiativeTable/savingThrowsTable/
    // buildSkillValues) — recognized and skipped here rather than also
    // landing in "defenses" (the old script's own behavior, ported
    // faithfully until now — but advantage/disadvantage was never really
    // a "defense" the way resistance/immunity/vulnerability are, and
    // duplicating it here just meant every advantage source was
    // represented twice). A generic saving-throw *bonus* (not advantage)
    // is the same story: savingThrowsTable's own generalSaveBonus already
    // folds it into every ability's value. Only resistance/immunity/
    // vulnerability are true defenses; anything else recognized-but-
    // elsewhere is dropped, anything unrecognized falls through to
    // "other" so it's still visible somewhere (e.g. advantage on attack
    // rolls or death saves, which have no dedicated table of their own).
    if (["advantage", "disadvantage"].includes(modType)) {
      if (
        subtype === "initiative" ||
        subtype.endsWith("saving-throws") ||
        normalizedSubtype === "ability-checks" ||
        SKILLS.some((skill) => skill.name === normalizedSubtype) ||
        ABILITIES.some((ability) => ability.name === normalizedSubtype)
      ) {
        return;
      }
      buckets.other.push(friendly);
      return;
    }
    if (modType === "bonus" && subtype.includes("saving-throws")) return;
    if (["resistance", "immunity", "vulnerability"].includes(modType)) {
      addDefense({ name: friendly, type: modifier.type, condition });
      return;
    }
    if (!modType.includes("proficiency")) {
      buckets.other.push(friendly);
      return;
    }

    if (subtype.includes("armor") || subtype === "shields") {
      buckets.armor.push(friendly);
      return;
    }
    // Saving throw / skill / ability-score proficiencies are dropped here
    // (see this function's own comment above) — recognized and skipped
    // rather than falling through to "other".
    if (
      subtype.endsWith("saving-throws") ||
      normalizedSubtype === "ability-checks" ||
      SKILLS.some((skill) => skill.name === normalizedSubtype) ||
      ABILITIES.some((ability) => ability.name === normalizedSubtype)
    ) {
      return;
    }
    if (knownSenseNames.has(normalizedSubtype)) {
      buckets.senses.push(friendly);
      return;
    }
    if (
      subtype.includes("tool") ||
      subtype.includes("kit") ||
      subtype.includes("suppl") ||
      subtype.includes("instrument") ||
      subtype.includes("gaming-set") ||
      subtype.includes("vehicle") ||
      modifier.entityTypeId === 2103445194
    ) {
      buckets.tools.push(friendly);
      return;
    }
    if (subtype.includes("weapon")) {
      buckets.weapons.push(friendly);
      return;
    }

    buckets.other.push(friendly);
  });

  buckets.armor = Array.from(new Set(buckets.armor));
  buckets.weapons = Array.from(new Set(buckets.weapons));
  buckets.tools = Array.from(new Set(buckets.tools));
  buckets.languages = Array.from(new Set(buckets.languages));
  buckets.senses = Array.from(new Set(buckets.senses));
  buckets.other = Array.from(new Set(buckets.other));
  return buckets;
}

// Shared by fantasyStatblockSplitList and fantasyStatblockSources below —
// a plain comma-separated string (or an already-split array) into a
// trimmed, non-empty string array.
function splitCommaList(raw) {
  if (Array.isArray(raw)) return raw.map((entry) => String(entry).trim()).filter(Boolean);
  return String(raw || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// Fantasy Statblocks' own post-fence text (see loadFantasyStatblockData's
// own comment, content-fetch.js) is an optional "### Description" heading +
// prose, then an optional "### References" heading + a bulleted list of
// source citations (confirmed against all 3 real reference files this
// format was reverse-engineered from — heading level is always `###`, but
// matched loosely here in case a hand-edited file uses a different level).
// Splits the two apart: everything before the References heading is real
// notes prose; everything after it, one bullet per line (`*` or `-`
// prefixed — both appear across the 3 reference files), is citation data
// that belongs in `sources`, not mixed into notes. No References heading
// found at all (not every statblock has one) — the whole text is notes,
// references stays empty.
function splitFantasyStatblockNotes(raw) {
  const text = String(raw || "");
  const headingMatch = text.match(/^#{1,6}\s*references\s*$/im);
  if (!headingMatch) return { notes: text.trim(), references: [] };
  const notes = text.slice(0, headingMatch.index).trim();
  const references = text
    .slice(headingMatch.index + headingMatch[0].length)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[*-]\s+/.test(line))
    .map((line) => line.replace(/^[*-]\s+/, "").trim())
    .filter(Boolean);
  return { notes, references };
}

// Splits a markdown-wonder item's own italic header line ("Weapon (claws),
// legendary (requires attunement by a monk)", "Wondrous Item, Very Rare,
// Requires Attunement", "Potion, rare") into the same {category, rarity,
// requiresAttunement} pieces srdItemStats reads off separate 5e API fields.
// Two attunement phrasings: parenthesized (5e API convention) and a bare
// trailing comma clause (several custom items use this instead).
// Category/rarity are "whatever's left of a two-part comma split" — category
// is allowed its own internal parens (a weapon's "(claws)" qualifier), which
// is why this splits on the LAST comma rather than the first.
// This vault's equipment category names that share zero characters with the
// matching System Item Form value's name (so resolveLivePropertyValue's
// exact/plural-fold match can't bridge them) — "Adventuring gear" against
// sys.dnd5e's "Equipment". Kept here, not vault-feature-matching.js, since
// this is this markdown vault's own vocabulary. Also feeds
// srdEquipmentStats — Tools/Ammunition/Mounts and Vehicles are all broad
// "Equipment" at the Item Form level; the specific sub-category is captured
// separately as `properties.equipmentCategory`.
const MARKDOWN_ITEM_FORM_ALIASES = {
  "adventuring gear": "Equipment",
  tools: "Equipment",
  "artisan's tools": "Equipment",
  "musical instruments": "Equipment",
  "gaming sets": "Equipment",
  "other tools": "Equipment",
  "mounts and vehicles": "Equipment",
  ammunition: "Equipment",
};

// The bare form-matching hint for an item's category — strips a trailing
// parenthetical SUBTYPE qualifier ("Weapon (claws)" -> "Weapon") before
// matching against the System's Item Form vocabulary, then applies the
// alias table above. The qualifier stays in `category` itself (full string
// kept for display/notes) — excluded from the match attempt only.
//
// Also feeds ddb-item.json's equipment import — a second source vocabulary.
// DDB's own equipment "Type" string prefixes the real Item Form word with a
// weapon-proficiency/armor-weight qualifier instead ("Martial Melee
// Weapon", "Light Armor"). Once the alias table finds no exact match,
// reducing to a trailing Weapon/Armor word lets the exact match find the
// System's value without hardcoding every DDB qualifier as its own alias.
function resolveMarkdownItemFormHint(category) {
  const bare = String(category || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  const aliased = MARKDOWN_ITEM_FORM_ALIASES[bare.toLowerCase()];
  if (aliased) return aliased;
  const trailingFormWord = bare.match(/\b(Weapon|Armor)$/i);
  return trailingFormWord ? trailingFormWord[1] : bare;
}

function parseMarkdownItemHeaderLine(headerLine) {
  const raw = String(headerLine || "");
  if (!raw) return { category: "", rarity: "", requiresAttunement: false };
  const requiresAttunement = /requires attunement/i.test(raw);
  let cleaned = raw.replace(/\(requires attunement[^)]*\)/i, "").trim();
  cleaned = cleaned.replace(/,?\s*requires attunement.*$/i, "").trim();
  cleaned = cleaned.replace(/,\s*$/, "");
  const commaIndex = cleaned.lastIndexOf(",");
  if (commaIndex === -1) return { category: cleaned, rarity: "", requiresAttunement };
  return {
    category: cleaned.slice(0, commaIndex).trim(),
    rarity: cleaned.slice(commaIndex + 1).trim(),
    requiresAttunement,
  };
}

// Same idea for a spell's own italic header line ("3rd-level evocation",
// "Evocation cantrip", "1st-level divination (ritual)") — level/school are
// only ever given inline in this vault's markdown, never as separate fields
// the way the 5e API's `level`/`school.name` are.
function parseMarkdownSpellHeaderLine(headerLine) {
  const raw = String(headerLine || "");
  const ritual = /\(ritual\)/i.test(raw);
  const cantripMatch = raw.match(/^([a-z][a-z\s]*?)\s+cantrip\b/i);
  if (cantripMatch) return { level: 0, school: cantripMatch[1].trim(), ritual };
  const leveledMatch = raw.match(/^(\d+)\w{2}-level\s+([a-z]+)/i);
  if (leveledMatch) return { level: Number(leveledMatch[1]), school: leveledMatch[2].trim(), ritual };
  return { level: 0, school: "", ritual };
}

// Expands a "base dice at base level, +increment dice per level above base"
// scaling clause into the same `{level: diceString}` ladder the 5e API's own
// damage_at_slot_level already gives srdSpellStats — e.g. base level 3,
// "8d6", increment "1d6" -> {3:"8d6", 4:"9d6", ..., 9:"14d6"}. Falls back to
// a single-entry ladder when the increment die doesn't match the base die's
// size, since that's a real formula this simple arithmetic can't safely guess.
function expandMarkdownDiceLadder(baseLevel, baseDice, incrementDice, maxLevel) {
  const base = String(baseDice || "").match(/^(\d+)d(\d+)$/i);
  const inc = String(incrementDice || "").match(/^(\d+)d(\d+)$/i);
  if (!base || !inc || base[2] !== inc[2]) return { [baseLevel]: baseDice };
  const sides = base[2];
  const baseCount = Number(base[1]);
  const incCount = Number(inc[1]);
  const values = {};
  for (let level = baseLevel; level <= maxLevel; level++) {
    values[level] = `${baseCount + (level - baseLevel) * incCount}d${sides}`;
  }
  return values;
}

// A cantrip's character-level scaling is stated as explicit thresholds in
// prose ("...when you reach 5th level (2d6), 11th level (3d6)..."), not a
// uniform per-level formula — parsed as literal (level, dice) pairs rather
// than via expandMarkdownDiceLadder. Returns null when no such clause is
// found, so the caller can fall through to the slot-scaling check instead.
function parseMarkdownCantripScaling(description, baseDice) {
  const matches = [...String(description || "").matchAll(/(\d+)\w{2}\s*level\s*\((\d+d\d+)\)/gi)];
  if (!matches.length) return null;
  const values = { 1: baseDice };
  matches.forEach((m) => {
    values[Number(m[1])] = m[2];
  });
  return values;
}

// Best-effort reconstruction of the `stats.mechanic` shape srdSpellStats
// reads off the 5e API's structured `damage`/`heal_at_slot_level` fields,
// but derived from prose — this vault's markdown spells have no structured
// fields at all. Four phrasings: an attack roll, a save-for-half, a binary
// save, and a flat heal. Deliberately narrower than a full NLP parse — a
// spell matching none of these (the majority: buff/utility spells like
// Bless) correctly returns null, falling through to the ordinary
// candidateUnits clause-recognizer pipeline.
function parseMarkdownSpellMechanic(description, higherLevel, level) {
  const baseLevel = level || 1;
  const text = String(description || "");

  const healMatch = text.match(/regains? (?:a number of )?hit points equal to (\d+d\d+)/i);
  if (healMatch) {
    const baseDice = healMatch[1];
    const slotMatch = String(higherLevel || "").match(/heal(?:ing)? increases by (\d+d\d+) for each slot level above (\d+)\w{2}/i);
    const values = slotMatch ? expandMarkdownDiceLadder(Number(slotMatch[2]), baseDice, slotMatch[1], 9) : { [baseLevel]: baseDice };
    return { kind: "heal", scaling: { by: "slot", values } };
  }

  const attackMatch = text.match(/make an? (?:ranged|melee) spell attack[^.]*\.\s*On a hit,[^.]*?takes?\s*(\d+d\d+(?:\s*\+\s*\d+)?)\s*(\w+) damage/i);
  const saveHalfMatch =
    !attackMatch &&
    text.match(
      /must make an? (\w+) saving throw\.?\s*[^.]*?takes?\s*(\d+d\d+(?:\s*\+\s*\d+)?)\s*(\w+) damage on a failed save,?\s*or half as much damage on a successful one/i
    );
  const saveBinaryMatch = !attackMatch && !saveHalfMatch && text.match(/must succeed on an? (\w+) saving throw or takes?\s*(\d+d\d+(?:\s*\+\s*\d+)?)\s*(\w+) damage/i);
  // Last-resort fallback — the three patterns above all require exact PHB
  // boilerplate wording; a hand-authored custom spell phrased more loosely
  // matches none of them and would silently lose its damage entirely. This
  // only requires the dice + damage-type phrase to appear anywhere in the
  // text — it can't reliably distinguish attack/save-half/save-binary the
  // way the stricter patterns can, so it defaults to the most common real
  // shape (save for half), reading whichever saving-throw ability is
  // mentioned if any. Still better than attaching no damage at all.
  const looseMatch =
    !attackMatch && !saveHalfMatch && !saveBinaryMatch && text.match(/(\d+d\d+(?:\s*\+\s*\d+)?)\s*(\w+) damage/i);
  const damageMatch = attackMatch || saveHalfMatch || saveBinaryMatch || looseMatch;
  if (!damageMatch) return null;

  let resolutionKind;
  let saveAbility;
  let saveEffect;
  let damageDice;
  let damageType;
  if (attackMatch) {
    resolutionKind = "attack";
    [, damageDice, damageType] = attackMatch;
  } else if (saveHalfMatch) {
    resolutionKind = "save";
    [, saveAbility, damageDice, damageType] = saveHalfMatch;
    saveEffect = "half";
  } else if (saveBinaryMatch) {
    resolutionKind = "save";
    [, saveAbility, damageDice, damageType] = saveBinaryMatch;
    saveEffect = "none";
  } else {
    resolutionKind = "save";
    [, damageDice, damageType] = looseMatch;
    saveEffect = "half";
    const abilityMatch = text.match(/(\w+) saving throw/i);
    saveAbility = abilityMatch ? abilityMatch[1] : undefined;
  }
  const baseDice = damageDice.replace(/\s+/g, "");

  const cantripValues = parseMarkdownCantripScaling(text, baseDice);
  let values = cantripValues;
  if (!values) {
    const slotMatch = String(higherLevel || "").match(/damage increases by (\d+d\d+) for each slot level above (\d+)\w{2}/i);
    values = slotMatch ? expandMarkdownDiceLadder(Number(slotMatch[2]), baseDice, slotMatch[1], 9) : { [baseLevel]: baseDice };
  }

  const areaMatch = text.match(/(\d+)-foot (cone|line|sphere|radius|cube)/i);

  return {
    kind: "damage",
    resolutionKind,
    saveAbility: saveAbility ? saveAbility.toLowerCase() : undefined,
    saveEffect,
    damageType: damageType ? damageType.toLowerCase() : undefined,
    areaShape: areaMatch ? areaMatch[2].toLowerCase() : undefined,
    areaSize: areaMatch ? Number(areaMatch[1]) : undefined,
    scaling: { by: cantripValues ? "character-level" : "slot", values },
  };
}

// DDB's `.feats` array carries more than real, player-chosen feats — it's
// also a generic carrier slot for a class feature's own sub-choice (Weapon
// Mastery's "which weapons" selection) and GM-narrative hooks from a
// specific sourcebook/adventure. DDB tags every one of these
// `__DISGUISE_FEAT`, the same tag DDB's own web UI uses to hide them from a
// character's visible Feats list, while a real chosen feat is tagged
// "General" instead. Shared by featsTable and featuresTable below.
function isRealDdbFeat(feat) {
  return !(feat.definition?.categories || []).some((category) => category?.tagName === "__DISGUISE_FEAT");
}

// --- Registered custom functions (referenced by name from mapping JSON) ---

return {
  // `args.path` defaults to "name"; use e.g. {"path":"root.name"} to slug the
  // root/parent entity's name instead of the current context's own name.
  slug(context, args) {
    return slugify(resolvePath(context, args?.path || "name"));
  },

  // A "<parent>-<own>" compound slug — e.g. Variant records (subclasses,
  // species subspecies, background variants) whose bare name isn't
  // guaranteed unique across every other parent record in the Library.
  // `args.parentPath` defaults to "root.name", `args.path` to "name",
  // matching slug()'s own defaults. Genuinely generic, not subclass-specific.
  compoundSlug(context, args) {
    const parent = slugify(resolvePath(context, args?.parentPath || "root.name"));
    let ownRaw = String(resolvePath(context, args?.path || "name") || "");
    // `args.stripSourcebookSuffix` — opt-in only. A Character's own
    // subclassDefinition.name carries a trailing "(SOURCEBOOK)" tag DDB's
    // character-service API adds ("The Fathomless (TCOE)") that the
    // Library's own subclass record, scraped from the content page, never
    // carries — left in, the computed refId never matches the real variant.
    if (args?.stripSourcebookSuffix) {
      ownRaw = ownRaw.replace(/\s*\([^)]*\)\s*$/, "");
    }
    const own = slugify(ownRaw);
    // Both halves required, not filter(Boolean).join("-") — a character
    // with no subclass chosen yet has an empty name, and "barbarian" (parent
    // alone) would be a real but WRONG id implying a variant that doesn't exist.
    if (!parent || !own) return "";
    return `${parent}-${own}`;
  },

  // `args.path` names which raw HTML field to parse (e.g.
  // "specialTraitsDescription"/"actionsDescription") — see
  // parseDdbHtmlTraitBlocks above for the actual parsing. Returns
  // [{name, description}, ...], the same shape 5e-api-monster.json's own
  // traits/actions already use.
  ddbParseHtmlTraits(context, args) {
    return parseDdbHtmlTraitBlocks(resolvePath(context, args?.path || ""));
  },

  // DDB's monster-service payload carries no System reference at all —
  // there's only ever one game system a DDB monster could belong to.
  // Hardcoded "sys.dnd5e", dual-tagged with 2014's "sys.dnd5e2014" too, since
  // non-Character content is materially the same across both editions by
  // default, so imports land visible to either System filter. Every sibling
  // *SystemIds function below shares this reasoning and value, kept as
  // separate functions (not one shared name) so each mapping's own intent
  // stays legible at the call site.
  ddbMonsterSystemIds() {
    return ["sys.dnd5e", "sys.dnd5e2014"];
  },

  srdMonsterSystemIds() {
    return ["sys.dnd5e", "sys.dnd5e2014"];
  },

  ddbClassSystemIds() {
    return ["sys.dnd5e", "sys.dnd5e2014"];
  },

  srdClassSystemIds() {
    return ["sys.dnd5e", "sys.dnd5e2014"];
  },

  ddbSpeciesSystemIds() {
    return ["sys.dnd5e", "sys.dnd5e2014"];
  },

  srdSpeciesSystemIds() {
    return ["sys.dnd5e", "sys.dnd5e2014"];
  },

  ddbBackgroundSystemIds() {
    return ["sys.dnd5e", "sys.dnd5e2014"];
  },

  srdBackgroundSystemIds() {
    return ["sys.dnd5e", "sys.dnd5e2014"];
  },

  // ddb-subclass.json/5e-api-subclass.json are each their own dedicated
  // mapping (not nested under class.json), so they get their own pair too.
  ddbSubclassSystemIds() {
    return ["sys.dnd5e", "sys.dnd5e2014"];
  },

  srdSubclassSystemIds() {
    return ["sys.dnd5e", "sys.dnd5e2014"];
  },

  // Case-insensitive/trimmed creature-type resolution, for sources whose
  // `type` value is free text a human typed rather than a clean API-generated
  // slug: the 5e API's type string is always lowercase, but Fantasy
  // Statblocks' is whatever an author wrote. Without this fold, a strict
  // `===` lookup against the System's own lowercase-slug table fails silently
  // (bindings.js's catch swallows the throw to ""), and Crucible's Creature
  // Type select then defaults to whichever option is first alphabetically for
  // that empty value — doubly invisible. Falls back to the raw trimmed input,
  // unmodified, when nothing in the System's own vocabulary matches, rather
  // than discarding the author's stated intent. `args.path` defaults to "type".
  resolveCreatureType(context, args, env) {
    const raw = String(resolvePath(context, args?.path || "type") || "").trim();
    if (!raw) return "";
    const table = Array.isArray(env?.lookupTables?.creatureTypes) ? env.lookupTables.creatureTypes : [];
    const key = raw.toLowerCase();
    const match = table.find((entry) => String(entry?.name || "").toLowerCase() === key);
    return match ? match.name : raw;
  },

  // The 5e API's `image`/`url` fields are relative paths, not
  // fetchable/displayable as-is. Prefixed with the same SRD base URL
  // content-fetch.js's SRD_BASE_URL constant holds — duplicated as a literal
  // here rather than imported, since content-fetch.js already imports this
  // file, and importing back would be circular. Left alone if already
  // absolute. `args.path` defaults to "image".
  srdAbsoluteUrl(context, args) {
    const raw = resolvePath(context, args?.path || "image");
    if (!raw) return "";
    const text = String(raw);
    if (/^https?:\/\//i.test(text)) return text;
    return `https://www.dnd5eapi.co${text.startsWith("/") ? text : `/${text}`}`;
  },

  // Same reasoning/value as srdMonsterSystemIds — used by
  // 5e-api-spell.json/5e-api-magic-item.json instead.
  srdVaultSystemIds() {
    return ["sys.dnd5e", "sys.dnd5e2014"];
  },

  // Builds Vault's own `stats` shape from a raw 5e API spell record in ONE
  // pass — every field is read from the same raw object, and the
  // `mechanic` classification genuinely needs several of them together
  // (damage vs heal, attack vs save), which doesn't decompose cleanly into
  // independent per-field binds. Bound once via a `with` binding and read by
  // every sibling field that needs a piece of it.
  //
  // A spell with no recognized damage/heal shape (the majority — Bless,
  // Hold Person, most buff/utility spells) isn't left as one opaque blob:
  // its desc paragraphs become `stats.candidateUnits`, one candidate unit
  // per paragraph or bullet, for vault-feature-matching.js's clause-
  // recognizer library to classify.
  srdSpellStats(context, args, env) {
    const s = context.root || context;
    const descArr = Array.isArray(s.desc) ? s.desc : [];
    const description = descArr.join("\n\n");
    const higherLevel = Array.isArray(s.higher_level) && s.higher_level.length ? s.higher_level.join("\n\n") : "";
    const componentsList = Array.isArray(s.components) ? s.components.join(", ") : "";
    const components = s.material ? `${componentsList} (${s.material})` : componentsList;

    let mechanic = null;
    const scalingValues = s.damage?.damage_at_slot_level || s.damage?.damage_at_character_level;
    if (s.damage && scalingValues) {
      const abilityIndex = s.dc?.dc_type?.index;
      mechanic = {
        kind: "damage",
        resolutionKind: s.dc ? "save" : "attack",
        saveAbility: s.dc ? ABILITY_INDEX_TO_NAME[abilityIndex] || abilityIndex : undefined,
        saveEffect: s.dc ? s.dc.dc_success : undefined,
        damageType: s.damage.damage_type?.index,
        areaShape: s.area_of_effect?.type,
        areaSize: s.area_of_effect?.size,
        scaling: { by: s.damage.damage_at_slot_level ? "slot" : "character-level", values: scalingValues },
      };
    } else if (s.heal_at_slot_level) {
      mechanic = { kind: "heal", scaling: { by: "slot", values: s.heal_at_slot_level } };
    }

    const candidateUnits = mechanic ? [] : descArr.flatMap((p) => srdSplitBullets(p));
    // "Spell" is one of sys.dnd5e's own real Item Form values — resolved
    // against the System's live Item Form list, never hardcoded as a bare
    // "spell" slug, so a Loom rename is picked up automatically. Rarity/
    // Activation don't apply to a spell, so only `form` is set here.
    // `level` stays its own plain `stats.level` field rather than forced
    // into a Vault property — no existing System-level property for it yet.
    const spellFormMatch = resolveLivePropertyValue("Spell", env?.lookupTables?.itemForms);
    const properties = spellFormMatch ? { form: slugifyPropertyValueName(spellFormMatch) } : {};

    // Which classes can learn this spell — the suite's ordinary
    // {refKind, refId, name} ref shape, so a generic refKind-scanning
    // matcher can cross-reference against a character's identity.classes[]
    // with zero D&D-specific code. `subclasses` is informational only — the
    // SRD API's subclass index doesn't match this repo's own Variant record
    // ids, so it's kept as a plain {index, name} pair rather than a refKind
    // ref that would falsely imply it's safe to match against.
    const classes = Array.isArray(s.classes)
      ? s.classes.map((c) => ({ refKind: "class", refId: c.index, name: c.name }))
      : [];
    const subclasses = Array.isArray(s.subclasses)
      ? s.subclasses.map((c) => ({ index: c.index, name: c.name }))
      : [];

    return {
      name: s.name,
      level: s.level,
      school: s.school?.name,
      castingTime: s.casting_time,
      range: s.range,
      components,
      duration: s.duration,
      concentration: Boolean(s.concentration),
      ritual: Boolean(s.ritual),
      description,
      higherLevel,
      mechanic,
      candidateUnits,
      properties,
      classes,
      subclasses,
    };
  },

  // Same "build the whole thing in one pass" reasoning as srdSpellStats, for
  // a raw 5e API magic item. Returns `null` for a variant-GROUP row
  // (`variant: false` with a non-empty `variants` list, e.g. "Weapon, +1,
  // +2, or +3") — that row isn't a concrete item a GM would ever hand a
  // player, its listed children are. srdItemKindFromStats/
  // srdItemNameFromStats below both read `null` as "skip this row", and
  // Loom's bulk-import loop already treats a missing kind/name as "no
  // save-able entity" and moves on.
  //
  // A non-variant item's remaining prose goes through the same
  // `candidateUnits` clause-recognizer pipeline spells use (see
  // vault-feature-matching.js) rather than a flat "+N bonus to X" regex,
  // which used to conflate a Ring of Protection's saving-throw grant with a
  // weapon's intrinsic enhancement bonus — genuinely different concepts.
  srdItemStats(context, args, env) {
    const s = context.root || context;
    const isVariant = Boolean(s.variant);
    const hasVariants = Array.isArray(s.variants) && s.variants.length > 0;
    if (!isVariant && hasVariants) return null;

    const descArr = Array.isArray(s.desc) ? s.desc : [];
    const description = descArr.join("\n\n");
    // Paragraph 0 is always the flavor/category/rarity header line (e.g.
    // "Wondrous item, uncommon (requires attunement)") — never candidate
    // Feature content, already captured below as category/rarity/
    // requiresAttunement.
    const bodyParagraphs = descArr.slice(1);

    let variantGroup = null;
    let variantTier = null;
    let mechanic = null;
    if (isVariant) {
      // A child row's `index` carries its parent's slug as a prefix
      // ("weapon-1" -> "weapon") — the 5e API gives no more direct parent
      // back-reference than this (only the parent lists its children).
      const match = String(s.index || "").match(/^(.*)-(\d+)$/);
      if (match) {
        variantGroup = match[1];
        variantTier = { id: `plus-${match[2]}`, name: `+${match[2]}` };
        mechanic = { kind: "passive-bonus", bonusText: description };
      }
    }

    const { charges, remaining } = mechanic ? { charges: null, remaining: [] } : srdExtractCharges(bodyParagraphs);
    const candidateUnits = mechanic ? [] : remaining.flatMap((p) => srdSplitBullets(p));
    const properties = srdItemProperties(
      {
        rarityName: s.rarity?.name,
        categoryName: s.equipment_category?.name,
        activationText: description,
      },
      env?.lookupTables
    );

    return {
      name: s.name,
      category: s.equipment_category?.name,
      rarity: s.rarity?.name,
      requiresAttunement: /requires attunement/i.test(descArr[0] || ""),
      description,
      charges,
      properties,
      variantGroup,
      variantTier,
      mechanic,
      candidateUnits,
    };
  },

  // `undefined` (never `""`) specifically so deriveEntities' own
  // `typeof item.kind === "string"` check correctly treats a skipped
  // variant-group row as "no entity produced" — an empty string would
  // still pass that check and save a blank-named record.
  srdItemKindFromStats(context) {
    return context.itemStats ? "wonder" : undefined;
  },
  srdItemNameFromStats(context) {
    return context.itemStats?.name;
  },

  // 5e-api-equipment.json's own stats builder — a raw 5e API /equipment row,
  // NOT /magic-items (srdItemStats above): no rarity/attunement concept, but
  // real cost/weight/mechanical stats magic items never carry. Handles both
  // the 2014 shape (`desc`, singular `equipment_category`) and the 2024
  // shape (`description`, plural `equipment_categories`), since the "srd"
  // source is year-agnostic and one mapping needs to work with either.
  srdEquipmentStats(context, args, env) {
    const s = context.root || context;
    const descArr = Array.isArray(s.desc) ? s.desc : Array.isArray(s.description) ? s.description : [];

    // Category name CANDIDATES, in the order to try them — 2014 gives
    // exactly one (`equipment_category.name`); 2024's `equipment_categories`
    // array lists several with no consistent generic-first/specific-first
    // order between weapons and armor. Trying each against the System's
    // live Item Form vocabulary and keeping the first that resolves
    // sidesteps needing to know which position is "the generic one" —
    // resolveLivePropertyValue's trailing-s fold handles plural entries
    // like "Weapons" resolving against the singular "Weapon" value.
    const categoryCandidates = s.equipment_category?.name
      ? [s.equipment_category.name]
      : (Array.isArray(s.equipment_categories) ? s.equipment_categories : []).map((c) => c?.name).filter(Boolean);
    let categoryName = categoryCandidates[0] || "";
    for (const candidate of categoryCandidates) {
      if (resolveLivePropertyValue(resolveMarkdownItemFormHint(candidate), env?.lookupTables?.itemForms)) {
        categoryName = candidate;
        break;
      }
    }
    // The SAME candidate list, tried against the System's
    // "equipmentCategories" sub-classification instead (Tools/Musical
    // Instrument/Gaming Set/Other Tools/Mounts and Vehicles/Ammunition) —
    // first candidate that resolves wins, same "more specific beats the
    // generic parent" reasoning as categoryName above (Carpenter's Tools'
    // ["Artisan's Tools", "Tools"] resolves to the more specific one).
    let equipmentCategoryName = "";
    for (const candidate of categoryCandidates) {
      if (resolveLivePropertyValue(candidate, env?.lookupTables?.equipmentCategories)) {
        equipmentCategoryName = candidate;
        break;
      }
    }
    // A weapon's Simple/Martial + Melee/Ranged split — the 2014 shape gives
    // it pre-combined as `category_range` ("Martial Ranged", a byte-exact
    // match against weaponCategories' vocabulary already). 2024 has no such
    // field — it only shows up folded into one of `equipment_categories`'
    // entries instead ("Martial Ranged Weapons"), so every candidate is
    // tried both as-is and with a trailing "Weapon(s)" suffix stripped.
    const weaponCategoryCandidates = s.category_range
      ? [s.category_range]
      : categoryCandidates.flatMap((c) => [c, c.replace(/\s+weapons?$/i, "")]);
    let weaponCategoryName = "";
    for (const candidate of weaponCategoryCandidates) {
      if (resolveLivePropertyValue(candidate, env?.lookupTables?.weaponCategories)) {
        weaponCategoryName = candidate;
        break;
      }
    }
    // An armor's own Light/Medium/Heavy/Shield split — the 2014 shape
    // gives it directly as `armor_category` ("Shield"/"Medium" — confirmed
    // live). 2024 folds it into `equipment_categories` instead ("Medium
    // Armor" — confirmed live against Breastplate — but Shield's own 2024
    // entry is bare "Shields" with no trailing "Armor" word at all, so
    // both the as-is and suffix-stripped forms are tried here too).
    const armorCategoryCandidates = s.armor_category
      ? [s.armor_category]
      : categoryCandidates.flatMap((c) => [c, c.replace(/\s+armor$/i, "")]);
    let armorCategoryName = "";
    for (const candidate of armorCategoryCandidates) {
      if (resolveLivePropertyValue(candidate, env?.lookupTables?.armorCategories)) {
        armorCategoryName = candidate;
        break;
      }
    }

    const price = s.cost?.quantity != null && s.cost?.unit ? `${s.cost.quantity} ${s.cost.unit}` : "";
    const weight = Number.isFinite(s.weight) ? s.weight : undefined;

    // Weapon/armor mechanical stats (damage, range, weapon properties/
    // 2024 mastery, AC, Strength requirement, Stealth) have no dedicated
    // Wonder field of their own — matches this suite's own existing
    // curated equipment (eff.handaxe.json etc.), which never tracks these
    // as structured data either — folded into the description as plain
    // "Label: value" lines instead of silently dropped, the same
    // "no established stats shape for these" reasoning markdownItemStats'
    // own mundane-equipment fields already follow.
    const extraLines = [];
    if (s.damage?.damage_dice) {
      extraLines.push(`Damage: ${s.damage.damage_dice}${s.damage.damage_type?.name ? ` ${s.damage.damage_type.name}` : ""}`);
    }
    if (s.range?.normal) {
      extraLines.push(`Range: ${s.range.normal}${s.range.long ? `/${s.range.long}` : ""} ft.`);
    }
    if (Array.isArray(s.properties) && s.properties.length) {
      extraLines.push(`Properties: ${s.properties.map((p) => p?.name).filter(Boolean).join(", ")}`);
    }
    if (s.mastery?.name) extraLines.push(`Mastery: ${s.mastery.name}`);
    if (s.armor_class?.base != null) {
      const dexNote = s.armor_class.dex_bonus
        ? s.armor_class.max_bonus != null
          ? ` + Dex modifier (max ${s.armor_class.max_bonus})`
          : " + Dex modifier"
        : "";
      extraLines.push(`Armor Class: ${s.armor_class.base}${dexNote}`);
    }
    if (s.str_minimum) extraLines.push(`Strength: ${s.str_minimum}`);
    if (s.stealth_disadvantage) extraLines.push("Stealth: Disadvantage");

    const { charges, remaining } = srdExtractCharges(descArr);
    const candidateUnits = remaining.flatMap((p) => srdSplitBullets(p));
    const properties = srdItemProperties(
      {
        rarityName: "",
        categoryName: resolveMarkdownItemFormHint(categoryName),
        activationText: descArr.join("\n\n"),
        weaponCategoryName,
        armorCategoryName,
        equipmentCategoryName,
      },
      env?.lookupTables
    );

    return {
      name: s.name,
      category: categoryName,
      rarity: "",
      requiresAttunement: false,
      description: [...descArr, ...extraLines].join("\n\n"),
      price,
      weight,
      tags: [],
      charges,
      properties,
      variantGroup: null,
      variantTier: null,
      mechanic: null,
      candidateUnits,
    };
  },

  // Builds the SAME `stats` shape srdItemStats builds above, from
  // parseMarkdownWonderSource's own generic structural parse
  // (content-fetch.js) instead of a raw 5e API record — markdown-item.json's
  // own `with` binding names this `itemStats` too, so it's read by the exact
  // same srdItemKindFromStats/srdItemNameFromStats above with zero
  // duplication, and consumed by vault-feature-matching.js's own
  // convertSpellOrItemToFeatures completely unchanged. `mechanic`/
  // `variantGroup`/`variantTier` stay null — a markdown vault file has no
  // structured "this is a +1/+2/+3 of a family" signal the way a 5e API
  // variant CHILD row's own `index` does, so every markdown item goes
  // through the ordinary candidateUnits clause-recognizer path, same as any
  // non-variant SRD item.
  markdownItemStats(context, args, env) {
    const s = context.root || context;
    const { category, rarity, requiresAttunement } = parseMarkdownItemHeaderLine(s.headerLine);
    const paragraphs = Array.isArray(s.paragraphs) ? s.paragraphs : [];
    // Mundane-equipment fields (Alchemist's Fire's own "**Damage**: 1d4" /
    // "**Damage Type**: Fire" / "**Properties**: Improvised Weapon" / ...) —
    // no established stats shape for these the way a spell's own Casting
    // Time/Range/Duration already have (5e API magic items never carry this
    // shape at all), so they're folded into the plain description text
    // rather than silently dropped. Not added to candidateUnits — a bare
    // "Label: value" line never matches a clause recognizer, so there's no
    // risk of a phantom Feature, only lost information if omitted.
    const sourceFields = { ...(s.fields || {}) };
    // A "Cost" field (this vault's own "**Cost:** 5 gp"-style markdown
    // field, when a note has one) — or ddb-item.json's own `price`
    // (ddbParseEquipmentPage's own Cost extraction, already promoted
    // before this ever runs, so `s.price` wins when both are somehow
    // present) — is the exact freeform price string item-pricing.js's own
    // rollResourcePrice already knows how to parse (parsePriceExpression's
    // own "ends in a coin abbreviation" contract). Surfaced as its own
    // `price` return field (the same top-level Wonder field
    // eff.handaxe.json's own "price": "5 gp" already uses) instead of left
    // buried only in description prose, which is what left every freshly-
    // imported mundane item completely unpriceable in the Shop widget —
    // confirmed real, reported bug: a freshly-imported Greataxe had no
    // sell price at all. Removed from the folded-into-description field
    // lines below once promoted — nothing else needs a plain-text
    // restatement of it, matching how eff.handaxe.json's own hand-curated
    // "price": "5 gp" never repeats itself in its own "notes" prose either.
    const price = s.price || sourceFields.Cost || sourceFields.cost || "";
    delete sourceFields.Cost;
    delete sourceFields.cost;
    // Same promotion, for "Weight" — equipment's own most commonly-present
    // stat, and (per the user's own explicit steer) the field most worth
    // getting right here since equipment imports are the main use of this
    // pipeline going forward. Parsed down to a bare number (the leading
    // "7" of ddb-item.json's own raw "7 lbs", or this vault's own
    // "**Weight:** 7 lbs" field) — the SAME shape Character.inventory[]
    // .weight already uses (extractInventoryWeight,
    // common/js/lib/calculator-modes/inventory-weight.js), not a unit-
    // suffixed string nothing downstream could read back out as a number.
    // Left `undefined` (never a fabricated 0) when nothing parses — the
    // mapping engine's own JSON.stringify at save time omits an
    // `undefined` key entirely, so an unweighted item (most magic items)
    // gets no `weight` key at all rather than a wrong zero.
    const weightRaw = s.weight || sourceFields.Weight || sourceFields.weight || "";
    delete sourceFields.Weight;
    delete sourceFields.weight;
    const weightMatch = String(weightRaw).match(/-?\d+(?:\.\d+)?/);
    const weight = weightMatch ? Number(weightMatch[0]) : undefined;
    const fieldLines = Object.entries(sourceFields).map(([key, value]) => `${key}: ${value}`);
    const description = [...paragraphs, ...fieldLines].join("\n\n");
    const { charges, remaining } = srdExtractCharges(paragraphs);
    const candidateUnits = remaining.flatMap((p) => srdSplitBullets(p));
    const properties = srdItemProperties(
      { rarityName: rarity, categoryName: resolveMarkdownItemFormHint(category), activationText: description },
      env?.lookupTables
    );

    return {
      name: s.name || "",
      category,
      rarity,
      requiresAttunement,
      description,
      price,
      weight,
      // A source's own real tag list — a plain array, same shape
      // ddb-monster.json's `tags` field reads, never flattened into
      // description prose. Empty for a markdown vault source, which has no
      // tags concept.
      tags: Array.isArray(s.tags) ? s.tags : [],
      charges,
      properties,
      variantGroup: null,
      variantTier: null,
      mechanic: null,
      candidateUnits,
    };
  },

  // Same "build the whole thing in one pass" reasoning as srdSpellStats, from
  // parseMarkdownWonderSource's own generic parse instead of a raw 5e API
  // record. `mechanic` is recovered from prose via parseMarkdownSpellMechanic
  // rather than read off a structured field, since markdown spells have neither.
  markdownSpellStats(context, args, env) {
    const s = context.root || context;
    const { level, school, ritual } = parseMarkdownSpellHeaderLine(s.headerLine);
    const fields = s.fields || {};
    const castingTime = fields["Casting Time"] || "";
    const range = fields["Range"] || "";
    const components = fields["Components"] || "";
    const duration = fields["Duration"] || "";
    const concentration = /concentration/i.test(duration);

    const paragraphs = Array.isArray(s.paragraphs) ? s.paragraphs : [];
    const description = paragraphs.join("\n\n");
    const higherLevel = s.higherLevel || "";
    const mechanic = parseMarkdownSpellMechanic(description, higherLevel, level);
    const candidateUnits = mechanic ? [] : paragraphs.flatMap((p) => srdSplitBullets(p));

    const spellFormMatch = resolveLivePropertyValue("Spell", env?.lookupTables?.itemForms);
    const properties = spellFormMatch ? { form: slugifyPropertyValueName(spellFormMatch) } : {};

    return {
      name: s.name || "",
      level,
      school,
      castingTime,
      range,
      components,
      duration,
      concentration,
      ritual,
      description,
      higherLevel,
      mechanic,
      candidateUnits,
      properties,
    };
  },

  // DDB's monster-service `senses` is `[{senseId, notes}]` — senseId a
  // numeric id resolved through the same `senses` lookup table formula
  // calls use, `notes` a free-text range string to regex-extract a number
  // from. Folds the separate `passivePerception` field into
  // `passives.perception`, producing this suite's one shared senses shape,
  // matching Character's sensesTable/srdSenses/fantasyStatblockSenses.
  ddbMonsterSenses(context, args, env) {
    const rawSenses = resolvePath(context, args?.sensesPath || "senses");
    const sensesTable = Array.isArray(env?.lookupTables?.senses) ? env.lookupTables.senses : [];
    const nameForId = (id) => sensesTable.find((entry) => entry.id === id)?.name || "";
    const result = {};
    (Array.isArray(rawSenses) ? rawSenses : []).forEach((entry) => {
      const name = nameForId(entry?.senseId);
      const match = String(entry?.notes || "").match(/(\d+)/);
      if (name && match) result[name] = Number(match[1]);
    });
    const passivePerception = Number(resolvePath(context, args?.passivePerceptionPath || "passivePerception"));
    if (Number.isFinite(passivePerception)) {
      result.passives = { perception: passivePerception };
    }
    return result;
  },

  // The 5e API's raw `senses` is a keyed object of already-unit-suffixed
  // strings plus `passive_perception` — reshaped into this suite's one
  // shared senses shape, same as ddbMonsterSenses/fantasyStatblockSenses.
  srdSenses(context, args) {
    const raw = resolvePath(context, args?.path || "senses");
    const result = {};
    if (raw && typeof raw === "object") {
      Object.entries(raw).forEach(([key, value]) => {
        if (key === "passive_perception") {
          const num = Number(value);
          if (Number.isFinite(num)) result.passives = { perception: num };
          return;
        }
        const match = String(value || "").match(/(\d+)/);
        if (match) result[key] = Number(match[1]);
      });
    }
    return result;
  },

  // DDB's monster-service `movements` is `[{movementId, speed, notes}, ...]`
  // — resolved into this suite's one shared speed shape, `{walk, burrow,
  // climb, fly, swim}` (matching Character's speedsTable exactly), each
  // `movementId` resolved through the same `speeds` lookup table formula
  // calls use. Falls back to "walk" if a movement has no resolvable name
  // (DDB's base-walking-speed entry sometimes has no movementId at all).
  ddbFormatSpeed(context, args, env) {
    const movements = resolvePath(context, args?.path || "movements");
    const speedsTable = Array.isArray(env?.lookupTables?.speeds) ? env.lookupTables.speeds : [];
    const nameForId = (id) => speedsTable.find((entry) => entry.id === id)?.name || "";
    const result = {};
    (Array.isArray(movements) ? movements : []).forEach((entry) => {
      if (!entry || !entry.speed) return;
      result[nameForId(entry.movementId) || "walk"] = entry.speed;
    });
    return result;
  },

  // Fantasy Statblocks' `hit_dice` is normally already just the dice count
  // ("21d20"), matching the 5e API's `hit_dice` directly — but real-world
  // source files sometimes carry the flat modifier too ("16d8 + 48"), so
  // this defensively splits either shape into `{dice, roll}`: `dice` is
  // always the bare `NdN` portion for `stats.hitDice`; `roll` is the
  // original full string for `stats.hitPoints.diceString`, only when it
  // carries more than the bare dice, so a clean source doesn't grow a
  // redundant duplicate field. `args.path` defaults to "hit_dice".
  splitHitDice(context, args) {
    const raw = String(resolvePath(context, args?.path || "hit_dice") || "").trim();
    const match = raw.match(/^(\d+d\d+)/i);
    const dice = match ? match[1] : raw;
    return { dice, roll: raw && raw !== dice ? raw : undefined };
  },

  // Fantasy Statblocks' `speed` is a single free-text string ("30 ft., swim
  // 30 ft.", "fly 60 ft. (hover)") — the first, unprefixed entry is always
  // walking speed; every other entry is prefixed by its movement-type name.
  // Parsed into this suite's shared speed shape, same as ddbFormatSpeed. A
  // trailing "(hover)" is captured as a sparse `hover: true` sibling, same
  // `stats.speed.hover` convention formatSpeedFromObject uses for the 5e
  // API. `args.path` defaults to "speed".
  fantasyStatblockSpeed(context, args) {
    const raw = String(resolvePath(context, args?.path || "speed") || "");
    const result = {};
    raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        const match = part.match(/^([A-Za-z]+)?\s*(\d+)\s*ft/i);
        if (!match) return;
        const key = (match[1] || "walk").toLowerCase();
        result[key] = Number(match[2]);
        if (key === "fly" && /hover/i.test(part)) result.hover = true;
      });
    return result;
  },

  // The 5e API's raw `speed` is a keyed object of already-unit-suffixed
  // strings — `{walk: "30 ft.", swim: "30 ft."}` — parsed into this suite's
  // shared speed shape, same as ddbFormatSpeed/fantasyStatblockSpeed. A
  // flying creature that can hover carries a sibling `hover: true` boolean
  // with no numeric value (the generic digit-match below would otherwise
  // silently drop it) — copied through sparse, omitted rather than `false`
  // when absent, read by Crucible's formatSpeedValue as a "(hover)" suffix.
  formatSpeedFromObject(context, args) {
    const raw = resolvePath(context, args?.path || "speed");
    const result = {};
    if (raw && typeof raw === "object") {
      Object.entries(raw).forEach(([key, value]) => {
        if (key === "hover") {
          if (value) result.hover = true;
          return;
        }
        const match = String(value || "").match(/(\d+)/);
        if (match) result[key] = Number(match[1]);
      });
    }
    return result;
  },

  // Both 5e API's raw `challenge_rating` (a decimal number) and Fantasy
  // Statblocks' `cr` (usually a string, not guaranteed) need to converge on
  // the same string shape DDB's own lookup already produces (a whole number
  // or fraction — "5", "1/2", "1/8"). `args.path` defaults to
  // "challenge_rating".
  formatChallengeRating(context, args) {
    const raw = resolvePath(context, args?.path || "challenge_rating");
    if (typeof raw === "string") return raw.trim();
    const value = Number(raw);
    if (!Number.isFinite(value)) return "";
    const FRACTIONS = { 0.125: "1/8", 0.25: "1/4", 0.5: "1/2" };
    return FRACTIONS[value] || String(value);
  },

  // Standard 5e Proficiency Bonus-by-CR — a fixed rule (PB = 2 +
  // floor((max(CR,1)-1)/4)), computed here rather than trusted to a
  // source-provided field: only the 5e API has one directly
  // (`proficiency_bonus`, used as-is there, not wired to this function).
  // DDB has none at all in a real monster payload; Fantasy Statblocks'
  // display is itself just a CR-based plugin callback, never stored data.
  // Deriving it here guarantees the same value every import produces.
  // `args.path` defaults to "challenge_rating"; see crToNumber for shapes.
  proficiencyBonusFromChallengeRating(context, args) {
    const cr = crToNumber(resolvePath(context, args?.path || "challenge_rating"));
    if (!Number.isFinite(cr)) return undefined;
    return 2 + Math.floor((Math.max(cr, 1) - 1) / 4);
  },

  // 5e API's raw `proficiencies` is a flat list mixing saving throws and
  // skills, distinguished only by a fixed string prefix on the label.
  // Splits it into the same two-field convention DDB/Fantasy Statblocks'
  // `savingThrows`/`skills` use. `args.path` defaults to "proficiencies";
  // wire via a `with` binding so both sibling output fields read this one
  // computed result instead of each re-parsing the raw list.
  srdSplitProficiencies(context, args) {
    const entries = resolvePath(context, args?.path || "proficiencies");
    const savingThrows = [];
    const skills = [];
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      const label = entry?.proficiency?.name || "";
      // A bare number (`{"value":7,"proficiency":{"name":"Saving Throw: DEX"}}`),
      // not `{value:{value:N}}`.
      const value = entry?.value;
      const saveMatch = label.match(/^Saving Throw:\s*(.+)$/i);
      if (saveMatch) {
        savingThrows.push({ name: saveMatch[1].trim(), value });
        return;
      }
      const skillMatch = label.match(/^Skill:\s*(.+)$/i);
      if (skillMatch) {
        skills.push({ name: skillMatch[1].trim(), value });
      }
    });
    return { savingThrows, skills };
  },

  // `args.path` defaults to "descLines" (ddb-content-parser.js's paragraph
  // array); joins into one string the way the 5e API's single `description`
  // field expects.
  // `args.skip` (default 0) drops that many leading lines before joining —
  // use 1 when the first line was already pulled out separately (e.g. as a
  // `summary`), so it isn't duplicated at the start of the full description.
  joinLines(context, args) {
    const value = resolvePath(context, args?.path || "descLines");
    const skip = Number(args?.skip) || 0;
    if (Array.isArray(value)) return value.slice(skip).join("\n\n");
    return typeof value === "string" ? value : "";
  },

  // Fantasy Statblocks' `saves`/`skillsaves` are each a YAML list of
  // single-key maps — `- Con: 5`, `- Arcana: 4` — the key varying per entry,
  // so nothing in the declarative primitives can read "whatever the one key
  // happens to be." `args.path` names which raw field to read; returns
  // [{name, value}, ...], same shape ddb-monster.json's savingThrows/skills use.
  fantasyStatblockKeyedList(context, args) {
    const list = resolvePath(context, args?.path || "");
    return (Array.isArray(list) ? list : [])
      .map((entry) => {
        const key = entry && typeof entry === "object" ? Object.keys(entry)[0] : undefined;
        return key ? { name: key, value: entry[key] } : null;
      })
      .filter(Boolean);
  },

  // Fantasy Statblocks bundles passive Perception into the same free-text
  // `senses` string as darkvision/blindsight/etc ("darkvision 120 ft.,
  // passive Perception 13") — no separate field. Splits/parses it into this
  // suite's shared senses shape, matching ddbMonsterSenses/srdSenses/
  // Character's sensesTable, sourced from the same `senses` lookup table so
  // the vocabulary lives in one place. `args.path` defaults to "senses".
  fantasyStatblockSenses(context, args, env) {
    const raw = String(resolvePath(context, args?.path || "senses") || "");
    const sensesTable = Array.isArray(env?.lookupTables?.senses) ? env.lookupTables.senses : [];
    const result = {};
    raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        const passiveMatch = part.match(/passive perception\s+(\d+)/i);
        if (passiveMatch) {
          result.passives = { perception: Number(passiveMatch[1]) };
          return;
        }
        const senseEntry = sensesTable.find((entry) => new RegExp(`^${entry.name}\\b`, "i").test(part));
        const rangeMatch = part.match(/(\d+)/);
        if (senseEntry && rangeMatch) result[senseEntry.name] = Number(rangeMatch[1]);
      });
    return result;
  },

  // Fantasy Statblocks' damage_resistances/damage_vulnerabilities/
  // damage_immunities/condition_immunities are each a single free-text
  // string, comma-separated when more than one applies — split and trimmed
  // into a plain string array, matching Crucible's shape.
  fantasyStatblockSplitList(context, args) {
    return splitCommaList(resolvePath(context, args?.path || ""));
  },

  // The "notes" half of splitFantasyStatblockNotes — References stripped out
  // (see fantasyStatblockSources below). `args.path` defaults to
  // "_postFenceNotes".
  fantasyStatblockNotes(context, args) {
    return splitFantasyStatblockNotes(resolvePath(context, args?.path || "_postFenceNotes")).notes;
  },

  // Combines the YAML frontmatter's terse `source` field with any citations
  // parsed out of the "### References" list into one array — both are
  // "where this content came from," and this suite has one `sources` field
  // per monster, not two competing citation concepts. `args.sourcePath`/
  // `args.notesPath` default to "source"/"_postFenceNotes".
  fantasyStatblockSources(context, args) {
    const fromSourceField = splitCommaList(resolvePath(context, args?.sourcePath || "source"));
    const { references } = splitFantasyStatblockNotes(resolvePath(context, args?.notesPath || "_postFenceNotes"));
    return [...fromSourceField, ...references];
  },

  // Fantasy Statblocks' damage_resistances/damage_vulnerabilities/
  // damage_immunities/condition_immunities are each a separate free-text,
  // comma-separated field — combined into this suite's shared `defenses`
  // array (matching Character's proficiencies.defenses), each entry tagged
  // with its `type`. Condition immunities fold in as `type: "immunity"`
  // too, no separate bucket.
  fantasyStatblockDefenses(context) {
    const splitField = (path) =>
      String(resolvePath(context, path) || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    const build = (path, type) => splitField(path).map((name) => ({ name, type }));
    return [
      ...build("damage_resistances", "resistance"),
      ...build("damage_vulnerabilities", "vulnerability"),
      ...build("damage_immunities", "immunity"),
      ...build("condition_immunities", "immunity"),
    ];
  },

  // The 5e API's damage_resistances/damage_vulnerabilities/damage_immunities
  // are each already a flat string array; condition_immunities is an array
  // of `{name}` reference objects. Combined into this suite's shared
  // `defenses` array, each entry tagged with its `type`.
  srdDefenses(context) {
    const stringList = (path) => {
      const raw = resolvePath(context, path);
      return Array.isArray(raw) ? raw.filter(Boolean) : [];
    };
    const build = (path, type) => stringList(path).map((name) => ({ name: String(name).trim(), type }));
    const conditionImmunities = resolvePath(context, "condition_immunities");
    const conditionEntries = (Array.isArray(conditionImmunities) ? conditionImmunities : [])
      .map((entry) => entry?.name)
      .filter(Boolean)
      .map((name) => ({ name, type: "immunity" }));
    return [
      ...build("damage_resistances", "resistance"),
      ...build("damage_vulnerabilities", "vulnerability"),
      ...build("damage_immunities", "immunity"),
      ...conditionEntries,
    ];
  },

  // DDB's monster conditionImmunities (numeric ids, resolved via the same
  // positional `conditions` lookup table formula calls use) fold into this
  // suite's shared `defenses` array as `type: "immunity"` entries. Damage-
  // type resistances/immunities/vulnerabilities are NOT included yet: DDB's
  // raw `damageAdjustments` field has no confirmed shape — a known, flagged
  // gap rather than a guessed-at parser. `args.path` defaults to
  // "conditionImmunities".
  ddbConditionDefenses(context, args, env) {
    const raw = resolvePath(context, args?.path || "conditionImmunities");
    const conditionsTable = Array.isArray(env?.lookupTables?.conditions) ? env.lookupTables.conditions : [];
    return (Array.isArray(raw) ? raw : [])
      .map((id) => conditionsTable[Number(id)])
      .filter(Boolean)
      .map((name) => ({ name, type: "immunity" }));
  },

  ddbHitDie(context) {
    return parseHitDie(context.coreTraits?.hitPointDie);
  },

  ddbSpeciesSpeed(context) {
    const fromCoreTraits = parseLeadingNumber(context.coreTraits?.speed);
    if (fromCoreTraits) return fromCoreTraits;
    return parseLeadingNumber(speciesNamedTraitText(context.namedTraits, "Speed"));
  },
  ddbSpeciesSize(context) {
    if (context.coreTraits?.size) return context.coreTraits.size;
    const text = speciesNamedTraitText(context.namedTraits, "Size");
    const match = text.match(/\b(Tiny|Small|Medium|Large|Huge|Gargantuan)\b/i);
    return match ? match[1] : null;
  },
  ddbSpeciesCreatureType(context) {
    if (context.coreTraits?.creatureType) return context.coreTraits.creatureType;
    const text = speciesNamedTraitText(context.namedTraits, "Creature Type");
    const match = text.match(/\byou are an? ([A-Za-z]+)/i);
    return match ? match[1] : null;
  },

  ddbSavingThrows(context) {
    return parseAbilityRefs(context.coreTraits?.savingThrowProficiencies);
  },

  // A DDB MONSTER's own `stats` is `[{statId, name, value}, ...]`, an array
  // keyed by DDB's numeric statId, not the character-sheet shape the ddb*
  // functions above assume. Reshapes into the keyed-object form
  // `{strength, dexterity, ...}` this suite's monster-stats standard uses
  // (matches Crucible's stats.abilities). `args.path` defaults to "stats";
  // ddb-monster.json's `initiativeBonus` field reads this same object back
  // via a `with` binding, since a formula bind can only see the RAW input
  // context, never a sibling output field still being built.
  ddbAbilitiesObject(context, args) {
    const entries = resolvePath(context, args?.path || "stats");
    const result = {};
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      const ability = ABILITIES.find((candidate) => candidate.id === entry?.statId);
      if (ability?.name) result[ability.name] = entry?.value;
    });
    return result;
  },

  ddbPrimaryAbility(context) {
    const text = context.coreTraits?.primaryAbility;
    if (!text) return null;
    return { desc: text, ability_scores: parseAbilityRefs(text) };
  },

  ddbProficiencyChoices(context) {
    const parsed = parseChooseList(context.coreTraits?.skillProficiencies);
    if (!parsed) return [];
    const options = parsed.items
      .map((label) => {
        const skill = SKILLS.find((entry) => entry.friendlyName.toLowerCase() === label.toLowerCase());
        if (!skill) return null;
        return { option_type: "reference", item: { index: `skill-${skill.name}`, name: `Skill: ${skill.friendlyName}` } };
      })
      .filter(Boolean);
    return [{ desc: parsed.desc, choose: parsed.choose, type: "proficiencies", from: { option_set_type: "options_array", options } }];
  },

  ddbProficiencies(context) {
    const traits = context.coreTraits || {};
    return [
      ...parseArmorProficiencies(traits.armorTraining),
      ...parseWeaponProficiencies(traits.weaponProficiencies),
      ...parseSavingThrowProficiencyRefs(traits.savingThrowProficiencies),
    ];
  },

  // `args.path` defaults to where classes' equipment text lives
  // (coreTraits.startingEquipment); backgrounds pass {"path":"traits.equipment"}
  // since their scraped text sits under a differently-named raw property.
  ddbEquipmentOptions(context, args) {
    const path = args?.path || "coreTraits.startingEquipment";
    return parseStartingEquipmentOptions(resolvePath(context, path));
  },

  ddbBackgroundAbilityScores(context) {
    return parseAbilityRefs(context.traits?.abilityScores);
  },

  ddbBackgroundFeat(context) {
    return parseFeatWithNote(context.traits?.feat);
  },

  ddbBackgroundProficiencies(context) {
    const traits = context.traits || {};
    return [...parseSkillProficiencyRefs(traits.skillProficiencies), ...parseToolProficiencyRefs(traits.toolProficiencies)];
  },

  emptyList() {
    return [];
  },

  activeModifiers(context) {
    return getActiveModifiers(context.root);
  },

  abilityScores(context) {
    return calculateAbilityScores(context.root, getActiveModifiers(context.root));
  },

  totalLevel(context) {
    return getTotalLevelRaw(context.root?.classes);
  },

  proficiencyBonus(context) {
    return getProficiencyBonusRaw(getTotalLevelRaw(context.root?.classes));
  },

  // The starting class (DDB's own `isStartingClass` flag), falling back to
  // the first class entry for older exports that don't set it.
  primaryClassName(context) {
    const classes = Array.isArray(context.root?.classes) ? context.root.classes : [];
    const primaryClass = classes.find((cls) => cls.isStartingClass) || classes[0] || {};
    return primaryClass.definition?.name || "";
  },

  // Ported from ddb-parser.js's buildIdentity — level_monk (for Martial
  // Arts-driven Unarmed Strike, see attacksTable) and level_multiclass
  // (total level minus whatever's in the starting/primary class).
  classLevelBreakdown(context) {
    const classes = Array.isArray(context.root?.classes) ? context.root.classes : [];
    const primaryClass = classes.find((cls) => cls.isStartingClass) || classes[0] || {};
    const primaryClassName = (primaryClass.definition?.name || "").toLowerCase();
    const totalLevel = getTotalLevelRaw(classes);
    const monkLevels = classes
      .filter((cls) => (cls.definition?.name || "").toLowerCase() === "monk")
      .reduce((total, cls) => total + (cls.level || 0), 0);
    const primaryLevels = classes
      .filter((cls) => (cls.definition?.name || "").toLowerCase() === primaryClassName)
      .reduce((sum, cls) => sum + (cls.level || 0), 0);
    return { level_monk: monkLevels, level_multiclass: Math.max(totalLevel - primaryLevels, 0) };
  },

  // Replaces the old plain "pipeline"/"map" inventory field — needs a real
  // custom function, not a per-item formula bind, to cross-reference each
  // item against `characterValues` (see below), a completely separate
  // TOP-LEVEL array a per-item pipeline step has no way to reach.
  //
  // DDB's own item-customization (right-click an inventory row -> Customize
  // -> rename) is NOT stored on the inventory item itself — it lives in
  // `characterValues`, one entry per customized FIELD, keyed by `valueId`
  // (the target item's own `id`, as a STRING — coerced below to compare
  // against the item's own numeric `id`) and `typeId` (8 = a custom NAME
  // override — confirmed live against a real customized "Grappling Hook"
  // renamed to "Hookshot"; a different typeId, 9, showed up on a different
  // item as what looks like a custom note/description override instead —
  // not handled here, only the name override is surfaced today).
  inventoryTable(context) {
    const rawCharacter = context.root;
    const items = Array.isArray(rawCharacter?.inventory) ? rawCharacter.inventory : [];
    const customValues = Array.isArray(rawCharacter?.characterValues) ? rawCharacter.characterValues : [];
    const customNameById = new Map();
    customValues.forEach((entry) => {
      if (entry?.typeId === 8 && entry?.valueId != null && typeof entry.value === "string" && entry.value.trim()) {
        customNameById.set(String(entry.valueId), entry.value.trim());
      }
    });
    return items.map((item) => {
      const row = {
        name: item.definition?.name || "",
        quantity: item.quantity || 1,
        weight: (item.definition?.weight || 0) * (item.definition?.weightMultiplier || 1) * (item.quantity || 1),
        notes: item.definition?.snippet || item.definition?.description || "",
        canAttune: Boolean(item.definition?.canAttune),
        isAttuned: Boolean(item.isAttuned),
        canEquip: Boolean(item.definition?.canEquip),
        isEquipped: Boolean(item.equipped),
      };
      // `name` stays the real catalog name — reference-matching and this
      // item's mechanical identity both depend on it; `customName` is a
      // pure display override laid on top, never a substitute for it.
      const customName = customNameById.get(String(item?.id));
      if (customName) row.customName = customName;
      return row;
    });
  },

  // Ported from ddb-parser.js's buildFeats — a straight list, no
  // classification needed (feat-granted proficiencies/bonuses already flow
  // through proficienciesTable/the relevant ability-score paths via their
  // own modifiers). isRealDdbFeat (above) drops DDB's own disguise-feat
  // carrier entries — see that function's own comment for why.
  featsTable(context) {
    const feats = Array.isArray(context.root?.feats) ? context.root.feats : [];
    return feats.filter(isRealDdbFeat).map((feat) => ({
      name: feat.definition?.name || "Unknown Feat",
      description: htmlBlocksToText(feat.definition?.description || ""),
      level: feat.requiredLevel || null,
      limitedUse: feat.definition?.limitedUse || null,
    }));
  },

  // Class features (including subclass features), racial traits, and feat
  // descriptions, combined and deduped by name (a feat and its granted
  // feature can otherwise appear twice). `level` is captured per source: a
  // class feature's requiredLevel sits INSIDE its `.definition`, unlike a
  // Feat's, which sits on the outer wrapper; a racial trait carries no level
  // at all, since 5e grants every one at creation.
  // content-feature-matching.js's promotion step reads this to record
  // `featureParams[id].grantedAtLevel`.
  featuresTable(context) {
    const rawCharacter = context.root;
    const classes = Array.isArray(rawCharacter?.classes) ? rawCharacter.classes : [];
    // DDB's character-service API returns a class's/subclass's FULL feature
    // catalog here — every level, not just what this character has actually
    // reached. `cls.level` is THIS class's own current level (not total
    // character level, real for a multiclass character), which is exactly
    // why the filter has to happen per-class before the cross-class flatMap
    // merges everything together. Feats need no equivalent level filter
    // (only ever what the player chose), but do need isRealDdbFeat's
    // disguise-feat filter.
    const classFeatures = classes
      .flatMap((cls) => {
        const classLevel = cls.level || 0;
        return [...(cls.classFeatures || []), ...(cls.subclassDefinition?.classFeatures || [])].filter(
          (feature) => (feature.definition?.requiredLevel ?? 0) <= classLevel
        );
      })
      .map((feature) => (feature.definition ? { ...feature.definition, level: feature.definition.requiredLevel ?? null } : null))
      .filter(Boolean);
    const racialTraits = (rawCharacter?.race?.racialTraits || [])
      .map((trait) => (trait.definition ? { ...trait.definition, level: null } : null))
      .filter(Boolean);
    const featFeatures = (rawCharacter?.feats || [])
      .filter(isRealDdbFeat)
      .map((feat) => (feat.definition ? { ...feat.definition, level: feat.requiredLevel ?? null } : null))
      .filter(Boolean);
    const combined = [...classFeatures, ...racialTraits, ...featFeatures];
    const seen = new Set();
    return combined.reduce((list, feature) => {
      const name = feature.name || feature.friendlySubtypeName;
      if (!name || seen.has(name.toLowerCase())) return list;
      seen.add(name.toLowerCase());
      list.push({ name, description: htmlBlocksToText(feature.description || feature.snippet || ""), level: feature.level ?? null });
      return list;
    }, []);
  },

  // Buckets every active modifier by its own type/subType strings, no
  // hardcoded per-item tables. saves/skills/scores buckets are dropped —
  // savingThrowsTable/skillsTable already cover that ground with real
  // per-item proficiency levels.
  // `defenses`/`languages` deliberately aren't in this object — they
  // relocate to `stats.proficiencies.{defenses,languages}` (this suite's
  // one shared path/shape, matching every monster import mapping) via
  // proficiencyDefenses/proficiencyLanguages below.
  proficienciesTable(context) {
    const { defenses, languages, ...rest } = buildProficiencyBuckets(context);
    return rest;
  },

  proficiencyDefenses(context) {
    return buildProficiencyBuckets(context).defenses;
  },

  proficiencyLanguages(context) {
    return buildProficiencyBuckets(context).languages;
  },

  // Equipped-weapon attacks plus a synthesized Unarmed Strike (DDB doesn't
  // supply one for non-Monk characters, but every 5e character can make
  // one). Weapon proficiency/melee-ranged classification uses DDB's own
  // item.definition.categoryId (1=Simple, 2=Martial) and attackType
  // (1=Melee, 2=Ranged) directly, never a hardcoded weapon-name list.
  // Damage type prefers DDB's own friendly strings — a weapon's
  // definition.damageType, or for a spell-backed displayAsAttack action,
  // that spell's own definition.modifiers entry with type:"damage" — only
  // falling back to the damageTypes System lookup for a non-spell action
  // with only a numeric damageTypeId.
  attacksTable(context) {
    const rawCharacter = context.root;
    const modifiers = getActiveModifiers(rawCharacter);
    const scores = calculateAbilityScores(rawCharacter, modifiers);
    const dexMod = Math.floor(((scores.dexterity || 10) - 10) / 2);
    const strMod = Math.floor(((scores.strength || 10) - 10) / 2);
    const totalLevel = getTotalLevelRaw(rawCharacter?.classes);
    const proficiencyBonus = getProficiencyBonusRaw(totalLevel);

    const proficientSubtypes = modifiers
      .filter((modifier) => modifier.type === "proficiency")
      .map((modifier) => (modifier.subType || "").toLowerCase());
    const isWeaponProficient = (definition) => {
      const name = (definition.type || definition.name || "").toLowerCase();
      if (!name) return false;
      if (proficientSubtypes.some((subtype) => subtype === name || subtype === `${name}-weapons`)) return true;
      const isMartial = definition.categoryId === 2;
      if (!isMartial && proficientSubtypes.includes("simple-weapons")) return true;
      if (isMartial && proficientSubtypes.includes("martial-weapons")) return true;
      return false;
    };

    const resolveDamageTypeName = (rawName) => {
      if (!rawName) return null;
      const match = DAMAGE_TYPES.find((entry) => (entry.name || "").toLowerCase() === String(rawName).toLowerCase());
      return match ? match.name : rawName;
    };
    const resolveDamageTypeById = (id) => {
      if (id == null) return null;
      const match = DAMAGE_TYPES.find((entry) => entry.id === id);
      return match ? match.name : null;
    };

    // Spell name -> spell entry, for two things: deduping actions that are
    // really just a spell (so a spell attack isn't listed twice), and
    // resolving a spell-backed action's damage type via that spell's own
    // string modifier instead of the numeric damageTypeId.
    const spellsByName = new Map();
    ["class", "race", "feat", "item"].forEach((bucket) => {
      const entries = rawCharacter?.spells?.[bucket];
      if (Array.isArray(entries)) {
        entries.forEach((spell) => {
          const name = spell?.definition?.name;
          if (name) spellsByName.set(name.toLowerCase(), spell);
        });
      }
    });
    (rawCharacter?.classSpells || []).forEach((group) => {
      (group?.spells || []).forEach((spell) => {
        const name = spell?.definition?.name;
        if (name && !spellsByName.has(name.toLowerCase())) spellsByName.set(name.toLowerCase(), spell);
      });
    });
    const resolveSpellDamageType = (name) => {
      const spell = spellsByName.get((name || "").toLowerCase());
      const damageModifier = (spell?.definition?.modifiers || []).find((modifier) => modifier.type === "damage");
      return damageModifier?.friendlySubtypeName || damageModifier?.subType || null;
    };

    const equipmentAttacks = (rawCharacter?.inventory || [])
      .filter((item) => item.equipped && (item.definition?.attackType || item.definition?.damage))
      .map((item) => {
        const definition = item.definition || {};
        const isRanged = definition.attackType === 2;
        const isFinesse = Array.isArray(definition.properties)
          ? definition.properties.some((prop) => (prop.name || "").toLowerCase() === "finesse")
          : false;
        const abilityMod = isRanged || (isFinesse && dexMod >= strMod) ? dexMod : strMod;
        const proficiency = isWeaponProficient(definition) ? proficiencyBonus : 0;
        const attackBonus =
          (definition.attackBonus ?? 0) +
          abilityMod +
          proficiency +
          collectModifiers(modifiers, "weapon-attacks", "bonus") +
          collectModifiers(modifiers, isRanged ? "ranged-attacks" : "melee-attacks", "bonus");

        const dice = definition.damage?.diceString || "";
        const damage = dice ? `${dice}${abilityMod ? formatSigned(abilityMod) : ""}` : null;
        const properties = Array.isArray(definition.properties)
          ? definition.properties.map((prop) => prop.name).filter(Boolean)
          : [];

        return {
          name: definition.name || "Attack",
          range: definition.range ? `${definition.range} ft.` : null,
          longRange: definition.longRange ? `${definition.longRange} ft.` : null,
          attackBonus,
          damage,
          damageType: resolveDamageTypeName(definition.damageType),
          notes: properties.join(", "),
          description: definition.description || definition.snippet || "",
        };
      });

    const spellNameSet = new Set(spellsByName.keys());
    const actionAttacks = flattenActions(rawCharacter?.actions)
      .filter((action) => action.displayAsAttack && !spellNameSet.has((action.name || "").toLowerCase()))
      .map((action) => ({
        name: action.name || "Attack",
        range: action.range || action.attackTypeRange || "",
        longRange: action.longRange || null,
        attackBonus: action.fixedToHit ?? action.value ?? 0,
        damage: formatActionDamage(action.dice),
        damageType: resolveSpellDamageType(action.name) || resolveDamageTypeById(action.damageTypeId),
        notes: "",
        description: action.description || action.snippet || "",
      }));

    const monkLevels = (rawCharacter?.classes || [])
      .filter((cls) => (cls.definition?.name || "").toLowerCase() === "monk")
      .reduce((total, cls) => total + (cls.level || 0), 0);
    const unarmedAbilityMod = monkLevels > 0 ? dexMod : strMod;
    const unarmedStrike = {
      name: "Unarmed Strike",
      range: null,
      longRange: null,
      attackBonus: unarmedAbilityMod + proficiencyBonus,
      damage: `1${formatSigned(unarmedAbilityMod)}`,
      damageType: "Bludgeoning",
      notes: "",
      description: "",
    };

    const seen = new Set();
    return [unarmedStrike, ...actionAttacks, ...equipmentAttacks].filter((attack) => {
      const key = (attack.name || "Attack").toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },

  // Ported from ddb-parser.js's buildAttacking.
  attackingTable(context) {
    const modifiers = getActiveModifiers(context.root);
    const extraAttacks = collectMaxModifier(modifiers, "extra-attacks", ["set", "set-base"]);
    return { attacksPerAction: 1 + extraAttacks, fightingStyle: determineFightingStyle(context.root?.feats) };
  },

  // Standalone ability/mod/attack-bonus/save-DC stats, exposed as their own
  // field via determineSpellcastingAbility.
  spellcastingTable(context) {
    const rawCharacter = context.root;
    const classes = Array.isArray(rawCharacter?.classes) ? rawCharacter.classes : [];
    const ability = determineSpellcastingAbility(classes);
    const modifiers = getActiveModifiers(rawCharacter);
    const scores = calculateAbilityScores(rawCharacter, modifiers);
    const modScore = ability ? scores[ability.name] ?? 10 : 10;
    const abilityMod = Math.floor((modScore - 10) / 2);
    const totalLevel = getTotalLevelRaw(classes);
    const proficiencyBonus = getProficiencyBonusRaw(totalLevel);
    return {
      abilityId: ability?.id || null,
      ability: ability?.shortName || null,
      mod: formatSigned(abilityMod),
      attack: formatSigned(abilityMod + proficiencyBonus),
      save: 8 + proficiencyBonus + abilityMod,
    };
  },

  // `pactMagic` has the same per-level `{level, used, available}` array
  // shape as `spellSlots`, so both are read identically here — DDB supplies
  // real slot data directly, no need to derive it from caster-level tables.
  // Generic limited-use pools (Ki points, Second Wind, feat-granted uses)
  // come from actions/features/feats' own limitedUse — reset type is a
  // numeric code there (durations lookup) but already a friendly string on
  // inventory-item limitedUse, so only numbers get looked up.
  limitedUsesTable(context) {
    const rawCharacter = context.root;
    const pools = [];

    ["actions", "features", "feats"].forEach((key) => {
      const entries = rawCharacter?.[key];
      if (!Array.isArray(entries)) return;
      entries.forEach((entry) => {
        const limitedUse = entry.limitedUse || entry.definition?.limitedUse;
        if (!limitedUse || !(limitedUse.maxUses || limitedUse.useProficiencyBonus)) return;
        const reset =
          typeof limitedUse.resetType === "number" ? DURATIONS[limitedUse.resetType] || null : limitedUse.resetType || null;
        pools.push({
          name: entry.name || entry.definition?.name || "Resource",
          uses: limitedUse.maxUses || 0,
          used: limitedUse.numberUsed || 0,
          reset,
        });
      });
    });

    (rawCharacter?.spellSlots || []).forEach((slot) => {
      const level = slot.level || 0;
      const available = slot.available ?? 0;
      const used = slot.used ?? 0;
      const total = available + used;
      if (!total) return;
      pools.push({ name: `Level ${level} Spell Slots`, level, total, available, used, reset: "Long Rest" });
    });

    (rawCharacter?.pactMagic || []).forEach((slot) => {
      const level = slot.level || 0;
      const available = slot.available ?? 0;
      const used = slot.used ?? 0;
      const total = available + used;
      if (!total) return;
      pools.push({ name: "Pact Magic", level, total, available, used, reset: "Short Rest" });
    });

    return pools;
  },

  // Flat `{strength: N, dexterity: N, ...}` — matching Monster/NPC's own
  // stats.abilities exactly. Not an array of enriched objects: that
  // metadata is already available from the System's own `abilities` field
  // definitions, and `modifier` is derivable via the same
  // `abilityModifier()` helper the UI already uses, not stored.
  abilitiesTable(context) {
    const modifiers = getActiveModifiers(context.root);
    const scores = calculateAbilityScores(context.root, modifiers);
    const result = {};
    ABILITIES.forEach((ability) => {
      result[ability.name] = scores[ability.name] ?? 10;
    });
    return result;
  },

  // Real DDB characters have no simple "current HP" field — current is
  // derived from baseHitPoints/bonusHitPoints/overrideHitPoints/
  // removedHitPoints, same as DDB's own sheet computes it. `temp` maps
  // straight from DDB's own temporaryHitPoints.
  hitPoints(context) {
    const rawCharacter = context.root;
    const modifiers = getActiveModifiers(rawCharacter);
    const scores = calculateAbilityScores(rawCharacter, modifiers);
    const conModifier = Math.floor(((scores.constitution ?? 10) - 10) / 2);
    const totalLevel = getTotalLevelRaw(rawCharacter.classes);
    const perLevelBonus = collectModifiers(modifiers, "hit-points-per-level", "bonus");
    const base = rawCharacter.overrideHitPoints || (rawCharacter.baseHitPoints || 0) + (rawCharacter.bonusHitPoints || 0);
    const damageTaken = rawCharacter.removedHitPoints || 0;
    const max = base + totalLevel * (conModifier + perLevelBonus);
    return { max, current: Math.max(0, max - damageTaken), temp: rawCharacter.temporaryHitPoints || 0 };
  },

  // DDB's export has no flat "armor class" field; it's the best
  // equipped-armor value plus Dex (capped by armor type) plus a shield and
  // any flat AC modifiers, same computation DDB's own sheet does.
  armorClass(context) {
    const rawCharacter = context.root;
    const modifiers = getActiveModifiers(rawCharacter);
    const scores = calculateAbilityScores(rawCharacter, modifiers);
    const dexModifier = Math.floor(((scores.dexterity ?? 10) - 10) / 2);
    const bonus = collectModifiers(modifiers, "armor-class", "bonus");

    const inventory = Array.isArray(rawCharacter.inventory) ? rawCharacter.inventory : [];
    const equippedArmor = inventory.filter((item) => item.equipped && item.definition?.armorClass != null);
    const hasShield = inventory.some(
      (item) => item.equipped && /shield/i.test(item.definition?.type || item.definition?.filterType || "")
    );

    const armorValues = equippedArmor.map((item) => {
      const def = item.definition || {};
      const armorBase = def.armorClass || 0;
      const dexContribution =
        /light/i.test(def.type) || def.armorTypeId === 1
          ? dexModifier
          : /medium/i.test(def.type) || def.armorTypeId === 2
          ? Math.min(dexModifier, 2)
          : /heavy/i.test(def.type) || def.armorTypeId === 3
          ? 0
          : dexModifier;
      return armorBase + dexContribution;
    });

    const naturalAc = 10 + dexModifier;
    const baseAc = armorValues.length ? Math.max(...armorValues) : naturalAc;
    return baseAc + bonus + (hasShield ? 2 : 0);
  },

  savingThrowsTable(context) {
    const modifiers = getActiveModifiers(context.root);
    const scores = calculateAbilityScores(context.root, modifiers);
    const totalLevel = getTotalLevelRaw(context.root?.classes);
    const proficiencyBonus = getProficiencyBonusRaw(totalLevel);
    const generalSaveBonus = Math.max(collectGeneralSavingThrowBonus(modifiers), collectItemSavingThrowBonus(context.root));

    return ABILITIES.map((ability) => {
      const subtype = SAVING_THROW_SUBTYPES[ability.name];
      const subtypes = [subtype, "saving-throws"];
      const abilityModifier = Math.floor(((scores[ability.name] || 10) - 10) / 2);
      const { level, roundUp } = determineProficiencyLevel(modifiers, subtypes);
      const savingThrowBonus = collectModifiers(modifiers, subtype, "bonus") + generalSaveBonus;
      const proficiencyValue = applyProficiency(level, proficiencyBonus, roundUp);
      return {
        ...ability,
        value: abilityModifier + proficiencyValue + savingThrowBonus,
        proficiency: level,
        advantage: hasModifierOfType(modifiers, subtypes, "advantage"),
        disadvantage: hasModifierOfType(modifiers, subtypes, "disadvantage"),
      };
    });
  },

  skillsTable(context) {
    return buildSkillValues(context.root);
  },

  // Plain string, matching Monster/NPC's own `alignment` shape. ALIGNMENTS
  // entries carry `id` matching DDB's alignmentId and `friendlyName` (the
  // display name — `name` itself is a slug).
  alignmentTable(context) {
    const alignmentId = context.root?.alignmentId;
    const match = ALIGNMENTS.find((entry) => entry.id === alignmentId);
    return match?.friendlyName || null;
  },

  // Everyone technically CAN have an "initiative" proficiency/expertise
  // modifier (the Alert feat, a subclass feature), hence the same
  // determineProficiencyLevel/applyProficiency path saves/skills use, not
  // just a flat Dex mod. `{bonus, advantage?, disadvantage?}` matches
  // Monster/NPC's stats.initiative — advantage/disadvantage sparse, omitted
  // rather than `false` when absent.
  initiativeTable(context) {
    const rawCharacter = context.root;
    const modifiers = getActiveModifiers(rawCharacter);
    const scores = calculateAbilityScores(rawCharacter, modifiers);
    const totalLevel = getTotalLevelRaw(rawCharacter?.classes);
    const proficiencyBonus = getProficiencyBonusRaw(totalLevel);

    const dexModifier = Math.floor(((scores.dexterity || 10) - 10) / 2);
    const { level, roundUp } = determineProficiencyLevel(modifiers, "initiative");
    const bonus = collectModifiers(modifiers, ["initiative", "dexterity-ability-checks"], "bonus");

    const result = { bonus: dexModifier + applyProficiency(level, proficiencyBonus, roundUp) + bonus };
    if (modifiers.some((modifier) => modifier.subType === "initiative" && modifier.type === "advantage")) result.advantage = true;
    if (modifiers.some((modifier) => modifier.subType === "initiative" && modifier.type === "disadvantage")) result.disadvantage = true;
    return result;
  },

  // Passive Perception/Investigation/Insight (10 + the matching skill's
  // already-computed value, via buildSkillValues) plus every known-range
  // sense (darkvision/blindsight/tremorsense/truesight, via SENSES) from
  // active modifiers, race-granted modifiers, and DDB's customSenses,
  // deduped keeping the largest range per sense name.
  sensesTable(context) {
    const rawCharacter = context.root;
    const modifiers = getActiveModifiers(rawCharacter);
    const allowed = new Set(SENSES.map((sense) => sense.name));
    const knownSenses = [];

    const pushFromModifier = (modifier) => {
      const normalized = modifier.subType.toLowerCase();
      const baseSense = SENSES.find((sense) => sense.name === normalized) || { id: modifier.id, name: normalized };
      knownSenses.push({ ...baseSense, range: modifier.fixedValue ?? modifier.value ?? null });
    };

    modifiers.filter((modifier) => modifier.subType && allowed.has(modifier.subType.toLowerCase())).forEach(pushFromModifier);

    const raceModifiers = (rawCharacter?.race?.racialTraits || [])
      .flatMap((trait) => trait.definition?.grantedModifiers || [])
      .filter((modifier) => modifier.subType && allowed.has(modifier.subType.toLowerCase()));
    raceModifiers.forEach(pushFromModifier);

    const customSenses = rawCharacter?.customSenses || [];
    customSenses.forEach((entry) => {
      const baseSense = SENSES.find((sense) => sense.id === entry.senseId || sense.id === entry.id);
      const name = (baseSense?.name || entry.name || "").toLowerCase();
      if (!name) return;
      knownSenses.push({ id: baseSense?.id || entry.id, name, range: entry.distance ?? entry.value ?? null });
    });

    const deduped = {};
    knownSenses.forEach((sense) => {
      const current = deduped[sense.name];
      if (!current || (sense.range ?? 0) > (current.range ?? 0)) deduped[sense.name] = sense;
    });

    const skillValues = buildSkillValues(rawCharacter).reduce((map, skill) => {
      map[skill.name] = skill.value;
      return map;
    }, {});

    const flattened = {
      passives: {
        perception: 10 + (skillValues.perception || 0),
        investigation: 10 + (skillValues.investigation || 0),
        insight: 10 + (skillValues.insight || 0),
      },
    };
    Object.values(deduped).forEach((sense) => {
      flattened[sense.name] = sense.range ?? null;
    });
    return flattened;
  },

  // Ported from ddb-parser.js's buildSpeeds — SPEEDS entries
  // (deriveLookupTables, matching sys.dnd5e.json's own `speeds` field)
  // carry `shortName` ("walking"/"burrowing"/...), the same suffix DDB's
  // own `innate-speed-{shortName}` modifier subtype uses.
  speedsTable(context) {
    const rawCharacter = context.root;
    const modifiers = getActiveModifiers(rawCharacter);
    const baseSpeeds = rawCharacter?.race?.weightSpeeds?.normal || {};
    const generalBonus = collectModifiers(modifiers, "speed", "bonus");
    const walkSpeed = (baseSpeeds.walk || 0) + generalBonus;

    return SPEEDS.reduce((speeds, speed) => {
      const innateSubtype = `innate-speed-${speed.shortName || speed.name}`;
      const base = (baseSpeeds[speed.name] || 0) + (speed.name === "walk" ? generalBonus : 0);
      const innate = collectMaxModifier(modifiers, innateSubtype, ["set", "set-base"]);
      const bonus = collectModifiers(modifiers, `${speed.name}-speed`, "bonus");
      const hasInnate = modifiers.some((modifier) => modifier.subType === innateSubtype && ["set", "set-base"].includes(modifier.type));
      const innateBase = innate || (hasInnate ? walkSpeed : 0);
      speeds[speed.name] = Math.max(base, innateBase) + bonus;
      return speeds;
    }, {});
  },

  determineSize(context) {
    const rawCharacter = context.root;
    if (!rawCharacter) return null;
    const modifiers = getActiveModifiers(rawCharacter);
    const sizeModifier = modifiers.find((modifier) => (modifier.type || "").toLowerCase() === "size" && modifier.subType);
    const candidates = [
      sizeModifier?.subType,
      sizeModifier?.fixedValue ?? sizeModifier?.value,
      rawCharacter.race?.sizeId,
      rawCharacter.race?.weightSpeeds?.sizeId,
      rawCharacter.race?.weightSpeeds?.size,
      rawCharacter.traits?.size,
    ].filter(Boolean);

    const match = candidates
      .map((entry) => (typeof entry === "string" ? entry.toLowerCase() : entry))
      .map((candidate) =>
        SIZES.find(
          (size) => size.id === candidate || size.value === candidate || (typeof candidate === "string" && size.name.toLowerCase() === candidate)
        )
      )
      .find(Boolean);

    return match?.name || null;
  },

  // Spellcasting sub-values, meant to be computed once via a `with` node and
  // reused across the spells pipeline's per-spell map step.
  spellAbilityMod(context) {
    const ability = determineSpellcastingAbility(context.root?.classes);
    if (!ability) return 0;
    const modifiers = getActiveModifiers(context.root);
    const scores = calculateAbilityScores(context.root, modifiers);
    return Math.floor(((scores[ability.name] || 10) - 10) / 2);
  },

  spellSaveDc(context) {
    const totalLevel = getTotalLevelRaw(context.root?.classes);
    const proficiencyBonus = getProficiencyBonusRaw(totalLevel);
    return 8 + proficiencyBonus + (context.spellAbilityMod || 0);
  },

  spellToHitBonus(context) {
    const totalLevel = getTotalLevelRaw(context.root?.classes);
    const proficiencyBonus = getProficiencyBonusRaw(totalLevel);
    return formatSigned(proficiencyBonus + (context.spellAbilityMod || 0));
  },

  // Pipeline `source` custom function: gathers spell entries from every
  // bucket (context.spells.{class,race,feat} and classSpells[].spells) into
  // one flat array, each tagged with its source bucket — the genuine
  // multi-source assembly part, before the declarative pipeline steps take over.
  collectRawSpells(context) {
    const rawCharacter = context.root;
    const entries = [];
    const spellsBucket = rawCharacter?.spells;
    if (spellsBucket && typeof spellsBucket === "object") {
      ["class", "race", "feat"].forEach((bucket) => {
        const list = spellsBucket[bucket];
        if (Array.isArray(list)) {
          list.forEach((spell) => entries.push({ spell, source: bucket }));
        }
      });
    }
    if (Array.isArray(rawCharacter?.classSpells)) {
      rawCharacter.classSpells.forEach((classSpell) => {
        (classSpell.spells || []).forEach((spell) => entries.push({ spell, source: "class" }));
      });
    }
    return entries;
  },
  };
}
