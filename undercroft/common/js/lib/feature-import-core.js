// Kind-agnostic core of the Feature-library import/matching pipeline —
// extracted from monster-feature-matching.js (Crucible's own monster
// importer, built and hardened across a long SRD monster-import cleanup:
// false merges, id fragmentation, options-array destruction, dangling
// featureParams keys, ...) so a SECOND importer (Vault's own spell/item
// import, see vault-feature-matching.js) gets every one of those same
// guarantees from its first import instead of re-discovering each bug the
// hard way. Nothing here knows what a "monster" or a "spell" is — every
// function takes its category/slug/substitution behavior as a parameter
// from the caller, which owns the content-shape-specific knowledge
// (5e stat-block prose vs 5e API spell/magic-item JSON).
//
// monster-feature-matching.js keeps everything that's genuinely about
// PARSING 5e monster stat-block prose (parseWeaponAttack, parseSaveEffect,
// Multiattack extraction, knownNameSubstitute's monster-name genericizing) —
// only the matching/dedup/tiering/options machinery around that lives here.

// See NAME_MATCH_SIMILARITY_THRESHOLD's own comment in monster-feature-
// matching.js's git history for the full reasoning — two bars for the two
// ways a name CAN relate without being identical (exact vs partial overlap),
// no name relation at all never qualifies regardless of description
// similarity.
export const NAME_MATCH_SIMILARITY_THRESHOLD = 0.25;
export const PARTIAL_NAME_MATCH_SIMILARITY_THRESHOLD = 0.5;

// Domain words common enough across nearly every trait/action/spell/item
// description (creature, damage, target, ...) that including them in the
// similarity score would wash out what actually distinguishes one mechanic
// from another — excluded the same way a search engine excludes stopwords.
export const STOPWORDS = new Set([
  "a", "an", "the", "of", "to", "and", "or", "its", "it", "is", "are", "this", "that", "with", "on", "in", "at",
  "as", "by", "if", "for", "from", "when", "while", "can", "must", "not", "no", "one", "target", "targets",
  "creature", "creatures", "damage", "each", "another", "instead", "must", "make", "makes",
  "melee", "ranged", "weapon", "spell", "attack", "hit", "reach",
]);

// A short, boilerplate-heavy one-liner only ever has a handful of
// significant tokens once the template itself is subtracted out — too few
// for a jaccard ratio to be trustworthy at either match bar. Below this
// token count, on either side, the required threshold jumps to near-total
// agreement regardless of how closely the names relate.
export const MIN_SIGNIFICANT_TOKENS_FOR_LOOSE_MATCH = 8;
export const SHORT_TEXT_SIMILARITY_THRESHOLD = 0.85;

// Heavily-templated "roll against a number" boilerplate (a weapon attack's
// "+N to hit", an area/save effect's "DC N <ability> saving throw") pads a
// short ability's significant-token count without actually distinguishing
// it from an unrelated one sharing the same boilerplate — forces the strict
// short-text threshold even when the raw token count alone wouldn't.
export const TEMPLATED_MECHANICAL_TEXT_PATTERN = /\+\d+\s+to hit|\bDC\s*\d+\s+\w+\s+saving throw\b/i;

// Feature ids and display names are used as filesystem-adjacent storage
// keys (dataManager.save writes a file keyed by id) and shown as labels —
// malformed source data (a name field holding an entire paragraph) can
// otherwise produce an id hundreds of characters long that fails to save.
export const MAX_SLUG_LENGTH = 60;
export const MAX_DISPLAY_NAME_LENGTH = 100;

export function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Strips a trailing "(N/Day)"-style frequency count and trailing period(s)
// before comparing — the one systematic per-record variation a 5e source's
// own templated names carry (e.g. "Legendary Resistance (3/Day).").
export function normalizeName(name) {
  return String(name || "")
    .trim()
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\.+$/, "")
    .toLowerCase()
    .trim();
}

// Only strips the trailing period(s) source data tends to carry on a name —
// keeps any "(N/Day)" count, since a freshly-created one-off feature is
// scoped to just this one record and that count is genuinely useful detail.
export function displayName(name) {
  return String(name || "").trim().replace(/\.+$/, "");
}

