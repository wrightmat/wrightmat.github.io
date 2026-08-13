// Turns an imported monster's flat `stats.traits`/`actions`/`bonusActions`/
// `reactions`/`legendaryActions`/`lairActions` (the one canonical shape both
// the DDB and Fantasy Statblocks mappings already converge on — each entry
// `{name, description}`) into real `feature` Library references, so an
// imported monster ends up structurally identical to a Crucible-generated
// one: `isImportedStatBlock` (crucible/js/app.js) keys off `featureIds`
// being a real array, and once that's true every existing Crucible code
// path (Add Feature select, Features list, budget/cost display) just works
// with zero special-casing — this module's only job is producing that one
// array, not teaching Crucible anything new about how to render it.
//
// Two call sites share this exact function, both automatic-on-save — no
// manual/backfill button anywhere in this suite (deliberately cut): Loom's
// own saveEntity, and Crucible's own handleSave (crucible/js/app.js) calls
// it directly too, since Crucible's save path bypasses saveEntity entirely
// (it writes straight to dataManager.save). Either way, every monster save
// gets this unconditionally, not as an opt-in extra step — "every import
// should align with internal data standards" per explicit product
// direction, not a toggle. Idempotent by construction (hasConvertibleStatBlock
// below returns false once a monster has nothing left to convert), so it's
// safe to call on every save rather than gating on "is this the first
// save" — this is also what repairs a monster imported before this module
// existed, the next time it's opened and saved.

const ABILITY_GROUP_KEYS = ["traits", "actions", "bonusActions", "reactions", "legendaryActions", "lairActions"];

// Which `combat.actionCost` value a Feature created/matched from each
// ability group should carry — same vocabulary Crucible's own
// generator uses for `actions` (crucible/js/lib/stats.js), extended here to
// cover legendary/lair actions (a concept native generation has no
// equivalent for yet, so these two values are new). "traits" has no entry
// at all — a trait is passive, not action-economy-costed, same convention
// native generation's own traits-less output already implies.
const ACTION_COST_BY_GROUP_KEY = {
  actions: "action",
  bonusActions: "bonus-action",
  reactions: "reaction",
  legendaryActions: "legendary-action",
  lairActions: "lair-action",
};

// A trait/action name recurs across many creatures far more often than its
// exact mechanic does (5e's own templated writing conventions) — but not
// always (a monster's "Frenzied Rage" and another's happen to share a name
// while doing genuinely different things). So matching leans on BOTH
// signals, and name is now a real GATE, not just a threshold-lowering
// nicety: two mechanics whose names share nothing in common ("Slam" vs
// "Tail") never collapse together no matter how similar their generic
// attack-roll boilerplate reads — confirmed live: this is exactly how Air
// Elemental's own "Slam" false-matched Adult Black Dragon's unrelated
// "Tail" before this fix (see findMatch below). Two bars for the two ways
// a name CAN relate without being identical:
//  - exact name match — a low bar is enough (5e's own templated writing
//    repeats a name far more reliably than its exact mechanic — e.g.
//    "Legendary Resistance (3/Day)." vs another creature's "(2/Day).").
//  - partial name overlap (shares at least one significant word — e.g.
//    "Fire Breath"/"Poison Breath" both containing "breath") — needs a
//    meaningfully closer description match to still count, since sharing
//    one generic word alone is weak evidence (confirmed live: this
//    exact pair, before the numeric-token fix in significantTokens below,
//    scored high enough on shared breath-weapon boilerplate to wrongly
//    match Adult Red Dragon's Fire Breath to Adult Green Dragon's own
//    Poison Breath Feature).
// No name relation at all never qualifies, full stop — regardless of
// description similarity.
const NAME_MATCH_SIMILARITY_THRESHOLD = 0.25;
const PARTIAL_NAME_MATCH_SIMILARITY_THRESHOLD = 0.5;

// Domain words common enough across nearly every monster trait/action
// (creature, damage, target, ...) that including them in the similarity
// score would wash out what actually distinguishes one mechanic from
// another — excluded the same way a search engine excludes stopwords.
// The attack-roll boilerplate ("Melee Weapon Attack: +N to hit, reach N
// ft., one target.") is the single biggest offender: two entirely
// different creatures' simple weapon attacks share nearly every word of
// that template, so without excluding it, a short attack description's
// jaccard score is dominated by boilerplate rather than by what actually
// differs (damage type, dice, any rider effect) — confirmed live: 5e API's
// Acolyte "Club" (bludgeoning) false-matched Aboleth's unrelated "Tail"
// (also bludgeoning) at 0.75 similarity purely on melee/weapon/attack/hit/
// reach overlap, wiping out Club's own Feature and its damage entirely.
const STOPWORDS = new Set([
  "a", "an", "the", "of", "to", "and", "or", "its", "it", "is", "are", "this", "that", "with", "on", "in", "at",
  "as", "by", "if", "for", "from", "when", "while", "can", "must", "not", "no", "one", "target", "targets",
  "creature", "creatures", "damage", "each", "another", "instead", "must", "make", "makes",
  "melee", "ranged", "weapon", "spell", "attack", "hit", "reach",
]);

// Descriptors too generic/common to safely stand in as "this refers to the
// monster" on their own (age/size adjectives, common-word overlaps with
// real ability vocabulary) — excluded even when they're one of a monster's
// own name words. The full name is always tried first regardless.
const GENERIC_NAME_WORDS = new Set(["adult", "young", "greater", "lesser", "giant", "the", "of", "and", "a", "an"]);

// Ported from this session's Python migration script (undercroft/README.md
// — the same technique used to clean up ~300 imported monsters' Feature
// text without the corruption a sentence-structure-guessing regex caused).
// Only ever substitutes a VERIFIED reference to THIS monster's own name
// (its full name, or an individual word over 3 characters, minus common
// age/size descriptors), always preceded by an article — never guesses at
// sentence structure, so unlike that earlier regex it can't eat into
// unrelated later text no matter how the sentence is built. Case-insensitive
// (the Python original wasn't, and silently missed lowercase common-noun
// references like "the demon" for Shadow Demon — confirmed live during
// this session's Shadow Stealth cleanup) while still preserving the actual
// matched article's own case for the output.
// Applied to every trait's description before matching AND when storing a
// newly-created one-off Feature — so a freshly-imported ability starts out
// already generic instead of baking this one monster's name into shared
// Library content, which is exactly what caused this whole cleanup pass to
// be necessary in the first place.
// This module briefly tried a combat-language-detected "the attacker"
// fallback for a "the creature" collision (Frightful Presence, a breath
// weapon), on the theory that a plain noun would misread for a genuinely
// combat-shaped ability. Reverted — "attacker" turned out to be its own
// source of wrong/awkward text just as often: a breath weapon's own
// "the attacker exhales..." reads oddly (exhaling isn't really an
// "attack"), and worse, Gem Stalker's own Protective Link ("...the
// attacker reduces that damage by 10, the attacker then takes damage
// equal to that amount") is flatly WRONG — the gem stalker is the
// PROTECTOR in that ability, not an attacker at all. The monster's own
// creature type reads correctly in every case checked (an attack, a
// breath weapon, telepathy, a protective reaction) since it's just an
// ordinary noun, not a role-specific one.

