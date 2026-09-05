// Reads a System's own `levelUpBindings` field — same role-bound-array
// convention as `combatBindings` (bindings.js), describing where choice-
// bearing data lives on reference-kind records (Class/Background/Variant)
// and where a resolved value lands on a Character. A generic engine reads
// these roles, never a hardcoded field name — a System with none authored
// simply has no level-up/build wizard yet.
//
// Roles in use today (see sys.dnd5e.json): "proficiencyChoices",
// "equipmentChoices", "featureLevels", "resourceGrowth". Each entry carries
// `libraryKind` (which Library kind this binding applies to — a role can
// have more than one) and `libraryField` (the field on that kind holding
// the raw data). `targetPath`, when present, is where a resolved choice
// lands on the Character.
import { fieldByKey } from "./bindings.js";

export function findLevelUpBinding(bindings, role, kind) {
  return (bindings || []).find((entry) => entry && entry.binding === role && (!kind || entry.libraryKind === kind)) || null;
}

export function findLevelUpBindings(bindings, role) {
  return (bindings || []).filter((entry) => entry && entry.binding === role);
}

// Normalizes a Class/Background record's own `proficiency_choices` (or any
// field shaped the same way) into a flat, render-ready list — a generic
// reader for the real 5e-API choice shape (`{desc, choose, type, from:
// {options: [{option_type: "reference", item: {index, name}}]}}`), not a
// new schema. Non-"reference" option shapes (equipment's own bundles) are
// left under each entry's own `raw`, since a bundle of items plus currency
// needs its own interpretation, not a flat pick-one-of-N list.
export function resolveChoiceList(rawChoices) {
  if (!Array.isArray(rawChoices)) return [];
  return rawChoices
    .filter((choice) => choice && typeof choice === "object")
    .map((choice) => {
      const rawOptions = Array.isArray(choice.from?.options) ? choice.from.options : [];
      const options = rawOptions
        .map((option) => {
          if (option?.option_type === "reference" && option.item) {
            return { id: option.item.index, name: option.item.name };
          }
          return null;
        })
        .filter(Boolean);
      return {
        desc: choice.desc || "",
        choose: Number(choice.choose) || 1,
        type: choice.type || "",
        options,
        raw: choice,
      };
    });
}

// A Feature's own optional `grants` array reuses the same `{choose, from:
// {options}}` shape for per-level Class/Subclass Features and Species
// traits, rather than inventing a competing schema. Each entry also carries
// a `type` ("abilityScoreIncrease", "skillProficiency",
// "languageProficiency", "spellKnown", "resourceGrowth", ...); resolving a
// grant's own effect is a per-type concern for the caller. Grants with no
// `choose` (a flat effect) aren't "choices" — this only normalizes entries
// that offer a pick.
// A grant's `from` is either a static `{options: [...]}` list or a dynamic
// `{source: "..."}` naming a pool that only exists on the live character
// (e.g. `{source: "proficientSkills"}` — "choose 2 of your CURRENT skill
// proficiencies"). Resolving a dynamic source needs the character, so it's
// a separate step a caller runs before resolveGrantChoices, which has no
// character to read. Source names are plain data — a new source needs a new
// `case` below, same as any other small closed vocabulary in this suite.
export function resolveDynamicGrantOptions(source, character) {
  if (source === "proficientSkills") {
    const skills = Array.isArray(character?.stats?.skills) ? character.stats.skills : [];
    return skills
      .filter((skill) => skill && Number(skill.proficiency) >= 2)
      .map((skill) => ({ id: skill.name, name: skill.friendlyName || skill.name }));
  }
  // Every key on the character's own stats.abilities object, whatever the
  // active System defines — never a hardcoded STR/DEX/... list. Full names,
  // not shortNames, since this is synchronous/character-only with no System
  // field-def lookup available (unlike Background's async loadAbilityFieldDefs).
  if (source === "allAbilities") {
    const abilities =
      character?.stats?.abilities && typeof character.stats.abilities === "object" ? character.stats.abilities : {};
    return Object.keys(abilities).map((key) => ({ id: key, name: key.charAt(0).toUpperCase() + key.slice(1) }));
  }
  return [];
}