// Deterministic, not for security — just enough entropy that two different
// overlong names sharing their first MAX_SLUG_LENGTH characters don't
// collide into the same id after truncation.
export function shortHash(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function cappedSlug(name) {
  const slug = slugify(name);
  if (slug.length <= MAX_SLUG_LENGTH) return slug;
  return `${slug.slice(0, MAX_SLUG_LENGTH)}-${shortHash(slug)}`;
}

export function cappedDisplayName(name) {
  const display = displayName(name);
  if (display.length <= MAX_DISPLAY_NAME_LENGTH) return display;
  return `${display.slice(0, MAX_DISPLAY_NAME_LENGTH - 1).trimEnd()}…`;
}

// A generated shared-template id (`feat.<slug(name)>`) can coincidentally
// collide with an EXISTING Feature that isn't actually a valid match for
// THIS caller's own category pool at all — a different System, or a totally
// unrelated kind of content (a monster's "Fire Breath" vs a Vault spell/item
// Feature that happens to slugify to the same id) sharing this same
// `feature` Library kind. The caller's own candidatePool already filters
// those out for MATCHING purposes, but that does nothing to protect a
// CREATE — `dataManager.save` writes unconditionally by id, so creating a
// new template at a colliding id would silently overwrite that unrelated
// Feature's own content instead of coexisting with it. `allowedCategories`
// is the caller's own reusable-template category set (`["monster"]` for
// Crucible, `["spell", "item"]` for Vault) — checked against the FULL
// unfiltered `existingFeatures` (not candidatePool) specifically so it also
// catches a collision candidatePool itself already excluded from view.
export function isReusableTemplateCandidate(feature, allowedCategories) {
  const categories = feature.tags?.categories;
  return !Array.isArray(categories) || !categories.length || categories.some((c) => allowedCategories.includes(c));
}

// `suffixWord` names the bump slot ("monster"/"effect") so two different
// importers sharing this same id-collision space produce readable, distinct
// disambiguated ids rather than a bare numeric suffix.
export function resolveTemplateId(baseId, existingFeatures, allowedCategories, suffixWord) {
  const pool = existingFeatures || [];
  const collision = pool.find((feature) => feature.id === baseId);
  if (!collision || isReusableTemplateCandidate(collision, allowedCategories)) return baseId;
  let suffix = 2;
  let candidateId = `${baseId}-${suffixWord}`;
  // Each bumped candidate slot needs the SAME reusability check the base id
  // just got above it — not just "is this id already taken". Confirmed
  // live (monster import): treating "already exists" alone as blocking
  // fragmented one shared ability across several different ids instead of
  // reusing an already-good candidate slot further down the bump chain.
  let occupant = pool.find((feature) => feature.id === candidateId);
  while (occupant && !isReusableTemplateCandidate(occupant, allowedCategories)) {
    candidateId = `${baseId}-${suffixWord}-${suffix}`;
    suffix += 1;
    occupant = pool.find((feature) => feature.id === candidateId);
  }
  return candidateId;
}

export function significantTokens(text) {
  const words = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    // A bare number (attack bonus, total damage, a dice count like "2d8") is
    // kept regardless of length — a coincidentally-shared dice notation
    // alone shouldn't be the only differentiator left once real numbers are
    // filtered out as "too short" noise. Alphabetic words still need
    // length>2 to exclude real stopword-shaped noise ("to", "by", "if", ...).
    .filter((word) => (word.length > 2 || /^\d+$/.test(word)) && !STOPWORDS.has(word));
  return new Set(words);
}

export function jaccardFromTokens(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  a.forEach((word) => {
    if (b.has(word)) intersection += 1;
  });
  const union = a.size + b.size - intersection;
  return union ? intersection / union : 0;
}

export function jaccardSimilarity(textA, textB) {
  return jaccardFromTokens(significantTokens(textA), significantTokens(textB));
}

// True when two texts are IDENTICAL once every digit run is masked out, but
// their actual digit runs (in order) differ — i.e. "the exact same sentence
// shape, with different numbers plugged in." A purely mechanical check (no
// grammar/sentence-structure guessing), so it can't misfire on genuinely
// different wording — only on genuinely identical wording with different
// numbers, which is exactly the case findMatch's own jaccard threshold can't
// reliably catch on its own.
export function sameShapeDifferentNumbers(a, b) {
  const digitsA = (String(a || "").match(/\d+/g) || []).join(",");
  const digitsB = (String(b || "").match(/\d+/g) || []).join(",");
  if (digitsA === digitsB) return false;
  return String(a || "").replace(/\d+/g, " ") === String(b || "").replace(/\d+/g, " ");
}

// Best-scoring qualifying candidate as `{feature, tierId}` (tierId null
// unless the winning representation was a tier's own text), or null
// (meaning: create a new one-off feature for this entry instead). Scores a
// candidate's own base description AND every one of its `tiers` (when
// present) as separate representations, keeping whichever one scores best —
// a tiered Feature's base text is deliberately generic/parameter-free, so
// comparing only against it would make a re-imported record whose exact
// ability is already captured as a tier fail to match and spawn a
// duplicate.
export function findMatch(trait, candidates) {
  const traitName = normalizeName(trait.name);
  const traitDescription = trait.description || "";
  const traitTokens = significantTokens(traitDescription);
  const traitLooksTemplated = TEMPLATED_MECHANICAL_TEXT_PATTERN.test(traitDescription);
  let best = null;
  let bestTierId = null;
  let bestScore = 0;
  candidates.forEach((feature) => {
    const featureName = normalizeName(feature.name);
    const nameMatches = Boolean(traitName) && traitName === featureName;
    const nameOverlaps = !nameMatches && jaccardSimilarity(traitName, featureName) > 0;
    if (!nameMatches && !nameOverlaps) return; // names aren't even close — never merge, regardless of description
    const representations = [{ tierId: null, text: feature.description || feature.mechanics?.text || "" }];
    if (Array.isArray(feature.tiers)) {
      feature.tiers.forEach((tier) => {
        if (tier?.mechanics?.text) representations.push({ tierId: tier.id, text: tier.mechanics.text });
      });
    }
    representations.forEach(({ tierId, text }) => {
      // Only guards the BASE description (tierId === null) — matching
      // against an EXISTING tier's own text already requires it, verbatim;
      // this never blocks that. That's precisely the shape Tiers exist to
      // capture (same mechanic, a real differing parameter), never
      // something safe to silently collapse onto one shared value.
      if (tierId === null && sameShapeDifferentNumbers(traitDescription, text)) return;
      const featureTokens = significantTokens(text);
      const similarity = jaccardFromTokens(traitTokens, featureTokens);
      // An EXACT name match always uses the lenient threshold, even for
      // short/templated text — once the name has already confirmed a
      // match, sameShapeDifferentNumbers above is what actually protects
      // against a false merge, not a similarity threshold on top of it.
      const requiredThreshold = nameMatches
        ? NAME_MATCH_SIMILARITY_THRESHOLD
        : traitLooksTemplated || TEMPLATED_MECHANICAL_TEXT_PATTERN.test(text) || Math.min(traitTokens.size, featureTokens.size) < MIN_SIGNIFICANT_TOKENS_FOR_LOOSE_MATCH
          ? SHORT_TEXT_SIMILARITY_THRESHOLD
          : PARTIAL_NAME_MATCH_SIMILARITY_THRESHOLD;
      if (similarity >= requiredThreshold && similarity > bestScore) {
        best = feature;
        bestTierId = tierId;
        bestScore = similarity;
      }
    });
  });
  return best ? { feature: best, tierId: bestTierId } : null;
}

// Written generically (any "Base Name (N/Day)" or "Base Name (Recharge
// N[-6])" ability) — a shared Feature whose incoming entry name carries one
// of these suffixes represents a genuinely SCALING ability (how often it's
// available, or — once a caller adds its own patterns — a rarity/level
// variant), not a flavor variant. `[\d\-‐-―]` in the Recharge pattern
// tolerates any dash-like character (plain hyphen, en dash, em dash) a
// copy-pasted source might use — confirmed live: a genuine Unicode en dash
// silently failed to match plain ASCII `\-` alone, leaving one sibling's
// suffix unstripped while its others matched fine, fragmenting one shared
// ability across different template ids.
export const NAMED_TIER_PATTERNS = [
  { pattern: /\((\d+)\/Day\)\s*$/i, tierId: (m) => `${m[1]}-day`, shortName: (m) => `${m[1]}/Day` },
  { pattern: /\(Recharge\s*([\d‐-―\-]+)\)\s*$/i, tierId: (m) => `recharge-${m[1].replace(/[‐-―\-]/g, "to")}`, shortName: (m) => `Recharge ${m[1]}` },
];

// Strips the same trailing "(Recharge N-M)"/"(N/Day)" suffix
// NAMED_TIER_PATTERNS matches, but for computing a weapon-attack/save-effect
// shared TEMPLATE's own id/slug — those branches match/create purely by
// NAME, so without this a record whose source data happens to keep the
// frequency suffix in the name would never collapse into the same template
// as another otherwise-identical record whose source dropped it. The
// template itself carries no numbers of its own either way, so there's
// nothing frequency-specific to preserve here — the two abilities really
// are the exact same template regardless of source-text spelling.
export function baseAbilityName(name) {
  let stripped = String(name || "");
  for (const { pattern } of NAMED_TIER_PATTERNS) stripped = stripped.replace(pattern, "");
  return stripped.trim() || name;
}

// Only ever called once findMatch has already found a same-mechanic match —
// this never changes WHETHER something matches, only what happens once it
// has: instead of silently discarding the frequency difference (or letting
// the SAME base ability at different frequencies proliferate into separate
// one-off Features), it's recorded as a tier on the ONE shared Feature.
// Returns the tier id to record on the caller's own record.featureTiers, or
// null if the entry's name doesn't carry a recognized suffix at all.
export async function resolveNamedTier(trait, match, dataManager, substitutedDescription) {
  const name = String(trait.name || "");
  let tierMatch = null;
  let found = null;
  for (const entry of NAMED_TIER_PATTERNS) {
    const result = name.match(entry.pattern);
    if (result) {
      tierMatch = result;
      found = entry;
      break;
    }
  }
  if (!found) return null;
  const tierId = found.tierId(tierMatch);
  const tiers = Array.isArray(match.tiers) ? match.tiers : [];
  let tier = tiers.find((entry) => entry.id === tierId);
  if (!tier) {
    tier = { id: tierId, name: cappedDisplayName(trait.name), shortName: found.shortName(tierMatch), mechanics: { text: substitutedDescription || "" } };
    match.tiers = [...tiers, tier];
    await dataManager.save("feature", match.id, match);
  }
  return tierId;
}

// A small, narrowly-anchored set of real phrasings for "this ability
// resolves into one of several named sub-effects, listed as SEPARATE
// {name, desc} entries in the raw source" — Iron Cobra's own "...or suffer
// one random poison effect:" (followed by "1. Poison Damage:"/"2.
// Confusion:"/etc. as their own numbered entries) and Gem Stalker's own
// "...one of the following effects occurs..." (followed by plain-named
// entries) are the two confirmed real monster-stat-block shapes; a spell/
// item source may add its own lead-in phrasing to this same pattern later.
// Deliberately NOT a loose "ends with a colon" heuristic — that would risk
// swallowing a genuinely unrelated NEXT ability whenever a source happens
// to end a sentence with one for other reasons.
export const CHOICE_LEAD_IN_PATTERN = /(?:suffer one random [\w\s]+ effect|one of the following effects occurs(?:,\s*determined by [^:.]+)?)\s*:?\s*$/i;
export const NUMBERED_SUB_EFFECT_NAME_PATTERN = /^(\d+)\.\s*(.+?):?\s*$/;

// Detects the multi-ENTRY choice shape above, starting at
// `entries[startIndex]`. Returns `{consumedCount, options: [{name, text}]}`
// — `consumedCount` is how many FOLLOWING entries were absorbed as this one
// ability's own `options` (the caller skips past them, they never become
// their own standalone Features) — or `null` when this entry isn't a choice
// lead-in, or when fewer than 2 qualifying sub-effect entries follow it (a
// "choice" of one thing isn't a choice; falls through to being treated as
// an ordinary standalone trait instead, same safe-fallback discipline as
// every pattern in this module: never guess, never partially match).
// `isIndependentAbility(description)` tells this where a plain-named list
// (no numbering marker) stops — the monster importer passes a check for
// "starts a fresh Melee/Ranged Attack line"; a caller with a different
// content shape (a spell/item source) can pass its own boundary check
// instead. A numbered list keeps consuming as long as the numbering stays
// sequential — an unambiguous, self-terminating signal that doesn't need
// this check at all.
export function detectChoiceEffectGroup(entries, startIndex, isIndependentAbility) {
  const lead = entries[startIndex];
  if (!lead?.description || !CHOICE_LEAD_IN_PATTERN.test(lead.description)) return null;
  const options = [];
  let i = startIndex + 1;
  let expectedNumber = 1;
  let sawNumbering = false;
  while (i < entries.length) {
    const entry = entries[i];
    if (!entry?.name || !entry?.description) break;
    if (isIndependentAbility(entry.description)) break;
    const numbered = String(entry.name).match(NUMBERED_SUB_EFFECT_NAME_PATTERN);
    if (numbered) {
      if (Number(numbered[1]) !== expectedNumber) break; // numbering broke — this entry belongs to something else
      sawNumbering = true;
      expectedNumber += 1;
    } else if (sawNumbering) {
      break; // a numbered list ends the moment an entry drops the numbering
    }
    const name = (numbered ? numbered[2] : String(entry.name)).replace(/\.\s*$/, "").trim();
    options.push({ name, text: String(entry.description).trim() });
    i += 1;
    if (!sawNumbering && options.length >= 8) break;
  }
  if (options.length < 2) return null;
  return { consumedCount: i - startIndex - 1, options };
}

// The OTHER real choice shape: already ONE entry's own multi-paragraph text
// ("...uses one of the following breath weapons.\nFire Breath. ...\n
// Weakening Breath. ...") rather than split across separate {name, desc}
// entries. Anchored on literal embedded newlines (this pipeline's own
// sources always preserve them verbatim) so an ordinary single-paragraph
// entry (the overwhelming majority) never matches at all. A single non-
// conforming line anywhere in the tail bails the WHOLE split (never a wrong
// partial structure), same discipline as detectChoiceEffectGroup.
export function splitEmbeddedEffectOptions(description) {
  const raw = String(description || "");
  if (!raw.includes("\n")) return null;
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 3) return null; // intro + at least 2 named options
  const [intro, ...rest] = lines;
  const options = [];
  for (const line of rest) {
    const match = line.match(/^([A-Z][\w '’-]+?)\.\s+(.+)$/);
    if (!match) return null;
    options.push({ name: match[1].trim(), text: match[2].trim() });
  }
  if (options.length < 2) return null;
  return { intro, options };
}

// A THIRD real choice shape, distinct from the numbered/embedded-newline
// ones above: a literal markdown table of randomized outcomes (a magic
// item's own "roll a d100, consult this table" content — confirmed live
// against the real 5e API: Wand of Wonder/Deck of Many Things both give
// their own random-effect list as `| d100 | Effect |` / `|---|---|` rows,
// not prose). Detected purely structurally (2+ consecutive `|...|` lines
// with a header row and a `|---|...` separator row) — no lead-in phrase
// needed, and none of this pipeline's other option-detectors could
// mistake an ordinary paragraph for a table, so this never needs to run
// conditionally after them. Each DATA row (after the header+separator)
// becomes one option: the first column is the option's own name/roll
// range, every remaining column is joined into that option's own text.
// Exported so a caller can recognize a BARE table row/separator line on its
// own (vault-feature-matching.js's own residual-clause path uses this to
// never mint a Feature from an isolated stat-block table fragment — see its
// own `isNonMechanicalUnit`), not just as part of this file's own whole-
// table detection below.
export const TABLE_ROW_PATTERN = /^\|(.+)\|$/;
export const TABLE_SEPARATOR_PATTERN = /^\|?[\s:|-]+\|?$/;

export function splitMarkdownTableOptions(description) {
  const raw = String(description || "");
  const lines = raw.split("\n").map((line) => line.trim());
  const rowIndexes = [];
  lines.forEach((line, index) => {
    if (TABLE_ROW_PATTERN.test(line)) rowIndexes.push(index);
  });
  if (rowIndexes.length < 3) return null; // header + separator + at least 1 data row

  // A table is a contiguous run of `|...|` lines — find the longest such
  // run rather than assuming the whole text is nothing but the table
  // (a table is usually preceded by ordinary prose paragraphs describing
  // the ability itself, e.g. Wand of Wonder's own charges/DC intro text).
  let bestStart = rowIndexes[0];
  let bestLength = 1;
  let runStart = rowIndexes[0];
  let runLength = 1;
  for (let i = 1; i < rowIndexes.length; i++) {
    if (rowIndexes[i] === rowIndexes[i - 1] + 1) {
      runLength += 1;
    } else {
      runStart = rowIndexes[i];
      runLength = 1;
    }
    if (runLength > bestLength) {
      bestStart = runStart;
      bestLength = runLength;
    }
  }
  if (bestLength < 3) return null;
  const tableLines = lines.slice(bestStart, bestStart + bestLength);
  const [headerLine, separatorLine, ...dataLines] = tableLines;
  if (!TABLE_SEPARATOR_PATTERN.test(separatorLine)) return null;

  const splitRow = (line) =>
    line
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());
  const header = splitRow(headerLine);
  const options = dataLines
    .map((line) => splitRow(line))
    .filter((cells) => cells.length >= 2 && cells.some(Boolean))
    .map((cells, index) => ({
      name: cells[0] || `Option ${index + 1}`,
      text: cells.slice(1).join(" — ") || cells[0],
    }));
  if (options.length < 2) return null;

  // Everything before the table's own first line is the ability's real
  // intro/mechanical text (charges, DC, trigger, ...) — joined back into
  // one string the same way the rest of this pipeline treats prose,
  // rather than losing it.
  const intro = lines
    .slice(0, bestStart)
    .filter(Boolean)
    .join("\n")
    .trim();
  return { intro, options, header };
}

// Shared by both detectChoiceEffectGroup's and splitEmbeddedEffectOptions'
// own call sites: creates (or, on re-import, refreshes) the ONE Feature
// representing a choice-effect trait, always a record-specific one-off
// (`feat.<recordSlug>-<trait-slug>`, matched content is never shared across
// records) with `mechanics.scope: "unique"` and `options` populated.
// `ctx.category` is this caller's own single Feature category
// ("monster"/"spell"/"item"/...); `ctx.substitute(text)` is the caller's own
// name-genericizing step (monster's own `knownNameSubstitute`, or identity
// for a source with nothing to genericize) applied to both the intro and
// every option's own text. Returns the saved Feature's own id.
export async function saveOptionsFeature(trait, intro, options, ctx) {
  const { candidatePool, recordSlug, systemId, actionCost, category, substitute, dataManager, result } = ctx;
  const substitutedIntro = substitute(intro);
  const featureId = `feat.${recordSlug}-${cappedSlug(trait.name)}`;
  let feature = candidatePool.find((entry) => entry.id === featureId);
  if (!feature) {
    feature = {
      id: featureId,
      name: cappedDisplayName(trait.name),
      systemIds: systemId ? [systemId] : [],
      description: substitutedIntro || "",
      mechanics: { type: "passive", scope: "unique", text: substitutedIntro || "" },
      budgetCost: 0,
      tags: { behaviors: [], recipeSlots: [], roles: [], creatureTypes: [], categories: [category] },
      synergizesWith: [],
      conflictsWith: [],
      ...(actionCost ? { combat: { actionCost } } : {}),
    };
    result.createdCount += 1;
  } else {
    feature.description = substitutedIntro || "";
    if (feature.mechanics && typeof feature.mechanics.text === "string") feature.mechanics.text = substitutedIntro || "";
    result.matchedCount += 1;
  }
  feature.options = options.map((option) => ({
    id: slugify(option.name),
    name: option.name,
    mechanics: { text: substitute(option.text) },
  }));
  await dataManager.save("feature", feature.id, feature);
  if (!candidatePool.includes(feature)) candidatePool.push(feature);
  return feature.id;
}
