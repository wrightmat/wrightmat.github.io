// Turns an imported monster's flat `stats.traits`/`actions`/`bonusActions`/
// `reactions`/`legendaryActions`/`lairActions` (the one canonical shape both
// the DDB and Fantasy Statblocks mappings converge on — each entry
// `{name, description}`) into real `feature` Library references, so an
// imported monster ends up structurally identical to a Crucible-generated
// one: `isImportedStatBlock` keys off `featureIds` being a real array, and
// every existing Crucible code path just works with zero special-casing.
//
// Two call sites share this exact function, both automatic-on-save: Loom's
// saveEntity, and Crucible's own handleSave (since Crucible's save path
// bypasses saveEntity entirely). Every monster save gets this
// unconditionally, not as an opt-in step. Idempotent by construction
// (hasConvertibleStatBlock returns false once nothing's left to convert),
// so it's also what repairs a monster imported before this module existed,
// the next time it's opened and saved.
//
// The kind-agnostic matching/dedup/tiering/options machinery this module
// relies on now lives in feature-import-core.js, shared with Vault's own
// spell/item importer — this file keeps only what's genuinely about PARSING
// 5e monster stat-block prose.
import {
  normalizeName,
  cappedSlug,
  cappedDisplayName,
  resolveTemplateId,
  findMatch,
  baseAbilityName,
  resolveNamedTier,
  detectChoiceEffectGroup,
  splitEmbeddedEffectOptions,
  saveOptionsFeature,
} from "./feature-import-core.js";

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

// Descriptors too generic/common to safely stand in as "this refers to the
// monster" on their own (age/size adjectives, common-word overlaps with
// real ability vocabulary) — excluded even when they're one of a monster's
// own name words. The full name is always tried first regardless.
const GENERIC_NAME_WORDS = new Set(["adult", "young", "greater", "lesser", "giant", "the", "of", "and", "a", "an"]);

// Only ever substitutes a VERIFIED reference to THIS monster's own name
// (its full name, or an individual word over 3 characters, minus common
// age/size descriptors), always preceded by an article — never guesses at
// sentence structure, so it can't eat into unrelated later text. Case-
// insensitive, while preserving the matched article's own case for output.
// Applied to every trait's description before matching AND when storing a
// newly-created one-off Feature, so a freshly-imported ability starts out
// generic instead of baking one monster's name into shared Library content.
// A combat-language-detected "the attacker" fallback for a "the creature"
// collision was tried and reverted — "attacker" produced its own wrong text
// just as often (a breath weapon "attacking" reads oddly; a protective
// reaction attributing to "the attacker" is flatly wrong when the monster
// is the protector). The monster's own creature type reads correctly in
// every case instead, since it's just an ordinary noun.