export function resolveGrantChoices(grants, character) {
  if (!Array.isArray(grants)) return [];
  return grants
    .filter((grant) => grant && typeof grant === "object" && grant.choose)
    .map((grant) => {
      const source = typeof grant.from?.source === "string" ? grant.from.source : "";
      const options = Array.isArray(grant.from?.options)
        ? grant.from.options
        : source
          ? resolveDynamicGrantOptions(source, character)
          : [];
      return {
        type: grant.type || "",
        desc: grant.desc || "",
        choose: Number(grant.choose) || 1,
        options,
        raw: grant,
      };
    });
}

// Shared core for matchFeaturesAtLevel/matchFeaturesAtTier — filters a
// reference-kind record's own `features[]` (each `{name, description, ...}`)
// to entries whose own `fieldKey` matches `targetValue` (or every entry when
// `targetValue` is null/undefined), then resolves each to its real featureId
// via its parallel `featureIds[]`. NOT a blind index pairing: real records
// have the two arrays drift out of alignment partway through, so index is
// checked first as the fast path, falling back to a name-matched search.
// Entries already in `existingFeatureIds` are skipped so reopening Level Up
// never re-offers something already granted.
function matchFeaturesByField(sourceFeatures, sourceFeatureIds, featureNameById, fieldKey, targetValue, existingFeatureIds) {
  const features = Array.isArray(sourceFeatures) ? sourceFeatures : [];
  const featureIds = Array.isArray(sourceFeatureIds) ? sourceFeatureIds : [];
  const existing = Array.isArray(existingFeatureIds) ? existingFeatureIds : [];
  const matched = [];
  features.forEach((entry, index) => {
    if (targetValue !== null && targetValue !== undefined && Number(entry?.[fieldKey]) !== Number(targetValue)) {
      return;
    }
    const targetName = (entry?.name || "").trim().toLowerCase();
    const indexId = featureIds[index];
    const matchedId =
      indexId && featureNameById.get(indexId) === targetName
        ? indexId
        : featureIds.find((id) => featureNameById.get(id) === targetName);
    if (matchedId && !matched.includes(matchedId) && !existing.includes(matchedId)) {
      matched.push(matchedId);
    }
  });
  return matched;
}

// Matches on a record's own `level` field — shared by Level Up (class, one
// level at a time) and character creation (species, every entry at once).
// `targetLevel: null` means every entry regardless of level (Species has no
// level concept); a number means only entries at exactly that level.
export function matchFeaturesAtLevel(sourceFeatures, sourceFeatureIds, featureNameById, targetLevel, existingFeatureIds) {
  return matchFeaturesByField(sourceFeatures, sourceFeatureIds, featureNameById, "level", targetLevel, existingFeatureIds);
}

// Matches on a record's own `tier` field — the same shape as `level` for a
// System whose progression isn't per-character-level but per discrete
// milestone (Daggerheart's subclass Foundation/Specialization/Mastery,
// granted by an "advancement" pick rather than at a fixed level). A
// subclass record's own `tier` (a plain integer on each feature entry) is
// real System-authored data, never inferred from the feature's own name.
export function matchFeaturesAtTier(sourceFeatures, sourceFeatureIds, featureNameById, targetTier, existingFeatureIds) {
  return matchFeaturesByField(sourceFeatures, sourceFeatureIds, featureNameById, "tier", targetTier, existingFeatureIds);
}

