// Kind-agnostic core of the Feature-library import/matching pipeline —
// shared by monster-feature-matching.js (Crucible) and vault-feature-
// matching.js (Vault spell/item import). Nothing here knows what a
// "monster" or a "spell" is — every function takes its category/slug/
// substitution behavior as a parameter from the caller, which owns the
// content-shape-specific knowledge.
//
// monster-feature-matching.js keeps everything genuinely about PARSING 5e
// monster stat-block prose (parseWeaponAttack, parseSaveEffect, Multiattack
// extraction, name genericizing) — only matching/dedup/tiering/options
// machinery lives here.

// Two bars for the two ways a name CAN relate without being identical (exact
// vs partial overlap); no name relation at all never qualifies regardless of
// description similarity.
export const NAME_MATCH_SIMILARITY_THRESHOLD = 0.25;
export const PARTIAL_NAME_MATCH_SIMILARITY_THRESHOLD = 0.5;

// Domain words common enough across nearly every trait/action/spell/item
// description that including them would wash out what actually distinguishes
// one mechanic from another — excluded like a search engine's stopwords.
export const STOPWORDS = new Set([
  "a", "an", "the", "of", "to", "and", "or", "its", "it", "is", "are", "this", "that", "with", "on", "in", "at",
  "as", "by", "if", "for", "from", "when", "while", "can", "must", "not", "no", "one", "target", "targets",
  "creature", "creatures", "damage", "each", "another", "instead", "must", "make", "makes",
  "melee", "ranged", "weapon", "spell", "attack", "hit", "reach",
]);

// A short, boilerplate-heavy one-liner only has a handful of significant
// tokens once the template is subtracted out — too few for a jaccard ratio
// to be trustworthy. Below this token count, the required threshold jumps
// to near-total agreement regardless of how closely the names relate.
export const MIN_SIGNIFICANT_TOKENS_FOR_LOOSE_MATCH = 8;
export const SHORT_TEXT_SIMILARITY_THRESHOLD = 0.85;

// Heavily-templated "roll against a number" boilerplate ("+N to hit", "DC N
// <ability> saving throw") pads a short ability's token count without
// actually distinguishing it from an unrelated one — forces the strict
// short-text threshold even when raw token count alone wouldn't.
export const TEMPLATED_MECHANICAL_TEXT_PATTERN = /\+\d+\s+to hit|\bDC\s*\d+\s+\w+\s+saving throw\b/i;

// Feature ids/display names are used as storage keys and labels — malformed
// source data can otherwise produce an id hundreds of characters long.
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
// before comparing — the one systematic per-record naming variation 5e
// source data carries (e.g. "Legendary Resistance (3/Day).").
export function normalizeName(name) {
  return String(name || "")
    .trim()
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\.+$/, "")
    .toLowerCase()
    .trim();
}

// Only strips trailing period(s) — keeps any "(N/Day)" count, since a
// freshly-created one-off feature is scoped to just this record and that
// count is genuinely useful.
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

// A generated shared-template id can coincidentally collide with an
// existing Feature from a different System or unrelated content category
// sharing the same `feature` Library kind. The caller's candidatePool
// already filters those out for MATCHING, but `dataManager.save` writes
// unconditionally by id, so a CREATE at a colliding id would silently
// overwrite unrelated content. `allowedCategories` is checked against the
// full unfiltered `existingFeatures`, not candidatePool, so it also catches
// a collision candidatePool already excluded from view.
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
  // Each bumped candidate slot needs the same reusability check the base id
  // got above — treating "already exists" alone as blocking fragments one
  // shared ability across several ids instead of reusing a good slot.
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
    // A bare number (attack bonus, dice count) is kept regardless of length
    // — real numbers shouldn't be filtered out as "too short" noise.
    // Alphabetic words still need length>2 to exclude stopword-shaped noise.
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

// True when two texts are identical once every digit run is masked out, but
// their actual digit runs differ — "the exact same sentence shape, with
// different numbers plugged in." Purely mechanical (no grammar guessing), so
// it only misfires on genuinely identical wording with different numbers —
// exactly the case findMatch's jaccard threshold can't reliably catch alone.
export function sameShapeDifferentNumbers(a, b) {
  const digitsA = (String(a || "").match(/\d+/g) || []).join(",");
  const digitsB = (String(b || "").match(/\d+/g) || []).join(",");
  if (digitsA === digitsB) return false;
  return String(a || "").replace(/\d+/g, " ") === String(b || "").replace(/\d+/g, " ");
}