function knownNameSubstitute(text, monsterName, creatureType) {
  const raw = String(text || "");
  const name = String(monsterName || "").trim();
  if (!name) return raw;
  const words = name.split(/\s+/).filter(Boolean);
  const seen = new Set([name.toLowerCase()]);
  const candidates = [name];
  // Contiguous multi-word slices, longest first — a colloquial partial
  // reference to a multi-word name ("the deep one" for "Deep One
  // Archimandrite") needs to be recognized as a WHOLE phrase, not word-by-
  // word, or only the first word matches, leaving the rest dangling as
  // broken trailing text. Listed before the single-word candidates so the
  // regex alternation (first-match-wins per position) prefers the longer
  // slice. Not filtered by GENERIC_NAME_WORDS — that check exists to keep a
  // bare generic word ("giant") from matching alone, but as part of a real
  // multi-word slice ("Adult Black" in "Adult Black Dragon") it's still
  // unambiguously a reference to this monster.
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
  // A real 5e trait's text almost always ALSO uses "creature" as a plain
  // common noun for its TARGETS, alongside the monster's own self-reference
  // by name that this function is about to genericize. Substituting the
  // self-reference with the same word ("the creature") then collides with
  // those pre-existing target-references, producing an unreadable sentence
  // where "creature" means two different things at once. Falls back to this
  // monster's own creature type once a collision is detected — a plain
  // noun, so it reads correctly regardless of what the ability does (see
  // the module note above for why "the attacker" was tried and reverted).
  // A missing/unknown creatureType falls back to "attacker" as an
  // imperfect last resort, rare in practice since every real monster
  // record carries its own `type`.
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
// ATTACK and one gore attack"). The general patterns below require EVERY
// item to carry its own trailing "attack(s)"/"with its", so this elliptical
// 2-item shape would otherwise silently swallow "bite and one gore" as one
// unresolvable name and fail the whole segment. Anchored end-to-end so it
// only fires on exactly this shape, never partially matches something else.
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
// "either" is a discourse marker paired with "or", stripped rather than
// treated as its own boundary.
// A bare comma (not immediately before "or") is ALSO a valid option
// boundary, but ONLY when the text never uses "and" anywhere. Real 5e
// Oxford-comma phrasing lists 3+ PEER alternatives this way, "or" appearing
// only before the last one — without this, two comma-separated options get
// mis-parsed as one option worth the sum of both, a genuine semantic bug.
// Gated on the absence of "and" specifically because "and" is the word
// every real AND-combo option uses to bind its own items together — if
// "and" appears anywhere, a bare comma might legitimately be part of an
// Oxford-comma AND-list WITHIN one option, so this falls back to the more
// conservative comma-only-directly-before-or behavior instead.
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
// per-segment: "two Stab or Spike attacks" means "two attacks, each a Stab
// or a Spike" — the count and trailing "attacks" noun are shared across
// both names rather than repeated, so the generic split-on-"or" path would
// produce two segments neither of which parses on its own. Anchored to the
// full text so it never partially matches a longer sentence with real extra
// content after it (a second sentence changing what the ability does must
// not be silently swallowed into a false choice).
const SHARED_SUFFIX_CHOICE_PATTERN =
  /^The creature makes (one|two|three|four|five|six|seven|eight)\s+([a-z][a-z '’-]*?)\s+or\s+([a-z][a-z '’-]*?)\s+attacks?\.?$/i;

// Parses a Multiattack trait's own free text ("The aalpamac makes three
// attacks: one with its bite and two with its claws.") into structured
// `{featureId, count}` references against this monster's own already-
// resolved attack Features. Two return shapes:
// - a flat `{featureId, count}[]` for a fixed combination (no real choice).
// - `{options: Array<{featureId,count}[]>}` for a genuine CHOICE ("two X,
//   two Y, or one of each") — an "or"/"either" cue means summing every
//   mentioned count would misrepresent the ability. Each top-level "or"
//   segment is parsed independently; if ANY segment fails to parse (a
//   genuinely nested/conditional phrasing), this returns null for the WHOLE
//   trait rather than a wrong partial structure.
// The caller always keeps the original text as a fallback either way, so a
// null return here never loses information — Crucible just renders the
// stored text instead of computing it.
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

  // Multiple sentences (an interior period, not just one at the end) means
  // an "or" anywhere in the text isn't necessarily a clean top-level option
  // boundary for the whole thing — a second, unrelated sentence's own
  // "and"-list could bleed into the first sentence's last "or" segment,
  // since splitTopLevelOptions only splits on "or", not sentence
  // boundaries. Bailing here (never a wrong merge) rather than also
  // reasoning about per-sentence/form structure.
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
      // Wraps this whole trait's processing so ONE bad trait (malformed
      // source data producing an oversized id, a save failing for any
      // reason) can only ever cost THIS trait its own Feature, never the
      // rest of the monster. `result.errors` carries what failed back to
      // the caller to surface instead of staying silent.
      try {
      // A "roll/pick one of the following" choice-effect ability, split
      // across several separate {name, desc} entries by the source itself
      // (numbered "1. Poison Damage:"/"2. Confusion:", or plain-named
      // "Amethyst."/"Crystal.") — consumed as ONE Feature's own `options`
      // instead of becoming standalone Features that don't make sense read
      // alone.
      const choiceGroup = detectChoiceEffectGroup(entries, entryIndex, looksLikeIndependentAbility);
      if (choiceGroup) {
        const optionsFeatureId = await saveOptionsFeature(trait, trait.description, choiceGroup.options, {
          candidatePool, recordSlug: monsterSlug, systemId, actionCost, category: "monster",
          substitute: (text) => knownNameSubstitute(text, record?.name, record?.type), dataManager, result,
        });
        featureIds.push(optionsFeatureId);
        if (!nameToFeatureId.has(normalizeName(trait.name))) nameToFeatureId.set(normalizeName(trait.name), optionsFeatureId);
        entryIndex += choiceGroup.consumedCount;
        continue;
      }
      // The OTHER real shape: the choice is already this one entry's own
      // multi-paragraph text ("uses one of the following breath weapons.\n
      // Fire Breath. ...\nWeakening Breath. ..."), never split into
      // separate entries by the source. Same treatment as above, just with
      // nothing following to skip past.
      const embeddedOptions = splitEmbeddedEffectOptions(trait.description);
      if (embeddedOptions) {
        const optionsFeatureId = await saveOptionsFeature(trait, embeddedOptions.intro, embeddedOptions.options, {
          candidatePool, recordSlug: monsterSlug, systemId, actionCost, category: "monster",
          substitute: (text) => knownNameSubstitute(text, record?.name, record?.type), dataManager, result,
        });
        featureIds.push(optionsFeatureId);
        if (!nameToFeatureId.has(normalizeName(trait.name))) nameToFeatureId.set(normalizeName(trait.name), optionsFeatureId);
        continue;
      }
      // Spellcasting is prose (an intro sentence plus a per-frequency spell
      // list), not a discrete atomic ability — it doesn't participate in
      // Crucible's recipe-slot/synergy Feature model, and creating a
      // Feature for it just duplicates stats.spells, the one dedicated
      // field for this. Matches "Spellcasting"/"Innate Spellcasting"/etc. —
      // only ever a trait, never an action/reaction/legendary/lair entry.
      if (groupKey === "traits" && normalizeName(trait.name).includes("spellcasting")) {
        if (trait.description) spellcastingTexts.push(trait.description);
        continue;
      }
      // "Multiattack" is a menu of a monster's OWN other attacks, so its
      // content is monster-specific by definition and should never be
      // MATCHED against another monster's own Multiattack text no matter
      // how the generic phrasing scores. findMatch is skipped entirely and
      // this always resolves to the one shared `feat.multiattack` template
      // (MULTIATTACK_TEMPLATE_ID below, the same feat.bite/feat.claw
      // convention extended to cover this too), with the structured
      // reference list living in record.featureParams instead of prose — a
      // reserved placeholder slot in featureIds holds its eventual position.
      if (normalizeName(trait.name) === "multiattack") {
        deferredMultiattacks.push({ trait, actionCost, index: featureIds.length });
        featureIds.push(null);
        continue;
      }
      // A cleanly-parseable simple weapon attack matches/creates by NAME
      // ALONE against a shared, number-free template — never findMatch's
      // description-similarity logic, which would always disagree since
      // the numbers genuinely differ per monster. `feat.<slug(name)>`
      // deliberately has no monster-slug prefix, unlike every other
      // created-here id, since it's meant to be reused by name across
      // every monster with an attack of this name.
      // parseWeaponAttackWithRider only runs once the clean pattern has
      // already failed, and its return shape is a strict superset of
      // parseWeaponAttack's own — so the match/create-template block below
      // handles either result identically. The template's own description
      // stays rider-agnostic since the rider is per-monster data
      // (featureParams), never baked into the shared template.
      const substitutedDescription = knownNameSubstitute(trait.description, record?.name, record?.type);
      const parsedAttack =
        parseWeaponAttack(trait.description) || parseWeaponAttackWithVersatile(trait.description) || parseWeaponAttackWithRider(trait.description);
      if (parsedAttack) {
        const templateId = resolveTemplateId(`feat.${cappedSlug(baseAbilityName(trait.name))}`, existingFeatures, ["monster"], "monster");
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
      // Same "matches/creates by NAME ALONE" reasoning as the weapon-attack
      // branch above — a breath weapon's trait name is already element-
      // specific in practice ("Acid Breath" never gets reused by a monster
      // whose breath is actually poison), and the shared template carries
      // no numbers of its own to get wrong.
      const parsedSaveEffect = parseSaveEffect(substitutedDescription);
      if (parsedSaveEffect) {
        const templateId = resolveTemplateId(`feat.${cappedSlug(baseAbilityName(trait.name))}`, existingFeatures, ["monster"], "monster");
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
      // substitutedDescription is what findMatch actually compares below: a
      // fresh import's own monster-name mentions read the same as the
      // generic wording already stored on shared/tiered Features, and it's
      // what a newly-created one-off Feature is stored with, so it starts
      // out generic instead of needing this same cleanup again later.
      const match = findMatch({ name: trait.name, description: substitutedDescription }, candidatePool);
      if (match) {
        const matchedFeature = match.feature;
        featureIds.push(matchedFeature.id);
        // Never overwrite an existing name->id mapping here. ABILITY_GROUP_KEYS
        // processes groups in a fixed order (actions before legendaryActions),
        // and a monster whose `legendary_actions` list re-mentions an attack
        // by its own plain name ("Claw." — "The dragon makes one Claw
        // attack.") would otherwise clobber that SAME name's earlier, real
        // mapping from the `actions` group with the Legendary Action
        // wrapper Feature instead. Keeping the FIRST mapping means
        // Multiattack always resolves to the mechanically real ability.
        if (!nameToFeatureId.has(normalizeName(trait.name))) nameToFeatureId.set(normalizeName(trait.name), matchedFeature.id);
        result.matchedCount += 1;
        // Backfill actionCost only if the matched Feature doesn't already
        // have one — never overwrite already-authored content just because
        // this import categorized the same mechanic differently.
        if (actionCost && !matchedFeature.combat?.actionCost) {
          matchedFeature.combat = { ...(matchedFeature.combat || {}), actionCost };
          await dataManager.save("feature", matchedFeature.id, matchedFeature);
        }
        // A monster-slug-prefixed id (`feat.<monsterSlug>-...`) is, by this
        // module's own convention, a one-off scoped to THIS monster, never
        // a shared/canonical Feature. Re-importing the same monster
        // re-matches its own already-existing one-off far more often than
        // it creates a fresh one, and unlike a genuinely shared Feature
        // (never blindly overwritten), this monster's prior one-off is safe
        // to refresh — it can only have come from an earlier pass of this
        // exact same automatic conversion, never hand-authored. Matching
        // alone isn't enough; the match's own stored text needs to move
        // forward too, or it silently keeps last time's un-genericized text.
        if (matchedFeature.id.startsWith(`feat.${monsterSlug}-`) && matchedFeature.description !== substitutedDescription) {
          matchedFeature.description = substitutedDescription || "";
          if (matchedFeature.mechanics && typeof matchedFeature.mechanics.text === "string") {
            matchedFeature.mechanics.text = substitutedDescription || "";
          }
          await dataManager.save("feature", matchedFeature.id, matchedFeature);
        }
        // Name-suffix tiers ("(N/Day)"/"(Recharge N)") take priority since
        // they're an unambiguous, deterministic label; only when a trait's
        // name carries neither does findMatch's own tier-text match apply —
        // never both at once in practice.
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
        // scope: "unique" — a monster-slug-prefixed id is scoped to THIS
        // monster alone, never a shared/canonical Feature, so it should
        // never be silently eligible for native generation, and should be
        // immediately editable from Crucible's Inspector (which gates
        // editability on this exact flag).
        mechanics: { type: "passive", scope: "unique", text: substitutedDescription || "" },
        // 0, not omitted — this is genuinely unbalanced/unreviewed content,
        // and an explicit 0 reads as "not yet costed" rather than silently
        // behaving like a free pick forever.
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
    // `null` on failure (findById already handles an unresolvable id
    // gracefully) rather than the exception aborting everything after this.
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
  // Crucible reads either shape programmatically, and Crucible's Stats
  // section renders every stat as a plain editable text box — so both get
  // flattened to one plain string here. Idempotent: a value that's already
  // a string is left alone.
  if (Array.isArray(stats.savingThrows)) stats.savingThrows = formatValueList(stats.savingThrows);
  if (Array.isArray(stats.skills)) stats.skills = formatValueList(stats.skills);
  // Only fills stats.spells from the Spellcasting trait(s) skipped above
  // when a source didn't already provide one directly — never overwrites
  // real structured/authored data with the trait's own prose fallback.
  if (stats.spells === undefined && spellcastingTexts.length) {
    stats.spells = spellcastingTexts.join("\n\n");
  }
  if (stats.spells !== undefined) stats.spells = formatSpells(stats.spells);

  // Best-effort: a monster with real Spellcasting always states its own
  // spell save DC in that trait's text ("...spell save DC 12..."), the one
  // DC that's both consistently phrased and the one a GM most wants at a
  // glance. Reads the FINAL stats.spells string, not just the local
  // spellcastingTexts fallback above — a source with its own dedicated
  // spells field never touches spellcastingTexts, so gating on that array
  // would silently skip every one of those imports' own DC. Only fills
  // stats.saveDC when it isn't already set.
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
