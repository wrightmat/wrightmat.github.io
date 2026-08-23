// Turns an embedded `[{name, description}]`-shaped array on a Library
// record — Species.traits, Variant.features, Class.features, or a merge of
// Character.feats/Character.features — into real `feature` Library
// references, the same way `monster-feature-matching.js`/`vault-feature-
// matching.js` already do for Monster/Wonder: matching/dedup against the
// shared `feature-import-core.js` engine, promoting anything unmatched into
// its own new Feature record, and recording the result as `record.
// featureIds` (+ `record.featureParams` for any per-grant metadata, same
// shape Monster's own `featureParams` already uses).
//
// Deliberately much simpler than monster-feature-matching.js — nothing here
// parses 5e stat-block mechanical prose (weapon attacks, save effects,
// Multiattack); a class/racial/feat entry is just a name + flavor text, so
// this only needs the generic match-by-name-and-description/create-if-
// unmatched path monster-feature-matching.js's own tail already establishes.
//
// Every call site is automatic-on-save, same as Monster/Vault — no manual/
// backfill button anywhere in this suite. Idempotent by construction:
// re-running finds the same already-created Features by name and reuses
// them rather than creating duplicates, and (unlike monster-feature-
// matching.js, which always fully reprocesses one record's complete
// ability-group set in a single call) this ACCUMULATES onto whatever
// `record.featureIds` already holds rather than replacing it — Character's
// own call site promotes `feats` and `features` as two separate passes over
// the same record, and both need to land in one combined list.
import { normalizeName, cappedSlug, cappedDisplayName, resolveTemplateId, findMatch } from "./feature-import-core.js";
import { findKindReferenceRecord } from "./library-reference.js";

// findMatch's own DEFAULT exact-name-match threshold (0.25) assumes an
// identical name means the same ability, just maybe reworded — true for
// Monster's own SRD trait text (genuinely reused verbatim by convention),
// false here: D&D class/subclass features deliberately reuse names across
// classes for CONCEPTUALLY DIFFERENT mechanics ("Spellcasting," "Fighting
// Style," "Channel Divinity," ...). Two different classes' own Spellcasting
// text shares enough D&D-mechanic vocabulary ("spell slots," "spellcasting
// ability," "prepare," "known spells") to clear 0.25 easily despite being
// genuinely different abilities — confirmed real risk, not hypothetical.
// 0.85 matches feature-import-core.js's own "near-total agreement" bar
// (SHORT_TEXT_SIMILARITY_THRESHOLD) — not imported/reused by that name
// since the reasoning here is unrelated to text length, but the same value
// already represents "these two texts are essentially the same wording."
const CHARACTER_FEATURE_NAME_MATCH_THRESHOLD = 0.85;

// DDB's own export prepends the level a feature was (re-)granted at to
// repeat entries within one class ("Weapon Mastery", then later "4: Weapon
// Mastery", "8: Ability Score Improvement", ...) — stripped before
// matching/slugging so these collapse onto ONE Feature record instead of
// spawning near-duplicates, with every grant level recorded instead of lost.
const LEVEL_PREFIX_PATTERN = /^(\d+):\s*/;
function stripLevelPrefix(name) {
  const raw = String(name || "");
  const match = raw.match(LEVEL_PREFIX_PATTERN);
  if (!match) return { name: raw, level: null };
  return { name: raw.slice(match[0].length).trim(), level: Number(match[1]) };
}

// A Species' own scraped `traits[]` mixes two genuinely different things
// DDB just happens to render the same way (an H4 heading + paragraphs): a
// handful of universal-shape PROPERTIES every species has some value for
// (how tall, how big, how fast, what type of creature, which ability
// scores go up, what languages, how long-lived) — fill-in-the-blank facts,
// not a distinctive mechanic — versus actual FEATURES (Darkvision, Flight,
// Silent Feathers, ...). Confirmed real, user-flagged: none of the former
// belong in the Feature library at all — they're not features of this
// species, they're properties of it, most already covered by dedicated
// fields elsewhere. Matched by normalized name (case/punctuation-
// insensitive, same normalizeName every other name comparison in this file
// uses) against every trait name actually seen across the full species
// library so far — confirmed by survey, not guessed. Ability Score
// Increases is explicitly included even though its own VALUE differs per
// species (which scores go up) — the concept itself ("choose your ability
// score bonuses") is a standard, non-distinctive species-wide mechanic in
// current 5e, not a unique feature.
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