// Which level a Class record grants its subclass choice at — read
// generically from `features[]` (an entry named "{ClassName} Subclass"),
// never assumed fixed. Different rulesets grant it at different levels (5e
// 2014's Cleric/Sorcerer/Warlock at 1, this repo's own records at 3), so
// callers must react to whatever this returns. Soft-fails (console.warn,
// null) rather than throwing when a class record doesn't follow the naming
// convention.
export function getSubclassGrantLevel(classRecord) {
  const target = `${(classRecord?.name || "").trim().toLowerCase()} subclass`;
  const entry = (Array.isArray(classRecord?.features) ? classRecord.features : []).find(
    (feature) => (feature?.name || "").trim().toLowerCase() === target
  );
  if (!entry) {
    console.warn(
      `level-up-bindings: class "${classRecord?.name}" has no "${classRecord?.name} Subclass" feature entry — can't determine its subclass-grant level.`
    );
    return null;
  }
  const level = Number(entry.level);
  return Number.isFinite(level) ? level : null;
}

// Grants a chosen subclass's level-tagged features up through targetLevel —
// a thin wrapper around matchFeaturesAtLevel reading the same
// `features`/`featureIds` pair off a Variant record. One shared
// implementation, called by both Level Up's subclassChoice resolution and
// the Build wizard's in-creation subclass pick.
export function grantSubclassFeaturesAtLevel(variantRecord, targetLevel, featureNameById, existingFeatureIds) {
  if (!variantRecord) return [];
  return matchFeaturesAtLevel(variantRecord.features, variantRecord.featureIds, featureNameById, targetLevel, existingFeatureIds);
}

// Tier-based counterpart to grantSubclassFeaturesAtLevel, for a subclass
// whose features[] carry `tier` instead of `level` (Daggerheart). One
// shared implementation, called by both the Build wizard's creation-time
// Foundation grant (tier 1) and Level Up's Advancement-Menu subclassUpgrade
// (tier 2/3).
export function grantSubclassFeaturesAtTier(variantRecord, targetTier, featureNameById, existingFeatureIds) {
  if (!variantRecord) return [];
  return matchFeaturesAtTier(variantRecord.features, variantRecord.featureIds, featureNameById, targetTier, existingFeatureIds);
}

// Looks up one row of a Class record's own level-keyed progression table —
// a reserved array field (named by the "classProgressionTable"
// levelUpBindings role's own `libraryField`), each row `{level, ...namedColumns}`.
// Same level-keyed-row convention `spellSlotProgression`/computeSpellSlots
// (above) already use, generalized from that one hardcoded `slots` column
// to an arbitrary class-scoped table with arbitrary named columns — d20
// Modern's Base Attack Bonus/Fort/Ref/Will/Defense Bonus/Reputation Bonus
// all vary independently by BOTH class and level, unlike anything a single
// System-wide table (spellSlotProgression) or flat per-class value
// (resourceGrowth) can express. A System whose classes declare no such
// field simply never resolves a row here.
export function resolveClassProgressionRow(classRecord, libraryField, targetLevel) {
  const table = Array.isArray(classRecord?.[libraryField]) ? classRecord[libraryField] : [];
  return table.find((row) => Number(row?.level) === Number(targetLevel)) || null;
}

// Formats a Class record's `multiclassPrerequisites` (an array of
// {any:[{ability,minimum}]} groups — every group required, each satisfied
// by meeting ANY one entry, modeling both single-ability classes and
// either/or ones like Fighter) into display text, resolving ability keys
// against the active System's own labels rather than hardcoding names.
export function describeMulticlassPrerequisites(prerequisites, abilityLabelByKey) {
  const groups = Array.isArray(prerequisites) ? prerequisites : [];
  if (!groups.length) return "";
  const label = (key) => abilityLabelByKey?.get(key) || key;
  return groups
    .map((group) => (Array.isArray(group?.any) ? group.any : []).map((req) => `${label(req.ability)} ${req.minimum}`).join(" or "))
    .filter(Boolean)
    .join(", ");
}

