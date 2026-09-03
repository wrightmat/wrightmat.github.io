// Turns an embedded `[{name, description}]`-shaped array on a Library
// record — Species.traits, Variant.features, Class.features, or a merge of
// Character.feats/Character.features — into real `feature` Library
// references, the same way monster-feature-matching.js/vault-feature-
// matching.js do for Monster/Wonder: matching/dedup against the shared
// feature-import-core.js engine, promoting anything unmatched into its own
// new Feature record, recording `record.featureIds`
// (+ `record.featureParams` for per-grant metadata).
//
// Deliberately much simpler than monster-feature-matching.js — nothing here
// parses 5e stat-block mechanical prose; a class/racial/feat entry is just
// a name + flavor text, so this only needs the generic match-by-name/
// create-if-unmatched path.
//
// Automatic-on-save, same as Monster/Vault — no manual/backfill button.
// Idempotent: re-running finds the same already-created Features by name.
// Unlike monster-feature-matching.js (which fully reprocesses one record's
// complete ability set per call), this ACCUMULATES onto whatever
// `record.featureIds` already holds — Character promotes `feats` and
// `features` as two separate passes over the same record, both needing to
// land in one combined list.
import { normalizeName, cappedSlug, cappedDisplayName, resolveTemplateId, findMatch } from "./feature-import-core.js";
import { findKindReferenceRecord } from "./library-reference.js";

// findMatch's DEFAULT exact-name-match threshold (0.25) assumes an
// identical name means the same ability — true for Monster's SRD trait
// text, false here: D&D class/subclass features deliberately reuse names
// across classes for CONCEPTUALLY DIFFERENT mechanics ("Spellcasting,"
// "Fighting Style," ...). Two classes' Spellcasting text shares enough
// vocabulary to clear 0.25 despite being genuinely different abilities.
// 0.85 matches feature-import-core.js's "near-total agreement" bar
// (SHORT_TEXT_SIMILARITY_THRESHOLD).
const CHARACTER_FEATURE_NAME_MATCH_THRESHOLD = 0.85;

// DDB's export prepends the level a feature was (re-)granted at to repeat
// entries within one class ("Weapon Mastery", then "4: Weapon Mastery", ...)
// — stripped before matching/slugging so these collapse onto ONE Feature
// record, with every grant level recorded instead of lost.
const LEVEL_PREFIX_PATTERN = /^(\d+):\s*/;
function stripLevelPrefix(name) {
  const raw = String(name || "");
  const match = raw.match(LEVEL_PREFIX_PATTERN);
  if (!match) return { name: raw, level: null };
  return { name: raw.slice(match[0].length).trim(), level: Number(match[1]) };
}

// A Species' scraped `traits[]` mixes two different things DDB renders the
// same way: universal-shape PROPERTIES every species has some value for
// (height, speed, creature type, ability score bumps, languages, life
// span) versus actual FEATURES (Darkvision, Flight, Silent Feathers, ...).
// None of the former belong in the Feature library — they're properties,
// not features, mostly covered by dedicated fields elsewhere. Matched by
// normalized name against every trait name seen across the species
// library. Ability Score Increases is included even though its own VALUE
// differs per species — the concept is a standard, non-distinctive
// species-wide mechanic, not a unique feature.
const SPECIES_PROPERTY_TRAIT_NAMES = new Set(
  ["Ability Score Increases", "Creature Type", "Height and Weight", "Languages", "Life Span", "Size", "Speed"].map((name) =>
    normalizeName(name)
  )
);

function recordGrantLevel(featureParams, featureId, level) {
  if (level == null || !Number.isFinite(level)) return;
  const existing = featureParams[featureId] || {};
  const levels = Array.isArray(existing.grantedAtLevel)
    ? existing.grantedAtLevel
    : existing.grantedAtLevel != null
      ? [existing.grantedAtLevel]
      : [];
  if (!levels.includes(level)) levels.push(level);
  levels.sort((a, b) => a - b);
  featureParams[featureId] = { ...existing, grantedAtLevel: levels };
}

// True once `record[sourceField]` (or any field in a `sourceField` array)
// has at least one entry left to promote — the caller's own cheap gate
// before bothering to fetch the Feature library at all.
export function hasEmbeddedFeatures(record, sourceField) {
  const fields = Array.isArray(sourceField) ? sourceField : [sourceField];
  return fields.some((field) => Array.isArray(record?.[field]) && record[field].length > 0);
}