// Best-scoring qualifying candidate as `{feature, tierId}` (tierId null
// unless the winning representation was a tier's own text), or null (create
// a new one-off feature instead). Scores a candidate's base description AND
// every `tiers` entry as separate representations, keeping whichever scores
// best — a tiered Feature's base text is deliberately generic/parameter-
// free, so comparing only against it would miss a re-import whose exact
// ability is already captured as a tier.
//
// `nameMatchThreshold` — overrides NAME_MATCH_SIMILARITY_THRESHOLD for an
// exact name match only. Default preserves lenient behavior Monster's
// callers rely on (SRD monster traits reuse identical text verbatim by
// convention, so an exact name match really does mean the same ability).
// content-feature-matching.js's Class/Species promotion passes a stricter
// override: D&D class features reuse names ("Spellcasting," "Channel
// Divinity") across classes for conceptually different mechanics, so the
// same assumption doesn't hold.
//
// `requireExactName` — when true, disables the `nameOverlaps` fallback
// entirely. Monster's callers leave this off (a partial overlap like
// "Legendary Resistance" vs "Legendary Resistance (3/Day)" legitimately
// signals the same ability there). content-feature-matching.js needs it on:
// D&D subclasses routinely name a later upgrade with an overlapping-but-
// different name ("Improved Critical" -> "Superior Critical"), and that
// upgrade's text is often short and near-identical to the base feature's —
// exactly the shape that crosses SHORT_TEXT_SIMILARITY_THRESHOLD despite
// being a deliberately different, stronger ability. Confirmed real data
// loss without this: Fighter Champion's own "Superior Critical" was
// silently swallowed into "Improved Critical" this way.
export function findMatch(trait, candidates, { nameMatchThreshold = NAME_MATCH_SIMILARITY_THRESHOLD, requireExactName = false } = {}) {
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
    const nameOverlaps = !requireExactName && !nameMatches && jaccardSimilarity(traitName, featureName) > 0;
    if (!nameMatches && !nameOverlaps) return; // names aren't close — never merge, regardless of description
    const representations = [{ tierId: null, text: feature.description || feature.mechanics?.text || "" }];
    if (Array.isArray(feature.tiers)) {
      feature.tiers.forEach((tier) => {
        if (tier?.mechanics?.text) representations.push({ tierId: tier.id, text: tier.mechanics.text });
      });
    }
    representations.forEach(({ tierId, text }) => {
      // Only guards the base description (tierId === null) — matching
      // against an existing tier's own text already requires it verbatim.
      // Same-shape-different-numbers is precisely what Tiers exist to
      // capture, never something to silently collapse onto one shared value.
      if (tierId === null && sameShapeDifferentNumbers(traitDescription, text)) return;
      const featureTokens = significantTokens(text);
      const similarity = jaccardFromTokens(traitTokens, featureTokens);
      // An exact name match always uses the name-match threshold, even for
      // short/templated text — sameShapeDifferentNumbers above is what
      // protects against a false merge on top of that, not a replacement for it.
      const requiredThreshold = nameMatches
        ? nameMatchThreshold
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

// Written generically for any "Base Name (N/Day)" or "Base Name (Recharge
// N[-6])" ability — a shared Feature carrying one of these suffixes
// represents a genuinely scaling ability, not a flavor variant. `[\d\-‐-―]`
// in the Recharge pattern tolerates any dash-like character a copy-pasted
// source might use (plain hyphen, en dash, em dash) — a plain ASCII `\-`
// alone missed a Unicode en dash and fragmented one shared ability across ids.
export const NAMED_TIER_PATTERNS = [
  { pattern: /\((\d+)\/Day\)\s*$/i, tierId: (m) => `${m[1]}-day`, shortName: (m) => `${m[1]}/Day` },
  { pattern: /\(Recharge\s*([\d‐-―\-]+)\)\s*$/i, tierId: (m) => `recharge-${m[1].replace(/[‐-―\-]/g, "to")}`, shortName: (m) => `Recharge ${m[1]}` },
];

// Strips the same trailing "(Recharge N-M)"/"(N/Day)" suffix
// NAMED_TIER_PATTERNS matches, but for computing a weapon-attack/save-effect
// shared TEMPLATE's id/slug — those branches match/create purely by name, so
// without this a record whose source keeps the frequency suffix in the name
// would never collapse into the same template as one whose source dropped it.
export function baseAbilityName(name) {
  let stripped = String(name || "");
  for (const { pattern } of NAMED_TIER_PATTERNS) stripped = stripped.replace(pattern, "");
  return stripped.trim() || name;
}

// Only ever called once findMatch has already found a same-mechanic match —
// never changes WHETHER something matches, only what happens once it has:
// the frequency difference is recorded as a tier on the one shared Feature
// rather than discarded or spawning a separate one-off. Returns the tier id
// to record on the caller's record.featureTiers, or null if no recognized suffix.
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
// resolves into one of several named sub-effects, listed as separate
// {name, desc} entries in the raw source" (e.g. "...or suffer one random
// poison effect:" followed by numbered entries). Deliberately not a loose
// "ends with a colon" heuristic — that would risk swallowing a genuinely
// unrelated next ability whenever a source ends a sentence with one.
export const CHOICE_LEAD_IN_PATTERN = /(?:suffer one random [\w\s]+ effect|one of the following effects occurs(?:,\s*determined by [^:.]+)?)\s*:?\s*$/i;
export const NUMBERED_SUB_EFFECT_NAME_PATTERN = /^(\d+)\.\s*(.+?):?\s*$/;

// Detects the multi-entry choice shape above, starting at
// `entries[startIndex]`. Returns `{consumedCount, options: [{name, text}]}`
// — `consumedCount` is how many following entries were absorbed as this
// ability's own `options` (the caller skips past them) — or `null` when this
// isn't a choice lead-in, or fewer than 2 sub-effects follow (never guess,
// never partially match). `isIndependentAbility(description)` tells this
// where a plain-named list (no numbering) stops; a numbered list keeps
// consuming as long as the numbering stays sequential, an unambiguous,
// self-terminating signal that doesn't need this check.
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

// The other real choice shape: one entry's own multi-paragraph text (e.g.
// "...uses one of the following breath weapons.\nFire Breath. ...") rather
// than split across separate {name, desc} entries. Anchored on literal
// embedded newlines so an ordinary single-paragraph entry never matches. A
// single non-conforming line anywhere in the tail bails the whole split
// (never a wrong partial structure), same discipline as detectChoiceEffectGroup.
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

// A third real choice shape, distinct from the numbered/embedded-newline
// ones above: a literal markdown table of randomized outcomes (a magic
// item's "roll a d100, consult this table" content — the 5e API gives Wand
// of Wonder/Deck of Many Things as `| d100 | Effect |` rows, not prose).
// Detected purely structurally (2+ consecutive `|...|` lines with a header
// and `|---|...` separator) — no lead-in phrase needed. Each data row
// becomes one option: first column is the name/roll range, remaining
// columns join into the text. Exported so a caller can also recognize a
// bare table row/separator line on its own (vault-feature-matching.js's
// residual-clause path uses this to avoid minting a Feature from an
// isolated stat-block table fragment).
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

  // A table is a contiguous run of `|...|` lines — find the longest run
  // rather than assuming the whole text is the table (usually preceded by
  // ordinary prose describing the ability itself).
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

  // Everything before the table's first line is the ability's real intro/
  // mechanical text (charges, DC, trigger) — joined back rather than lost.
  const intro = lines
    .slice(0, bestStart)
    .filter(Boolean)
    .join("\n")
    .trim();
  return { intro, options, header };
}

// Shared by detectChoiceEffectGroup's and splitEmbeddedEffectOptions' call
// sites: creates (or, on re-import, refreshes) the one Feature representing
// a choice-effect trait, always a record-specific one-off
// (`feat.<recordSlug>-<trait-slug>`, never shared across records) with
// `mechanics.scope: "unique"` and `options` populated. `ctx.substitute(text)`
// is the caller's name-genericizing step, applied to the intro and every
// option's text. Returns the saved Feature's id.
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
