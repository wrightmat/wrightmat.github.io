// Escape-hatch custom functions for Loom mapping definitions, registered by
// name and invoked from `custom` nodes/steps (see mapping-engine.js).
//
// These are the pieces of common/ddb-parser.js's logic that genuinely don't
// fit the declarative object/field/pipeline primitives: getActiveModifiers()
// cross-references modifiers against inventory equip/attunement state with
// componentId-based deduplication, and several sections build on it in ways
// that are reconciliation/classification logic rather than a map/filter/sort/
// group-by/dedup shape. Ported near-verbatim from ddb-parser.js (not
// reimplemented) since the escape hatch's whole point is reusing exactly this
// kind of logic rather than forcing it into primitives that don't fit.
//
// Every root-level custom function receives (context, args, env); every
// pipeline-step custom function receives (currentValue, context, args, env).
// `context.root` is always the original raw character object, regardless of
// how deep the mapping tree has descended.
import { resolveDottedPath as resolvePath } from "./dotted-path.js";

// Factory rather than a static export: ABILITIES/SAVING_THROW_SUBTYPES/
// SKILLS/SIZES used to be static imports from common/js/lib/lookup-tables.js
// (a hardcoded module); they're now derived at runtime from the active D&D
// 5e System record (see common/js/lib/system-lookup-tables.js's
// deriveLookupTables), so this whole module becomes a factory closing over
// whatever the caller derived, called once per DDB import (content-fetch.js,
// loom/js/app.js) rather than a module-level singleton. Every function body
// below is otherwise unchanged from the previous static-import version.
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
}) {
// Best-effort text parsing for D&D Beyond's scraped "Core <Class> Traits"
// values (plain descriptive strings, e.g. "D12 per Barbarian level" or
// "Strength and Constitution") into the 5e API's more structured shapes
// (a bare number; an array of {index, name} ability refs). Not derivable via
// the formula engine (no string-splitting/regex functions), and fuzzier than
// a clean rename — hence a custom function rather than a `field` bind.
function parseHitDie(text) {
  const match = /d\s*(\d+)/i.exec(text || "");
  return match ? Number(match[1]) : null;
}

function parseLeadingNumber(text) {
  const match = /(\d+)/.exec(text || "");
  return match ? Number(match[1]) : null;
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

// "Magic Initiate (Cleric)" -> {index:"magic-initiate", name:"Magic Initiate", note:"Cleric"}
function parseFeatWithNote(text) {
  if (!text) return null;
  const match = /^(.+?)\s*\(([^)]+)\)\s*$/.exec(text.trim());
  const name = match ? match[1].trim() : text.trim();
  const feat = { index: slugify(name), name };
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

// Mirrors the 5e API's equipment-choice shape, minus the per-item `url` (D&D
// Beyond doesn't give us a 5e API item reference to point at). Three distinct
// patterns, checked in order: "4 Handaxes" (leading count,
// name pluralized by the count so it gets singularized); "Parchment (10
// sheets)" (count embedded in a trailing parenthetical, name NOT pluralized —
// "Calligrapher's Supplies" also ends in a trailing (paren) but with no
// digit inside, meaning it's a note like the feat's "(Cleric)", not a count);
// and a bare name with neither (count 1, name used exactly as written — NOT
// singularized, since without a leading count there's no reason to assume
// the DDB text is plural in the first place, e.g. "Calligrapher's Supplies"
// is the item's actual name, not "several supplies").
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

// DDB's `actions` bucket groups entries by source (race/class/feat/...),
// same shape context.spells.{class,race,feat} already gets flattened for
// (see collectRawSpells below) — one flat list, tagging isn't needed here
// since attacksTable doesn't care which source an attack came from.
function flattenActions(actions) {
  if (!actions || typeof actions !== "object") return [];
  return Object.values(actions).reduce((all, group) => (Array.isArray(group) ? all.concat(group) : all), []);
}

function formatActionDamage(dice) {
  if (!dice) return null;
  const base = typeof dice === "string" ? dice : dice.diceString || "";
  return base || null;
}

// A small, stable, edition-core vocabulary (10 named 5e fighting styles) —
// used only to recognize a feat by its exact PHB name for the
// attacksPerAction/fightingStyle summary, not a sprawling per-item content
// table the way weapon classification would be, so kept inline rather than
// a new System field for this one lookup.
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
// advantage/disadvantage on a save or skill) — same subtype-list-matching
// convention as collectModifiers/determineProficiencyLevel, just a boolean
// presence check instead of summing/maxing a numeric value. Used to attach
// advantage/disadvantage directly to the ability/skill it actually applies
// to (savingThrowsTable, buildSkillValues) instead of a separate generic
// bucket — see proficienciesTable's own comment on why that bucket no
// longer catches these at all.
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
  return totalLevel > 0 ? 2 + Math.floor((totalLevel - 1) / 4) : 0;
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
// Insight need the same computed skill values skillsTable itself exposes) —
// a standalone function rather than sensesTable calling `this.skillsTable`,
// since these are plain object-literal methods and nothing guarantees the
// mapping engine invokes them in a way that preserves `this`.
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

// A D&D Beyond monster's specialTraitsDescription/actionsDescription (see
// content-fetch.js's own fetchDdbMonster — confirmed against a real live
// fetch) are raw HTML, not structured data: one `<p>` per trait/action, the
// name bolded (`<strong>Name.</strong>`, sometimes also wrapped in `<em>` —
// an action's own `<em>` sometimes continues past the name to also wrap a
// type label like "Melee Weapon Attack:", which is why this only anchors on
// the closing `</strong>`, not on where any surrounding `<em>` happens to
// end). Uses the DOM (this module only ever runs in a browser) to decode
// entities/strip nested tags (dice-notation `<span>`s, etc.) rather than a
// hand-rolled entity table, which real HTML content will eventually break.
function stripHtmlToText(html) {
  const el = document.createElement("div");
  el.innerHTML = html;
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

// A `<p>` with no leading bolded name is a CONTINUATION of the previous
// trait's own description, not a new entry — confirmed against real data
// (Gray Ooze's own "Corrode Metal" trait splits across two `<p>` tags,
// the second with no name at all).
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

// Extracted from what used to be proficienciesTable's own inline body (that
// function now just calls this and trims two keys off) — a standalone
// function, not an object-literal method, so proficiencyDefenses/
// proficiencyLanguages below can call it directly too without relying on
// `this` (this file's own established rule — see sensesTable's own comment
// on why: "nothing guarantees the mapping engine invokes them in a way that
// preserves `this`").
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

// --- Registered custom functions (referenced by name from mapping JSON) ---

return {
  // `args.path` defaults to "name"; use e.g. {"path":"root.name"} to slug the
  // root/parent entity's name instead of the current context's own name.
  slug(context, args) {
    return slugify(resolvePath(context, args?.path || "name"));
  },

  // `args.path` names which raw HTML field to parse (e.g.
  // "specialTraitsDescription"/"actionsDescription") — see
  // parseDdbHtmlTraitBlocks above for the actual parsing. Returns
  // [{name, description}, ...], the same shape 5e-api-monster.json's own
  // traits/actions already use.
  ddbParseHtmlTraits(context, args) {
    return parseDdbHtmlTraitBlocks(resolvePath(context, args?.path || ""));
  },

  // D&D Beyond's own monster-service payload carries no System reference at
  // all (there's only ever one game system a DDB monster could belong to) —
  // a monster imported through ddb-monster.json previously saved with no
  // `systemIds`, invisible to anything that filters by System. Fixed,
  // hardcoded "sys.dnd5e" — the DDB-import pipeline is inherently D&D-5e-
  // specific already (see content-fetch.js's own DND5E_SYSTEM_ID constant,
  // same reasoning).
  ddbMonsterSystemIds() {
    return ["sys.dnd5e"];
  },

  // Same reasoning and same hardcoded value as ddbMonsterSystemIds above —
  // the 5e-API/SRD monster-import pipeline is just as unambiguously D&D-5e-
  // specific, but had no systemIds field at all before this, so every SRD
  // monster import landed invisible to anything that filters by System.
  // Kept as its own function (not a shared name) so each mapping's own
  // intent stays legible at the call site.
  srdMonsterSystemIds() {
    return ["sys.dnd5e"];
  },

  // D&D Beyond's own monster-service `senses` (confirmed via a real live
  // fetch) is `[{senseId, notes}]` — senseId a numeric id resolved through
  // the SAME `senses` lookup table `lookup('senses', ...)` formula calls
  // already use (`env.lookupTables`, not `args` — needs the live table),
  // `notes` a free-text range string ("60 ft.") to regex-extract a plain
  // number out of. Folds the monster's own separate `passivePerception`
  // field into `passives.perception`, producing this suite's one shared
  // senses shape — `{passives:{perception}, darkvision, blindsight, ...}` —
  // matching Character's own sensesTable output, srdSenses, and
  // fantasyStatblockSenses exactly. `args.sensesPath`/
  // `args.passivePerceptionPath` default to "senses"/"passivePerception".
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

  // The 5e API's own raw `senses` (confirmed via a real live fetch) is a
  // keyed object of already-unit-suffixed strings plus `passive_perception`
  // — e.g. `{darkvision: "60 ft.", passive_perception: 12}`. Reshapes into
  // this suite's one shared senses shape, same as ddbMonsterSenses/
  // fantasyStatblockSenses above.
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

  // D&D Beyond's own monster-service `movements` (confirmed via a real live
  // fetch, content-fetch.js's fetchDdbMonster) is `[{movementId, speed,
  // notes}, ...]` — resolved into this suite's one shared speed shape,
  // `{walk, burrow, climb, fly, swim}` (matching Character's own
  // speedsTable/ddb-character.json's speed shape exactly — see the
  // monster-data-alignment plan). Resolves each entry's own `movementId`
  // through the SAME `speeds` lookup table `lookup('speeds', ...)` formula
  // calls already use (`env.lookupTables`, not `args` — needs the live
  // table). Falls back to "walk" if a movement has no resolvable name
  // (DDB's own base-walking-speed entry sometimes has no movementId at
  // all).
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

  // Fantasy Statblocks' own `speed` is a single free-text string ("30 ft.,
  // swim 30 ft.", "fly 60 ft. (hover)") — the first, unprefixed entry is
  // always walking speed; every other entry is prefixed by its own
  // movement-type name. Parsed into this suite's one shared speed shape,
  // same as ddbFormatSpeed above. `args.path` defaults to "speed".
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
        result[(match[1] || "walk").toLowerCase()] = Number(match[2]);
      });
    return result;
  },

  // The 5e API's own raw `speed` (confirmed via a real live fetch) is a
  // keyed object of already-unit-suffixed strings — `{walk: "30 ft.", swim:
  // "30 ft."}` — parsed into this suite's one shared speed shape, same as
  // ddbFormatSpeed/fantasyStatblockSpeed above.
  formatSpeedFromObject(context, args) {
    const raw = resolvePath(context, args?.path || "speed");
    const result = {};
    if (raw && typeof raw === "object") {
      Object.entries(raw).forEach(([key, value]) => {
        const match = String(value || "").match(/(\d+)/);
        if (match) result[key] = Number(match[1]);
      });
    }
    return result;
  },

  // Both 5e-API's raw `challenge_rating` (a decimal number, e.g. 0.5) and
  // Fantasy Statblocks' plugin-authored `cr` (usually already a string, but
  // not guaranteed) need to converge on the same string shape DDB's own
  // `lookup('challengeRatings', ...).shortName` already produces (a whole
  // number or a fraction — "5", "1/2", "1/8") — this suite's one CR
  // convention. `args.path` defaults to "challenge_rating".
  formatChallengeRating(context, args) {
    const raw = resolvePath(context, args?.path || "challenge_rating");
    if (typeof raw === "string") return raw.trim();
    const value = Number(raw);
    if (!Number.isFinite(value)) return "";
    const FRACTIONS = { 0.125: "1/8", 0.25: "1/4", 0.5: "1/2" };
    return FRACTIONS[value] || String(value);
  },

  // 5e-API's raw `proficiencies` (confirmed by this mapping's own prior
  // pipeline step, which this function replaces) is `[{proficiency:{name:
  // "Saving Throw: DEX"|"Skill: Perception"}, value:{value:N}}, ...]` — one
  // flat list mixing both concepts, distinguished only by a fixed string
  // prefix on the label. Splits it into the same two-field convention DDB/
  // Fantasy Statblocks' own `savingThrows`/`skills` already use (`{name,
  // value}[]` each), matching this suite's one shared shape for the
  // concept. `args.path` defaults to "proficiencies"; wire via a `with`
  // binding (same pairing pattern `fantasyStatblockSenses`'s own comment
  // documents) so both sibling output fields read this one computed result
  // instead of each re-parsing the raw list independently.
  srdSplitProficiencies(context, args) {
    const entries = resolvePath(context, args?.path || "proficiencies");
    const savingThrows = [];
    const skills = [];
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      const label = entry?.proficiency?.name || "";
      const value = entry?.value?.value;
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

  // Fantasy Statblocks' own `saves`/`skillsaves` (Obsidian's plugin, see
  // content-fetch.js's loadFantasyStatblockData) are each a YAML list of
  // single-key maps — `- Con: 5`, `- Arcana: 4` — the key name itself
  // varying per entry (an ability abbreviation, or a skill name), so nothing
  // in the mapping engine's declarative primitives can read "whatever the
  // one key on this object happens to be." `args.path` names which raw
  // field to read; returns [{name, value}, ...], the same shape
  // ddb-monster.json's own savingThrows/skills already use.
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
  // `senses` string as darkvision/blindsight/etc (e.g. "darkvision 120 ft.,
  // passive Perception 13") — no separate field, confirmed across all 3
  // reference examples, and always uses standard D&D sense-type names.
  // Splits/parses it directly into this suite's one shared senses shape —
  // `{passives:{perception}, darkvision, blindsight, ...}`, matching
  // ddbMonsterSenses/srdSenses/Character's own sensesTable exactly — sourced
  // from the SAME `senses` lookup table (`env.lookupTables`, not `args`) so
  // the sense-name vocabulary lives in one place. `args.path` defaults to
  // "senses".
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

  // Fantasy Statblocks' own `damage_resistances`/`damage_vulnerabilities`
  // (confirmed) and `damage_immunities`/`condition_immunities` (never seen
  // in the 3 reference examples, mapped defensively on the same assumed
  // convention as the two confirmed fields) are each a single free-text
  // string, comma-separated when more than one applies (e.g.
  // "cold, fire") — split and trimmed into a plain string array, matching
  // Crucible's own damageResistances/damageImmunities shape.
  fantasyStatblockSplitList(context, args) {
    return splitCommaList(resolvePath(context, args?.path || ""));
  },

  // The "notes" half of splitFantasyStatblockNotes above — References
  // stripped out (see fantasyStatblockSources below for where that half
  // goes instead). `args.path` defaults to "_postFenceNotes".
  fantasyStatblockNotes(context, args) {
    return splitFantasyStatblockNotes(resolvePath(context, args?.path || "_postFenceNotes")).notes;
  },

  // Combines the YAML frontmatter's own terse `source` field (e.g. "MM",
  // a sourcebook abbreviation) with any citations parsed out of the
  // "### References" list (splitFantasyStatblockNotes above) into one
  // array — both are "where this content came from" in the same sense,
  // and this suite has one `sources` field per monster, not two competing
  // citation concepts. `args.sourcePath`/`args.notesPath` default to
  // "source"/"_postFenceNotes".
  fantasyStatblockSources(context, args) {
    const fromSourceField = splitCommaList(resolvePath(context, args?.sourcePath || "source"));
    const { references } = splitFantasyStatblockNotes(resolvePath(context, args?.notesPath || "_postFenceNotes"));
    return [...fromSourceField, ...references];
  },

  // Fantasy Statblocks' own damage_resistances/damage_vulnerabilities/
  // damage_immunities/condition_immunities are each a separate free-text,
  // comma-separated field — combined here into this suite's one shared
  // `defenses` array (matching Character's own proficiencies.defenses
  // exactly), each entry tagged with its `type`. Condition immunities fold
  // into the same array as `type: "immunity"` too — no separate condition-
  // immunity bucket, same convention Character's own data already uses
  // (e.g. `{name:"Magical Sleep", type:"immunity"}`).
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

  // The 5e API's own damage_resistances/damage_vulnerabilities/
  // damage_immunities are each already a flat string array; condition_
  // immunities is an array of `{name}` reference objects (read raw here,
  // not via the mapping's own pipeline step, since a custom function only
  // ever sees the raw input context). Combined into this suite's one shared
  // `defenses` array, each entry tagged with its `type` — same convention
  // fantasyStatblockDefenses/Character's own proficiencies.defenses use.
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

  // D&D Beyond's own monster conditionImmunities (numeric ids, resolved via
  // the SAME positional `conditions` lookup table `lookup('conditions',
  // ...)` formula calls already use — a plain array of strings indexed by
  // sourceId, see system-lookup-tables.js's own `positionalNames`) fold into
  // this suite's one shared `defenses` array as `type: "immunity"` entries —
  // same convention every other source uses for condition immunities.
  // Damage-type resistances/immunities/vulnerabilities are NOT included
  // here yet: DDB's own raw `damageAdjustments` field has no documented
  // shape anywhere in this codebase or a confirmed live-fetch sample (unlike
  // senses/speed, which were verified against real payloads before being
  // ported) — a known, flagged gap in the monster-data-alignment plan
  // rather than a guessed-at parser. `args.path` defaults to
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
    return parseLeadingNumber(context.coreTraits?.speed);
  },

  ddbSavingThrows(context) {
    return parseAbilityRefs(context.coreTraits?.savingThrowProficiencies);
  },

  // A D&D Beyond MONSTER's own `stats` (confirmed via a real live fetch,
  // content-fetch.js's fetchDdbMonster) is `[{statId, name, value}, ...]` —
  // an array keyed by DDB's own numeric statId, not the character-sheet
  // shape any of the ddb* functions above assume. Reshapes it into the
  // keyed-object form `{strength, dexterity, ...}` this suite's own common
  // monster-stats standard uses (matches Crucible's own stats.abilities —
  // see crucible/js/lib/stats.js), keyed by the SAME ability names
  // system-lookup-tables.js's own `abilities` table already exposes
  // (sys.dnd5e.json's own ability field keys, e.g. "dexterity"). `args.path`
  // defaults to "stats"; ddb-monster.json's own `initiativeBonus` field
  // reads this same object back via a `with` binding rather than
  // recomputing it, since a formula bind can only ever see the RAW input
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

  // Ported from ddb-parser.js's buildFeats — a straight list, no
  // classification needed (feat-granted proficiencies/bonuses already flow
  // through proficienciesTable/the relevant ability-score paths via their
  // own modifiers).
  featsTable(context) {
    const feats = Array.isArray(context.root?.feats) ? context.root.feats : [];
    return feats.map((feat) => ({
      name: feat.definition?.name || "Unknown Feat",
      description: feat.definition?.description || "",
      level: feat.requiredLevel || null,
      limitedUse: feat.definition?.limitedUse || null,
    }));
  },

  // Ported from ddb-parser.js's buildFeatures — class features (including
  // subclass features), racial traits, and feat descriptions, combined and
  // deduped by name (a feat and its granted feature can otherwise appear
  // twice).
  featuresTable(context) {
    const rawCharacter = context.root;
    const classes = Array.isArray(rawCharacter?.classes) ? rawCharacter.classes : [];
    const classFeatures = classes
      .flatMap((cls) => [...(cls.classFeatures || []), ...(cls.subclassDefinition?.classFeatures || [])])
      .map((feature) => feature.definition)
      .filter(Boolean);
    const racialTraits = (rawCharacter?.race?.racialTraits || []).map((trait) => trait.definition).filter(Boolean);
    const featFeatures = (rawCharacter?.feats || []).map((feat) => feat.definition).filter(Boolean);
    const combined = [...classFeatures, ...racialTraits, ...featFeatures];
    const seen = new Set();
    return combined.reduce((list, feature) => {
      const name = feature.name || feature.friendlySubtypeName;
      if (!name || seen.has(name.toLowerCase())) return list;
      seen.add(name.toLowerCase());
      list.push({ name, description: feature.description || feature.snippet || "" });
      return list;
    }, []);
  },

  // Ported from ddb-parser.js's buildProficiencies — buckets every active
  // modifier by its own type/subType strings (no hardcoded per-item
  // tables). saves/skills/scores buckets are dropped versus the old
  // script: savingThrowsTable/skillsTable already cover that ground with
  // real per-item proficiency levels, so a flat name list here would just
  // be a worse duplicate.
  // `defenses`/`languages` are deliberately NOT in this object anymore —
  // they relocated to `stats.proficiencies.{defenses,languages}` (this
  // suite's one shared path/shape for both, matching every monster import
  // mapping's own defenses/languages functions — see the monster-data-
  // alignment plan), via proficiencyDefenses/proficiencyLanguages below.
  // Keeping them here too would be the exact "two keys doing the same job"
  // this suite avoids everywhere else.
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

  // Ported from ddb-parser.js's buildAttacks (equipped-weapon half) plus a
  // synthesized Unarmed Strike (DDB doesn't supply one for non-Monk
  // characters — every 5e character can make one regardless of class).
  // Two real corrections versus the old script:
  //  - Weapon proficiency/melee-ranged classification uses DDB's own
  //    item.definition.categoryId (1=Simple, 2=Martial) and attackType
  //    (1=Melee, 2=Ranged) directly — confirmed present on every weapon
  //    item — instead of the old script's hardcoded WEAPONS.simple/
  //    martial/ranged name lists. This also drops a real bug: the old
  //    script granted martial-weapon proficiency to *any* ranged weapon,
  //    including simple ones (isRanged && martial-weapons check).
  //  - Damage type prefers DDB's own friendly strings — weapon items'
  //    definition.damageType (already a string), and for spell-backed
  //    displayAsAttack actions, that spell's own definition.modifiers
  //    entry with type:"damage" (also a string — confirmed against a live
  //    export: Hunter's Mark resolves to "Force" this way). Only a
  //    non-spell action with *only* a numeric damageTypeId and no string
  //    anywhere nearby falls back to the damageTypes System lookup.
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

  // Ported from ddb-parser.js's buildSpellcasting — standalone
  // ability/mod/attack-bonus/save-DC stats. Previously only computed
  // internally (spells' own toHit/dc) via determineSpellcastingAbility,
  // which already existed in this file; not exposed as its own field
  // before now.
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

  // Ported from ddb-parser.js's buildLimitedUses, simplified against a live
  // export rather than assumption: the old script treated Pact Magic as a
  // single object with several possible key-name guesses
  // (context.pactMagic.totalSlots/slots/maxSlots/...), because at the time
  // it was written DDB's API apparently didn't return it in a simple shape.
  // A real export today has `pactMagic` in exactly the same per-level
  // `{level, used, available}` array shape as `spellSlots` — so both are
  // read identically here, and the old script's `deriveSpellSlots`
  // (computing slots from hardcoded full/half/third-caster level tables,
  // for when DDB's own data was missing) is dropped as unnecessary: DDB
  // supplies real slot data directly now. Generic limited-use pools
  // (Ki points, Second Wind, feat-granted uses, ...) come from
  // actions/features/feats' own limitedUse — reset type is a numeric code
  // on those (durations lookup, confirmed live: resetType 2 = "Long
  // Rest"), but already a friendly string on inventory-item limitedUse
  // (e.g. "Consumable"), so only numbers get looked up.
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
  // stats.abilities exactly (this suite's one shared shape — see the
  // monster-data-alignment plan). No longer an array of enriched
  // {id,name,friendlyName,shortName,score,modifier} objects — that
  // metadata is already available from the active System's own `abilities`
  // field definitions (abilityFieldDefs), no need to duplicate it per-
  // character; `modifier` is derivable via the same `abilityModifier()`
  // helper Monster/NPC's own UI already uses, not stored.
  abilitiesTable(context) {
    const modifiers = getActiveModifiers(context.root);
    const scores = calculateAbilityScores(context.root, modifiers);
    const result = {};
    ABILITIES.forEach((ability) => {
      result[ability.name] = scores[ability.name] ?? 10;
    });
    return result;
  },

  // Ported from ddb-parser.js's buildHitPoints (never carried over to this
  // mapping-custom-functions.js rewrite, so DDB imports have never populated
  // hit points until now). Real DDB characters have no simple "current HP"
  // field — current is derived from baseHitPoints/bonusHitPoints/
  // overrideHitPoints/removedHitPoints, the same as DDB's own sheet
  // computes it. `temp` maps straight from DDB's own temporaryHitPoints —
  // initially excluded as out of scope, now a real synced field (see the
  // System's combatBindings.tempHp and the character template's Temp HP
  // component), so it's included here too.
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

  // Ported from ddb-parser.js's buildArmorClass (also never carried over) —
  // found while porting hitPoints above. DDB's export has no flat "armor
  // class" field either; it's the best equipped-armor value plus Dex
  // (capped by armor type) plus a shield and any flat AC modifiers, same
  // computation DDB's own sheet does.
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

  // Plain string — matching Monster/NPC's own `alignment` shape exactly
  // (this suite's one shared shape — see the monster-data-alignment plan).
  // ALIGNMENTS entries (deriveLookupTables) carry `id` matching DDB's own
  // alignmentId, `friendlyName` (the display name — `name` itself is a
  // slug, same convention as every other lookup entry in this file);
  // `shortName` is no longer stored per-character — it's derivable from
  // the System's own alignments vocabulary, same as every other lookup-
  // resolved display value in this suite.
  alignmentTable(context) {
    const alignmentId = context.root?.alignmentId;
    const match = ALIGNMENTS.find((entry) => entry.id === alignmentId);
    return match?.friendlyName || null;
  },

  // Ported from ddb-parser.js's buildInitiative — everyone technically CAN
  // have an "initiative" proficiency/expertise modifier (e.g. the Alert
  // feat's variants, or a subclass feature), hence the same
  // determineProficiencyLevel/applyProficiency path saves/skills use, not
  // just a flat Dex mod. `{bonus, advantage?, disadvantage?}` — this
  // suite's one shared initiative shape (see the monster-data-alignment
  // plan), matching Monster/NPC's own stats.initiative exactly (they only
  // ever populate `bonus`; advantage/disadvantage are Character-observable
  // extras, sparse — omitted rather than `false` when absent, same
  // convention senses/defenses already use).
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

  // Ported from ddb-parser.js's buildSenses — passive Perception/
  // Investigation/Insight (10 + the matching skill's already-computed
  // value, via the shared buildSkillValues helper) plus every known-range
  // sense (darkvision/blindsight/tremorsense/truesight, via SENSES —
  // deriveLookupTables, matching sys.dnd5e.json's own `senses` field) from
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

  // Pipeline `source` custom function: gathers spell entries from every bucket
  // ddb-parser.js's buildSpells reads (context.spells.{class,race,feat} and
  // classSpells[].spells) into one flat array, each tagged with its source
  // bucket — the part that's a genuine multi-source assembly, before the
  // declarative map/dedup/group-by/sort pipeline steps take over.
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