function knownNameSubstitute(text, monsterName, creatureType) {
  const raw = String(text || "");
  const name = String(monsterName || "").trim();
  if (!name) return raw;
  const words = name.split(/\s+/).filter(Boolean);
  const seen = new Set([name.toLowerCase()]);
  const candidates = [name];
  // Contiguous multi-word slices, longest first — a colloquial partial
  // reference to a multi-word name ("the deep one" for "Deep One
  // Archimandrite", "the dragon turtle" for "Dragon Turtle Wyrmling") needs
  // to be recognized as a WHOLE phrase, not word-by-word. Confirmed live:
  // without this, only the FIRST word of such a reference matched, leaving
  // the rest dangling as broken trailing text ("The creature turtle can
  // breathe air and water." / "a creature one can breathe..."). Listed
  // before the single-word candidates below so the regex alternation (which
  // tries options in listed order, first-match-wins per position) prefers
  // the longer slice over a shorter one that would also match at the same
  // position. Not filtered by GENERIC_NAME_WORDS — that check exists to
  // keep a single bare generic word ("giant") from matching alone, but a
  // generic word AS PART OF a genuine multi-word slice ("Adult Black" in
  // "Adult Black Dragon") is still unambiguously a reference to this one
  // monster, since the whole slice must be a real contiguous substring of
  // its actual name.
  for (let len = words.length - 1; len >= 2; len--) {
    for (let start = 0; start + len <= words.length; start++) {
      const slice = words.slice(start, start + len).join(" ");
      const lower = slice.toLowerCase();
      if (!seen.has(lower)) {
        candidates.push(slice);
        seen.add(lower);
      }
    }
  }
  [...words]
    .sort((a, b) => b.length - a.length)
    .forEach((word) => {
      const lower = word.toLowerCase();
      if (word.length > 3 && !GENERIC_NAME_WORDS.has(lower) && !seen.has(lower)) {
        candidates.push(word);
        seen.add(lower);
      }
    });
  const alternation = candidates.map((candidate) => candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const pattern = new RegExp(`\\b(The|the|A|a|An|an)\\s+(?:${alternation})(['’]s)?\\b`, "gi");
  // A real 5e trait's own text almost always ALSO uses "creature" as a
  // plain common noun for its TARGETS ("each creature within 120 feet...",
  // "a creature can repeat the saving throw...") alongside the monster's
  // own self-reference by name ("the dragon", "the aboleth") that this
  // function is about to genericize. Substituting the self-reference with
  // the SAME word ("the creature") then collides with those pre-existing
  // target-references — confirmed live: Adult Black Dragon's own Frightful
  // Presence ("Each creature of the dragon's choice... immune to the
  // dragon's Frightful Presence...") became "Each creature of the
  // creature's choice... immune to the creature's Frightful Presence...",
  // and Aboleth's own Probing Telepathy ("...the aboleth learns the
  // creature's greatest desires if the aboleth can see the creature")
  // became an unreadable "...the creature learns the creature's greatest
  // desires if the creature can see the creature" — "creature" now means
  // two different things in the same sentence. Falls back to this
  // monster's own creature type once a collision is detected — a plain
  // noun, so it reads correctly regardless of what the ability actually
  // does (see the module note above this function for why "the attacker"
  // was tried and reverted). A missing/unknown creatureType falls back to
  // "attacker" as an imperfect last resort — this should be rare in
  // practice (every real monster record carries its own `type`), and
  // imperfect wording still beats the original collision bug.
  const genericWord = /\bcreatures?\b/i.test(raw) ? creatureType || "attacker" : "creature";
  const indefiniteArticle = /^[aeiou]/i.test(genericWord) ? "an" : "a";
  return raw.replace(pattern, (whole, article, possessive) => {
    let word;
    if (article.toLowerCase() === "the") {
      word = article[0] === "T" ? "The" : "the";
    } else {
      word = article[0] === "A" ? indefiniteArticle.charAt(0).toUpperCase() + indefiniteArticle.slice(1) : indefiniteArticle;
    }
    return `${word} ${genericWord}${possessive || ""}`;
  });
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Strips a trailing "(N/Day)"-style frequency count and trailing period(s)
// before comparing — the one systematic per-creature variation 5e's own
// templated trait names carry (e.g. "Legendary Resistance (3/Day).").
function normalizeName(name) {
  return String(name || "")
    .trim()
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\.+$/, "")
    .toLowerCase()
    .trim();
}

// Only strips the trailing period(s) DDB/Fantasy-Statblocks source data
// tends to carry on a trait name — keeps the "(N/Day)" count, since a
// freshly-created one-off feature is scoped to just this one monster and
// that count is genuinely useful, faithful detail on a name that was never
// going to generalize anyway.
function displayName(name) {
  return String(name || "").trim().replace(/\.+$/, "");
}

// Feature ids and display names are used as filesystem-adjacent storage
// keys (dataManager.save writes a file keyed by id) and shown as labels —
// an unbounded trait.name (malformed source data, e.g. a statblock file
// whose YAML `name:` field somehow ended up holding an entire ability's
// full paragraph instead of a short label — this isn't hypothetical:
// confirmed live, an Isonade import's own "Swallow" trait had its whole
// multi-sentence description sitting in `name`) can otherwise produce an
// id hundreds of characters long. That id then fails to save, and — since
// nothing here used to catch a per-trait failure — the resulting exception
// propagated all the way up and aborted the ENTIRE monster's conversion,
// silently taking the whole import down with it (the monster record itself
// was never saved, with no error surfaced anywhere). Capped independently
// of validating trait.name's CONTENT — this is defense-in-depth against
// any future malformed source, not an attempt to detect or repair it; see
// the try/catch around each trait's own processing below for the other
// half of that fix (one bad trait can no longer take the whole monster
// down, regardless of why it failed).
const MAX_SLUG_LENGTH = 60;
const MAX_DISPLAY_NAME_LENGTH = 100;

// Deterministic, not for security — just enough entropy that two
// different overlong names sharing their first MAX_SLUG_LENGTH characters
// don't collide into the same id after truncation.
function shortHash(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function cappedSlug(name) {
  const slug = slugify(name);
  if (slug.length <= MAX_SLUG_LENGTH) return slug;
  return `${slug.slice(0, MAX_SLUG_LENGTH)}-${shortHash(slug)}`;
}

function cappedDisplayName(name) {
  const display = displayName(name);
  if (display.length <= MAX_DISPLAY_NAME_LENGTH) return display;
  return `${display.slice(0, MAX_DISPLAY_NAME_LENGTH - 1).trimEnd()}…`;
}

// A generated shared-template id (`feat.<slug(name)>` — parseWeaponAttack's
// feat.bite/feat.claw convention, extended to parseSaveEffect's own breath-
// weapon templates too) can coincidentally collide with an EXISTING Feature
// that isn't actually a valid match for this monster-category pool at
// all — a different System, or (confirmed live: "Fire Breath" is also the
// name of a real Vault spell/item Feature, `feat.fire-breath`, sharing this
// same `feature` Library kind under a completely different category) a
// totally unrelated kind of content that just happens to slugify to the
// same id. The caller's own `candidatePool` already filters those out for
// MATCHING purposes, but that filtering does nothing to protect a CREATE —
// `dataManager.save` writes unconditionally by id, so creating a new
// monster-category template at a colliding id would silently overwrite
// that unrelated Feature's own content instead of coexisting with it.
// Checked against the FULL unfiltered `existingFeatures` (not
// candidatePool) specifically so it also catches a collision candidatePool
// itself already excluded from view.
function isReusableTemplateCandidate(feature) {
  const categories = feature.tags?.categories;
  return !Array.isArray(categories) || !categories.length || categories.includes("monster");
}
function resolveTemplateId(baseId, existingFeatures) {
  const pool = existingFeatures || [];
  const collision = pool.find((feature) => feature.id === baseId);
  if (!collision || isReusableTemplateCandidate(collision)) return baseId;
  let suffix = 2;
  let candidateId = `${baseId}-monster`;
  // Each bumped candidate slot needs the SAME reusability check the base id
  // just got above it — not just "is this id already taken". Confirmed
  // live: Adult Red Dragon's own "Fire Breath" collided with an unrelated
  // pre-existing feat.fire-breath (a single-target spell-like Feature, not
  // monster-category), correctly bumped to feat.fire-breath-monster — but
  // that candidate was ALREADY a perfectly good, reusable monster-category
  // save-effect template (created by an earlier import), and the old loop
  // treated "already exists" alone as blocking, bumping straight past it to
  // feat.fire-breath-monster-2 instead of reusing it. Ancient Red Dragon
  // then repeated the same mistake against -2, landing on -3 — three
  // dragons with the literal same ability name fragmented across three
  // different ids instead of sharing one.
  let occupant = pool.find((feature) => feature.id === candidateId);
  while (occupant && !isReusableTemplateCandidate(occupant)) {
    candidateId = `${baseId}-monster-${suffix}`;
    suffix += 1;
    occupant = pool.find((feature) => feature.id === candidateId);
  }
  return candidateId;
}

function significantTokens(text) {
  const words = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    // A bare number (attack bonus, total damage, reach in feet, a dice
    // count like "2d8") is kept regardless of length — confirmed live: Air
    // Elemental's own "Slam" ("+8 to hit, reach 5 ft., ... 14 (2d8 + 5)
    // bludgeoning") false-matched Adult Black Dragon's unrelated "Tail"
    // (+11/reach 15/15 (2d8 + 6) bludgeoning) at a coincidentally-identical
    // "2d8" — the length>2 filter below was stripping every other
    // differentiating number (8, 5, 14, 11, 15, 6) as noise, leaving only
    // the boilerplate word overlap plus one coincidentally-shared dice
    // notation to compare against. Alphabetic words still need length>2 to
    // exclude real stopword-shaped noise ("to", "by", "if", ...).
    .filter((word) => (word.length > 2 || /^\d+$/.test(word)) && !STOPWORDS.has(word));
  return new Set(words);
}

function jaccardFromTokens(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  a.forEach((word) => {
    if (b.has(word)) intersection += 1;
  });
  const union = a.size + b.size - intersection;
  return union ? intersection / union : 0;
}

function jaccardSimilarity(textA, textB) {
  return jaccardFromTokens(significantTokens(textA), significantTokens(textB));
}

// A short, boilerplate-heavy simple-attack one-liner ("Melee Weapon
// Attack: +N to hit, reach N ft., one target. Hit: N (NdN) TYPE damage.")
// only ever has a handful of significant tokens once the template itself
// is subtracted out — too few for a jaccard ratio to be trustworthy at
// either the exact-name or partial-name bar below, since one or two
// coincidentally-shared tokens (a matching damage type, or the same dice
// notation two differently-sized creatures happen to both roll) can carry
// a disproportionate share of a tiny set. Confirmed live, twice, even
// after the numeric-token fix above: Deep One Priest's "Claws" (+6/2d6+4
// slashing) false-matched Adult Black Dragon's unrelated "Tail", and
// separately a hand-authored "Claws" false-matched a DIFFERENT creature's
// "Claws" despite meaningfully different to-hit/damage numbers — same
// exact name, same dice, still NOT the same mechanic. Below this token
// count, on either side, the required threshold jumps to near-total
// agreement regardless of how closely the names relate.
const MIN_SIGNIFICANT_TOKENS_FOR_LOOSE_MATCH = 8;
const SHORT_TEXT_SIMILARITY_THRESHOLD = 0.85;

// 5e's own writing is heavily templated around a "roll against a number"
// clause — a weapon attack's "+N to hit" or an area/save effect's "DC N
// <ability> saving throw" — and everything around that clause (reach/
// range, "one target", "Hit:", "taking N (dice) TYPE damage on a failed
// save, or half as much damage on a successful one", ...) is boilerplate
// shared near-verbatim across completely unrelated monsters. That
// boilerplate alone is often enough significant-token PADDING to push a
// short ability's token count past MIN_SIGNIFICANT_TOKENS_FOR_LOOSE_MATCH,
// even though almost none of the padding is genuinely distinguishing — the
// one or two tokens that actually matter (a damage TYPE word, an ability
// score name, a DC number) are just a couple words among many, so a
// jaccard score built mostly from shared boilerplate barely notices when
// they're wrong. Confirmed live TWICE, re-importing the adult chromatic
// dragons through the 5e API: Bite (a to-hit weapon attack with an
// elemental rider — parseWeaponAttack's own end-anchored pattern
// deliberately declines to structure this, see its own comment, leaving it
// to findMatch) false-matched across completely different damage types
// (Blue Dragon's own lightning-rider Bite matched Dragon Eel's unrelated
// one, Red Dragon's matched Young Topaz Dragon's, Green/White Dragon's
// both matched Black Dragon's own acid-rider Bite); separately, Breath (a
// DC-based area save, a totally different boilerplate shape with no "to
// hit" at all) false-matched the same way across different elements
// (Blue Dragon's own breath matched Black Dragon's acid one; Red Dragon's
// matched Green Dragon's poison one; White Dragon's matched an unrelated
// monster's necrotic one). A bare presence check, not a full structural
// match like parseWeaponAttack's own pattern — deliberately broad (also
// catches e.g. Frightful Presence's "DC N Wisdom saving throw", which
// SHOULD vary by a dragon's own Charisma but was found collapsed onto one
// shared DC too) since forcing the strict threshold is the safe direction
// to err in a false positive here: the cost is just a missed auto-merge
// opportunity (an already-common, already-tolerated outcome throughout
// this session's own consolidation work), never a wrong one.
const TEMPLATED_MECHANICAL_TEXT_PATTERN = /\+\d+\s+to hit|\bDC\s*\d+\s+\w+\s+saving throw\b/i;

// True when two texts are IDENTICAL once every digit run is masked out, but
// their actual digit runs (in order) differ — i.e. "the exact same sentence
// shape, with different numbers plugged in." A purely mechanical check (no
// grammar/sentence-structure guessing, same safety property
// knownNameSubstitute's own multi-word-slice matching already relies on),
// so it can't misfire on genuinely different wording — only on genuinely
// identical wording with different numbers, which is exactly the case
// findMatch's own jaccard threshold can't reliably catch (see its call
// site's own comment).
function sameShapeDifferentNumbers(a, b) {
  const digitsA = (String(a || "").match(/\d+/g) || []).join(",");
  const digitsB = (String(b || "").match(/\d+/g) || []).join(",");
  if (digitsA === digitsB) return false;
  return String(a || "").replace(/\d+/g, " ") === String(b || "").replace(/\d+/g, " ");
}

// Best-scoring qualifying candidate as `{feature, tierId}` (tierId null
// unless the winning representation was a tier's own text), or null
// (meaning: create a new one-off feature for this trait instead).
//
// Scores a candidate's own base description AND every one of its `tiers`
// (when present) as separate representations, keeping whichever one scores
// best — not just the base description. A tiered Feature's base text is
// deliberately generic/parameter-free (e.g. Teleport's "a short distance"),
// so it reads nothing like any specific monster's own numbers; comparing
// only against it would make a re-imported monster whose exact ability is
// already captured as a tier (same wording, once name-substituted) fail to
// match at all and spawn a fresh duplicate — confirmed live: Arcanaloth's
// own "up to 60 feet" Teleport scores far below either match threshold
// against feat.teleport's generic base text alone, but scores ~1.0 against
// that Feature's own "60-ft" tier text, since that tier's text IS this
// exact monster's own original wording (name-substituted) already.
function findMatch(trait, candidates) {
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
    // jaccardSimilarity already tokenizes+dedups via significantTokens —
    // reused as-is on the (short) names rather than a second bespoke
    // name-overlap function.
    const nameOverlaps = !nameMatches && jaccardSimilarity(traitName, featureName) > 0;
    if (!nameMatches && !nameOverlaps) return; // names aren't even close — never merge, regardless of description
    const representations = [{ tierId: null, text: feature.description || feature.mechanics?.text || "" }];
    if (Array.isArray(feature.tiers)) {
      feature.tiers.forEach((tier) => {
        if (tier?.mechanics?.text) representations.push({ tierId: tier.id, text: tier.mechanics.text });
      });
    }
    representations.forEach(({ tierId, text }) => {
      // A long-enough paragraph differing from a candidate's BASE
      // description in nothing but its embedded numbers can clear even the
      // strict SHORT_TEXT threshold above, since jaccard similarity barely
      // notices one differing token out of twenty-plus shared ones —
      // confirmed live: Frightful Presence's own DC (which should vary by
      // each dragon's own Charisma) scores ~0.93 similar to a differently-
      // worded dragon's identical-except-DC text, comfortably above 0.85.
      // That's precisely the shape Tiers exist to capture (same mechanic, a
      // real differing parameter — Teleport's distance, Legendary
      // Resistance's frequency), never something safe to silently collapse
      // onto one shared value. Only guards the BASE description
      // (tierId === null) — matching against an EXISTING tier's own text
      // already requires it, verbatim; this never blocks that.
      if (tierId === null && sameShapeDifferentNumbers(traitDescription, text)) return;
      const featureTokens = significantTokens(text);
      const similarity = jaccardFromTokens(traitTokens, featureTokens);
      // An EXACT name match always uses the lenient threshold, even for
      // short/templated text — confirmed live: Amphibious ("The creature
      // can breathe air and water.") only has 3-4 significant tokens after
      // stopword-filtering, so it used to hit the strict 0.85 short-text
      // bar below; one source's extra filler word ("...can breathe BOTH
      // air and water") dropped its similarity to 0.75, just under that
      // bar, and two monsters' plainly-identical Amphibious traits stayed
      // split as separate Features. The strict short-text bar exists to
      // protect the WEAK-evidence case (partial/no name match, so content
      // similarity is the only signal) — once the name has already
      // confirmed a match, `sameShapeDifferentNumbers` above is what
      // actually protects against a false merge (two same-named abilities
      // with genuinely different numbers), not this threshold on top of
      // it. Short/templated text without an exact name match still needs
      // the strict bar — that's the genuinely risky combination (weak name
      // signal AND weak content signal).
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

const COUNT_WORD_VALUES = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
const COUNT_WORDS_BY_VALUE = Object.fromEntries(Object.entries(COUNT_WORD_VALUES).map(([word, value]) => [value, word]));

// Looks up a raw attack-name capture ("Radiant Pellet", "bite") against this
// monster's own already-resolved attack Features, tolerating a trailing "s"
// either way (singular/plural mismatch between the Multiattack sentence's
// own phrasing and the trait's own authored name) — factored out since every
// extraction pattern below needs the exact same fallback chain.
function resolveAttackFeatureId(rawName, nameToFeatureId) {
  const name = rawName.trim().toLowerCase();
  return nameToFeatureId.get(name) || nameToFeatureId.get(name.replace(/s$/, "")) || nameToFeatureId.get(`${name}s`);
}

// A real stat block sometimes elides the repeated trailing "attack(s)" noun
// across an AND-list ("one bite and one gore attack" meaning "one bite
// ATTACK and one gore attack" — confirmed live, Bukavac's own Multiattack)
// — the general patterns below require EVERY item to carry its own trailing
// "attack(s)"/"with its", so this elliptical 2-item shape would otherwise
// silently swallow "bite and one gore" as one unresolvable name and fail the
// whole segment. Anchored end-to-end (same safe-fallback discipline as
// parseWeaponAttack/parseSaveEffect) so it only ever fires on exactly this
// shape, never partially matches something else.
const ELIDED_TRAILING_NOUN_PAIR_PATTERN =
  /^(one|two|three|four|five|six|seven|eight)\s+([a-z][a-z '’-]*?)\s+and\s+(one|two|three|four|five|six|seven|eight)\s+([a-z][a-z '’-]*?)\s+attacks?\.?$/i;

// Runs the two 5e attack-reference phrasings ("one with its bite" / "two
// Radiant Pellet attacks") against a single segment of Multiattack text —
// factored out of extractMultiattackReferences so the SAME per-segment logic
// can run once for a fixed-combination trait's WHOLE text, or independently
// per option when the trait reads as a choice (see below). Returns null
// (never a wrong-but-plausible partial list) when nothing at all matched.
function extractAttacksFromSegment(segment, nameToFeatureId) {
  const elided = segment.trim().match(ELIDED_TRAILING_NOUN_PAIR_PATTERN);
  if (elided) {
    const firstCount = COUNT_WORD_VALUES[elided[1].toLowerCase()];
    const firstId = resolveAttackFeatureId(elided[2], nameToFeatureId);
    const secondCount = COUNT_WORD_VALUES[elided[3].toLowerCase()];
    const secondId = resolveAttackFeatureId(elided[4], nameToFeatureId);
    if (firstCount && firstId && secondCount && secondId && firstId !== secondId) {
      return [
        { featureId: firstId, count: firstCount },
        { featureId: secondId, count: secondCount },
      ];
    }
  }

  const attacks = [];
  const seen = new Set();
  const patterns = [
    /\b(one|two|three|four|five|six|seven|eight)\s+with\s+its\s+([a-z][a-z '’-]*?)(?=\s*(?:,|\.|and\b|$))/gi,
    /\b(one|two|three|four|five|six|seven|eight)\s+([a-z][a-z '’-]*?)\s+attacks?\b/gi,
  ];
  patterns.forEach((pattern) => {
    let match = pattern.exec(segment);
    while (match) {
      const count = COUNT_WORD_VALUES[match[1].toLowerCase()];
      const featureId = resolveAttackFeatureId(match[2], nameToFeatureId);
      if (count && featureId && !seen.has(featureId)) {
        seen.add(featureId);
        attacks.push({ featureId, count });
      }
      match = pattern.exec(segment);
    }
  });
  return attacks.length ? attacks : null;
}

// Splits a Multiattack's text on top-level "or" boundaries ("two Branch
// attacks, two Radiant Pellet attacks, or one of each" → 3 segments) —
// "either" is a discourse marker paired with "or", not content, so it's
// stripped rather than treated as its own boundary.
// A bare comma (not immediately before "or") is ALSO a valid option
// boundary — but ONLY when the text never uses "and" anywhere. Real 5e
// Oxford-comma phrasing ("two Branch attacks, two Radiant Pellet attacks,
// or one of each") lists 3+ PEER alternatives this way, "or" appearing
// only before the last one — confirmed live: without this, "two Branch
// attacks, two Radiant Pellet attacks" was mis-parsed as ONE option worth
// 4 attacks (both mentions found by the same segment's own general pattern
// loop) instead of two SEPARATE 2-attack alternatives, a genuine semantic
// bug (not just a wording difference — Aartuk Elder never has an option
// where it makes both Branch AND Radiant Pellet attacks together). Gated
// on the ABSENCE of "and" specifically because "and" is the one word every
// real AND-combo option (Bukavac's own "two Claw attacks and one Bite
// attack") uses to bind its own items together — if "and" appears
// anywhere in the text, a bare comma might legitimately be part of an
// Oxford-comma AND-list WITHIN one option (e.g. "one Claw, one Bite, and
// one Tail attack"), so this falls back to the more conservative
// comma-only-directly-before-or behavior instead. Verified against every
// real Multiattack trait across the whole imported monster set: this
// changes ONLY Aartuk Elder's own parse (correctly, from 2 options to 3);
// every other already-structured or already-text-only case is unaffected.
const CONSERVATIVE_OPTION_SPLIT_PATTERN = /,?\s*\bor\b\s*/i;
const AGGRESSIVE_OPTION_SPLIT_PATTERN = /\s*,\s*(?:or\s+)?|\s+or\s+/i;

function splitTopLevelOptions(text) {
  const cleaned = text.replace(/\beither\b/gi, "");
  const pattern = /\band\b/i.test(cleaned) ? CONSERVATIVE_OPTION_SPLIT_PATTERN : AGGRESSIVE_OPTION_SPLIT_PATTERN;
  return cleaned
    .split(pattern)
    .map((part) => part.trim())
    .filter(Boolean);
}

// A segment that's just "one of each" (Aartuk Elder's own third option)
// doesn't name any attack itself — it refers back to the OTHER options
// already parsed. Resolved as a post-pass in extractMultiattackReferences
// below, once every other segment's own attacks are known.
const EACH_OF_PREVIOUS_OPTIONS_PATTERN = /^(?:one|1)\s+of\s+each\.?$/i;

// A second elliptical shape, this time at the WHOLE-text level rather than
// per-segment: "two Stab or Spike attacks" (Adult Kruthik's own Multiattack)
// means "two attacks, each a Stab or a Spike" — the count and trailing
// "attacks" noun are shared across BOTH names rather than repeated, so the
// generic split-on-"or"-then-parse-each-segment path below would produce two
// segments ("...two Stab", "Spike attacks") neither of which parses on its
// own. Anchored to the FULL text (not just a segment) specifically so it
// never partially matches a longer sentence with real extra content after it
// (confirmed live: Autumn Eladrin's own "two Longsword or Longbow attacks.
// It can replace one attack with a use of Spellcasting." must NOT match this
// — the second sentence changes what the ability actually does, so silently
// representing it as just a Longsword-or-Longbow choice would misrepresent
// it, the same "never guess" concern driving every other end-anchored
// pattern in this file).
const SHARED_SUFFIX_CHOICE_PATTERN =
  /^The creature makes (one|two|three|four|five|six|seven|eight)\s+([a-z][a-z '’-]*?)\s+or\s+([a-z][a-z '’-]*?)\s+attacks?\.?$/i;

// Parses a Multiattack trait's own free text ("The aalpamac makes three
// attacks: one with its bite and two with its claws.") into structured
// `{featureId, count}` references against this SAME monster's own
// already-resolved attack Features (nameToFeatureId, built up over the main
// convertStatBlockToFeatures loop) — the reference-based data
// buildMultiattackParams actually stores. Two return shapes:
// - a flat `{featureId, count}[]` for a fixed combination (no real choice).
// - `{options: Array<{featureId,count}[]>}` for a genuine CHOICE ("two X,
//   two Y, or one of each") — an "or"/"either" cue means summing every
//   mentioned count would misrepresent the ability (confirmed live: Aartuk
//   Elder's own "two Branch attacks, two Radiant Pellet attacks, or one of
//   each" is not "four attacks always"). Each top-level "or" segment is
//   parsed independently (extractAttacksFromSegment) — if ANY segment fails
//   to parse (a genuinely nested/conditional phrasing like Autumn Eladrin's
//   own "...replace one attack with a use of Spellcasting"), this returns
//   null for the WHOLE trait rather than a wrong partial structure, same
//   "never guess" contract extractAttacksFromSegment itself already follows.
// The caller always keeps the original text as a fallback either way, so a
// null return here never loses information — it just means Crucible renders
// the stored text instead of computing it.
function extractMultiattackReferences(text, nameToFeatureId) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const sharedSuffix = raw.match(SHARED_SUFFIX_CHOICE_PATTERN);
  if (sharedSuffix) {
    const count = COUNT_WORD_VALUES[sharedSuffix[1].toLowerCase()];
    const firstId = resolveAttackFeatureId(sharedSuffix[2], nameToFeatureId);
    const secondId = resolveAttackFeatureId(sharedSuffix[3], nameToFeatureId);
    if (count && firstId && secondId && firstId !== secondId) {
      return {
        options: [
          [{ featureId: firstId, count }],
          [{ featureId: secondId, count }],
        ],
      };
    }
  }

  if (!/\b(or|either)\b/i.test(raw)) {
    return extractAttacksFromSegment(raw, nameToFeatureId);
  }

  // Multiple sentences (an interior period, not just one at the very end)
  // means an "or" found anywhere in the text isn't necessarily a clean
  // top-level option boundary for the WHOLE thing — confirmed live:
  // Werebat's own two-sentence Multiattack ("In humanoid form, the creature
  // makes two scimitar attacks or two shortbow attacks. In hybrid form, it
  // can make one bite attack and one scimitar attack.") would otherwise let
  // the SECOND sentence's own unrelated "and"-list bleed into the FIRST
  // sentence's own last "or" segment, since splitTopLevelOptions only splits
  // on "or", not on sentence boundaries — producing a wrong-but-plausible
  // merged option (shortbow+bite+scimitar as one combination) instead of the
  // real 3 separate, form-gated options. Bailing here (never a wrong merge)
  // rather than trying to also reason about per-sentence/form structure.
  if (raw.replace(/\.\s*$/, "").includes(".")) return null;

  const segments = splitTopLevelOptions(raw);
  if (segments.length < 2) return null;

  const options = [];
  const eachOfPreviousIndexes = [];
  for (const segment of segments) {
    if (EACH_OF_PREVIOUS_OPTIONS_PATTERN.test(segment)) {
      eachOfPreviousIndexes.push(options.length);
      options.push(null);
      continue;
    }
    const attacks = extractAttacksFromSegment(segment, nameToFeatureId);
    if (!attacks) return null;
    options.push(attacks);
  }

  if (eachOfPreviousIndexes.length) {
    const knownFeatureIds = [];
    const seenKnown = new Set();
    options.forEach((attacks) => {
      if (!attacks) return;
      attacks.forEach((attack) => {
        if (!seenKnown.has(attack.featureId)) {
          seenKnown.add(attack.featureId);
          knownFeatureIds.push(attack.featureId);
        }
      });
    });
    if (!knownFeatureIds.length) return null;
    eachOfPreviousIndexes.forEach((index) => {
      options[index] = knownFeatureIds.map((featureId) => ({ featureId, count: 1 }));
    });
  }

  return { options };
}

// A single shared Multiattack template — exactly the same "shared, number/
// reference-free Feature plus per-monster data on the record" convention
// parseWeaponAttack's feat.bite/feat.claw/... already use, extended here to
// cover Multiattack too. This WASN'T the original design: every monster with
// a Multiattack used to get its own fresh `feat.<slug>-multiattack` Feature
// file, on the reasoning that Multiattack's own CONTENT is monster-specific
// (true — it's a menu of THIS monster's own other attacks, never matched/
// reused across monsters) — but that's an argument for why the DATA is
// per-monster, not for why it needs a whole separate Feature file per
// monster to hold it. Confirmed real cost of the original design: 200+
// near-identical one-off Multiattack files cluttering the Library, every one
// structurally saying the exact same thing ("here is this monster's own
// attack-reference list"), exactly the shape a shared template already
// solves for weapon attacks. `record.featureParams["feat.multiattack"]`
// holds `{attacks, text}` — `attacks` is the parsed {featureId, count} list
// (absent when extraction failed or the ability is choice-structured, e.g.
// Aartuk Elder's own "two Branch, two Radiant Pellet, or one of each"),
// `text` is always the original (name-substituted) prose fallback. Crucible's
// own multiattackDescriptionText computes the live sentence from `attacks`
// when present and every reference resolves, falling back to `text`
// otherwise — same contract the old per-monster Feature's own
// mechanics.attacks/mechanics.text pair had, just relocated.
const MULTIATTACK_TEMPLATE_ID = "feat.multiattack";

// Extraction runs on the name-substituted text, harmlessly — the patterns it
// looks for ("two Branch attacks") never overlap with a monster's own name,
// so substituting first can't affect what gets extracted. extractMultiattack
// References returns either a flat array (fixed combination — stored as
// `attacks`, the original/common shape) or `{options: [...]}` (a genuine
// choice — stored as `options`), or null (nothing usable extracted); `text`
// is always kept as the fallback regardless of which case applies.
function buildMultiattackParams(trait, { nameToFeatureId, monsterName, creatureType }) {
  const substitutedDescription = knownNameSubstitute(trait.description, monsterName, creatureType);
  const extracted = extractMultiattackReferences(substitutedDescription, nameToFeatureId);
  const structured = Array.isArray(extracted)
    ? { attacks: extracted }
    : extracted && Array.isArray(extracted.options)
      ? { options: extracted.options }
      : {};
  return { ...structured, text: substitutedDescription || "" };
}

// A simple weapon attack ("Melee Weapon Attack: +8 to hit, reach 5 ft., one
// target. Hit: 16 (2d10 + 5) piercing damage.") is the single biggest
// source of near-duplicate Features in this whole pipeline — confirmed
// live: hundreds of Bite/Claw/Slam/Tail/... files across a real 300-
// monster import, each one differing ONLY in these numbers, never safe to
// merge (the numbers are genuinely different per monster) yet never
// meaningfully different in KIND either. Parsed here into structured
// fields instead of matched/created as prose — the SAME "Bite" Feature
// (`feat.bite`, keyed purely by trait name, not monster-prefixed) is
// reused by every monster that has one, and each monster's own numbers
// live on ITS OWN record (`record.featureParams`, parallel to
// `record.featureTiers`), never on the shared Feature itself. This is a
// completely separate matching path from findMatch's own description-
// similarity logic — deliberately so: comparing DESCRIPTIONS would always
// disagree (the numbers differ), so this matches by name alone, which is
// safe here because the shared Feature carries no numbers of its own to
// get wrong. Anchored start-to-end (`$`), so a "plus N (dice) TYPE
// damage" rider clause, or any other trailing sentence, fails to match
// entirely rather than silently truncating real information — those keep
// going through the normal prose findMatch/create path unchanged, same
// "never lose information" rule this whole module follows. The `:` after
// "Attack" and the `Hit:` label are both optional — confirmed live: three
// otherwise-plain (no rider at all) attacks stayed one-offs purely because
// their own source text used a `;` instead of a `:` (formian-myrmarch's
// own Bite/Claws) or dropped the `Hit:` label entirely (deep-drake's own
// Bite) — a punctuation quirk in ONE source file, not a real content
// difference, so tolerating it is safe the same way the rest of this
// pattern already is (it still can't swallow a real rider clause, since
// the match is still anchored end-to-end).
// The dice-notation parenthetical is normally always present in real 5e
// text ("1 (1d4 - 1) piercing damage") but not always in this Library's own
// imported source — a small creature whose damage averages to a bare "1"
// sometimes has the source omit it entirely ("Hit: 1 piercing damage.", no
// parens at all — confirmed live across a whole cluster of tiny creatures'
// own Bite: Rat, Bat, Lizard, Quipper, Cat's own Claws, ...). Made optional
// rather than required so these still parse: the leading flat number
// (group 6) is always captured and used as a literal `damageDice` fallback
// whenever the parenthetical (group 7) is absent, rather than silently
// failing to match and falling through to a monster-prefixed one-off.
const WEAPON_ATTACK_PATTERN =
  /^(Melee|Ranged)\s+(Weapon|Spell)\s+Attack[:;]?\s*\+(\d+)\s+to hit,\s*(reach|range)\s+([\d/]+)\s*ft\.,\s*one (?:target|creature)\.\s*(?:Hit:\s*)?(\d+)\s*(?:\(([0-9d\s+-]+?)\))?\s*([a-z]+)\s+damage\.?\s*$/i;

// The 2024 rules revision's own phrasing for the exact same mechanical
// shape — "Melee Attack Roll: +9, reach 5 ft. Hit: 28 (4d10 + 6) Piercing
// damage." — no "Weapon"/"Spell" word (the 2024 revision drops that
// distinction from this sentence shape entirely), "Attack Roll" instead of
// "...Attack", no "one target"/"one creature" clause, Title Case damage
// type. A completely separate pattern (not folded into
// WEAPON_ATTACK_PATTERN above) so the already-proven-safe classic
// pattern's own behavior can't be affected by this addition —
// parseWeaponAttack tries this SECOND, only once the classic pattern has
// already failed to match. Anchored end-to-end same as the classic
// pattern — a "Melee or Ranged Attack Roll" combined-distance shape, or
// any rider clause, correctly fails to match and falls through to the
// normal one-off prose path rather than losing information.
const WEAPON_ATTACK_ROLL_PATTERN =
  /^(Melee|Ranged)\s+Attack Roll:\s*\+(\d+),\s*(reach|range)\s+([\d/]+)\s*ft\.\s*Hit:\s*\d+\s*\(([0-9d\s+-]+?)\)\s*([A-Za-z]+)\s+damage\.?\s*$/i;

// A finesse/thrown weapon usable EITHER way in one combined sentence
// ("Melee or Ranged Weapon Attack: +N to hit, reach N ft. or range N/N
// ft., one target...") — a genuinely different shape from the classic
// pattern above (which only ever has ONE distance label), not just a
// wording variant of it. Confirmed live: a whole cluster of Dagger/
// Javelin/Spear one-offs shared this exact shape and, lacking any support
// for it, each spawned its own separate Feature instead of collapsing —
// `kind: "MeleeOrRanged"` is a third value alongside "Melee"/"Ranged"
// (see weaponAttackDescriptionText's own handling, crucible/js/app.js),
// carrying BOTH `meleeDistance` and `rangeDistance` since a single
// `distance` field can't represent two simultaneous ranges.
const MELEE_OR_RANGED_PATTERN =
  /^Melee or Ranged\s+(Weapon|Spell)\s+Attack[:;]?\s*\+(\d+)\s+to hit,\s*reach\s+([\d/]+)\s*ft\.\s*or\s*range\s+([\d/]+)\s*ft\.,\s*one (?:target|creature)\.\s*(?:Hit:\s*)?(\d+)\s*(?:\(([0-9d\s+-]+?)\))?\s*([a-z]+)\s+damage\.?\s*$/i;

function parseWeaponAttack(text) {
  const raw = String(text || "");
  const classic = raw.match(WEAPON_ATTACK_PATTERN);
  if (classic) {
    return {
      kind: classic[1],
      attackKind: classic[2],
      attackBonus: Number(classic[3]),
      distanceLabel: classic[4].toLowerCase(),
      distance: classic[5],
      damageDice: classic[7] ? classic[7].replace(/\s+/g, " ").trim() : classic[6],
      damageType: classic[8].toLowerCase(),
    };
  }
  const attackRoll = raw.match(WEAPON_ATTACK_ROLL_PATTERN);
  if (attackRoll) {
    return {
      kind: attackRoll[1],
      // The 2024 phrasing drops the Weapon/Spell distinction entirely —
      // "Weapon" is the overwhelmingly common real case (confirmed live:
      // every 2024-phrased trait found this session was a natural weapon/
      // innate attack, none a spell attack) and renders back through
      // weaponAttackDescriptionText's own classic-style sentence
      // ("Melee Weapon Attack: +N to hit...") the same way every other
      // weapon-attack Feature already displays, regardless of which
      // phrasing the source used.
      attackKind: "Weapon",
      attackBonus: Number(attackRoll[2]),
      distanceLabel: attackRoll[3].toLowerCase(),
      distance: attackRoll[4],
      damageDice: attackRoll[5].replace(/\s+/g, " ").trim(),
      damageType: attackRoll[6].toLowerCase(),
    };
  }
  const meleeOrRanged = raw.match(MELEE_OR_RANGED_PATTERN);
  if (meleeOrRanged) {
    return {
      kind: "MeleeOrRanged",
      attackKind: meleeOrRanged[1],
      attackBonus: Number(meleeOrRanged[2]),
      meleeDistance: meleeOrRanged[3],
      rangeDistance: meleeOrRanged[4],
      damageDice: meleeOrRanged[6] ? meleeOrRanged[6].replace(/\s+/g, " ").trim() : meleeOrRanged[5],
      damageType: meleeOrRanged[7].toLowerCase(),
    };
  }
  return null;
}

// parseWeaponAttack's own sibling for a weapon attack that carries exactly
// ONE trailing rider clause beyond the base template — the reverse of
// riderClauseText's own 3 shapes (crucible/js/app.js). Without this, EVERY
// monster whose Bite/Claw/Gore/etc. carries a rider recreated its own
// one-off Feature on import instead of collapsing into the shared
// template — confirmed live: this is exactly how re-importing Adult Topaz
// Dragon put `feat.adult-topaz-dragon-bite` right back after it had
// already been hand-collapsed into `feat.bite` + a rider, and why the
// library had 21 separate "Bite" Features (17 "Claw", 9 "Longsword", ...)
// at once — the rider mechanism only ever existed as a one-time data
// migration, never wired into the live pipeline until now. Only called
// once parseWeaponAttack has already failed on the FULL text (see the
// main loop below), so a clean rider-free attack is never affected. Tries
// each of the 3 known real trailing-clause phrasings (same wording
// riderClauseText itself renders, since that was modeled on real found
// examples) — strips exactly one, then requires the REMAINING text to
// match the base attack pattern cleanly. Anything else (an unrecognized
// rider shape, 2+ stacked clauses, garbled text) returns null and falls
// through to the existing one-off path untouched — never a wrong partial
// parse, same discipline as every other pattern in this file.
// Every "(.*?)\s+<lead-in>" suffix pattern below tolerates an optional
// comma directly before its own lead-in word (",?\s+" instead of "\s+") —
// confirmed live: stripping a Versatile clause (see
// parseWeaponAttackWithVersatile below) out of the MIDDLE of a sentence
// can leave a stray comma immediately before "plus"/"If" that was never
// there in a plain rider-only text (Autumn Eladrin's own "...if used
// with two hands, plus 22 (5d8) psychic damage." strips down to
// "...damage, plus 22..." — the comma stays attached unless this pattern
// explicitly allows it). Written as its own token rather than folded
// into the lazy `(.*?)` capture so the captured base text itself never
// includes the comma.
const SECONDARY_DAMAGE_RIDER_SUFFIX = /^(.*?),?\s+plus\s+\d+\s*\(([0-9d\s+-]+?)\)\s*([a-z]+)\s+damage\.?\s*$/i;
// Broadened from its original "If the target is a creature, it must
// succeed..." to also accept two real variants found once the SRD/Fantasy
// Statblocks bestiary got this large: a plain lead-in with no restriction
// clause at all ("...and the target must succeed on a DC N ABILITY saving
// throw or be poisoned for 24 hours"), and a genuine target-type
// restriction — not just the generic "a creature" — a whole lycanthropy-
// curse cluster (Werebear/Wereboar/Wererat/Weretiger/Werewolf/Wereshark's
// own Bite) reads "If the target is a humanoid, it must succeed...", and
// Ghast/Ghoul's own Claws read "If the target is a creature other than an
// undead, it must succeed...". Group 2 (the restriction, if present) feeds
// `rider.targetRestriction` — omitted when it's literally "creature" (the
// existing default rendering already says that). "be" OR "become" — both
// appear in real source text for the identical mechanic.
const SAVE_OR_CONDITION_RIDER_SUFFIX =
  /^(.*?)[,.]?\s+(?:If the target is (?:a|an) ([\w\s]+?), it|(?:and )?the target)\s+must succeed on a DC\s*(\d+)\s+(\w+)\s+saving throw or (?:be|become)\s+(.+?)(?:\s+for\s+(.+?))?\.?\s*$/i;
// The other real "save" shape a weapon-attack rider carries — not a
// condition on failure, straight bonus damage instead (almost always
// poison) — "...and the target must make a DC N ABILITY saving throw,
// taking N (dice) TYPE damage on a failed save, or half as much damage on
// a successful one." The exact same sentence shape SAVE_EFFECT_PATTERN's
// own tail uses (monster-feature-matching.js above), just riding on a
// single-target weapon attack instead of an area effect — confirmed live
// across a whole cluster of venomous Bite/Claw attacks (Giant Poisonous
// Snake, Giant Spider, Phase Spider, Spirit Naga, Guardian Naga, ...).
// Trailing note is optional — confirmed live: a whole cluster of larger
// venomous spiders (Giant Spider, Giant Wolf Spider, Phase Spider) append
// "If the poison damage reduces the target to 0 hit points, the target is
// stable but poisoned for 1 hour, even after regaining hit points, and is
// paralyzed while poisoned in this way." verbatim after the standard save-
// or-damage clause — same "one further sentence tacked on" shape as
// SAVE_EFFECT_PATTERN's own trailing-note capture above, extended here for
// the exact same reason (losing it entirely would silently drop the actual
// mechanical effect, not just flavor).
const SAVE_OR_DAMAGE_RIDER_SUFFIX =
  /^(.*?)[,.]?\s+(?:and\s+)?the target must make a DC\s*(\d+)\s+(\w+)\s+saving throw,\s+taking\s+\d+\s*\(([0-9d\s+-]+?)\)\s+(\w+)\s+damage on a failed save,\s+or half as much damage on a successful one\.?(?:\s+(.+))?\s*$/i;
const CHARGE_BONUS_RIDER_SUFFIX =
  /^(.*?),?\s+If the creature moved\s+(\d+)\+\s+feet straight toward the target immediately before the hit, the target takes an extra\s+\d+\s*\(([0-9d\s+-]+?)\)\s*([a-z]+)\s+damage\.?\s*$/i;
// The 4th rider kind — an UNCONDITIONAL on-hit effect, no saving throw at
// all (confirmed live: Blood Lash's own "...it can't regain hit points
// until the start of [name]'s next turn"). Tried last, only once the
// stricter save-or-condition pattern (which requires "must succeed on a
// DC...") has already failed, so it never steals a real save-based rider.
const CONDITION_NO_SAVE_RIDER_SUFFIX = /^(.*?),?\s+If the target is a creature, it\s+(.+?)\.?\s*$/i;
// The 5th rider kind — a secondary damage bonus whose TYPE is dynamic
// ("...damage of the type to which the creature has resistance"), not a
// literal fixed type the way `secondary-damage` above is — a real,
// recurring 5e pattern for dragon-blooded/elemental-themed humanoids
// (confirmed live: Dragonsoul and Orc of the Onyx Scale's own identical
// Shortsword rider, differing only in self-reference word). Tried alongside
// the others, not gated behind them failing first — its own "...damage of
// the type to which..." tail never overlaps with SECONDARY_DAMAGE's
// stricter `\s+damage\.?\s*$` anchor (that one requires "damage" to end the
// sentence; this one always has more text after "damage"), so there's no
// ambiguity between the two to resolve.
const RESISTANCE_TYPE_DAMAGE_RIDER_SUFFIX = /^(.*?),?\s+plus\s+\d+\s*\(([0-9d\s+-]+?)\)\s*damage of the type to which the \w+ has resistance\.?\s*$/i;

function parseWeaponAttackWithRider(text) {
  const raw = String(text || "");
  const secondary = raw.match(SECONDARY_DAMAGE_RIDER_SUFFIX);
  const saveOrCondition = !secondary && raw.match(SAVE_OR_CONDITION_RIDER_SUFFIX);
  const saveOrDamage = !secondary && !saveOrCondition && raw.match(SAVE_OR_DAMAGE_RIDER_SUFFIX);
  const chargeBonus = !secondary && !saveOrCondition && !saveOrDamage && raw.match(CHARGE_BONUS_RIDER_SUFFIX);
  const resistanceTypeDamage =
    !secondary && !saveOrCondition && !saveOrDamage && !chargeBonus && raw.match(RESISTANCE_TYPE_DAMAGE_RIDER_SUFFIX);
  const conditionNoSave =
    !secondary && !saveOrCondition && !saveOrDamage && !chargeBonus && !resistanceTypeDamage && raw.match(CONDITION_NO_SAVE_RIDER_SUFFIX);

  let base;
  let rider;
  if (secondary) {
    base = secondary[1];
    rider = { kind: "secondary-damage", dice: secondary[2].replace(/\s+/g, " ").trim(), damageType: secondary[3].toLowerCase() };
  } else if (saveOrCondition) {
    base = saveOrCondition[1];
    const restriction = saveOrCondition[2] ? saveOrCondition[2].trim().toLowerCase() : null;
    rider = {
      kind: "save-or-condition",
      ...(restriction && restriction !== "creature" ? { targetRestriction: restriction } : {}),
      saveDC: Number(saveOrCondition[3]),
      saveAbility: saveOrCondition[4].toLowerCase(),
      condition: saveOrCondition[5].trim(),
      ...(saveOrCondition[6] ? { duration: saveOrCondition[6].trim() } : {}),
    };
  } else if (saveOrDamage) {
    base = saveOrDamage[1];
    rider = {
      kind: "save-or-damage",
      saveDC: Number(saveOrDamage[2]),
      saveAbility: saveOrDamage[3].toLowerCase(),
      dice: saveOrDamage[4].replace(/\s+/g, " ").trim(),
      damageType: saveOrDamage[5].toLowerCase(),
      ...(saveOrDamage[6] ? { trailingNote: saveOrDamage[6].trim() } : {}),
    };
  } else if (chargeBonus) {
    base = chargeBonus[1];
    rider = { kind: "charge-bonus", triggerDistance: Number(chargeBonus[2]), dice: chargeBonus[3].replace(/\s+/g, " ").trim(), damageType: chargeBonus[4].toLowerCase() };
  } else if (resistanceTypeDamage) {
    base = resistanceTypeDamage[1];
    rider = { kind: "resistance-type-damage", dice: resistanceTypeDamage[2].replace(/\s+/g, " ").trim() };
  } else if (conditionNoSave) {
    base = conditionNoSave[1];
    rider = { kind: "condition-no-save", condition: conditionNoSave[2].trim() };
  } else {
    return null;
  }

  const parsedBase = parseWeaponAttack(base);
  if (!parsedBase) return null;
  return { ...parsedBase, rider };
}

// The 5e Versatile weapon property ("or N2 (dice2) TYPE damage if used
// with two hands") — a separate concept from the 4 rider kinds above (see
// versatileClauseText's own comment, crucible/js/app.js, for why): it
// inserts INTO the base "Hit: ..." sentence rather than trailing after
// it, and can genuinely coexist with a real rider. Confirmed live: a full
// scan of the "Longsword" duplicate-name group found ALL 8 one-offs
// carried Versatile, and 5 of those 8 ALSO stacked a secondary-damage
// rider on top (Autumn Eladrin's own "...or 6 (1d10 + 1) slashing damage
// if used with two hands, plus 22 (5d8) psychic damage."), which
// `parseWeaponAttackWithRider` alone can't parse — the versatile clause
// breaks its own end-anchored base-attack sub-match. Strips the versatile
// clause out FIRST (wherever it falls in the sentence, not just a
// trailing suffix), then re-attempts BOTH the clean and rider-aware
// parsers on what's left.
// Comma before "or" is optional, not required — confirmed live: Guard's
// own Spear ("...piercing damage or 5 (1d8 + 1) piercing damage if used
// with two hands...") omits it while 6 of 7 other real Spear texts include
// it for the exact same mechanic.
const VERSATILE_CLAUSE_PATTERN =
  /,?\s*or\s*\d+\s*\(([0-9d\s+-]+?)\)\s*[a-z]+\s+damage\s+(?:if|when)\s+used\s+with\s+two\s+hands(?:\s+to\s+make\s+a\s+melee\s+attack)?/i;

function parseWeaponAttackWithVersatile(text) {
  const raw = String(text || "");
  const match = raw.match(VERSATILE_CLAUSE_PATTERN);
  if (!match) return null;
  const stripped = raw.replace(VERSATILE_CLAUSE_PATTERN, "");
  const parsed = parseWeaponAttack(stripped) || parseWeaponAttackWithRider(stripped);
  if (!parsed) return null;
  return { ...parsed, versatile: { damageDice: match[1].replace(/\s+/g, " ").trim() } };
}

// parseWeaponAttack's own sibling for the OTHER heavily-templated 5e
// mechanical shape — a save-based area effect (a breath weapon, almost
// always) — "The creature exhales X in an N-foot line/cone[ that is N feet
// wide]. Each creature in that line/area must make a DC N ABILITY saving
// throw, taking N (dice) TYPE damage on a failed save, or half as much
// damage on a successful one." Same discipline as WEAPON_ATTACK_PATTERN:
// anchored start-to-end, so a real rider (Crimson Shade's own necrotic
// breath raises the slain as undead; Adult Topaz Dragon's own desiccating
// breath applies a lingering weakened condition instead of simple half-
// damage; the metallic dragons' own "uses one of the following breath
// weapons" wrapper bundles two distinct breath options into one trait)
// fails to match entirely rather than silently dropping that extra effect —
// those keep going through the normal prose findMatch/create path
// unchanged. Confirmed live against every clean real breath-weapon text in
// the current Library before deploying this pattern.
//
// The captured `ability` is the TARGET's own saving-throw ability (which
// varies for real, "DC 18 Dexterity" vs "DC 17 Constitution" — kept as
// literal stored data, never computed, since it's read off the trait text
// verbatim and has nothing to do with any of THIS monster's own stats) —
// distinct from the attacking monster's own DC-setting ability
// (`dcAbility`, defaulted to Constitution below — 5e's own universal
// convention for breath weapons specifically, every real example in this
// Library confirms it), which IS what feeds computeSaveDC. Damage dice are
// kept as literal stored data too, not formula-computed — a breath
// weapon's damage scales with the monster's size/age category in real 5e
// design, not with an ability modifier the way weapon-attack damage does.
// The leading self-reference word was originally hardcoded to literally
// "creature" — but knownNameSubstitute (see its own comment above) never
// actually produces that word for a monster's SELF-reference once the text
// also uses "creature" as a plain common noun for its targets (the normal
// case for every breath weapon: "Each creature in that area..."), since
// doing so would collide the two meanings. It resolves to the monster's own
// creature TYPE instead ("the dragon", "the elemental") — so this pattern
// matched almost nothing in practice. Confirmed live: every real dragon
// breath weapon in the Library ("The dragon exhales acid...") silently fell
// through to the generic one-off path instead of ever reaching
// feat.acid-breath/feat.cold-breath/etc., for every monster ever imported.
// `\w+` accepts whatever self-reference word ends up there and simply
// discards it (never captured into the returned shape) — the shared
// template's own stored description always uses the generic "The creature"
// wording regardless of what any individual monster's own text said.
// Self-reference is 1-2 words, not always 1 — confirmed live: Dragon Eel's
// own text says "The dragon eel exhales...", not "The dragon...".
const SAVE_EFFECT_LEAD =
  /^The \w+(?:\s+\w+)?\s+(exhales|sprays|releases|emits|breathes)\s+(.+?)\s+in an?\s+(\d+)-foot\s+(line|cone|sphere|radius)(?:\s+that is\s+(\d+)\s*(?:ft\.?|feet)\s+wide)?\./;
// Both base-shape patterns tolerate one further trailing sentence after the
// core damage/save clause (captured, never required) — a narrative addendum
// some breath weapons carry (a creature killed by the damage rises as
// undead, a temporary-hit-points side effect, ...) that doesn't change the
// core mechanic at all. Rendered verbatim via the `trailing-note` rider kind
// (saveEffectDescriptionText, crucible/js/app.js) — same "store the
// per-monster addendum as literal text, don't try to decompose it further"
// call as SAVE_EFFECT_FAIL_CONDITION_PATTERN's own rider below, for the
// same reason (each real example is one-off flavor, not a reusable shape).
const SAVE_EFFECT_PATTERN = new RegExp(
  SAVE_EFFECT_LEAD.source +
    /\s*Each creature in that (?:line|area|cone|sphere)\s+must make a DC\s*(\d+)\s+(\w+)\s+saving throw,\s+taking\s+\d+\s*\(([0-9d\s+-]+?)\)\s+(\w+)\s+damage on a failed save,\s+or half as much damage on a successful one\.?(?:\s+(.+))?\s*$/.source,
  "i"
);
// The other real ordering 5e source text uses for the exact same mechanic
// ("takes N damage, or half damage with a successful DC N ABILITY saving
// throw" instead of "must make a DC N ABILITY saving throw, taking N
// damage..."). Same fields, no rider by default — this is pure sentence
// reordering, not a mechanical difference, so it feeds parseSaveEffect's own
// return shape unchanged and collapses into the exact same shared template
// as the other ordering once genericized. "target" tolerated alongside
// "creature" — confirmed live on Dragon Eel's own Lightning Breath ("Each
// target in that line takes..."). Trailing-note capture as above —
// confirmed live: Mindrot Thrall's own Acid Breath adds "If the saving
// throw fails, the creature is also infected with mindrot spores." after
// this exact shape.
const SAVE_EFFECT_REORDERED_PATTERN = new RegExp(
  SAVE_EFFECT_LEAD.source +
    /\s*Each (?:creature|target) in that (?:line|area|cone|sphere)\s+takes\s+\d+\s*\(([0-9d\s+-]+?)\)\s+(\w+)\s+damage,\s+or half damage with a successful DC\s*(\d+)\s+(\w+)\s+saving throw\.?(?:\s+(.+))?\s*$/.source,
  "i"
);
// The third real shape: a breath weapon whose failed/successful-save
// outcome is more than just "damage, or half damage" — an extra rider
// effect (a condition, a push, a secondary damage type) tacked onto BOTH
// outcomes, always in a separate "On a failure, ... On a success/successful
// save, ..." sentence pair rather than the single comma-joined sentence the
// two patterns above assume. Deliberately doesn't try to decompose that
// tail into structured fields the way weapon-attack riders do — the real
// examples this was built from (a dragon's own "weakened" condition, a push
// + prone knockdown, a stun) are each different enough, and each already
// only needs a per-monster VALUE (its own damage numbers, its own
// duration), not a per-monster STRUCTURE — that trying to generalize it
// further than "store the whole outcome sentence pair verbatim, genericized
// like everything else" would cost far more mechanism than it'd save. See
// saveEffectDescriptionText's own rider handling (crucible/js/app.js) for
// how `rider.conditionText` gets rendered. `DC` is optional in the source
// match (not just in output) — confirmed live: Deep Drake's own Enervating
// Breath omits it entirely ("must make a 16 Dexterity saving throw").
const SAVE_EFFECT_FAIL_CONDITION_PATTERN = new RegExp(
  SAVE_EFFECT_LEAD.source +
    /\s*Each (?:creature|target) in (?:that|the) (?:line|area|cone|sphere)\s+must make (?:a )?(?:DC\s*)?(\d+)\s+(\w+)\s+saving throw\.\s*(On a (?:failure|failed save)[\s\S]+)$/.source,
  "i"
);
// A 4th, completely independent LEAD shape — real 5e source text orders
// the shape/substance both ways: "exhales SUBSTANCE in a N-foot SHAPE"
// (SAVE_EFFECT_LEAD above) or "exhales a N-foot SHAPE of SUBSTANCE" (this
// one) — confirmed live: Magma Mephit's own Fire Breath ("...exhales a
// 15-foot cone of fire...") and Ice Mephit's own Frost Breath ("...exhales
// a 15-foot cone of cold air...") both use this order and silently fell
// through to the generic one-off path despite being an exact-shape match
// for the already-large feat.fire-breath-monster/feat.cold-breath
// templates. Only paired with the BASE (comma-joined) tail shape below —
// no real example combining this lead order with the reordered/fail-
// condition tails has turned up yet; add those pairings if one does.
const SAVE_EFFECT_LEAD_SHAPE_FIRST =
  /^The \w+(?:\s+\w+)?\s+(exhales|sprays|releases|emits|breathes)\s+an?\s+(\d+)-foot\s+(line|cone|sphere|radius)(?:\s+that is\s+(\d+)\s*(?:ft\.?|feet)\s+wide)?\s+of\s+(.+?)\./;
const SAVE_EFFECT_PATTERN_SHAPE_FIRST = new RegExp(
  SAVE_EFFECT_LEAD_SHAPE_FIRST.source +
    /\s*Each creature in that (?:line|area|cone|sphere)\s+must (?:make|succeed on) a DC\s*(\d+)\s+(\w+)\s+saving throw,\s+taking\s+\d+\s*\(([0-9d\s+-]+?)\)\s+(\w+)\s+damage on a failed save,\s+or half as much damage on a successful one\.?(?:\s+(.+))?\s*$/.source,
  "i"
);

function parseSaveEffect(text) {
  const raw = String(text || "");
  let match = raw.match(SAVE_EFFECT_PATTERN);
  if (match) {
    return {
      verb: match[1].toLowerCase(),
      substance: match[2].trim(),
      areaSize: match[3],
      areaShape: match[4].toLowerCase(),
      ...(match[5] ? { lineWidth: match[5] } : {}),
      dcAbility: "constitution",
      // match[6] is the trait's own ORIGINAL literal DC number — deliberately
      // unused/discarded (not stored anywhere), since the whole point of
      // formula mode is computing a fresh DC from this monster's own stats
      // rather than trusting a number baked into the source text.
      ability: match[7].toLowerCase(),
      damageDice: match[8].replace(/\s+/g, " ").trim(),
      damageType: match[9].toLowerCase(),
      ...(match[10] ? { rider: { kind: "trailing-note", conditionText: match[10].trim() } } : {}),
    };
  }
  match = raw.match(SAVE_EFFECT_REORDERED_PATTERN);
  if (match) {
    return {
      verb: match[1].toLowerCase(),
      substance: match[2].trim(),
      areaSize: match[3],
      areaShape: match[4].toLowerCase(),
      ...(match[5] ? { lineWidth: match[5] } : {}),
      dcAbility: "constitution",
      damageDice: match[6].replace(/\s+/g, " ").trim(),
      damageType: match[7].toLowerCase(),
      // match[8] is the ORIGINAL literal DC number, same as above — discarded.
      ability: match[9].toLowerCase(),
      ...(match[10] ? { rider: { kind: "trailing-note", conditionText: match[10].trim() } } : {}),
    };
  }
  match = raw.match(SAVE_EFFECT_FAIL_CONDITION_PATTERN);
  if (match) {
    return {
      verb: match[1].toLowerCase(),
      substance: match[2].trim(),
      areaSize: match[3],
      areaShape: match[4].toLowerCase(),
      ...(match[5] ? { lineWidth: match[5] } : {}),
      dcAbility: "constitution",
      // match[6] is the ORIGINAL literal DC number, same as above — discarded.
      ability: match[7].toLowerCase(),
      rider: { kind: "fail-condition", conditionText: match[8].trim() },
    };
  }
  match = raw.match(SAVE_EFFECT_PATTERN_SHAPE_FIRST);
  if (match) {
    return {
      verb: match[1].toLowerCase(),
      areaSize: match[2],
      areaShape: match[3].toLowerCase(),
      ...(match[4] ? { lineWidth: match[4] } : {}),
      substance: match[5].trim(),
      dcAbility: "constitution",
      // match[6] is the ORIGINAL literal DC number, same as the other 3 — discarded.
      ability: match[7].toLowerCase(),
      damageDice: match[8].replace(/\s+/g, " ").trim(),
      damageType: match[9].toLowerCase(),
      ...(match[10] ? { rider: { kind: "trailing-note", conditionText: match[10].trim() } } : {}),
    };
  }
  return null;
}

// Written generically (any "Base Name (N/Day)" or "Base Name (Recharge
// N[-6])" ability), not hardcoded to "Legendary Resistance" specifically —
// those are just the common real-world cases. A shared Feature whose
// incoming trait name carries one of these suffixes represents a
// genuinely SCALING ability (how often it's available), not a flavor
// variant — reuses Vault's own `tiers` shape (feature.tiers: [{id, name,
// shortName, mechanics}]) with a per-tier `mechanics.text` instead of
// Vault's per-tier `budgetCost`, since a monster Feature's tiers vary by
// frequency, not gp value. Only ever called once findMatch has already
// found a same-mechanic match (same thresholds as any other trait) — this
// never changes WHETHER something matches, only what happens once it has:
// instead of silently discarding the frequency difference (or, worse,
// letting the SAME base ability at different frequencies proliferate into
// separate one-off Features — confirmed live: 15 separate "Legendary
// Resistance (N/Day)" files before this), it's recorded as a tier on the
// ONE shared Feature. Returns the tier id to record on the monster's own
// record.featureTiers, or null if the trait's name doesn't carry either
// suffix at all — a Recharge-tagged ability whose OTHER numbers (damage,
// area, DC, ...) also vary per monster (the common case — confirmed live:
// "Acid Breath (Recharge 4-6)" vs "Acid Breath (Recharge 5-6)" are
// genuinely different abilities, not just a recharge-value difference)
// won't even reach here, since findMatch's own description-similarity gate
// already keeps those from matching in the first place.
// `[\d\-‐-―]` — a "Recharge N-M" range can arrive with any of
// several dash-like characters depending on source (plain ASCII hyphen,
// or a genuine en dash "–"/em dash "—" from a copy-pasted 5e sourcebook
// PDF/site) — confirmed live: Adult Topaz Dragon's own "(Recharge 5–6)"
// used a real Unicode en dash (U+2013), which the plain ASCII `\-` alone
// silently failed to match, leaving its own suffix unstripped while its
// Wyrmling/Young siblings' bare (non-suffixed) names matched fine —
// fragmenting one shared ability across different template ids.
const NAMED_TIER_PATTERNS = [
  { pattern: /\((\d+)\/Day\)\s*$/i, tierId: (m) => `${m[1]}-day`, shortName: (m) => `${m[1]}/Day` },
  { pattern: /\(Recharge\s*([\d‐-―\-]+)\)\s*$/i, tierId: (m) => `recharge-${m[1].replace(/[‐-―\-]/g, "to")}`, shortName: (m) => `Recharge ${m[1]}` },
];
// Strips the same trailing "(Recharge N-M)"/"(N/Day)" suffix
// NAMED_TIER_PATTERNS matches, but for computing a weapon-attack/save-effect
// shared TEMPLATE's own id/slug — these two branches match/create purely by
// NAME (see their own comments below), so without this a monster whose
// source data happens to keep the frequency suffix in the trait name
// ("Tidal Breath (Recharge 5-6)") would never collapse into the same
// template as another monster's otherwise-identical ability whose source
// happened to drop it ("Tidal Breath" bare) — confirmed live: Adult Sea
// Dragon vs Young/Wyrmling Sea Dragon's own Tidal Breath. The template
// itself carries no numbers (bare stub description) either way, so unlike
// resolveNamedTier's own job (preserving genuinely differing per-tier TEXT)
// there's nothing frequency-specific to preserve here — the two abilities
// really are the exact same template regardless of source-text spelling.
function baseAbilityName(name) {
  let stripped = String(name || "");
  for (const { pattern } of NAMED_TIER_PATTERNS) stripped = stripped.replace(pattern, "");
  return stripped.trim() || name;
}
async function resolveNamedTier(trait, match, dataManager, substitutedDescription) {
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

// A trait's own description opens with an attack-roll/save line — a strong
// signal it's a genuinely SEPARATE ability describing its own hit/save
// resolution from scratch, never a sub-effect of a preceding "roll/pick one
// of the following" ability (a sub-effect only ever describes its OWN
// consequence, it never re-states an attack or save that's already been
// resolved by the ability that led into it). Used by detectChoiceEffectGroup
// below to know where a choice-effect list ends.
function looksLikeIndependentAbility(description) {
  return /^(Melee|Ranged)\s+(Weapon|Spell\s+)?Attack/i.test(String(description || "").trim());
}

// A small, narrowly-anchored set of real 5e phrasings for "this ability
// resolves into one of several named sub-effects, listed as SEPARATE
// {name, desc} entries in the raw stat block" — Iron Cobra's own "...or
// suffer one random poison effect:" (followed by "1. Poison Damage:"/
// "2. Confusion:"/"3. Paralysis:" as their own numbered entries) and Gem
// Stalker's own "...one of the following effects occurs, determined by the
// kind of dragon that created it:" (followed by "Amethyst."/"Crystal."/
// etc. as their own plain-named entries) are the two confirmed real shapes.
// Deliberately NOT a loose "ends with a colon" heuristic — that would risk
// swallowing a genuinely unrelated NEXT ability whenever a source happens
// to end a sentence with one for other reasons.
const CHOICE_LEAD_IN_PATTERN = /(?:suffer one random [\w\s]+ effect|one of the following effects occurs(?:,\s*determined by [^:.]+)?)\s*:?\s*$/i;
const NUMBERED_SUB_EFFECT_NAME_PATTERN = /^(\d+)\.\s*(.+?):?\s*$/;

// Detects the multi-ENTRY shape above, starting at `entries[startIndex]`.
// Returns `{consumedCount, options: [{name, text}]}` — `consumedCount` is
// how many FOLLOWING entries were absorbed as this one ability's own
// `options` (the caller skips past them, they never become their own
// standalone Features) — or `null` when this entry isn't a choice lead-in,
// or when fewer than 2 qualifying sub-effect entries follow it (a "choice"
// of one thing isn't a choice; falls through to being treated as an
// ordinary standalone trait instead, same safe-fallback discipline as
// every other pattern in this file: never guess, never partially match).
// A numbered list (Iron Cobra's shape) keeps consuming as long as the
// numbering stays sequential — an unambiguous, self-terminating signal.
// A plain-named list (Gem Stalker's shape) has no such marker, so
// consumption there stops at the first entry that looks like an
// independent ability, or after a small generous cap (8) — enough for any
// real 5e sub-effect table, small enough that a genuinely mismatched
// source can't silently swallow the rest of the monster's own ability list.
function detectChoiceEffectGroup(entries, startIndex) {
  const lead = entries[startIndex];
  if (!lead?.description || !CHOICE_LEAD_IN_PATTERN.test(lead.description)) return null;
  const options = [];
  let i = startIndex + 1;
  let expectedNumber = 1;
  let sawNumbering = false;
  while (i < entries.length) {
    const entry = entries[i];
    if (!entry?.name || !entry?.description) break;
    if (looksLikeIndependentAbility(entry.description)) break;
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

// The OTHER real shape: the choice is already ONE entry's own multi-
// paragraph text ("The creature uses one of the following breath
// weapons.\nFire Breath. ...\nWeakening Breath. ...") rather than split
// across separate {name, desc} entries — dragon Breath Weapons' own shape,
// never actually split by the source/importer, just left as flat opaque
// prose today. Anchored on literal embedded newlines (this pipeline's own
// sources always preserve them verbatim) so an ordinary single-paragraph
// trait (the overwhelming majority) never matches at all. A single
// non-conforming line anywhere in the tail bails the WHOLE split (never a
// wrong partial structure), same discipline as every other pattern here.
function splitEmbeddedEffectOptions(description) {
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

// Shared by both detectChoiceEffectGroup's and splitEmbeddedEffectOptions'
// own call sites in the main loop below: creates (or, on re-import,
// refreshes) the ONE Feature representing a choice-effect trait, always a
// monster-specific one-off (`feat.<monsterSlug>-<trait-slug>` — matched
// content is never shared across monsters, same reasoning Multiattack's
// own content already gets) with `mechanics.scope: "unique"` and `options`
// populated. Returns the saved Feature's own id.
async function saveOptionsFeature(trait, intro, options, ctx) {
  const { candidatePool, monsterSlug, systemId, actionCost, record, dataManager, result } = ctx;
  const substitutedIntro = knownNameSubstitute(intro, record?.name, record?.type);
  const featureId = `feat.${monsterSlug}-${cappedSlug(trait.name)}`;
  let feature = candidatePool.find((entry) => entry.id === featureId);
  if (!feature) {
    feature = {
      id: featureId,
      name: cappedDisplayName(trait.name),
      systemIds: systemId ? [systemId] : [],
      description: substitutedIntro || "",
      mechanics: { type: "passive", scope: "unique", text: substitutedIntro || "" },
      budgetCost: 0,
      tags: { behaviors: [], recipeSlots: [], roles: [], creatureTypes: [], categories: ["monster"] },
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
    mechanics: { text: knownNameSubstitute(option.text, record?.name, record?.type) },
  }));
  await dataManager.save("feature", feature.id, feature);
  if (!candidatePool.includes(feature)) candidatePool.push(feature);
  return feature.id;
}

// `existingFeatures` — every `feature` Library entry already loaded by the
// caller (Loom's own reference fetch, or Crucible's own module-level
// `features` list) — filtered here to the active System + monster category,
// not the caller's job. `monsterSlug` seeds new one-off features' ids
// (`feat.<monsterSlug>-<trait-slug>`) so two different monsters' same-named-
// but-different traits never collide.
//
// Mutates and returns `record` (sets `featureIds`, deletes the now-
// superseded ability-group arrays from `record.stats`) — the caller still
// owns saving it. Newly-created features are saved here directly via
// `dataManager.save("feature", ...)` as they're created (not batched at the
// end), and immediately added to the working candidate pool so a later
// trait — on this same monster, or a later monster in the same import
// batch — that shares the exact mechanic reuses it instead of creating a
// duplicate.
export async function convertStatBlockToFeatures(record, { dataManager, existingFeatures, monsterSlug }) {
  const stats = record?.stats;
  const result = { featureIds: [], matchedCount: 0, createdCount: 0, errors: [] };
  if (!stats || !dataManager) return result;

  const systemId = Array.isArray(record.systemIds) ? record.systemIds[0] : record.systemIds || null;
  // `mechanics.scope: "unique"` marks a Feature as belonging to exactly ONE
  // monster (it's what gates Crucible's own Inspector edit permissions —
  // see the Basic Info block's own comment) — but until this filter existed
  // it was purely advisory during IMPORT: a unique-scoped Feature stayed in
  // every other monster's own candidatePool right alongside genuinely
  // shared templates, so findMatch's own lenient exact-name threshold could
  // (and did) silently claim it for an unrelated monster. Confirmed live:
  // Hell Hound's own Fire Breath import matched straight onto Adult Red
  // Dragon's pre-existing one-off (same name, short/templated text, no
  // per-monster featureParams to tell them apart) — Hell Hound ended up
  // displaying Adult Red Dragon's own 18d6/DC 21 numbers verbatim. A
  // monster's OWN existing scope:unique Features stay eligible (via
  // record.featureIds) so re-importing/re-saving the SAME monster still
  // reuses them instead of creating a duplicate one-off every time.
  const ownFeatureIds = new Set(record.featureIds || []);
  const candidatePool = (existingFeatures || []).filter((feature) => {
    const categories = feature.tags?.categories;
    const matchesCategory = !Array.isArray(categories) || !categories.length || categories.includes("monster");
    const ids = Array.isArray(feature.systemIds) ? feature.systemIds : [];
    const matchesSystem = !systemId || !ids.length || ids.includes(systemId);
    const matchesScope = feature.mechanics?.scope !== "unique" || ownFeatureIds.has(feature.id);
    return matchesCategory && matchesSystem && matchesScope;
  });

  const featureIds = [];
  // Which tier of a shared tiered Feature THIS monster's own copy uses
  // (resolveNamedTier above) — mirrors Vault's own
  // currentRecord.featureTiers exactly, same shape/convention, just
  // populated here instead of by Vault's own UI. Starts from whatever the
  // record already had (idempotent re-conversion shouldn't drop an
  // already-resolved tier for a Feature that's no longer being
  // re-matched this pass).
  const featureTiers = { ...(record.featureTiers || {}) };
  // Which numbers THIS monster's own copy of a shared weapon-attack
  // Feature uses (parseWeaponAttack below) — parallel to featureTiers,
  // same "shared Feature, per-monster data lives on the record" shape.
  const featureParams = { ...(record.featureParams || {}) };
  // Collected instead of converted below — see the "traits" special-case
  // inside the loop.
  const spellcastingTexts = [];
  // Multiattack entries are handled in a SECOND pass after every other
  // trait/action/etc. in this monster has its own Feature id resolved (see
  // buildMultiattackParams below) — Multiattack's own text references OTHER
  // attacks ("one with its bite and two with its claws") that, within a real
  // stat block, are almost always listed AFTER it in the same `actions`
  // array, so those featureIds don't exist yet on a single forward pass.
  // `index` is this entry's own position in `featureIds` (a placeholder
  // pushed below) — resolved after the deferred pass so Multiattack still
  // displays in its original stat-block position (first among actions), not
  // shuffled to the end.
  const deferredMultiattacks = [];
  // normalizeName(trait.name) -> the featureId that ended up representing
  // it (matched-existing or newly-created) — Multiattack's own text
  // extraction (buildMultiattackParams) looks attack names up here.
  const nameToFeatureId = new Map();
  for (const groupKey of ABILITY_GROUP_KEYS) {
    const entries = Array.isArray(stats[groupKey]) ? stats[groupKey] : [];
    const actionCost = ACTION_COST_BY_GROUP_KEY[groupKey];
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
      const trait = entries[entryIndex];
      if (!trait?.name) continue;
      // Wraps this whole trait's processing (matching, template/one-off
      // creation, every dataManager.save call in between) so that ONE bad
      // trait — malformed source data producing an oversized id (see
      // cappedSlug/cappedDisplayName above), a save that fails for any
      // other reason, anything unexpected — can only ever cost THIS trait
      // its own Feature, never the rest of the monster. Confirmed live:
      // before this existed, an Isonade import's own "Swallow" trait threw
      // while saving (its name field held its whole multi-sentence
      // description, producing a ~700-character id), and since nothing
      // caught it, the exception propagated all the way up and aborted the
      // ENTIRE monster's conversion — Isonade's own monster record was
      // never saved at all, with no error surfaced anywhere the user could
      // see it. `result.errors` carries what failed back to the caller
      // (Loom's saveEntity, Crucible's own handleSave) to surface instead
      // of staying silent.
      try {
      // A "roll/pick one of the following" choice-effect ability, split
      // across several separate {name, desc} entries by the source itself
      // (Iron Cobra's own numbered "1. Poison Damage:"/"2. Confusion:"/
      // "3. Paralysis:", Gem Stalker's own plain-named "Amethyst."/
      // "Crystal."/etc.) — consumed as ONE Feature's own `options` instead
      // of becoming standalone Features that don't make sense read alone.
      // Confirmed live: left unhandled, this exact shape is how Iron
      // Cobra's Bite ended up split into 3 meaningless separate "Features"
      // and Gem Stalker's Crystal Dart ended up truncated at its own
      // choice-lead-in colon with its 5 named effects orphaned.
      const choiceGroup = detectChoiceEffectGroup(entries, entryIndex);
      if (choiceGroup) {
        const optionsFeatureId = await saveOptionsFeature(trait, trait.description, choiceGroup.options, {
          candidatePool, monsterSlug, systemId, actionCost, record, dataManager, result,
        });
        featureIds.push(optionsFeatureId);
        if (!nameToFeatureId.has(normalizeName(trait.name))) nameToFeatureId.set(normalizeName(trait.name), optionsFeatureId);
        entryIndex += choiceGroup.consumedCount;
        continue;
      }
      // The OTHER real shape: the choice is already this ONE entry's own
      // multi-paragraph text (dragon Breath Weapons' own "uses one of the
      // following breath weapons.\nFire Breath. ...\nWeakening Breath.
      // ..." — never split into separate entries by the source). Same
      // treatment as above, just with nothing following to skip past.
      const embeddedOptions = splitEmbeddedEffectOptions(trait.description);
      if (embeddedOptions) {
        const optionsFeatureId = await saveOptionsFeature(trait, embeddedOptions.intro, embeddedOptions.options, {
          candidatePool, monsterSlug, systemId, actionCost, record, dataManager, result,
        });
        featureIds.push(optionsFeatureId);
        if (!nameToFeatureId.has(normalizeName(trait.name))) nameToFeatureId.set(normalizeName(trait.name), optionsFeatureId);
        continue;
      }
      // Spellcasting is prose (an intro sentence plus a per-frequency spell
      // list), not a discrete atomic ability — it doesn't participate in
      // Crucible's recipe-slot/synergy Feature model the way "Legendary
      // Resistance" does, and creating a Feature for it just duplicates
      // whatever a source's own spellcasting summary already belongs in:
      // stats.spells, the one dedicated field for this (Fantasy
      // Statblocks' own `spells` frontmatter already targets it directly —
      // see that mapping). Matches "Spellcasting"/"Innate
      // Spellcasting"/"Psionic Spellcasting"/etc. — this is only ever a
      // trait, never an action/reaction/legendary/lair entry.
      if (groupKey === "traits" && normalizeName(trait.name).includes("spellcasting")) {
        if (trait.description) spellcastingTexts.push(trait.description);
        continue;
      }
      // "Multiattack" is a menu of a monster's OWN other attacks ("makes
      // two claw attacks", "can use its Frightful Presence, then makes
      // three attacks: ...") — its CONTENT is monster-specific by
      // definition, so unlike a real shared mechanic ("Legendary
      // Resistance", "Amphibious") that content should never be MATCHED
      // against another monster's own Multiattack text no matter how the
      // generic phrasing scores (confirmed live: Aalpamac's own Multiattack
      // — no Frightful Presence, different attack combination — still
      // matched Adult Black Dragon's unrelated one on the exact-name low
      // bar under the old prose-matching path). That's an argument for why
      // the DATA is per-monster, not for why it needs its own Feature file
      // per monster to hold it — findMatch is skipped entirely (not just
      // given a stricter bar) and this always resolves to the ONE shared
      // `feat.multiattack` template (MULTIATTACK_TEMPLATE_ID below,
      // parseWeaponAttack's feat.bite/feat.claw/... convention extended to
      // cover this too), with the structured reference list living in
      // record.featureParams instead of prose on a dedicated Feature — a
      // reserved placeholder slot in featureIds holds its eventual position.
      if (normalizeName(trait.name) === "multiattack") {
        deferredMultiattacks.push({ trait, actionCost, index: featureIds.length });
        featureIds.push(null);
        continue;
      }
      // A cleanly-parseable simple weapon attack (see parseWeaponAttack's
      // own comment) matches/creates by NAME ALONE against a shared,
      // number-free template — never findMatch's description-similarity
      // logic, which would always disagree here since the numbers
      // genuinely differ per monster. `feat.<slug(name)>` deliberately has
      // no monster-slug prefix, unlike every other created-here id — it's
      // meant to be reused by name across every monster with an attack of
      // this name, the same as an EXISTING shared canonical (Amphibious,
      // Legendary Resistance, ...) already is.
      // parseWeaponAttackWithRider only ever runs once the clean (rider-
      // free) pattern has already failed, and its return shape is a strict
      // superset of parseWeaponAttack's own (the same base fields plus an
      // optional `.rider`) — so the whole match/create-template block below
      // handles either result identically, no separate branch needed. The
      // template's own stored description stays rider-agnostic either way
      // ("Melee Weapon Attack against one target.") since the rider is
      // per-monster data (featureParams), never baked into the shared
      // template itself.
      // Computed once here (rather than down at the generic findMatch
      // fallback, where it used to live) since parseSaveEffect now needs it
      // too — a breath weapon's OWN self-reference mid-sentence ("pushed 30
      // feet away from the dragon") still needs genericizing even though
      // the LEADING self-reference word no longer does (see
      // SAVE_EFFECT_PATTERN's own comment for why that part now matches any
      // word). Weapon-attack text has no self-references to clean up, so
      // this is a no-op for that branch either way.
      const substitutedDescription = knownNameSubstitute(trait.description, record?.name, record?.type);
      const parsedAttack =
        parseWeaponAttack(trait.description) || parseWeaponAttackWithVersatile(trait.description) || parseWeaponAttackWithRider(trait.description);
      if (parsedAttack) {
        const templateId = resolveTemplateId(`feat.${cappedSlug(baseAbilityName(trait.name))}`, existingFeatures);
        let template = candidatePool.find((feature) => feature.id === templateId);
        if (template) {
          result.matchedCount += 1;
        } else {
          template = {
            id: templateId,
            name: cappedDisplayName(baseAbilityName(trait.name)),
            systemIds: systemId ? [systemId] : [],
            description: `${parsedAttack.kind} ${parsedAttack.attackKind} Attack against one target.`,
            mechanics: { type: "weapon-attack" },
            budgetCost: 0,
            tags: { behaviors: [], recipeSlots: [], roles: [], creatureTypes: [], categories: ["monster"] },
            synergizesWith: [],
            conflictsWith: [],
            ...(actionCost ? { combat: { actionCost } } : {}),
          };
          await dataManager.save("feature", template.id, template);
          candidatePool.push(template);
          result.createdCount += 1;
        }
        featureIds.push(template.id);
        // Never overwrite an existing name->id mapping — see the note on
        // the generic findMatch/one-off branches below for why (Multiattack
        // resolution depends on the FIRST, most-mechanically-real Feature a
        // name resolves to, never a same-named later entry from a
        // different ability group).
        if (!nameToFeatureId.has(normalizeName(trait.name))) nameToFeatureId.set(normalizeName(trait.name), template.id);
        featureParams[template.id] = parsedAttack;
        continue;
      }
      // Same "matches/creates by NAME ALONE against a shared, number-free
      // template" reasoning as the weapon-attack branch above — a breath
      // weapon's own trait name is already element-specific in practice
      // ("Acid Breath" never gets reused by a monster whose breath is
      // actually poison), so name-only matching is safe here for the same
      // reason it's safe there: the shared template carries no numbers of
      // its own to get wrong, and findMatch's own description-similarity
      // logic would always disagree anyway since the numbers genuinely
      // differ per monster.
      const parsedSaveEffect = parseSaveEffect(substitutedDescription);
      if (parsedSaveEffect) {
        const templateId = resolveTemplateId(`feat.${cappedSlug(baseAbilityName(trait.name))}`, existingFeatures);
        let template = candidatePool.find((feature) => feature.id === templateId);
        if (template) {
          result.matchedCount += 1;
        } else {
          template = {
            id: templateId,
            name: cappedDisplayName(baseAbilityName(trait.name)),
            systemIds: systemId ? [systemId] : [],
            description: `The creature ${parsedSaveEffect.verb} ${parsedSaveEffect.substance} in an area, forcing a saving throw or dealing damage.`,
            mechanics: { type: "save-effect" },
            budgetCost: 0,
            tags: { behaviors: [], recipeSlots: [], roles: [], creatureTypes: [], categories: ["monster"] },
            synergizesWith: [],
            conflictsWith: [],
            ...(actionCost ? { combat: { actionCost } } : {}),
          };
          await dataManager.save("feature", template.id, template);
          candidatePool.push(template);
          result.createdCount += 1;
        }
        featureIds.push(template.id);
        if (!nameToFeatureId.has(normalizeName(trait.name))) nameToFeatureId.set(normalizeName(trait.name), template.id);
        featureParams[template.id] = parsedSaveEffect;
        continue;
      }
      // substitutedDescription (computed above, before the weapon-attack
      // block) is what findMatch actually compares below: a fresh import's
      // own monster-name mentions read the same as the generic wording
      // already stored on shared/tiered Features, it's what a newly-created
      // one-off Feature is stored with (so it starts out generic instead of
      // needing this same cleanup again later), and it's what a
      // newly-discovered named tier's own text is stored with.
      const match = findMatch({ name: trait.name, description: substitutedDescription }, candidatePool);
      if (match) {
        const matchedFeature = match.feature;
        featureIds.push(matchedFeature.id);
        // Never overwrite an existing name->id mapping here. ABILITY_GROUP_KEYS
        // processes groups in a fixed order (actions before legendaryActions),
        // and a monster whose `legendary_actions` list re-mentions an attack
        // by its own plain name ("Claw." — "The dragon makes one Claw
        // attack.") used to silently clobber that SAME name's earlier,
        // real mapping from the `actions` group (the actual templated
        // weapon-attack Feature) — confirmed live: Adult Topaz Dragon's own
        // Multiattack ("...and two Claw attacks") ended up pointing at the
        // Legendary Action wrapper Feature instead of the real weapon
        // attack once this ran, since the legendary-action entry is
        // processed later and always overwrote it. Keeping the FIRST
        // mapping means Multiattack always resolves to the mechanically
        // real ability, never a same-named wrapper/reference encountered
        // later in the stat block.
        if (!nameToFeatureId.has(normalizeName(trait.name))) nameToFeatureId.set(normalizeName(trait.name), matchedFeature.id);
        result.matchedCount += 1;
        // Backfill actionCost only if the matched Feature doesn't already
        // have one — never silently overwrite already-authored content
        // just because this particular import happened to categorize the
        // same mechanic differently.
        if (actionCost && !matchedFeature.combat?.actionCost) {
          matchedFeature.combat = { ...(matchedFeature.combat || {}), actionCost };
          await dataManager.save("feature", matchedFeature.id, matchedFeature);
        }
        // A monster-slug-prefixed id (`feat.<monsterSlug>-...`) is, by this
        // module's own id convention, a one-off scoped to THIS monster —
        // never a shared/canonical Feature (those are never monster-slug-
        // prefixed). Re-importing the same monster re-matches its own
        // already-existing one-off (same name, near-identical content) far
        // more often than it creates a fresh one, and unlike a genuinely
        // shared Feature (never blindly overwritten — it may be curated, or
        // used by other monsters) this monster's own prior one-off is safe
        // to refresh: it can only ever have come from an earlier pass of
        // this exact same automatic conversion, never hand-authored.
        // Confirmed live: Adult Oblex's own "Aversion to Fire" and Cactid's
        // own "Hail of Needles" both re-matched their pre-existing one-offs
        // on re-import and silently kept last time's un-genericized text —
        // matching alone was never enough, the match's own stored text
        // needs to move forward too.
        if (matchedFeature.id.startsWith(`feat.${monsterSlug}-`) && matchedFeature.description !== substitutedDescription) {
          matchedFeature.description = substitutedDescription || "";
          if (matchedFeature.mechanics && typeof matchedFeature.mechanics.text === "string") {
            matchedFeature.mechanics.text = substitutedDescription || "";
          }
          await dataManager.save("feature", matchedFeature.id, matchedFeature);
        }
        // Name-suffix tiers ("(N/Day)"/"(Recharge N)") take priority since
        // they're an unambiguous, deterministic label; only when a trait's
        // name carries neither does findMatch's own tier-text match (a
        // trait whose SUBSTITUTED description matched one of the Feature's
        // existing description-encoded tiers, e.g. Teleport's "60 ft."
        // tier) apply — never both at once in practice.
        const namedTierId = await resolveNamedTier(trait, matchedFeature, dataManager, substitutedDescription);
        const tierId = namedTierId || match.tierId || null;
        if (tierId) featureTiers[matchedFeature.id] = tierId;
        continue;
      }
      const newFeature = {
        id: `feat.${monsterSlug}-${cappedSlug(trait.name)}`,
        name: cappedDisplayName(trait.name),
        systemIds: systemId ? [systemId] : [],
        description: substitutedDescription || "",
        // scope: "unique" — a monster-slug-prefixed id is, by this
        // module's own convention, scoped to THIS monster alone (see the
        // "matchedFeature.id.startsWith" refresh-on-reimport comment
        // above) — never a shared/canonical Feature, so it should never
        // be silently eligible for native generation, and should be
        // immediately editable from Crucible's own Inspector (which gates
        // editability on this exact flag). Previously left unset, so
        // every freshly-imported one-off was both wrongly generation-
        // eligible and stuck read-only until someone hand-reviewed it.
        mechanics: { type: "passive", scope: "unique", text: substitutedDescription || "" },
        // 0, not omitted — this is genuinely unbalanced/unreviewed content
        // (see the module comment), and an explicit 0 reads as "not yet
        // costed" rather than silently behaving like a free pick forever.
        budgetCost: 0,
        tags: { behaviors: [], recipeSlots: [], roles: [], creatureTypes: [], categories: ["monster"] },
        synergizesWith: [],
        conflictsWith: [],
        ...(actionCost ? { combat: { actionCost } } : {}),
      };
      await dataManager.save("feature", newFeature.id, newFeature);
      candidatePool.push(newFeature);
      featureIds.push(newFeature.id);
      if (!nameToFeatureId.has(normalizeName(trait.name))) nameToFeatureId.set(normalizeName(trait.name), newFeature.id);
      result.createdCount += 1;
      } catch (error) {
        const message = error?.message || String(error);
        result.errors.push({ trait: trait.name, groupKey, message });
        console.warn(`monster-feature-matching: failed to convert trait "${trait.name}" (${groupKey}) — kept the rest of this monster's own conversion going. ${message}`);
      }
    }
    delete stats[groupKey];
  }

  for (const { trait, actionCost, index } of deferredMultiattacks) {
    // Same "one bad trait can't take the whole monster down" reasoning as
    // the try/catch above — featureIds[index] is left at its placeholder
    // `null` on failure (renderFeatureList's own findById already handles
    // an unresolvable id gracefully) rather than the exception propagating
    // and aborting everything after this monster's own Multiattack.
    try {
      let template = candidatePool.find((entry) => entry.id === MULTIATTACK_TEMPLATE_ID);
      if (!template) {
        template = {
          id: MULTIATTACK_TEMPLATE_ID,
          name: "Multiattack",
          systemIds: systemId ? [systemId] : [],
          description: "The creature makes multiple attacks.",
          mechanics: { type: "multiattack" },
          budgetCost: 0,
          tags: { behaviors: [], recipeSlots: [], roles: [], creatureTypes: [], categories: ["monster"] },
          synergizesWith: [],
          conflictsWith: [],
          ...(actionCost ? { combat: { actionCost } } : {}),
        };
        await dataManager.save("feature", template.id, template);
        candidatePool.push(template);
        result.createdCount += 1;
      } else {
        result.matchedCount += 1;
        if (actionCost && !template.combat?.actionCost) {
          template.combat = { ...(template.combat || {}), actionCost };
          await dataManager.save("feature", template.id, template);
        }
      }
      featureIds[index] = template.id;
      featureParams[template.id] = buildMultiattackParams(trait, { nameToFeatureId, monsterName: record?.name, creatureType: record?.type });
    } catch (error) {
      const message = error?.message || String(error);
      result.errors.push({ trait: trait.name, groupKey: "multiattack", message });
      console.warn(`monster-feature-matching: failed to convert Multiattack trait "${trait.name}" — kept the rest of this monster's own conversion going. ${message}`);
    }
  }

  // Saving Throws/Skills come off an import as `[{name, value}]`; Spells is
  // an intro sentence plus per-frequency spell-list objects. Nothing in
  // Crucible reads either shape programmatically (deriveStats' own native
  // output has no equivalent field at all), and Crucible's Stats section
  // (renderStats) renders every stat as a plain editable text box — so both
  // get flattened to one plain string here, the same "fully editable, no
  // bespoke structure" treatment every other imported stat already gets.
  // Idempotent: a value that's already a string (already converted, or a
  // hand-authored record) is left alone.
  if (Array.isArray(stats.savingThrows)) stats.savingThrows = formatValueList(stats.savingThrows);
  if (Array.isArray(stats.skills)) stats.skills = formatValueList(stats.skills);
  // Only fills stats.spells from the Spellcasting trait(s) skipped above
  // when a source didn't already provide one directly (Fantasy Statblocks'
  // own dedicated `spells` field) — never overwrites real structured/
  // authored data with the trait's own prose fallback.
  if (stats.spells === undefined && spellcastingTexts.length) {
    stats.spells = spellcastingTexts.join("\n\n");
  }
  if (stats.spells !== undefined) stats.spells = formatSpells(stats.spells);

  // Best-effort: a monster with real Spellcasting always states its own
  // spell save DC in that trait's own text ("...spell save DC 12...") — the
  // one DC of the several a stat block can have (see undercroft/README.md's
  // stats.saveDC entry) that's both consistently phrased and consistently
  // the one a GM most wants at a glance next to the Spells box. Reads the
  // FINAL stats.spells string, not just the local spellcastingTexts
  // fallback above — a source with its own dedicated spells field (Fantasy
  // Statblocks' `spells` frontmatter) never touches spellcastingTexts at
  // all (nothing to skip out of `traits`, since a well-formed file already
  // keeps spellcasting prose out of there), so gating on that array being
  // non-empty silently skipped every one of those imports' own DC — same
  // "spell save DC 12" text lives in stats.spells either way, whichever
  // path put it there. Only fills stats.saveDC when it isn't already set —
  // same "never overwrite an already-authored value" rule every other
  // backfill here follows.
  if (stats.saveDC === undefined && typeof stats.spells === "string") {
    const match = stats.spells.match(/spell save DC\s*(\d+)/i);
    if (match) stats.saveDC = Number(match[1]);
  }

  record.featureIds = featureIds;
  result.featureIds = featureIds;
  // Sparse, same convention as every other optional stats.* field — only
  // present at all once a monster actually has a tiered Feature.
  if (Object.keys(featureTiers).length) record.featureTiers = featureTiers;
  if (Object.keys(featureParams).length) record.featureParams = featureParams;
  return result;
}

function formatValueList(entries) {
  if (!Array.isArray(entries) || !entries.length) return "";
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== "object") return String(entry);
      const numericValue = Number(entry.value);
      const sign = Number.isFinite(numericValue) && numericValue >= 0 ? "+" : "";
      const displayValue = Number.isFinite(numericValue) ? numericValue : (entry.value ?? "");
      return `${entry.name || ""} ${sign}${displayValue}`.trim();
    })
    .filter(Boolean)
    .join(", ");
}

function formatSpells(spells) {
  if (typeof spells === "string") return spells;
  if (!Array.isArray(spells) || !spells.length) return "";
  return spells
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        return Object.entries(entry)
          .map(([frequency, list]) => `${frequency}: ${list}`)
          .join("; ");
      }
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

// Loom's own saveEntity checks this before running the conversion above at
// all — a monster whose importer already produced no traits/actions (or a
// hand-authored one with a genuinely empty stat block) has nothing to
// convert, so there's no point fetching the feature library or touching the
// record for it.
export function hasConvertibleStatBlock(record) {
  const stats = record?.stats;
  if (!stats) return false;
  return ABILITY_GROUP_KEYS.some((key) => Array.isArray(stats[key]) && stats[key].length > 0);
}