// Non-blocking check — GM/player judgment stays authoritative over rules
// legality; this only surfaces a warning in the Add-a-Class picker.
export function characterMeetsMulticlassPrerequisites(prerequisites, abilities) {
  const groups = Array.isArray(prerequisites) ? prerequisites : [];
  if (!groups.length) return true;
  const scores = abilities && typeof abilities === "object" ? abilities : {};
  return groups.every((group) => {
    const options = Array.isArray(group?.any) ? group.any : [];
    if (!options.length) return true;
    return options.some((req) => Number(scores[req.ability]) >= Number(req.minimum));
  });
}

// Caster-level math, multiclass-aware from the ground up, generic over
// whatever caster types the active System declares in its own `casterTypes`
// reserved field (each value `{shortName, divisor?, ownProgression?, name?, reset?}`
// — D&D 5e's own "full"/"half"/"third"/"pact" become this System's data,
// not JS string literals). Each class's EFFECTIVE caster type is its active
// subclass's own `caster_type` when set, else the base class's value — so a
// third-caster subclass (Eldritch Knight) correctly overrides an otherwise-
// uncastered base class with zero extra authoring for subclasses that don't
// change casting. A `divisor` entry (D&D's full/half/third) accumulates
// `floor(level/divisor)` into the shared main caster-level total, resolved
// against `spellSlotProgression`. An `ownProgression` entry (D&D's pact/
// Warlock) accumulates its own independent level pool instead, resolved
// against whichever OTHER reserved field its `ownProgression` names (its own
// level-keyed `{level, slots, slotLevel}` rows, same shape as
// spellSlotProgression's `slots` column) — generalizing the one hardcoded
// pact/warlock special case to however many independent slot pools a System
// declares. `name`/`reset` label that pool's own limitedUses entry (default
// "Pact Magic"/"Short Rest", matching D&D 5e's own convention, for a System
// that doesn't bother overriding them). `classRecordsById`/
// `variantRecordsById` are plain refId->record Maps. `systemFields` is the
// active System's own top-level `fields` array. Returns limitedUses[]-shaped
// entries (no `used`/`available` yet — that's mergeLimitedUses' job) for
// every nonzero slot count.
export function computeSpellSlots(classes, classRecordsById, variantRecordsById, systemFields) {
  const list = Array.isArray(classes) ? classes : [];
  const fields = Array.isArray(systemFields) ? systemFields : [];
  const slotTable = fieldByKey(fields, "spellSlotProgression")?.values || [];
  const casterTypes = fieldByKey(fields, "casterTypes")?.values || [];
  const casterTypeById = new Map(casterTypes.filter((entry) => entry?.shortName).map((entry) => [entry.shortName, entry]));
  let casterLevel = 0;
  const ownProgressionLevels = new Map();
  list.forEach((cls) => {
    const classRecord = classRecordsById?.get(cls?.refId);
    if (!classRecord) return;
    const variantRecord = cls?.subclass?.refId ? variantRecordsById?.get(cls.subclass.refId) : null;
    const casterTypeId = variantRecord?.caster_type || classRecord.caster_type || "";
    const casterType = casterTypeById.get(casterTypeId);
    if (!casterType) return;
    const level = Number(cls?.level) || 0;
    if (casterType.ownProgression) {
      ownProgressionLevels.set(casterType, (ownProgressionLevels.get(casterType) || 0) + level);
    } else if (Number(casterType.divisor) > 0) {
      casterLevel += Math.floor(level / Number(casterType.divisor));
    }
  });
  const entries = [];
  const slotsRow = slotTable.find((row) => Number(row.level) === casterLevel);
  if (slotsRow && Array.isArray(slotsRow.slots)) {
    slotsRow.slots.forEach((total, index) => {
      if (Number(total) > 0) {
        entries.push({ name: `Level ${index + 1} Spell Slots`, level: index + 1, total: Number(total), reset: "Long Rest" });
      }
    });
  }
  ownProgressionLevels.forEach((ownLevel, casterType) => {
    if (ownLevel <= 0) return;
    const table = fieldByKey(fields, casterType.ownProgression)?.values || [];
    const row = table.find((entry) => Number(entry.level) === ownLevel);
    if (row && Number(row.slots) > 0) {
      entries.push({
        name: casterType.name || "Pact Magic",
        level: Number(row.slotLevel) || 1,
        total: Number(row.slots),
        reset: casterType.reset || "Short Rest",
      });
    }
  });
  return entries;
}

