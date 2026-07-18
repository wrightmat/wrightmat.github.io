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

import { ABILITIES, SAVING_THROW_SUBTYPES, SKILLS, SIZES } from "./lookup-tables.js";

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

function resolvePath(obj, path) {
  return String(path || "")
    .split(".")
    .reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), obj);
}

function formatSigned(value) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value}`;
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
      if (modifier.type === "proficiency") level = Math.max(level, modifier.value ?? 1);
      if (modifier.type === "expertise") level = Math.max(level, modifier.value ?? 2);
      if (modifier.type === "half-proficiency") level = Math.max(level, modifier.value ?? 0.5);
      if (modifier.type === "half-proficiency-round-up") {
        level = Math.max(level, modifier.value ?? 0.5);
        roundUp = true;
      }
    });
  return { level, roundUp };
}

function applyProficiency(level, proficiencyBonus, roundUp = false) {
  if (!level || !proficiencyBonus) return 0;
  if (level === 3 || level === 1) return proficiencyBonus;
  if (level === 4 || level === 2) return proficiencyBonus * 2;
  if (level === 1 || level === 0.5) {
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

function determineSpellcastingAbility(classes) {
  if (!Array.isArray(classes)) return null;
  const caster = classes.find((cls) => cls.definition?.canCastSpells) || classes[0];
  if (!caster) return null;
  return ABILITIES.find((entry) => entry.id === caster.definition?.spellCastingAbilityId) || null;
}

// --- Registered custom functions (referenced by name from mapping JSON) ---

export const customFunctions = {
  // `args.path` defaults to "name"; use e.g. {"path":"root.name"} to slug the
  // root/parent entity's name instead of the current context's own name.
  slug(context, args) {
    return slugify(resolvePath(context, args?.path || "name"));
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

  ddbHitDie(context) {
    return parseHitDie(context.coreTraits?.hitPointDie);
  },

  ddbSpeciesSpeed(context) {
    return parseLeadingNumber(context.coreTraits?.speed);
  },

  ddbSavingThrows(context) {
    return parseAbilityRefs(context.coreTraits?.savingThrowProficiencies);
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

  abilitiesTable(context) {
    const modifiers = getActiveModifiers(context.root);
    const scores = calculateAbilityScores(context.root, modifiers);
    return ABILITIES.map((ability) => {
      const score = scores[ability.name] ?? 10;
      return { ...ability, score, modifier: Math.floor((score - 10) / 2) };
    });
  },

  savingThrowsTable(context) {
    const modifiers = getActiveModifiers(context.root);
    const scores = calculateAbilityScores(context.root, modifiers);
    const totalLevel = getTotalLevelRaw(context.root?.classes);
    const proficiencyBonus = getProficiencyBonusRaw(totalLevel);
    const generalSaveBonus = Math.max(collectGeneralSavingThrowBonus(modifiers), collectItemSavingThrowBonus(context.root));

    return ABILITIES.map((ability) => {
      const subtype = SAVING_THROW_SUBTYPES[ability.name];
      const abilityModifier = Math.floor(((scores[ability.name] || 10) - 10) / 2);
      const { level, roundUp } = determineProficiencyLevel(modifiers, [subtype, "saving-throws"]);
      const savingThrowBonus = collectModifiers(modifiers, subtype, "bonus") + generalSaveBonus;
      const proficiencyValue = applyProficiency(level, proficiencyBonus, roundUp);
      return { ...ability, value: abilityModifier + proficiencyValue + savingThrowBonus, proficiency: level };
    });
  },

  skillsTable(context) {
    const modifiers = getActiveModifiers(context.root);
    const scores = calculateAbilityScores(context.root, modifiers);
    const totalLevel = getTotalLevelRaw(context.root?.classes);
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
      };
    });
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