// `sourceField` — a field name, or an array of field names, on `record` to
// read `{name, description, level?}` entries from (Character's own call
// site passes ["feats", "features"] to promote both into one combined
// result). `parentPath` — a plain string (NOT a lookup path) to scope newly
// -created one-off Feature ids against, e.g. a Species/Class's own name, or
// a Variant's own `parentId`; omit for Character (a class/racial/feat name
// is definitionally the SAME thing for every character who has it, so a
// newly-created Character-level one-off gets a bare, unscoped, reusable id
// — `feat.<slug(name)>` — same convention Monster's own shared weapon-
// attack/save-effect templates already use). `category` — this entry's own
// `tags.categories` value. Every caller passes one (Character/Species/
// Variant/Class all pass `"character"` — Undercroft doesn't model race/
// class/background/feat as separate concepts, so one broad category
// covers all of them, sibling to Monster/Vault/Sanctum's own "monster"/
// "spell"/"item"/"location"). A Feature with no category can't be found
// via Loom's own Type filter (loom/js/app.js's populateFeatureTypeFilter
// only lists categories that actually appear on some Feature), so this is
// never meant to be omitted. `suffixWord` — passed through to
// resolveTemplateId's own id-collision bump slot, defaults to "feature".
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
  // all — a real, recurring D&D pattern: the SAME class feature granted
  // again at a HIGHER level with a genuinely different additive effect
  // (Barbarian's own "Improved Brutal Strike" at levels 13 and 17 — level
  // 13 grants new Brutal Strike options text, level 17 is unrelated
  // "upgrade the damage" text; confirmed real data loss this fixes: the
  // level-13 text was silently discarded, findMatch treating the level-17
  // entry as "the same feature, just reworded" and matching/overwriting
  // it). Combining BEFORE matching (rather than leaving it to findMatch's
  // own per-entry similarity call) is also what keeps a later re-import
  // idempotent — a freshly re-combined entry compares like-for-like
  // against an already-combined existing Feature, instead of a lone
  // level-13-only entry being compared against a level-13+17 combined
  // record and failing a strict similarity bar for the wrong reason.
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

  // DDB's own fixed boilerplate for a feature re-granted at a higher level
  // with THE SAME effect just reapplied, in more than one known phrasing —
  // matched by TEXT SHAPE, not by this entry's own name, so it can never
  // misfire on a genuinely different repeat-grant like Barbarian's own
  // "Improved Brutal Strike" (whose own repeat text reads completely
  // differently and is correctly preserved in full by the combine step
  // above, not touched by this one at all). Stripped and its levels
  // merged in, so the CORE text used for matching/storage never embeds a
  // class name — matching what the Generic, cross-class-shared version of
  // a feature like this already has stored. Confirmed real, recurring
  // regression this fixes: both Ability Score Improvement's and
  // Expertise's own generic Features had this kind of clause manually
  // stripped during a one-time cleanup, but the live pipeline never
  // learned to do the same stripping, so every class's own fresh
  // re-import kept spawning a fresh class-scoped duplicate instead of
  // matching the shared one — confirmed live on three separate classes
  // now (Cleric/Druid for Ability Score Improvement, Bard for Expertise),
  // each surfacing its own distinct phrasing. An array, not one pattern,
  // so a future not-yet-seen phrasing is one more entry here, not a
  // rewrite — expect this list to keep growing as more classes get
  // re-imported.
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

  // The FULL array, not just its first entry — a source record dual-tagged
  // across both D&D editions (every non-Character import, per this suite's
  // own "Characters stay single-System, everything else dual-tags by
  // default" convention) used to only ever pass its first System down to a
  // newly-created Feature, silently dropping the second one instead of
  // matching the record it came from.
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
  // this shared category pool with no ownership check at all — correct for
  // the Class-feature domain a Character's own promoted feat is SUPPOSED to
  // reuse (e.g. Ability Score Improvement), but the exact same pooling lets
  // a Species trait match a Generic feature it has no business reusing
  // (confirmed real: a pre-existing bare `feat.ability-score-increases`,
  // itself unrelated Character-domain content, silently absorbed both
  // Water Genasi's and Yuan-ti's own "Ability Score Increases" trait).
  // `allowCrossScopeMatch === false` (Species/racial-variant domain) tightens
  // this the same way it tightens crossScopeUniqueFeatures below — ONLY
  // features this record already owns are ever candidates; everything else
  // always gets its own fresh copy rather than risking a coincidental-text
  // reuse across unrelated species.
  const candidatePool = (existingFeatures || []).filter((feature) => {
    const matchesScope = allowCrossScopeMatch
      ? feature.mechanics?.scope !== "unique" || ownFeatureIds.has(feature.id)
      : ownFeatureIds.has(feature.id);
    return matchesCategoryAndSystem(feature) && matchesScope;
  });
  // A DIFFERENT record's own "unique"-scoped feature (e.g. another class's
  // own class-scoped `feat.<class>-<name>`) is excluded from candidatePool
  // above on purpose — that scoping is what keeps two different classes'
  // own same-named-but-different features apart (Spellcasting being the
  // motivating example). But a small number of D&D features are genuinely
  // UNIVERSAL, byte-for-byte identical text across every class by
  // convention ("Epic Boon" is the confirmed real case — every class's own
  // copy is the exact same sentence) — for those, class-scoping was
  // actively WRONG, silently spawning a fresh duplicate on every class
  // import instead of reusing the one already created. Handled as its own
  // narrow, separate exact-match pass (see the loop below) rather than by
  // loosening candidatePool's own scope filter or findMatch's own
  // similarity threshold — a near-miss like "Ability Score Improvement"
  // (each class's own copy names that class explicitly: "...at Barbarian
  // levels 8, 12, and 16" vs "...at Cleric levels...") is similar enough
  // to plausibly clear a fuzzy bar but must NEVER cross-merge, since doing
  // so would show one class's own leveling text on another class's sheet.
  // Only an EXACT (whitespace/case-normalized) match is safe enough to
  // cross this boundary at all.
  // `allowCrossScopeMatch` — the caller's own opt-out. Confirmed real, this
  // exact mechanism silently mismerges Species/racial-variant traits: many
  // species share genuinely IDENTICAL PHB boilerplate for short traits
  // (Height and Weight's own "regardless of race..." paragraph is the same
  // stock text for most species; Speed/Darkvision/Size often coincide on
  // the same number/wording purely by game-design chance) without those
  // traits being conceptually universal the way Epic Boon or Extra Attack
  // actually are — Owlin's own "Speed" got silently healed to reuse
  // Yuan-ti's id and content just because both happened to be worded (or
  // valued) identically. Unlike class features (vetted case by case, e.g.
  // Epic Boon/Extra Attack, before ever being trusted here), no Species
  // trait has ever been confirmed as an intentionally-shared concept, so
  // the caller defaults this off for the Species/racial-variant domain.
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
        // A SECOND class independently producing byte-identical text is
        // exactly the confirmation that this feature is genuinely
        // universal, not one class's own thing — flip it to Generic scope
        // right now rather than leaving it permanently "unique" just
        // because it happened to be created by whichever class got
        // imported first. Doesn't rename its id (still class-prefixed,
        // e.g. `feat.barbarian-epic-boon`) — that needs updating every
        // other record's own featureIds/featureParams references too, a
        // heavier migration left for a manual cleanup pass (see this
        // session's own Epic Boon rename), not something safe to do as a
        // silent autosave side effect.
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
        // GENUINELY DIFFERENT content (findMatch already just failed above,
        // so we know it doesn't match) would otherwise silently overwrite
        // whichever subclass got there first at this same id — confirmed
        // real, repeated content loss: every Artificer subclass has its own
        // "Tools of the Trade," Battle Smith and Forge Adept both have their
        // own "Battle Ready." Escalating to the caller's own
        // `disambiguationSlug` (a Variant's own compound id, e.g.
        // "artificer-cartographer") ONLY on an actual detected collision —
        // never unconditionally — is what keeps every OTHER, non-colliding
        // subclass's own id exactly as it's always been; only the specific
        // names that truly collide within one class ever escalate.
        if (recordSlug && disambiguationSlug && disambiguationSlug !== recordSlug) {
          const collision = (existingFeatures || []).find((feature) => feature.id === newId);
          if (collision && collision.mechanics?.scope === "unique" && !ownFeatureIds.has(collision.id)) {
            newId = `feat.${cappedSlug(disambiguationSlug)}-${cappedSlug(cleanName)}`;
          }
        }
        // Deterministic ids are also idempotent — when nothing MATCHED but
        // this exact (possibly just-escalated) id already exists on disk
        // anyway, this "create" is really an overwrite of already-promoted
        // content whose own text just changed since the last import (a
        // parser fix backfilling previously-missing content is the
        // confirmed real case — Domain Spells' own table content). Tracked
        // separately from a genuinely brand-new id so the caller's own
        // status message can say "updated" instead of "created" for this
        // case.
        const isUpdate = (existingFeatures || []).some((feature) => feature.id === newId);
        const newFeature = {
          id: newId,
          name: cappedDisplayName(cleanName),
          systemIds: recordSystemIds,
          description: trait.description,
          // scope: "unique" only for a record-slug-scoped id (Species/
          // Variant/Class-specific) — mirrors monster-feature-matching.js's
          // own one-off-vs-shared-template convention exactly: a bare,
          // unscoped id (Character's own case, when nothing matched) is
          // meant to be reused by name across every other character who
          // has the same class/racial feature or feat, so it stays without
          // a `scope` key at all, same as Monster's own shared weapon-
          // attack/save-effect templates.
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
// record by NAME: species/class/subclass (identity.race / identity.classes[]
// / .subclass), spells (spells[].spells[]), and inventory (inventory[]).
// None of them promote/create anything the way feats/features above do — a
// spell/species/class/item is already modeled as its own Library kind
// (wonder/species/class/variant), so this only ever LINKS, via
// findKindReferenceRecord's own case-insensitive name-or-id match (the same
// lookup a reference chip's own hover-preview already uses), never guesses.
//
// This used to compute `refId` optimistically as `slugify(name)` with no
// fetch at all. Confirmed wrong in practice, not just theoretically: a
// Library record's own id does NOT always equal slugify(its own name) — a
// 5e-API-sourced Wonder's id follows the API's own slug convention instead
// (e.g. "Potion of Fire Giant Strength" imports as id
// "potion-of-giant-strength-fire", not "potion-of-fire-giant-strength") —
// so an unverified guess routinely pointed at nothing, or (worse, silently)
// at a real but WRONG record that happened to share the computed id. A
// field with no matching record at all (homebrew, or a source kind not yet
// imported) now simply gets NO refId — a {refKind,name}-only value isn't
// reference-shaped (component-renderers.js's own isReferenceValue requires
// refId too), so it correctly renders as plain text, and the next save
// picks it up automatically once the real record exists.
//
// All four are async now (a real fetch, not a synchronous guess) — every
// call site gates them behind an explicit, deliberate save action, never
// autosave, the same line workbench-character-view.js's own persistDraft
// already draws for Feature promotion just below (a live Library fetch on
// every keystroke would be wasteful; an explicit Save/Re-import is not).
async function linkReferenceField(dataManager, kind, value, { searchName, filter } = {}) {
  if (!dataManager || !value?.name || value.refId) return;
  const match = await findKindReferenceRecord(dataManager, kind, searchName || value.name, { filter }).catch(() => null);
  if (match) {
    value.refKind = kind;
    value.refId = match.id;
  }
}

// Wonder covers more than one real-world concept under one shared kind (a
// spell AND a piece of equipment, deliberately — see this file's own
// "Character reference linking" header) — a name collision between the two
// is a real, confirmed case, not hypothetical: the "Shield" SPELL and a
// Character's own Shield (armor) equipment share a name, and matching
// against the wrong one is worse than matching against neither. `form` is
// Wonder's own established distinguishing property — vault/js/app.js
// already hardcodes checking this exact key throughout its own Identity
// box (Rarity/Activation/Item Form) — not a new, D&D-specific mechanism
// invented here, just this same existing convention applied as a filter.
// Degrades gracefully for a System that doesn't use this property
// convention at all: a Wonder with no "form" property simply never counts
// as spell-form, same as it always has (no filtering effect either way,
// never worse than before this fix).
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

// DDB's own character-service API tags a subclass name with a trailing
// "(SOURCEBOOK)" ("The Fathomless (TCOE)") the Library's own Variant record
// — scraped straight from its content page, whose heading never carries it
// — doesn't have; left in, the name would never match at all. Mirrors
// mapping-custom-functions.js's own compoundSlug(stripSourcebookSuffix) fix
// for the identical problem on the id-GENERATION side (a bulk subclass
// import computing its own new record's id) — this is the reference-
// MATCHING side of the same fix.
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