const SPELL_SLOT_NAME_PATTERN = /^Level \d+ Spell Slots$/;

// Writes computeSpellSlots' output into a character's real `limitedUses[]`
// without clobbering an already-tracked `used` count, and without touching
// any entry this function doesn't own (Ki points, Second Wind, ... matched
// by name against only "Level N Spell Slots"/"Pact Magic", left alone
// otherwise). An entry whose total changed keeps `used`, shifts `available`
// by the delta. An entry that would disappear entirely is only dropped if
// nothing's been used from it; otherwise kept with a console warning —
// never silently destroying tracked play state.
export function mergeLimitedUses(existingLimitedUses, computedEntries) {
  const existing = Array.isArray(existingLimitedUses) ? existingLimitedUses : [];
  const computed = Array.isArray(computedEntries) ? computedEntries : [];
  const isManaged = (entry) => entry?.name === "Pact Magic" || SPELL_SLOT_NAME_PATTERN.test(entry?.name || "");
  const result = existing.filter((entry) => !isManaged(entry));
  const seen = new Set();
  existing.filter(isManaged).forEach((entry) => {
    const match = computed.find((c) => c.name === entry.name && Number(c.level) === Number(entry.level));
    if (match) {
      seen.add(`${match.name}::${match.level}`);
      const delta = Number(match.total) - Number(entry.total || 0);
      if (delta !== 0) {
        entry.total = Number(match.total);
        entry.available = Math.max(0, (Number(entry.available) || 0) + delta);
      }
      result.push(entry);
    } else if (Number(entry.used) > 0) {
      console.warn(
        `level-up-bindings: "${entry.name}" no longer applies to this character's classes but has ${entry.used} used — kept, not removed.`
      );
      result.push(entry);
    }
  });
  computed.forEach((entry) => {
    if (!seen.has(`${entry.name}::${entry.level}`)) {
      result.push({ ...entry, available: entry.total, used: 0 });
    }
  });
  return result;
}

// Equipment's own bundle shape (option_type: "multiple"/"counted_reference"/
// "reference"/"money") deliberately isn't forced into resolveChoiceList's
// flat {id, name} shape — this is the dedicated reader. Options carry {id,
// label, bundle}: `label` a human-readable rendering of the whole bundle
// ("Chain Shirt, Shield, Mace, Holy Symbol, Priest's Pack, 7 GP"), `bundle`
// the raw option for applyEquipmentBundle to apply, `id` a stable synthetic
// index (equipment options have no natural id).
function describeEquipmentBundle(option) {
  if (!option || typeof option !== "object") return "";
  if (option.option_type === "money") {
    return `${option.count ?? 0} ${(option.unit || "gp").toUpperCase()}`;
  }
  if (option.option_type === "counted_reference") {
    const count = Number(option.count) || 1;
    return `${count > 1 ? `${count}x ` : ""}${option.of?.name || "Item"}`;
  }
  if (option.option_type === "reference") {
    return option.item?.name || "Item";
  }
  if (option.option_type === "multiple" && Array.isArray(option.items)) {
    return option.items.map(describeEquipmentBundle).filter(Boolean).join(", ");
  }
  return "";
}

export function resolveEquipmentChoice(rawChoice) {
  if (!rawChoice || typeof rawChoice !== "object") return null;
  const rawOptions = Array.isArray(rawChoice.from?.options) ? rawChoice.from.options : [];
  const options = rawOptions.map((option, index) => ({
    id: String(index),
    label: describeEquipmentBundle(option) || `Option ${index + 1}`,
    bundle: option,
  }));
  if (!options.length) return null;
  return {
    desc: rawChoice.desc || "",
    choose: Number(rawChoice.choose) || 1,
    options,
    raw: rawChoice,
  };
}

