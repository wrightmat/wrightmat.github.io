// Reads a System's own `levelUpBindings` field — the same role-bound-array
// convention `combatBindings` already established (bindings.js's own
// findBindingByRole/findBindingsByRole), just describing WHERE choice-
// bearing data lives on reference-kind records (Class/Background/Variant)
// for this System, and where a resolved value should land on a Character,
// instead of where a live stat lives. A generic level-up/build engine reads
// these roles — never a hardcoded field name like "proficiency_choices" —
// so a System whose own Class-equivalent kind names things differently (or
// a System with no such kind at all) needs zero engine code changes, only
// its own levelUpBindings authored. A System with none authored at all
// simply has no level-up/build wizard available yet, same graceful
// degradation every optional System field in this suite already follows.
//
// Roles in use today (see sys.dnd5e.json's own levelUpBindings for the real
// values): "proficiencyChoices", "equipmentChoices", "featureLevels",
// "resourceGrowth". Each entry also carries `kind` (which Library kind this
// binding applies to — a role can have more than one, e.g. proficiency
// choices exist on both Class and Background records) and `path` (the field
// on THAT kind's own records holding the raw data). `targetPath` (when
// present) is where a resolved choice should be written on the Character.
export function findLevelUpBinding(bindings, role, kind) {
  return (bindings || []).find((entry) => entry && entry.role === role && (!kind || entry.kind === kind)) || null;
}

export function findLevelUpBindings(bindings, role) {
  return (bindings || []).filter((entry) => entry && entry.role === role);
}

// Normalizes a Class/Background record's own `proficiency_choices` (or any
// field shaped the same way) into a flat, render-ready list. This is
// already the real 5e-API choice shape sitting on every imported Class and
// Background record today — `{ desc, choose, type, from: { option_set_type,
// options: [{ option_type: "reference", item: { index, name } }] } }` — a
// generic reader for it, not a new schema. Non-"reference" option shapes
// (equipment's own "multiple"/"counted_reference"/"money" bundles) are left
// under each entry's own `raw` for a future equipment-specific renderer —
// a bundle of items plus currency needs its own interpretation, not a flat
// pick-one-of-N list, so this function doesn't force it into one.
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