// `sourceField` — a field name, or array of field names, on `record` to
// read `{name, description, level?}` entries from (Character passes
// ["feats", "features"] to promote both into one combined result).
// `parentPath` — a plain string (NOT a lookup path) to scope newly-created
// one-off Feature ids, e.g. a Species/Class's name; omit for Character (a
// class/racial/feat name is the SAME thing for every character who has it,
// so a new one-off gets a bare, unscoped, reusable id — `feat.<slug(name)>`
// — same convention Monster's shared weapon-attack templates use).
// `category` — this entry's `tags.categories` value; every caller passes
// one (Character/Species/Variant/Class all pass "character"). A Feature
// with no category can't be found via Loom's Type filter, so this is never
// meant to be omitted. `suffixWord` — resolveTemplateId's id-collision bump
// slot, defaults to "feature".
export async function promoteEmbeddedFeatures(
  record,
  { sourceField, parentPath, disambiguationSlug, category, suffixWord = "feature", dataManager, existingFeatures, allowCrossScopeMatch = true, excludeSpeciesPropertyTraits = false }
) {
  const fields = Array.isArray(sourceField) ? sourceField : [sourceField];
  const result = { featureIds: [], matchedCount: 0, createdCount: 0, updatedCount: 0, errors: [] };
  if (!record || !dataManager) return result;
  let rawEntries = fields.flatMap((field) => (Array.isArray(record[field]) ? record[field] : []));
  if (excludeSpeciesPropertyTraits) {
    rawEntries = rawEntries.filter((entry) => !SPECIES_PROPERTY_TRAIT_NAMES.has(normalizeName(stripLevelPrefix(entry?.name).name)));
  }
  if (!rawEntries.length) return result;

  // Combine entries sharing the same (normalized, level-prefix-stripped)
  // name WITHIN THIS SOURCE LIST, in original order, before matching at
  // all — a recurring D&D pattern: the SAME class feature granted again at
  // a HIGHER level with a different additive effect (Barbarian's "Improved
  // Brutal Strike" at 13 and 17, each with distinct text). Combining
  // BEFORE matching also keeps re-import idempotent — a freshly
  // re-combined entry compares like-for-like against an already-combined
  // existing Feature.
  const groups = new Map();
  rawEntries.forEach((entry) => {
    if (!entry?.name) return;
    const key = normalizeName(stripLevelPrefix(entry.name).name);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  const combinedEntries = Array.from(groups.values()).map((group) => {
    if (group.length === 1) return group[0];
    const levels = group.map((e) => (typeof e.level === "number" ? e.level : stripLevelPrefix(e.name).level)).filter((lvl) => lvl != null);
    return {
      name: group[0].name,
      level: levels.length ? Math.min(...levels) : (group[0].level ?? null),
      levels: levels.length ? levels : null,
      description: group.map((e) => e.description || "").filter(Boolean).join("\n\n"),
    };
  });

  // DDB's fixed boilerplate for a feature re-granted at a higher level with
  // THE SAME effect reapplied, in more than one known phrasing — matched
  // by TEXT SHAPE, not name, so it can't misfire on a genuinely different
  // repeat-grant like "Improved Brutal Strike" (untouched by the combine
  // step above). Stripped and levels merged in, so the CORE text used for
  // matching/storage never embeds a class name — matching the Generic,
  // cross-class-shared Feature already on file (Ability Score Improvement,
  // Expertise). An array, not one pattern, so a not-yet-seen phrasing is
  // one more entry, not a rewrite.
  const REPEAT_GRANT_CLAUSE_PATTERNS = [
    // "...for which you qualify. You gain this feature again at Fighter
    // levels 6, 8, 12, 14, and 16." (Ability Score Improvement)
    /\s*You gain this feature again at [^.]*\./i,
    // "...of your choice.\n\nAt Bard level 9, you gain Expertise in two
    // more of your skill proficiencies of your choice." (Expertise) —
    // always the LAST paragraph in every case seen so far, so matches to
    // the end of the string rather than just to its own first period (that
    // paragraph's own sentence can itself contain more than one).
    /\n\nAt [^.]+ level \d+, you gain[\s\S]*$/i,
  ];
  const entries = combinedEntries.map((entry) => {
    if (!entry?.description) return entry;
    let match = null;
    for (const pattern of REPEAT_GRANT_CLAUSE_PATTERNS) {
      match = entry.description.match(pattern);
      if (match) break;
    }
    if (!match) return entry;
    const clauseLevels = (match[0].match(/\d+/g) || []).map(Number);
    if (!clauseLevels.length) return entry;
    const core = entry.description.slice(0, match.index).trim();
    const existingLevels = Array.isArray(entry.levels) ? entry.levels : typeof entry.level === "number" ? [entry.level] : [];
    return { ...entry, description: core, levels: [...existingLevels, ...clauseLevels] };
  });
  if (!entries.length) return result;

  // The FULL array, not just its first entry — a record dual-tagged across
  // both D&D editions (non-Character imports dual-tag by default) needs
  // both Systems on any newly-created Feature, not just the first.
  const recordSystemIds = Array.isArray(record.systemIds) ? record.systemIds : record.systemIds ? [record.systemIds] : [];
  const ownFeatureIds = new Set(record.featureIds || []);
  const allowedCategories = category ? [category] : [];
  const matchesCategoryAndSystem = (feature) => {
    const categories = feature.tags?.categories;
    const matchesCategory = !Array.isArray(categories) || !categories.length || categories.some((c) => allowedCategories.includes(c));
    const ids = Array.isArray(feature.systemIds) ? feature.systemIds : [];
    const matchesSystem = !recordSystemIds.length || !ids.length || ids.some((id) => recordSystemIds.includes(id));
    return matchesCategory && matchesSystem;
  };
  // Non-"unique" (Generic) features are normally reusable by ANY record in
  // this shared category pool with no ownership check — correct for the
  // Class-feature domain (Ability Score Improvement), but the same pooling
  // let a Species trait match a Generic feature it had no business reusing
  // (a bare `feat.ability-score-increases` silently absorbed both Water
  // Genasi's and Yuan-ti's own trait). `allowCrossScopeMatch === false`
  // (Species/racial-variant domain) tightens this: ONLY features this
  // record already owns are candidates; everything else gets a fresh copy.
  const candidatePool = (existingFeatures || []).filter((feature) => {
    const matchesScope = allowCrossScopeMatch
      ? feature.mechanics?.scope !== "unique" || ownFeatureIds.has(feature.id)
      : ownFeatureIds.has(feature.id);
    return matchesCategoryAndSystem(feature) && matchesScope;
  });
  // A DIFFERENT record's "unique"-scoped feature is excluded from
  // candidatePool above on purpose — that scoping keeps two classes'
  // same-named-but-different features apart (Spellcasting). But a small
  // number of D&D features are genuinely UNIVERSAL, byte-for-byte
  // identical across every class ("Epic Boon") — for those, class-scoping
  // was actively WRONG, spawning a fresh duplicate on every class import.
  // Handled as its own narrow, separate exact-match pass (see the loop
  // below) rather than loosening candidatePool's scope filter or
  // findMatch's similarity threshold — a near-miss like "Ability Score
  // Improvement" (each class's own copy names that class) is similar
  // enough to clear a fuzzy bar but must NEVER cross-merge. Only an EXACT
  // (whitespace/case-normalized) match is safe enough to cross this
  // boundary.
  // `allowCrossScopeMatch` — the caller's opt-out. This exact mechanism
  // silently mismerged Species/racial-variant traits: many species share
  // identical PHB boilerplate for short traits (Height and Weight;
  // Speed/Darkvision/Size often coincide by game-design chance) without
  // being conceptually universal — Owlin's "Speed" got silently healed to
  // reuse Yuan-ti's id just because both were worded identically. No
  // Species trait has been confirmed as an intentionally-shared concept
  // (unlike vetted class features like Epic Boon), so the caller defaults
  // this off for the Species/racial-variant domain.
  const crossScopeUniqueFeatures = allowCrossScopeMatch
    ? (existingFeatures || []).filter(
        (feature) => matchesCategoryAndSystem(feature) && feature.mechanics?.scope === "unique" && !ownFeatureIds.has(feature.id)
      )
    : [];
  const normalizeDescriptionForExactMatch = (text) => String(text || "").replace(/\s+/g, " ").trim().toLowerCase();

  const recordSlug = parentPath ? cappedSlug(parentPath) : null;
  // Seeded from whatever the record already has (never starts empty) — see
  // this module's own header comment for why: multiple promotion passes
  // over the same record (Character's own feats+features) need to
  // accumulate into one list, not each overwrite the other's work.
  const featureIds = [...(record.featureIds || [])];
  const featureParams = { ...(record.featureParams || {}) };

  for (const entry of entries) {
    if (!entry?.name) continue;
    try {
      const { name: cleanName, level: prefixLevel } = stripLevelPrefix(entry.name);
      if (!cleanName) continue;
      const trait = { name: cleanName, description: entry.description || "" };
      const level = prefixLevel != null ? prefixLevel : typeof entry.level === "number" ? entry.level : null;

      const normalizedTraitName = normalizeName(cleanName);
      const normalizedTraitDescription = normalizeDescriptionForExactMatch(trait.description);
      const exactCrossScopeMatch =
        normalizedTraitDescription &&
        crossScopeUniqueFeatures.find(
          (feature) =>
            normalizeName(feature.name) === normalizedTraitName &&
            normalizeDescriptionForExactMatch(feature.description || feature.mechanics?.text || "") === normalizedTraitDescription
        );
      const match = exactCrossScopeMatch
        ? null
        : findMatch(trait, candidatePool, { nameMatchThreshold: CHARACTER_FEATURE_NAME_MATCH_THRESHOLD, requireExactName: true });
      let featureId;
      if (exactCrossScopeMatch) {
        featureId = exactCrossScopeMatch.id;
        result.matchedCount += 1;
        // A SECOND class independently producing byte-identical text
        // confirms this feature is genuinely universal — flip it to
        // Generic scope now rather than leaving it "unique" just because
        // it was created by whichever class got imported first. Doesn't
        // rename its id (still class-prefixed) — that needs updating every
        // other record's own references too, a heavier migration left for
        // a manual cleanup pass, not a silent autosave side effect.
        if (exactCrossScopeMatch.mechanics?.scope === "unique") {
          const { scope, ...restMechanics } = exactCrossScopeMatch.mechanics;
          const healed = { ...exactCrossScopeMatch, mechanics: restMechanics };
          await dataManager.save("feature", healed.id, healed);
          exactCrossScopeMatch.mechanics = restMechanics;
        }
      } else if (match) {
        featureId = match.feature.id;
        result.matchedCount += 1;
      } else {
        const baseId = recordSlug ? `feat.${recordSlug}-${cappedSlug(cleanName)}` : `feat.${cappedSlug(cleanName)}`;
        let newId = recordSlug ? baseId : resolveTemplateId(baseId, existingFeatures, allowedCategories, suffixWord);
        // Class-scoped ids are deterministic (`feat.<class>-<name>`) — a
        // SECOND subclass of the same class reusing this exact name for
        // GENUINELY DIFFERENT content (findMatch already failed above)
        // would otherwise silently overwrite whichever subclass got there
        // first (every Artificer subclass has its own "Tools of the
        // Trade"). Escalating to the caller's `disambiguationSlug` (a
        // Variant's compound id) ONLY on an actual detected collision keeps
        // every OTHER, non-colliding subclass's id unchanged.
        if (recordSlug && disambiguationSlug && disambiguationSlug !== recordSlug) {
          const collision = (existingFeatures || []).find((feature) => feature.id === newId);
          if (collision && collision.mechanics?.scope === "unique" && !ownFeatureIds.has(collision.id)) {
            newId = `feat.${cappedSlug(disambiguationSlug)}-${cappedSlug(cleanName)}`;
          }
        }
        // Deterministic ids are also idempotent — when nothing MATCHED but
        // this exact id already exists on disk, this "create" is really an
        // overwrite of already-promoted content whose text changed since
        // the last import (a parser fix backfilling missing content).
        // Tracked separately so the caller's status message can say
        // "updated" instead of "created."
        const isUpdate = (existingFeatures || []).some((feature) => feature.id === newId);
        const newFeature = {
          id: newId,
          name: cappedDisplayName(cleanName),
          systemIds: recordSystemIds,
          description: trait.description,
          // scope: "unique" only for a record-slug-scoped id — mirrors
          // monster-feature-matching.js's one-off-vs-shared-template
          // convention: a bare, unscoped id (Character's case) is meant to
          // be reused by name across every character with the same
          // class/racial feature, so it stays without a `scope` key.
          mechanics: recordSlug ? { type: "passive", scope: "unique", text: trait.description } : { type: "passive", text: trait.description },
          budgetCost: 0,
          tags: { behaviors: [], recipeSlots: [], roles: [], creatureTypes: [], categories: category ? [category] : [] },
          synergizesWith: [],
          conflictsWith: [],
        };
        await dataManager.save("feature", newFeature.id, newFeature);
        candidatePool.push(newFeature);
        featureId = newFeature.id;
        if (isUpdate) {
          result.updatedCount += 1;
        } else {
          result.createdCount += 1;
        }
      }
      if (!featureIds.includes(featureId)) featureIds.push(featureId);
      // `entry.levels` — every ORIGINAL level this combined entry came
      // from (see the combine-before-matching step above); recording all
      // of them, not just the primary/lowest `level`, keeps "granted again
      // at a higher level" visible in featureParams even after two raw
      // entries collapse into one Feature.
      (Array.isArray(entry.levels) ? entry.levels : [level]).forEach((lvl) => recordGrantLevel(featureParams, featureId, lvl));
    } catch (error) {
      const message = error?.message || String(error);
      result.errors.push({ trait: entry.name, message });
      console.warn(`content-feature-matching: failed to convert "${entry.name}" — kept the rest of this record's own conversion going. ${message}`);
    }
  }

  record.featureIds = featureIds;
  result.featureIds = featureIds;
  if (Object.keys(featureParams).length) record.featureParams = featureParams;
  return result;
}

// Shared status-message wording for `promoteEmbeddedFeatures` outcomes —
// one place so Loom and Workbench's own save/re-import flows report the
// same "matched / created / updated" language instead of drifting apart.
export function describeFeaturePromotionOutcome({ matchedCount = 0, createdCount = 0, updatedCount = 0 } = {}) {
  return `Matched ${matchedCount} feature${matchedCount === 1 ? "" : "s"} to existing Features, created ${createdCount} new one${createdCount === 1 ? "" : "s"}, updated ${updatedCount} existing one${updatedCount === 1 ? "" : "s"}.`;
}

// --- Character reference linking ----------------------------------------
// Four Character field families link into an ALREADY-EXISTING Library
// record by NAME: species/class/subclass, spells, and inventory. None of
// them promote/create anything the way feats/features above do — a
// spell/species/class/item is already its own Library kind, so this only
// ever LINKS, via findKindReferenceRecord's case-insensitive name-or-id
// match, never guesses.
//
// This used to compute `refId` optimistically as `slugify(name)` with no
// fetch — wrong in practice: a Library record's id does NOT always equal
// slugify(its name) (a 5e-API-sourced Wonder's id follows the API's own
// slug convention instead), so an unverified guess routinely pointed at
// nothing or, worse, a real but WRONG record. A field with no matching
// record now simply gets NO refId — it renders as plain text, and the
// next save picks it up once the real record exists.
//
// All four are async now (a real fetch, not a synchronous guess) — every
// call site gates them behind an explicit save action, never autosave.
async function linkReferenceField(dataManager, kind, value, { searchName, filter } = {}) {
  if (!dataManager || !value?.name || value.refId) return;
  const match = await findKindReferenceRecord(dataManager, kind, searchName || value.name, { filter }).catch(() => null);
  if (match) {
    value.refKind = kind;
    value.refId = match.id;
  }
}

// Wonder covers more than one real-world concept under one shared kind (a
// spell AND a piece of equipment, deliberately) — a name collision between
// the two is real: the "Shield" SPELL and a Character's own Shield (armor)
// share a name, and matching against the wrong one is worse than matching
// against neither. `form` is Wonder's own established distinguishing
// property (vault/js/app.js already checks this key throughout its
// Identity box), applied here as a filter. Degrades gracefully for a
// System with no "form" property — never worse than before this fix.
const WONDER_FORM_KEY = "form";
const SPELL_FORM_VALUE = "spell";
export function isSpellForm(entry) {
  return String(entry?.properties?.[WONDER_FORM_KEY] || "").toLowerCase() === SPELL_FORM_VALUE;
}

export async function linkCharacterSpellReferences(dataManager, record) {
  if (!dataManager || !Array.isArray(record?.spells)) return;
  for (const group of record.spells) {
    if (!Array.isArray(group?.spells)) continue;
    for (const spell of group.spells) {
      await linkReferenceField(dataManager, "wonder", spell, { filter: isSpellForm });
    }
  }
}

export async function linkCharacterInventoryReferences(dataManager, record) {
  if (!dataManager || !Array.isArray(record?.inventory)) return;
  for (const item of record.inventory) {
    await linkReferenceField(dataManager, "wonder", item, { filter: (entry) => !isSpellForm(entry) });
  }
}

// DDB's character-service API tags a subclass name with a trailing
// "(SOURCEBOOK)" ("The Fathomless (TCOE)") the Library's Variant record
// (scraped from its content page, whose heading never carries it) doesn't
// have; left in, the name would never match. Mirrors
// mapping-custom-functions.js's compoundSlug(stripSourcebookSuffix) fix for
// the identical problem on the id-GENERATION side.
function stripSourcebookSuffix(name) {
  return String(name || "").replace(/\s*\([^)]*\)\s*$/, "");
}

export async function linkCharacterSpeciesClassReferences(dataManager, record) {
  if (!dataManager || !record?.identity) return;
  await linkReferenceField(dataManager, "species", record.identity.race);
  const classes = Array.isArray(record.identity.classes) ? record.identity.classes : [];
  for (const cls of classes) {
    await linkReferenceField(dataManager, "class", cls);
    if (cls?.subclass?.name) {
      await linkReferenceField(dataManager, "variant", cls.subclass, { searchName: stripSourcebookSuffix(cls.subclass.name) });
    }
  }
}