// Applies a picked equipment bundle onto a character: each item leaf
// becomes an ordinary freeform inventory entry {name, quantity} — no
// refKind/refId, since starting equipment here is named text, not a Library
// pick — each money leaf adds onto the matching currencies.* field.
export function applyEquipmentBundle(bundle, character) {
  if (!bundle || typeof bundle !== "object" || !character) return;
  if (bundle.option_type === "multiple" && Array.isArray(bundle.items)) {
    bundle.items.forEach((item) => applyEquipmentBundle(item, character));
    return;
  }
  if (bundle.option_type === "money") {
    const unit = (bundle.unit || "gp").toLowerCase();
    if (!character.currencies || typeof character.currencies !== "object") {
      character.currencies = {};
    }
    character.currencies[unit] = (Number(character.currencies[unit]) || 0) + (Number(bundle.count) || 0);
    return;
  }
  if ((bundle.option_type === "counted_reference" || bundle.option_type === "reference") && (bundle.of || bundle.item)) {
    const source = bundle.of || bundle.item;
    if (!Array.isArray(character.inventory)) {
      character.inventory = [];
    }
    character.inventory.push({ name: source.name || "Item", quantity: Number(bundle.count) || 1 });
  }
}

// Background's own flat, hard-granted `proficiencies[]` (role
// "proficiencyGrants" — not a choice) names each entry with the real
// 5e-API convention ("Skill: Insight", "Tool: Calligrapher's Supplies") — a
// fixed external data format, not System-configurable vocabulary.
// Dispatches by prefix onto whichever field models that proficiency type: a
// Skill sets the matching stats.skills[] entry's `proficiency` to at least
// 2, never downgrading an existing Expertise (3); everything else
// dedup-pushes the bare name onto the matching field. Confirmed against a
// real character record that armor/weapons/tools sit at the Character's
// top-level `proficiencies.*` while languages sits at
// `stats.proficiencies.languages` — a real inconsistency, matched exactly
// rather than "cleaned up" here.
const PROFICIENCY_GRANT_TARGETS = [
  { prefix: "Skill:", target: "skill" },
  { prefix: "Tool:", path: ["proficiencies", "tools"] },
  { prefix: "Armor:", path: ["proficiencies", "armor"] },
  { prefix: "Weapon:", path: ["proficiencies", "weapons"] },
  { prefix: "Language:", path: ["stats", "proficiencies", "languages"] },
];

export function applyProficiencyGrant(name, character) {
  const raw = typeof name === "string" ? name.trim() : "";
  if (!raw || !character) return;
  const match = PROFICIENCY_GRANT_TARGETS.find((entry) => raw.startsWith(entry.prefix));
  const bareName = match ? raw.slice(match.prefix.length).trim() : raw;
  if (!match || match.target === "skill") {
    const skills = Array.isArray(character.stats?.skills) ? character.stats.skills : [];
    const skill = skills.find(
      (entry) => entry?.friendlyName?.toLowerCase() === bareName.toLowerCase() || entry?.name?.toLowerCase() === bareName.toLowerCase()
    );
    if (skill && Number(skill.proficiency) < 2) {
      skill.proficiency = 2;
    }
    return;
  }
  let cursor = character;
  for (let i = 0; i < match.path.length - 1; i += 1) {
    const key = match.path[i];
    if (!cursor[key] || typeof cursor[key] !== "object") {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  const listKey = match.path[match.path.length - 1];
  if (!Array.isArray(cursor[listKey])) {
    cursor[listKey] = [];
  }
  if (!cursor[listKey].includes(bareName)) {
    cursor[listKey].push(bareName);
  }
}