// A Feature's own optional `grants` array (see the character-builder
// roadmap's own Phase 2 write-up) reuses this exact `{choose, from:
// {options}}` shape for the one place Class/Background data doesn't
// already have it structured — per-level Class/Subclass Features and
// Species traits — rather than inventing a competing schema. Each entry
// also carries a `type` describing what kind of grant it is
// ("abilityScoreIncrease", "skillProficiency", "toolProficiency",
// "languageProficiency", "spellKnown", "resourceGrowth", ...); resolving a
// grant's OWN effect (applying a flat bonus, prompting a choice) is a
// per-type concern for whatever calls this — same reasoning
// resolveChoiceList above already documents for equipment bundles. Grants
// with no `choose` at all (a flat, unconditional effect) aren't "choices"
// in the sense resolveChoiceList's caller needs — this only ever normalizes
// entries that actually offer a pick.
// A grant's own `from` is either a static `{options: [...]}` list (handled
// directly by resolveGrantChoices below) or a DYNAMIC `{source: "..."}`
// naming a pool that only exists on the character being leveled up (e.g.
// feat.skill-expertise's own `{source: "proficientSkills"}` — "choose 2 of
// your own CURRENT skill proficiencies," a pool with no fixed list at all).
// Resolving one of these needs the live character, so it's a separate,
// optional step a caller runs before resolveGrantChoices rather than
// something resolveGrantChoices could ever do itself (it has no character
// to read). Source names are plain data on the grant, never inferred from
// a Feature's own id/name — a new source needs a new `case` here, same as
// any other small, closed vocabulary in this suite.
export function resolveDynamicGrantOptions(source, character) {
  if (source === "proficientSkills") {
    const skills = Array.isArray(character?.stats?.skills) ? character.stats.skills : [];
    return skills
      .filter((skill) => skill && Number(skill.proficiency) >= 2)
      .map((skill) => ({ id: skill.name, name: skill.friendlyName || skill.name }));
  }
  // Every key on the character's own stats.abilities object — whatever the
  // active System's ability field actually defines, never a hardcoded
  // STR/DEX/... list. Full names ("Strength"), not the shortName ("STR")
  // Background's own bespoke ability-bonus UI shows — this function is
  // synchronous and character-only, with no System field-def lookup
  // available to resolve a shortName from, unlike that UI's own async
  // context (loadAbilityFieldDefs).
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

// Matches a reference-kind record's own level-tagged `features[]` (each
// entry `{name, level, description}`) against its own parallel
// `featureIds[]` (the already-promoted real `feature` kind ids) — shared by
// Level Up (class, one level at a time) and character creation (species —
// every entry at once, no level gate; class's own level-1 entries). NOT a
// blind index pairing: real class records have been confirmed to have the
// two arrays drift out of alignment partway through (a pre-existing content
// gap, not something to silently trust) — the same INDEX is checked first
// as the fast/common-case match, falling back to a name-matched search
// across the whole list otherwise. `targetLevel: null` means "every entry,
// regardless of level" (Species has no level concept of its own at all);
// a number means "only entries at exactly this level" (Class). Entries
// already present in `existingFeatureIds` are skipped so re-running this
// (e.g. reopening the Level Up modal) never re-offers something already
// granted.
export function matchFeaturesAtLevel(sourceFeatures, sourceFeatureIds, featureNameById, targetLevel, existingFeatureIds) {
  const features = Array.isArray(sourceFeatures) ? sourceFeatures : [];
  const featureIds = Array.isArray(sourceFeatureIds) ? sourceFeatureIds : [];
  const existing = Array.isArray(existingFeatureIds) ? existingFeatureIds : [];
  const matched = [];
  features.forEach((entry, index) => {
    if (targetLevel !== null && targetLevel !== undefined && Number(entry?.level) !== Number(targetLevel)) {
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

// Which level a Class record's own data says it grants its subclass choice
// at — read generically from the class's own `features[]` (an entry named
// "{ClassName} Subclass"), never assumed to be a fixed level. This matters:
// every class record in THIS repo currently grants it at level 3, but
// other rulesets (5e 2014's Cleric/Sorcerer/Warlock grant it at level 1)
// or other Systems entirely may say otherwise — callers (Level Up AND the
// Build wizard) both have to react to whatever this returns, including 1.
// Soft-fails (console.warn, null) rather than throwing if a class record
// doesn't follow the naming convention — a content gap to flag, not a
// crash.
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

// Grants a chosen subclass's own level-tagged features, up through
// targetLevel — a thin, explicitly-named wrapper around matchFeaturesAtLevel
// reading the SAME `features`/`featureIds` property pair off a Variant
// record that the class-level granting code already reads off a Class
// record (matching that existing precedent, not a stricter one). One
// shared implementation, called identically by Level Up's own
// "subclassChoice" resolution and the Build wizard's own in-creation
// subclass pick — never two separate copies of this logic.
export function grantSubclassFeaturesAtLevel(variantRecord, targetLevel, featureNameById, existingFeatureIds) {
  if (!variantRecord) return [];
  return matchFeaturesAtLevel(variantRecord.features, variantRecord.featureIds, featureNameById, targetLevel, existingFeatureIds);
}

// Formats a Class record's own `multiclassPrerequisites` (an array of
// {any:[{ability,minimum}]} groups — every GROUP is required, each group
// satisfied by meeting ANY one of its own entries, modeling both 5e's
// single-ability classes and its either/or ones like Fighter, and its
// both-required ones like Paladin/Monk/Ranger) into display text, resolving
// ability keys against the active System's own ability labels rather than
// hardcoding ability names.
export function describeMulticlassPrerequisites(prerequisites, abilityLabelByKey) {
  const groups = Array.isArray(prerequisites) ? prerequisites : [];
  if (!groups.length) return "";
  const label = (key) => abilityLabelByKey?.get(key) || key;
  return groups
    .map((group) => (Array.isArray(group?.any) ? group.any : []).map((req) => `${label(req.ability)} ${req.minimum}`).join(" or "))
    .filter(Boolean)
    .join(", ");
}

// Non-blocking check — this suite's own standing policy (restated across
// every phase of this roadmap) is that GM/player judgment stays
// authoritative over rules legality; this exists purely to surface a
// warning in the Add-a-Class picker, never to gate anything.
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

// Full/half/third/pact caster-level math, generalized across every class a
// character has (multiclass-aware from the ground up, not bolted on) —
// each class's EFFECTIVE caster type is its active subclass's own
// `caster_type` when set, else the base class's own value, so a
// third-caster subclass (Eldritch Knight/Arcane Trickster) correctly
// overrides an otherwise-"none" base class the moment it's picked, with
// zero extra authoring for every subclass that doesn't change casting at
// all. `classRecordsById`/`variantRecordsById` are plain Maps (refId ->
// record) — callers already have these from whatever fetch populated the
// Level Up/Build preview. Returns limitedUses[]-shaped entries (no
// `used`/`available` yet — that's mergeLimitedUses' own job) for every
// nonzero slot count, same shape already sitting in real imported
// character data.
export function computeSpellSlots(classes, classRecordsById, variantRecordsById, spellSlotProgression, pactMagicProgression) {
  const list = Array.isArray(classes) ? classes : [];
  const slotTable = Array.isArray(spellSlotProgression) ? spellSlotProgression : [];
  const pactTable = Array.isArray(pactMagicProgression) ? pactMagicProgression : [];
  let casterLevel = 0;
  let warlockLevel = 0;
  list.forEach((cls) => {
    const classRecord = classRecordsById?.get(cls?.refId);
    if (!classRecord) return;
    const variantRecord = cls?.subclass?.refId ? variantRecordsById?.get(cls.subclass.refId) : null;
    const casterType = variantRecord?.caster_type || classRecord.caster_type || "none";
    const level = Number(cls?.level) || 0;
    if (casterType === "full") casterLevel += level;
    else if (casterType === "half") casterLevel += Math.floor(level / 2);
    else if (casterType === "third") casterLevel += Math.floor(level / 3);
    else if (casterType === "pact") warlockLevel += level;
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
  if (warlockLevel > 0) {
    const pactRow = pactTable.find((row) => Number(row.level) === warlockLevel);
    if (pactRow && Number(pactRow.slots) > 0) {
      entries.push({ name: "Pact Magic", level: Number(pactRow.slotLevel) || 1, total: Number(pactRow.slots), reset: "Short Rest" });
    }
  }
  return entries;
}

const SPELL_SLOT_NAME_PATTERN = /^Level \d+ Spell Slots$/;

// Writes computeSpellSlots' own output into a character's real
// `limitedUses[]`, WITHOUT ever clobbering a player's already-tracked
// `used` count, and WITHOUT touching any entry this function doesn't own
// (Ki points, Second Wind, any other DDB-imported limited-use pool —
// those are matched by name against this function's own two managed
// shapes, "Level N Spell Slots" and "Pact Magic," and left completely
// alone otherwise). An entry whose total changed keeps its `used`, shifts
// `available` by the same delta. An entry that would disappear entirely
// (character no longer qualifies for that slot level) is only actually
// dropped if nothing's been used from it; otherwise it's kept with a
// console warning — never silently destroying tracked play state.
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
// flat {id, name} shape (see that function's own comment) — this is the
// dedicated reader for it. Options carry {id, label, bundle}: `label` a
// human-readable rendering of the whole bundle ("Chain Shirt, Shield, Mace,
// Holy Symbol, Priest's Pack, 7 GP"), `bundle` the raw option kept for
// applyEquipmentBundle below to actually apply. `id` is a stable synthetic
// index (equipment options have no natural id of their own the way a
// {option_type:"reference"} skill pick does).
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

// Applies a PICKED equipment bundle (one option's own `bundle`, from
// resolveEquipmentChoice above) onto a character: each item leaf becomes an
// ordinary freeform inventory entry (the same {name, quantity} shape the
// Add/Remove picker's own custom-add path already produces — no refKind/
// refId, since starting equipment here is named text, not a Library pick),
// each money leaf adds onto the matching currencies.* field.
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
// "proficiencyGrants" — NOT a choice, unlike Class/Background's own
// `proficiency_choices`) names each entry with the real 5e-API convention
// ("Skill: Insight", "Tool: Calligrapher's Supplies") — a fixed external
// data format, not System-configurable vocabulary, the same treatment this
// suite already gives DDB's own field names elsewhere (mapping-custom-
// functions.js). Dispatches by prefix onto whichever existing field
// actually models that proficiency type: a Skill sets the matching
// stats.skills[] entry's own `proficiency` to (at least) 2 — proficient,
// never downgrading an existing Expertise (3); everything else dedup-pushes
// the bare name onto the matching Phase 1 proficiency field — confirmed
// via a real character record (not guessed) that these are NOT all under
// one prefix: armor/weapons/tools sit at the Character's own top-level
// `proficiencies.*`, but languages sits at `stats.proficiencies.languages`
// — an existing, real inconsistency in this data model, matched exactly
// rather than "cleaned up" as a side effect of this function.
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
