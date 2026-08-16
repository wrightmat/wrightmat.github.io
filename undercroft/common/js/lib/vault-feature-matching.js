// Turns an imported spell/magic item's own mapped `stats` (see
// mapping-custom-functions.js's srdSpellStats/srdItemStats for the exact
// shape a mapping produces) into real `feature` Library references, so an
// imported Effect ends up structurally identical to a Vault-generated one:
// `featureIds` being a real array is what every existing Vault code path
// (Add Feature select, Features list, budget display) already expects,
// mirroring exactly what monster-feature-matching.js does for Crucible's
// own monster import.
//
// Built on feature-import-core.js — the same matching/dedup/tiering/options
// engine Crucible's own importer uses, hardened across a long SRD monster-
// import cleanup (false merges, id fragmentation, options-array destruction,
// dangling featureParams keys). Every one of those safety properties
// (candidatePool scope/category correctness, collision-aware template ids,
// never touching an `options`-bearing Feature) is reused as-is here rather
// than re-earned the hard way a second time.
//
// A magic item's OWN prose is not pre-segmented into atomic abilities the
// way a monster's `stats.traits`/`actions` already are (each arrives as its
// own {name, description} entry before any of this pipeline runs) — the 5e
// API's own `desc` field is just paragraphs of prose, often describing
// SEVERAL distinct abilities at once (a real item confirmed live: three
// separate bulleted abilities in one item). The first version of this
// module missed that and dumped an item's ENTIRE remaining description into
// ONE Feature named after the item — not reusable, not granular, not
// actually a "Feature" in this suite's own sense. This version instead
// processes every `stats.candidateUnits` entry (the mapping's own
// paragraph/bullet-segmented remaining prose) independently against a
// library of generic clause recognizers, exactly the way monster import
// processes every trait/action independently — one Effect can produce
// several Features, same as one monster already does.
import {
  cappedSlug,
  cappedDisplayName,
  resolveTemplateId,
  splitMarkdownTableOptions,
} from "./feature-import-core.js";

const VAULT_CATEGORIES = ["spell", "item"];
const PASSIVE_BONUS_TEMPLATE_TYPE = "item-passive-bonus";
// Every generic reusable Feature the clause-recognizer library below
// targets already exists as ordinary hand-authored Vault content (Phase 1
// of this redesign — `feat.damage-modification`, `feat.skill-bonus`, etc.)
// with `mechanics.type: "active"`, the same type Vault's own pre-existing
// starter Features already use. Reused here rather than inventing a new
// type per clause shape, since these ARE that same kind of Feature.
const GENERIC_ACTIVE_TYPE = "active";

// Every SRD spell/magic item this pipeline recognizes is matched/created
// against a shared template keyed purely by NAME — same reasoning
// monster-feature-matching.js's parseWeaponAttack/parseSaveEffect branches
// already established: the shared template carries no numbers of its own
// (those live in this record's own `featureParams`), so comparing
// descriptions would always disagree and isn't needed at all. Two
// completely different spells/items happening to share an exact name is
// the same acceptable, already-tolerated edge case monster import accepts
// for Bite/Claw/etc.
async function matchOrCreateParameterizedFeature(name, mechanicsType, { candidatePool, existingFeatures, systemId, dataManager, result }) {
  const templateId = resolveTemplateId(`feat.${cappedSlug(name)}`, existingFeatures, VAULT_CATEGORIES, "effect");
  let template = candidatePool.find((feature) => feature.id === templateId);
  if (template) {
    result.matchedCount += 1;
  } else {
    template = {
      id: templateId,
      name: cappedDisplayName(name),
      systemIds: systemId ? [systemId] : [],
      description: "",
      mechanics: { type: mechanicsType },
      budgetCost: 0,
      tags: { behaviors: [], recipeSlots: [], roles: [], creatureTypes: [], categories: [mechanicsType === PASSIVE_BONUS_TEMPLATE_TYPE ? "item" : "spell"] },
      synergizesWith: [],
      conflictsWith: [],
    };
    await dataManager.save("feature", template.id, template);
    candidatePool.push(template);
    result.createdCount += 1;
  }
  return template;
}

// A magic item's own rarity-linked bonus family (Weapon +1/+2/+3, Armor
// +1/+2/+3, ...) is given to us pre-grouped by the SRD itself — the parent
// list entry ("Weapon, +1, +2, or +3") carries `variant: false` plus a
// `variants` array naming each concrete child; each child carries
// `variant: true` and no `variants` of its own (confirmed live against the
// real 5e API — /api/2014/magic-items/weapon and its own /weapon-1,
// /weapon-2, /weapon-3 children). The mapping never produces an Effect
// record for the PARENT row at all (it isn't a concrete item a GM would
// actually hand a player — see 5e-api-magic-item.json's own comment), so
// this module only ever sees CHILD rows, each already carrying its own
// `stats.variantGroup` (the parent's own index, e.g. "weapon") and
// `stats.variantTier` ({id, name} — this child's own rarity-derived tier,
// e.g. {id: "plus-1", name: "+1"}) when it belongs to such a family. This
// is a genuinely different case from a spell's own slot-level scaling: a
// specific owned magic item really IS exactly one rarity/bonus tier, a
// fixed choice per Effect record — precisely what Tiers exist to model —
// never a value chosen fresh at every use the way a spell's own slot level
// is (see CLAUSE_RECOGNIZERS' own castASpell entry for that contrast).
//
// `stats.variantGroup` itself ("weapon"/"armor"/"ammunition"/"wand-of-the-
// war-mage") names the item's own FORM, never a mechanic — an earlier
// version of this function used it directly as a new Feature's own name,
// which the user correctly called out as the same mistake this whole
// redesign exists to fix (an item-shaped Feature, not a granular reusable
// one) — worse, it duplicated content that ALREADY existed as
// `feat.weapon-enhancement`/`feat.armor-class-bonus`/
// `feat.spell-attack-bonus` (pre-existing Vault content, untouched by this
// session's own Phase 1). Routed through this lookup instead of a name
// transform, so the family maps onto the Feature that actually describes
// what the bonus DOES; the item's own Form belongs on the Effect record
// itself (see `record.properties.form`, set by the caller from
// `stats.properties`), never baked into a Feature's own identity.
const VARIANT_GROUP_MECHANIC_NAME = {
  weapon: "Weapon Enhancement",
  ammunition: "Weapon Enhancement",
  armor: "Armor Class Bonus",
  "wand-of-the-war-mage": "Spell Attack Bonus",
};

async function resolvePassiveBonusFeature(stats, ctx) {
  const { candidatePool, existingFeatures, systemId, dataManager, result } = ctx;
  const mechanic = stats.mechanic;
  const isVariant = Boolean(stats.variantGroup);
  const name = isVariant ? VARIANT_GROUP_MECHANIC_NAME[stats.variantGroup] || cappedDisplayName(stats.variantGroup) : stats.name;
  const template = await matchOrCreateParameterizedFeature(name, PASSIVE_BONUS_TEMPLATE_TYPE, { candidatePool, existingFeatures, systemId, dataManager, result });

  if (!isVariant) {
    return { featureId: template.id, featureParams: { bonusValue: mechanic.bonusValue, bonusTarget: mechanic.bonusTarget }, tierId: null };
  }

  // First child of this family to import seeds the template's own tiers;
  // every subsequent child (any order) just adds its own — mirrors
  // resolveNamedTier's own "create tier if missing" idempotency
  // (monster-feature-matching.js).
  const tierId = stats.variantTier.id;
  const tiers = Array.isArray(template.tiers) ? template.tiers : [];
  if (!tiers.some((tier) => tier.id === tierId)) {
    template.tiers = [
      ...tiers,
      { id: tierId, name: stats.variantTier.name, shortName: stats.variantTier.name, mechanics: { text: mechanic.bonusText || "" } },
    ];
    await dataManager.save("feature", template.id, template);
  }
  return { featureId: template.id, featureParams: null, tierId };
}

// A wand/staff/rod's own "cast one of the following spells" menu is the
// SAME shape as a monster's own Multiattack (monster-feature-matching.js):
// a single generic Feature (`feat.spell-menu` / `feat.multiattack`) whose
// own text carries no numbers at all, plus a per-record params list
// referencing the actual options — never a fresh Feature per item, and
// never one Feature per listed spell either (each spell is only meaningful
// as part of THIS item's own menu, not independently reusable the way a
// monster's own Bite/Claw attacks are). `saveDC` is the item's own literal
// fixed value (present on some items, absent on others — e.g. Rod of
// Alertness's own detect-magic-family spells need no save at all).
//
// List-splitting is genuinely ambiguous from punctuation alone — confirmed
// live: Staff of the Woodlands' own list mixes normal ", "-joined entries
// with "locate animals or plants", a single real spell name that itself
// contains the word "or". Splitting on every top-level comma FIRST (only
// treating " or " as a list separator when there's no comma to split on,
// or as the leading word of the LAST comma-split segment) resolves this
// correctly — confirmed against all 4 real phrasings this shape uses
// across a live 355-item bulk import (Rod of Alertness, Staff of Swarming
// Insects, Staff of the Woodlands, Wand of Binding).
// The lead-in text between "spells" and the colon is NOT always just
// "from it" / "(save DC N)" — Staff of Healing's own real shape adds a
// trailing "using your spell save DC and spellcasting ability modifier"
// qualifier that the old fixed-shape optional groups couldn't match at
// all (confirmed live: the whole clause silently went unrecognized).
// Captured as free text (group 1) instead and searched separately for a
// literal DC afterward — trying to fit both the flexible lead-in AND the
// DC extraction into one greedy/lazy pass over the same span doesn't
// reliably find the DC (confirmed live testing), so it's kept as two
// simple steps. `[^.]+` for the list itself already spans newlines fine
// (a negated character class matches any character except the one named,
// including "\n") — the SAME pattern below also runs against the WHOLE
// record's own joined candidate units (see convertSpellOrItemToFeatures),
// which is what actually fixes Ring of Animal Influence's own real shape:
// the list itself is NOT on the same line as the "cast one of the
// following spells:" lead-in at all — each option is its own separate
// paragraph.
// Splits `text` on `separator`, but only OUTSIDE parentheses — a plain
// `.split(separator)` breaks the moment one option's own descriptive text
// contains a comma inside its own parenthetical (Staff of Healing's own
// "cure wounds (1 charge per spell level, up to 4th)").
function splitRespectingParens(text, separator) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") {
      depth += 1;
      current += ch;
    } else if (ch === ")") {
      depth -= 1;
      current += ch;
    } else if (ch === separator && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

const SPELL_MENU_LEAD_PATTERN = /cast one of the following spells([^:]*):\s*([^.]+)\.?/i;
const SPELL_MENU_ENTRY_PATTERN = /^(.*?)(?:\s*\((\d+)\s*charges?\))?$/i;
function parseSpellMenuSaveDC(leadText) {
  const match = /save DC\s*(\d+)/i.exec(leadText);
  return match ? Number(match[1]) : null;
}
function parseSpellMenuList(listText) {
  // Newline-separated (Ring of Animal Influence's own real shape — each
  // option is its own paragraph, not comma-joined on one line) takes
  // priority: split on newlines first, whole-line-as-name, since a comma
  // WITHIN one of those lines (Ring of Animal Influence's own "Fear (save
  // DC 13), targeting only beasts...") is part of that option's own
  // descriptive text, not a list separator.
  if (listText.includes("\n")) {
    return listText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = SPELL_MENU_ENTRY_PATTERN.exec(line.replace(/\.$/, ""));
        const name = (match ? match[1] : line).trim();
        return name ? { name, ...(match?.[2] ? { charges: Number(match[2]) } : {}) } : null;
      })
      .filter(Boolean);
  }
  // Splitting on a bare `,` breaks the moment an option's own PARENTHETICAL
  // itself contains a comma — confirmed live: Staff of Healing's own "cure
  // wounds (1 charge per spell level, up to 4th)" was silently split into
  // two fake half-entries. `splitRespectingParens` only splits on a comma
  // OUTSIDE any parens.
  const segments = listText.includes(",")
    ? splitRespectingParens(listText, ",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part, index, arr) => (index === arr.length - 1 ? part.replace(/^or\s+/i, "") : part))
    : listText
        .split(/\s+or\s+/i)
        .map((part) => part.trim())
        .filter(Boolean);
  return segments
    .map((segment) => {
      const match = SPELL_MENU_ENTRY_PATTERN.exec(segment.replace(/\.$/, ""));
      const name = (match ? match[1] : segment).trim();
      if (!name) return null;
      return { name, ...(match?.[2] ? { charges: Number(match[2]) } : {}) };
    })
    .filter(Boolean);
}

// "Roll a die to pick which damage type this applies to" (Armor of
// Resistance's own real shape: a markdown table whose every option IS a
// damage type, e.g. "| d10 | Damage Type | | 1 | Acid | ...") is the SAME
// `feat.damage-modification` concept the plain-prose "resistance/immunity/
// vulnerability to ACID damage" recognizer already covers — just presented
// as a table because the specific type is GM-chosen/random rather than
// fixed. Recognized here (against the WHOLE record's joined candidate
// units, same as the general whole-record table check this replaces —
// see convertSpellOrItemToFeatures below) rather than added as a THIRD
// bespoke options-Feature shape: `damageType: "random"` captures the only
// thing that's actually still unknown, same as leaving a property
// genuinely unresolved rather than guessing a specific type.
const DAMAGE_TYPE_NAMES = new Set([
  "acid",
  "bludgeoning",
  "cold",
  "fire",
  "force",
  "lightning",
  "necrotic",
  "piercing",
  "poison",
  "psychic",
  "radiant",
  "slashing",
  "thunder",
]);
const DAMAGE_TIER_LEAD_PATTERN = /\b(resistance|immunity|vulnerability)\b.{0,80}\bdamage\b/i;
function recognizeDamageTypeChoiceTable(joinedText) {
  const table = splitMarkdownTableOptions(joinedText);
  if (!table) return null;
  // splitMarkdownTableOptions's own convention (see its module comment):
  // the first column is the option's own "name" (here, Armor of
  // Resistance's own roll RANGE — "1".."10" — never the damage type
  // itself), everything else is joined into "text" — confirmed live
  // against the real table, whose damage type names live in the SECOND
  // column.
  const optionNames = table.options.map((option) => option.text.trim().toLowerCase());
  if (!optionNames.length || !optionNames.every((name) => DAMAGE_TYPE_NAMES.has(name))) return null;
  const tierMatch = DAMAGE_TIER_LEAD_PATTERN.exec(table.intro);
  if (!tierMatch) return null;
  return { tierId: tierMatch[1].toLowerCase() };
}

// --- Clause-recognizer library -------------------------------------------
// Each entry recognizes ONE candidate unit's own text (a single paragraph
// or bullet — see mapping-custom-functions.js's own srdSplitBullets) as a
// generic, reusable mechanic and reports which shared Feature it belongs
// to. Built from real recurring shapes found across a broad sample of
// already-imported item/spell text, not designed blind. Tried in order,
// first match wins per unit — ordered roughly by specificity (a damage-type
// resistance clause must never fall through to the looser generic-condition
// recognizer below it).
//
// `tierId: null` means this Feature has no tiers at all (the compound-fact
// case — see feature-import-core.js's own module comment on
// `feat.cast-a-spell`/`feat.speed-modification` for why); a non-null
// `tierId` names one of that Feature's own existing tier ids exactly (never
// invents a new one) — see Phase 1's own taxonomy work for the authoritative
// tier lists.
// A fixed vocabulary of REAL 5e conditions — used by the three
// impose-condition siblings below to constrain what counts as a
// "condition" capture. Confirmed necessary live: without this, a free-text
// capture over the same shapes pulled in spell-specific flavor text as if
// it were a standard condition — Symbol's own "driven insane"/"overwhelmed
// with despair", Planar Binding's own "bound to serve you", Resilient
// Sphere's own "enclosed" — none of which are real conditions a Feature
// should claim to impose.
const KNOWN_CONDITION_WORDS =
  "charmed|frightened|paralyzed|poisoned|stunned|unconscious|restrained|incapacitated|blinded|deafened|petrified|grappled|prone|invisible|exhausted|possessed";

// Auto-classifies which of feat.impose-condition's own four tiers (Minor/
// Moderate/Severe/Extreme — see that record's own per-tier mechanics.text)
// a specific 5e condition word falls into, so every "Impose Condition"
// clause recognizer below lands with the RIGHT tier picked automatically
// instead of always leaving tierId null and making the GM guess (confirmed
// real gap: every recognizer using this featureName hardcoded tierId: null,
// unconditionally). Mirrors feat.impose-condition.json's own tier text
// exactly — keep both in sync if that record's own grouping ever changes.
// "invisible" (in KNOWN_CONDITION_WORDS for pattern-matching purposes only
// — some clauses legitimately impose it as a save-or-suffer effect) has no
// listed tier in that record at all and is deliberately left unmapped
// rather than guessed; "banished" (mentioned in the Severe tier's own text)
// isn't a KNOWN_CONDITION_WORDS entry at all, so it never reaches here.
const CONDITION_TIER = {
  frightened: "minor",
  blinded: "minor",
  deafened: "minor",
  prone: "minor",
  grappled: "minor",
  poisoned: "moderate",
  charmed: "moderate",
  restrained: "moderate",
  exhausted: "moderate",
  possessed: "moderate",
  stunned: "severe",
  incapacitated: "severe",
  unconscious: "severe",
  paralyzed: "extreme",
  petrified: "extreme",
};
const CONDITION_TIER_ORDER = ["minor", "moderate", "severe", "extreme"];

function resolveConditionTier(condition) {
  return CONDITION_TIER[String(condition || "").trim().toLowerCase()] || null;
}

// For a two-condition choice ("blinded or deafened", your choice) — the
// MORE severe of the two, since a GM budgeting for this should be charged
// for the worse case a target could actually land in, not the milder one.
function resolveMoreSevereConditionTier(conditionA, conditionB) {
  const tierA = resolveConditionTier(conditionA);
  const tierB = resolveConditionTier(conditionB);
  if (!tierA) return tierB;
  if (!tierB) return tierA;
  return CONDITION_TIER_ORDER.indexOf(tierB) > CONDITION_TIER_ORDER.indexOf(tierA) ? tierB : tierA;
}

const CLAUSE_RECOGNIZERS = [
  {
    // "resistance/immunity/vulnerability to ACID damage" / "Resistance
    // against poison damage" — checked live: real SRD text uses both
    // prepositions ("to" is far more common, but Belt of Dwarvenkind's own
    // "you have Resistance against poison damage" uses "against").
    // Adjective forms ("is immune to psychic damage", Mind Blank's own
    // real text; "immune to thunder damage", Silence's own; "immune to
    // all damage", Resilient Sphere's own) added alongside the noun forms
    // above — same concept, different part of speech, mapped back to the
    // same resistance/immunity/vulnerability tier ids in `build`.
    name: "damage-modification",
    pattern: /\b(resistance|immunity|vulnerability|immune|resistant|vulnerable) (?:to|against) (\w+) damage\b/i,
    build: (m) => {
      const word = m[1].toLowerCase();
      const tierId = word.startsWith("immun") ? "immunity" : word.startsWith("resist") ? "resistance" : "vulnerability";
      return { featureName: "Damage Modification", tierId, params: { damageType: m[2].toLowerCase() } };
    },
  },
  {
    // "resistance to one of the following damage types: X, Y, or Z" /
    // "vulnerability to two of the three damage types" (Armor of
    // Vulnerability's own real prose shape) — the GM-chosen/random-type
    // sibling of the plain single-type recognizer above; see
    // recognizeDamageTypeChoiceTable's own module comment for the TABLE-
    // shaped version of this exact same concept (Armor of Resistance).
    // `\s+` (not a literal space) between "to" and the count — confirmed
    // live that Armor of Vulnerability's own real SRD text has a stray
    // double space there ("resistance to  one of..."), a single-space
    // pattern silently never matched it.
    name: "damage-modification-choice",
    pattern: /\b(resistance|immunity|vulnerability)\s+to\s+(?:one|two|\d+)\s+of\s+the\s+(?:following\s+|three\s+|several\s+)?damage\s+types?\b/i,
    build: (m) => ({ featureName: "Damage Modification", tierId: m[1].toLowerCase(), params: { damageType: "random" } }),
  },
  {
    // A weapon's own bonus damage dice on a hit — "the target takes an
    // extra 2d6 fire damage" / "it deals an extra 2d6 fire damage" —
    // confirmed live across 21 real SRD items (Flame Tongue, Frost Brand,
    // Holy Avenger, Dragon Slayer, Staff of Striking, ...). Two real verb
    // families, both confirmed live: "takes/take" AND "deals/deal" for the
    // plain unconditional case; separately, Arrow of Slaying's own real
    // text uses the GERUND "taking" specifically because it's part of a
    // save clause ("...must make a DC 17 Constitution saving throw, taking
    // an extra 6d10 piercing damage on a failed save, or half as much
    // extra damage on a successful one.") — missing that verb form (and
    // the save clause shape entirely) is exactly why Arrow of Slaying's
    // own real import produced no Extra Damage Feature at all. Both shapes
    // — plain and save-conditional — are ONE pattern (not two array
    // entries, unlike area-damage-burst's own half/binary split) so a
    // save-conditional clause can never ALSO independently match a looser
    // plain-shape pattern and double up on the same Feature: the whole
    // save clause is one optional LEADING group, `saveDC`/`saveAbility`/
    // `saveEffect` only ever populate together, when it's actually there.
    // Distinct from `weapon-attack-bonus` above (a flat bonus to the
    // ATTACK/DAMAGE ROLL, not extra damage dice) and from
    // `damage-modification` (resistance/immunity/vulnerability, not damage
    // dealt).
    // "damage OF THE WEAPON'S TYPE" (no explicit type word — Dragon Slayer,
    // Giant Slayer, Vicious Weapon, confirmed live all 3) means the extra
    // dice deal the SAME type as whatever weapon this is attached to,
    // rather than a fixed type of their own — captured as the marker
    // `damageType: "weapon"` rather than left unrecognized.
    // The save-conditional branch doesn't always say "extra" — confirmed
    // live: Javelin of Lightning's own "...must make a DC 13 Dexterity
    // saving throw, taking 4d6 lightning damage on a failed save..." and
    // Dust of Dryness's own near-identical shape are the item's own SOLE
    // damage (not bonus damage stacked on a separate attack), so "extra"
    // never appears — made optional ONLY in that branch (the leading "must
    // make a DC..." clause is already a strong enough gate on its own);
    // the plain unconditional branch still REQUIRES "extra" so it can't
    // false-positive on an unrelated damage mention elsewhere in the text.
    // `DC\s*(\d+)` in the save-conditional branch is OPTIONAL — a spell's
    // own save DC is never stated as a literal number in its own text
    // (it's always "your spell save DC", implicit), unlike an item's own
    // fixed value. Every recognizer that gated an entire match on a
    // literal "DC N" used to silently fail on ANY spell text carrying the
    // exact same real mechanic an item states plainly — confirmed live
    // (Antipathy/Sympathy's own "must succeed on a wisdom saving throw or
    // become frightened", no DC at all). `saveDC` in `build` below is only
    // ever set when the item DID state one; `saveAbility`/`saveEffect` are
    // now keyed off the ability capture (m[2], always present when this
    // branch matches) rather than the DC capture (m[1], now optional).
    // Bare `damage\b` added as a third damage-type alternative — Hunter's
    // Mark's own "you deal an extra 1d6 damage to the target" states NO
    // type at all (confirmed live), which the existing two alternatives
    // (a named type, or "of the weapon's type") both required. `build`
    // below already defaults an untyped match to "weapon" either way, so
    // this is a pure widening.
    name: "extra-damage",
    pattern:
      /(?:must make (?:a )?(?:DC\s*(\d+)\s*)?(\w+) saving throw,?\s*(?:takes?|taking|deals?|dealing) (?:an extra )?|(?:takes?|deals?) an extra )(\d+d\d+(?:\s*\+\s*\d+)?) (?:(\w+) damage\b|damage of the weapon'?s type|damage\b)(?:\s+on a failed save(?:,?\s*(?:and|or) half as much(?:\s+extra)? damage on an? successful one)?)?/i,
    build: (m) => {
      const params = { damageDice: m[3].replace(/\s+/g, ""), damageType: (m[4] || "weapon").toLowerCase() };
      if (m[2]) {
        if (m[1]) params.saveDC = Number(m[1]);
        params.saveAbility = m[2].toLowerCase();
        params.saveEffect = /half as much/i.test(m[0]) ? "half" : "none";
      }
      return { featureName: "Extra Damage", tierId: null, params };
    },
  },
  {
    // "you have advantage on Wisdom (Perception) checks" / "on Perception checks"
    name: "skill-bonus-advantage",
    pattern: /\badvantage on (?:[\w\s]+\(([\w\s]+)\)|(\w+)) checks\b/i,
    build: (m) => ({ featureName: "Skill Bonus", tierId: "advantage", params: { skill: (m[1] || m[2]).trim().toLowerCase() } }),
  },
  {
    // Advantage on attack rolls/saving throws (not a skill-check-only
    // clause — those stay with `skill-bonus-advantage` above). Confirmed
    // live: True Strike's own "you gain advantage on your first attack
    // roll against the target", Foresight's own "has advantage on attack
    // rolls, ability checks, and saving throws", Beacon of Hope's own "has
    // advantage on wisdom saving throws and death saving throws",
    // Protection from Evil and Good's own "has advantage on any new saving
    // throw against the relevant effect". The lookahead requires an actual
    // "roll"/"throw" word in the captured span so a bare skill-checks
    // clause (already `skill-bonus-advantage`'s job) or an unrelated
    // "advantage on the save" aside (Enthrall) never double-matches here.
    name: "grants-advantage",
    pattern:
      /(?:you gain|has) advantage on (?=[^.,]*(?:rolls?\b|throws?\b))([^.,]+(?:, [\w\s]+? checks?,? and [\w\s]+? throws?)?)/i,
    build: (m) => ({ featureName: "Grants Advantage", tierId: null, params: { rollType: m[1].trim().toLowerCase() } }),
  },
  {
    // A creature's own game statistics are wholesale replaced by another
    // creature's — confirmed live across Animal Shapes ("A target's game
    // statistics are replaced by the statistics of the chosen beast"),
    // Polymorph/True Polymorph ("game statistics, including mental ability
    // scores, are replaced by the statistics of"), Shapechange ("Your game
    // statistics are replaced by the statistics of the chosen creature"),
    // and Magic Jar ("Your game statistics are replaced by the statistics
    // of the creature"). Distinct from `summoned-companion` (a NEW
    // creature appears) — this is an EXISTING creature's stat block being
    // swapped out.
    name: "transforms-creature",
    pattern: /game statistics(?:, including mental ability scores,)? are replaced by the statistics of/i,
    build: () => ({ featureName: "Transforms Creature", tierId: null, params: null }),
  },
  {
    // Shields a target from divination magic outright — the SAME concept
    // (and near-identical mechanics text) as the pre-existing
    // feat.divination-immunity (Amulet of Proof against Detection and
    // Location's own item version), reused rather than duplicated — caught
    // only by checking the full Feature catalog before shipping a
    // separate "Divination Warding" Feature, which was wrong. Confirmed
    // live across three real, independently-worded spells: Nondetection's
    // own "you hide a target that you touch from divination magic",
    // Private Sanctum's own "Creatures in the area can't be targeted by
    // divination spells", Mind Blank's own "...immune to psychic damage,
    // [...], divination spells, and the charmed condition" (one item in a
    // bundled immunity list — `recognizeClause` runs every recognizer
    // against the same candidate text, so this fires independently of
    // whatever else in that same sentence `damage-modification`/
    // `condition-immunity` catch). Distinct from feat.detection (the
    // user's OWN sense, not a ward against being sensed) and
    // feat.obscurement (blocks ordinary senses/light, not specifically
    // divination magic).
    name: "divination-warding",
    pattern:
      /hides? [\w\s]*? from divination magic|can't be targeted by (?:any )?divination (?:magic|spells)|immune to (?:[\w\s,]+?,\s*)?divination spells\b/i,
    build: () => ({ featureName: "Divination Immunity", tierId: null, params: null }),
  },
  {
    // "+2 bonus to Wisdom (Perception) checks" / "+5 bonus to Stealth checks"
    // / "+10 bonus to Dexterity (Stealth) checks" (Pass Without Trace) /
    // "+10 bonus to Strength checks" (Rod of Lordly Might) — both +10s
    // confirmed live, added a matching tier to feat.skill-bonus itself.
    name: "skill-bonus-flat",
    pattern: /\+(2|5|10) bonus to (?:[\w\s]+\(([\w\s]+)\)|(\w+)) checks\b/i,
    build: (m) => ({
      featureName: "Skill Bonus",
      tierId: m[1] === "10" ? "plus-10" : m[1] === "5" ? "plus-5" : "plus-2",
      params: { skill: (m[2] || m[3]).trim().toLowerCase() },
    }),
  },
  {
    // "your Strength score is 27 while you wear this belt" / "your Strength score changes to 21"
    // Belt/Manual-of-Giant-Strength's own real phrasing has an article
    // between the verb and the number ("changes to A 21") that a plain
    // single-space pattern silently never matched — confirmed live across
    // the whole Belt of [X] Giant Strength family.
    name: "ability-score-set",
    pattern: /\byour (\w+) score (?:is|becomes|changes to) (?:an? )?(19|21|23|25|27|29)\b/i,
    build: (m) => ({ featureName: "Ability Score Increase", tierId: `set-${m[2]}`, params: { ability: m[1].toLowerCase() } }),
  },
  {
    // "your Constitution score increases by 2, as does your maximum" — the
    // sibling of ability-score-set above, for the Tome/Manual-of-[Ability]
    // family's own real phrasing. `feat.ability-score-increase` already
    // ships `increase-1`/`increase-2`/`increase-4` tiers (added alongside
    // `set-19`...`set-29` from the start) but nothing ever produced them —
    // this was the missing recognizer.
    name: "ability-score-increase-by",
    pattern: /\byour (\w+) score increases by (1|2|4)\b/i,
    build: (m) => ({ featureName: "Ability Score Increase", tierId: `increase-${m[2]}`, params: { ability: m[1].toLowerCase() } }),
  },
  {
    // speed grant — type and distance are one compound fact, no tiers.
    // "gives? you a" is a third confirmed real verb (Wings of Flying: "The
    // wings give you a flying speed of 60 feet"), alongside "gain"/"have".
    // "has" is a 4th confirmed verb (Broom of Flying/Carpet of Flying: "It
    // has a flying speed of 50 feet"). "gains?" (not bare "gain") —
    // confirmed live: spell text is written in 3rd person about its own
    // target ("The target GAINS a flying speed of 60 feet", Fly), so the
    // bare "gain" alone silently never matched a single real spell.
    name: "speed-grant",
    pattern: /\b(?:gains?|has|have|gives? you) a (climbing|swimming|burrowing|flying) speed of (\d+) feet\b/i,
    build: (m) => ({ featureName: "Speed Modification", tierId: null, params: { speedType: m[1].toLowerCase(), distance: Number(m[2]) } }),
  },
  {
    // A RELATIVE grant, not a fixed number — Potion of Flying's own "you
    // gain a flying speed equal to your walking speed" — `distance` is the
    // string "walking speed" rather than a number in this case (mirrors
    // `feat.charges`' own dice-formula-as-string convention when a value
    // genuinely isn't a fixed number). Same "gains?" fix as speed-grant
    // above, plus "its"/"the target's" alongside "your" — Spider Climb's
    // own real text describes a touched target in 3rd person: "The target
    // also gains a climbing speed equal to ITS walking speed".
    name: "speed-grant-relative",
    pattern: /\b(?:gains?|has|have|gives? you) a (climbing|swimming|burrowing|flying) speed equal to (?:your|its|the target'?s|the creature'?s) walking speed/i,
    build: (m) => ({ featureName: "Speed Modification", tierId: null, params: { speedType: m[1].toLowerCase(), distance: "walking speed" } }),
  },
  {
    // "+1 bonus to AC and saving throws" / "+2 bonus to your AC"
    // Robe of Stars' own real shape has NO "AC" at all — "+1 bonus to
    // saving throws" alone — confirmed live. `ac`/`savingThrows` replace
    // the old single `alsoSavingThrows` flag (which assumed AC was always
    // present and saves were merely "also" granted) so a saves-only grant
    // renders correctly instead of implying a nonexistent AC bonus.
    // "5" added to the enum — Shield's own real "+5 bonus to AC" (feat.
    // protection-bonus's own tiers gained a matching plus-5 to go with it;
    // every other value here still resolves to an item's own conventional
    // +1/+2/+3 family and needs no new tier).
    name: "protection-bonus",
    pattern: /\+(1|2|3|5) bonus to (?:your )?(AC(?: and saving throws)?|saving throws)\b/i,
    build: (m) => ({
      featureName: "Protection Bonus",
      tierId: `plus-${m[1]}`,
      params: { ac: /AC/i.test(m[2]), savingThrows: /saving throws/i.test(m[2]) },
    }),
  },
  {
    // Mage Armor's own "The target's base AC becomes 13 + its Dexterity
    // modifier" — REPLACES the whole AC calculation with a fixed formula,
    // distinct from protection-bonus above (an ADDITIVE bonus on top of
    // whatever AC the wearer already has). The ability-modifier addend is
    // optional — some real "AC becomes N" clauses are a bare flat number
    // with no modifier attached at all.
    name: "set-ac",
    pattern: /(?:base )?AC becomes (\d+)(?:\s*\+\s*(?:its|your|the target'?s) (\w+) modifier)?/i,
    build: (m) => ({ featureName: "Set AC", tierId: null, params: { base: Number(m[1]), ...(m[2] ? { modifier: m[2].toLowerCase() } : {}) } }),
  },
  {
    // Barkskin's own "the target's AC can't be less than 16" — a FLOOR on
    // an existing AC, letting armor/other bonuses still exceed it, unlike
    // set-ac above (which replaces the calculation outright) or
    // protection-bonus (an additive bonus, no floor concept at all).
    name: "ac-minimum",
    pattern: /AC (?:can'?t|cannot) be less than (\d+)/i,
    build: (m) => ({ featureName: "AC Minimum", tierId: null, params: { minimum: Number(m[1]) } }),
  },
  {
    // A weapon's own inherent "+N bonus to attack and damage rolls" clause,
    // OUTSIDE the rarity-variant-family case already handled by
    // resolvePassiveBonusFeature (a non-family item like Sun Blade — its
    // own weapon bonus is just one clause among several, not the item's
    // sole recognized mechanic) — reuses the exact same pre-existing
    // `feat.weapon-enhancement` Feature (untouched by this redesign's own
    // Phase 1, already tiered plus-1/plus-2/plus-3) rather than inventing
    // a second "weapon bonus" concept.
    name: "weapon-attack-bonus",
    pattern: /\+(1|2|3) bonus to attack and damage rolls\b/i,
    build: (m) => ({ featureName: "Weapon Enhancement", tierId: `plus-${m[1]}`, params: null }),
  },
  {
    // Area damage tied to a saving throw, WITH the failed-save damage
    // still dealt at half on a success — Horn of Blasting's own exact real
    // shape (confirmed live): "...a 30-foot cone... Each creature... must
    // make a DC 15 Constitution saving throw. On a failed save, a creature
    // takes 5d6 thunder damage and is deafened for 1 minute. On a
    // successful save, a creature takes half as much damage...". None of
    // this (shape/size, save ability/DC, damage dice/type, the optional
    // trailing status rider) exists as a discrete SRD JSON field the way a
    // spell's own `damage_at_slot_level`/`dc` do — it's only ever prose —
    // so it's pulled out here the same way monster import's own
    // `parseSaveEffect` (monster-feature-matching.js) pulls a breath
    // weapon's own area/damage/save out of a monster trait's free text.
    // Unlike that monster-only parser, `saveDC` is kept as the item's own
    // literal fixed value (never discarded/recomputed) — an item has no
    // CR-based formula to recompute it from the way a monster does.
    // `DC\s*(\d+)` is OPTIONAL — a spell's own text never states a literal
    // DC (always "your spell save DC" implicit) the way an item's own fixed
    // value does; `saveDC` in `build` below is only set when one was
    // actually captured. The article before the ability name has to cover
    // both "a" (Dexterity, Constitution, ...) and "an" (Intelligence) now
    // that "DC" itself isn't always there to fix it at "a".
    name: "area-damage-save-half",
    pattern:
      /(\d+)-foot (cone|line|sphere|radius)[\s\S]*?(?:must make|must succeed on) an? (?:DC\s*(\d+)\s*)?(\w+) saving throw[.,]?\s*On a failed save,?\s*(?:a creature |each creature |the target |you )?takes?\s*([0-9dD]+(?:\s*\+\s*\d+)?)\s*(\w+) damage(?:,?\s*(?:and|but)?\s*(?:is|becomes)\s+([^.]+?))?\./i,
    build: (m) => ({
      featureName: "Area Damage Burst",
      tierId: null,
      params: {
        areaShape: m[2].toLowerCase(),
        areaSize: Number(m[1]),
        saveAbility: m[4].toLowerCase(),
        ...(m[3] ? { saveDC: Number(m[3]) } : {}),
        damageDice: m[5].replace(/\s+/g, ""),
        damageType: m[6].toLowerCase(),
        saveEffect: "half",
        ...(m[7] ? { rider: m[7].trim() } : {}),
      },
    }),
  },
  {
    // Same area-damage-on-a-save shape, but a binary hit/miss with no half
    // damage on success — Bead of Force's own exact real shape (confirmed
    // live): "Each creature within a 10-foot radius... must succeed on a
    // DC 15 Dexterity saving throw or take 5d4 force damage." Kept as a
    // separate recognizer (rather than folding into the pattern above)
    // since the two real phrasings genuinely diverge at the sentence
    // level — same "more than one regex for one concept" precedent
    // monster-feature-matching.js's own `parseSaveEffect` already
    // establishes (4 separate lead/tail shape patterns there).
    // `DC\s*(\d+)` is OPTIONAL — same reasoning as area-damage-save-half
    // above (a spell's own text never states a literal DC).
    name: "area-damage-save-binary",
    pattern: /(\d+)-foot (cone|line|sphere|radius)[\s\S]*?must succeed on an? (?:DC\s*(\d+)\s*)?(\w+) saving throw or take\s*([0-9dD]+(?:\s*\+\s*\d+)?)\s*(\w+) damage/i,
    build: (m) => ({
      featureName: "Area Damage Burst",
      tierId: null,
      params: {
        areaShape: m[2].toLowerCase(),
        areaSize: Number(m[1]),
        saveAbility: m[4].toLowerCase(),
        ...(m[3] ? { saveDC: Number(m[3]) } : {}),
        damageDice: m[5].replace(/\s+/g, ""),
        damageType: m[6].toLowerCase(),
        saveEffect: "none",
      },
    }),
  },
  {
    // darkvision grant/extension
    // "darkvision out to A RANGE OF 60 feet" (Goggles of Night) combines
    // two of the existing alternatives at once — a 4th real phrasing.
    name: "darkvision",
    pattern: /\bdarkvision (?:out to a range of|out to|with a range of|to a range of)?\s*(\d+) feet\b/i,
    build: (m) => ({ featureName: "Darkvision", tierId: null, params: { range: Number(m[1]) } }),
  },
  {
    // temporary hit points
    name: "temporary-hit-points",
    pattern: /\b(\d+d\d+(?:\s*\+\s*\d+)?|\d+) temporary hit points\b/i,
    build: (m) => ({ featureName: "Temporary Hit Points", tierId: null, params: { dice: m[1].replace(/\s+/g, "") } }),
  },
  {
    // critical hits become normal hits (the Adamantine Armor case —
    // verified live: real SRD text uses "becomes", singular, not "become")
    name: "no-critical-hits",
    pattern: /critical hits? against you (?:becomes?|(?:is|are) treated as) (?:a )?normal hits?\b/i,
    build: () => ({ featureName: "No Critical Hits", tierId: null, params: null }),
  },
  {
    // A pure action-economy restriction with no damage/condition attached —
    // the Slow spell's own real, exact phrasing ("it can't use reactions")
    // — confirmed as a genuine gap before this existed: `grep`ing this whole
    // file/mapping-custom-functions.js for "Reaction" found zero matches, so
    // any spell/item using this clause silently lost it entirely. Shares
    // feat.action-restricted with the bonus-action/action tiers below
    // rather than being its own Feature — all three are the same "can't
    // take X" shape, just naming a different piece of the action economy —
    // and NOT folded into Impose Condition, since this isn't one of the
    // named 5e conditions (frightened/poisoned/etc.), just a standalone
    // restriction some effects apply entirely on their own, separate from
    // (and often layered with) an actual condition. Real data uses both
    // "can't take reactions" (e.g. confusion, wand-of-fear) and "can't use
    // reactions" (Slow itself) — matched interchangeably here.
    name: "restrict-reactions",
    pattern: /can't (?:take|use) reactions/i,
    build: () => ({ featureName: "Action Restricted", tierId: "reaction", params: null }),
  },
  {
    // Same shape as restrict-reactions above, for a target's bonus action
    // instead — no boilerplate SRD spell uses this exact clause today (Slow
    // itself instead XORs action-vs-bonus-action, a different mechanic not
    // modeled here), but custom/homebrew spell text does say this plainly,
    // and this Feature's own "Bonus Actions" tier exists specifically so
    // that case isn't silently dropped the same way reactions were before
    // restrict-reactions existed.
    name: "restrict-bonus-actions",
    pattern: /can't (?:take|use) (?:a |an )?bonus actions?/i,
    build: () => ({ featureName: "Action Restricted", tierId: "bonus-action", params: null }),
  },
  {
    // Same shape again, for a target's action outright — the Dream spell's
    // own real phrasing ("can't take actions or move") is the reference
    // case; the "or move" clause is a separate movement restriction not
    // modeled by this Feature.
    name: "restrict-actions",
    pattern: /can't take actions\b/i,
    build: () => ({ featureName: "Action Restricted", tierId: "action", params: null }),
  },
  {
    // "you can breathe underwater" / "you can breathe air and water" —
    // OR the spell's own real 3rd-person phrasing (Water Breathing itself,
    // confirmed live): "gives ... the ability to breathe underwater" —
    // structurally different (no "you can"), so kept as its own
    // alternative rather than trying to force one shared lead-in.
    name: "water-breathing",
    pattern: /\byou can breathe (?:air and water|underwater)\b|\b(?:the )?ability to breathe (?:air and water|underwater)\b/i,
    build: () => ({ featureName: "Water Breathing", tierId: null, params: null }),
  },
  {
    // "immune to any disease" / "immune to being frightened" / "immune to poison"
    // — checked AFTER damage-modification so "immune to acid damage" never
    // falls through to here.
    name: "condition-immunity",
    pattern: /\bimmune to (?:contracting )?(?:any )?(?:the )?(?:being )?([a-z][a-z\s]*?)(?=\.|,|;| while| for| unless|$)/i,
    build: (m) => {
      const condition = m[1].trim().toLowerCase();
      // Antipathy/Sympathy's own self-referential "immune to it for 1
      // minute" (referring back to the spell's own effect, not a named
      // condition) — confirmed live: matched the same shape as a real
      // condition ("immune to poison") with nothing to tell them apart
      // except the captured word itself being a pronoun.
      if (!condition || /damage$/.test(condition) || ["it", "this", "that", "them", "itself", "themselves"].includes(condition)) return null;
      return { featureName: "Condition Immunity", tierId: null, params: { condition } };
    },
  },
  {
    // "you can cast the X spell" / "cast X (save DC 15) once" / "casts X from
    // the wand" — MUST be case-insensitive: confirmed live that real SRD
    // prose almost always lowercases a referenced spell's own name in
    // running text ("cast the levitate spell"), unlike a Feature/Effect's
    // own `.name` field. Missing the `/i` flag here silently failed to
    // match the overwhelming majority of real "cast a spell" clauses
    // (confirmed live against a real 355-item bulk import: ~50 residual
    // one-off Features were actually this exact clause, just never
    // recognized).
    //
    // Two MORE real lead-in phrasings, confirmed live across a full-catalog
    // re-sweep, neither containing the word "cast" at all: potions almost
    // always say "you gain the effect of the X spell" (Potion of
    // Clairvoyance, Speed, Mind Reading, ...) — including a quoted variant
    // for a spell with two named modes ('you gain the "reduce" effect of
    // the enlarge/reduce spell', Potion of Diminution/Growth, where the
    // spell's own name legitimately contains a "/"); a wand/rod clause
    // duplicating a spell's effect without granting the spell itself often
    // says "as with the X spell" (Wand of Fear's own Command property).
    // Same target Feature either way — mechanically, an item letting you
    // experience a specific spell's effect is the same concept regardless
    // of which of the three phrasings the source happens to use.
    // Confirmed live: a GENERIC reference to spellcasting — "attacks or
    // casts A spell", "cast THE spell as normal" (meaning "whatever spell
    // was already in play", not naming one) — matches this same shape and
    // silently produced a garbage `spellName: "a"`/`"the"` (7 real items
    // affected). Rejected in `build`, not the pattern itself, since "a"/
    // "an"/"the" are otherwise ordinary word characters the capture group
    // has no other reason to special-case.
    // "gains the effect of A freedom of movement spell" (Oil of
    // Slipperiness) — a 4th real article ("a", not "the") before the
    // spell name in this specific lead-in.
    // A 4th real lead-in: "detonates as a 3rd-level fireball spell"
    // (Necklace of Fireballs) — an optional ordinal spell-level phrase
    // between "as a/an" and the spell name.
    name: "cast-a-spell",
    pattern:
      /(?:\bcast(?:s)? (?:the )?|gains? (?:the|a) (?:"[\w/]+" )?effect of (?:the|a) |as with the |detonates as an? (?:\d+\w{2}-level )?)([\w][\w\s/]*?) spell\b/i,
    build: (m) => {
      const spellName = m[1].trim();
      // Self-referential "cast THIS spell (again/on the creature/...)"
      // (Animal Messenger, Animate Dead, Arcane Lock) and generic
      // descriptor phrases like "cast A SUPPRESSED spell" (Antimagic
      // Field) both confirmed live — neither names an actual spell, but
      // the exact-match-only "a"/"an"/"the" reject list let both through
      // (the first word matters, not just the whole phrase).
      const firstWord = spellName.toLowerCase().split(/\s+/)[0];
      if (["a", "an", "the", "this", "that", "it", "its", "your", "my", "his", "her", "their"].includes(firstWord)) return null;
      return { featureName: "Cast a Spell", tierId: null, params: { spellName } };
    },
  },
  {
    // "cast magic missile AS A 5TH-LEVEL spell" (Robe of Stars) — the
    // spell name comes BEFORE "as a[n] Nth-level", the reverse word order
    // from "detonates as a 3rd-level fireball spell" above. Kept as its
    // own recognizer rather than folded into the main pattern: the main
    // pattern's capture class excludes hyphens, so it can't cross
    // "5th-level" to reach the trailing "spell" at all (confirmed live —
    // it silently failed to match this shape entirely, not just wrong).
    name: "cast-a-spell-as-level",
    pattern: /\bcast(?:s)? ([a-z][a-z' ]*?) as an? \d+\w{2}-level spell\b/i,
    build: (m) => ({ featureName: "Cast a Spell", tierId: null, params: { spellName: m[1].trim() } }),
  },
  {
    // "cast dominate beast (save DC 15) from it" (Trident of Fish Command)
    // — no trailing "spell" word at all, unlike every other confirmed
    // phrasing; `(save DC N)` right after the name is the only reliable
    // anchor.
    name: "cast-a-spell-with-dc",
    pattern: /\bcast(?:s)? ([a-z][a-z' ]*?) \(save DC \d+\) from it\b/i,
    build: (m) => ({ featureName: "Cast a Spell", tierId: null, params: { spellName: m[1].trim() } }),
  },
  {
    // A menu of several spells (charge-gated or not) — the Multiattack-
    // shaped concept, see this recognizer's own module comment above
    // (SPELL_MENU_LEAD_PATTERN) for the parsing design and live
    // verification. Checked AFTER cast-a-spell in this array purely for
    // reading order — the two patterns never actually collide (cast-a-
    // spell's own trailing `spell\b` never matches this clause's plural
    // "spells", confirmed live), and recognizeClause tries every recognizer
    // regardless of array position anyway.
    name: "spell-menu",
    pattern: SPELL_MENU_LEAD_PATTERN,
    build: (m) => {
      const spells = parseSpellMenuList(m[2]);
      if (!spells.length) return null;
      const saveDC = parseSpellMenuSaveDC(m[1]);
      return { featureName: "Spell Menu", tierId: null, params: { spells, ...(saveDC ? { saveDC } : {}) } };
    },
  },
  {
    // "advantage on saving throws against X" — a genuinely common defensive
    // shape (confirmed live across 6+ real items: Mantle of Spell
    // Resistance, Necklace of Adaptation, Ring of Spell Turning, Scarab of
    // Protection, Spellguard Shield, Robe of the Archmagi), distinct from
    // `skill-bonus-advantage` above (which is specifically about ABILITY
    // CHECKS, never saving throws) and from `damage-modification` (a
    // damage TYPE, not a category of effects/sources a save defends
    // against). `against` is kept as free text (never a fixed enum — real
    // values range from a single word "spells" to a whole parenthetical
    // list), captured up to the sentence's own end or a trailing "while
    // you..." dependent clause (Mantle of Spell Resistance's own real
    // shape needs that second boundary — its whole description is one
    // sentence with no period until the very end).
    name: "saving-throw-advantage",
    pattern: /\badvantage on saving throws (?:made )?against ([^.]+?)(?:\.|\s+while you\b)/i,
    build: (m) => ({ featureName: "Saving Throw Advantage", tierId: null, params: { against: m[1].trim() } }),
  },
  {
    // Flat, unconditional healing with no associated spell name — "You
    // regain 2d4 + 2 hit points when you drink this potion." (every Potion
    // of Healing tier) / "The creature that receives it regains 2d8 + 2 hit
    // points" (Restorative Ointment — the subject isn't always "you", so
    // the verb alone is the anchor). Vault's own starter
    // `feat.mending-pulse` already ships FIXED tiers whose own dice exactly
    // match the 4 real Potion of Healing values (2d4+2/4d4+4/8d4+8/
    // 10d4+20) — reused via exact dice match rather than duplicated; any
    // OTHER flat healing dice value (Restorative Ointment's own 2d8+2, which
    // matches none of those 4 fixed tiers) goes to a separate, ordinary
    // `feat.healing` Feature with a plain `{healingDice}` param instead —
    // same reasoning `damage-modification`'s own per-type params use,
    // rather than growing `feat.mending-pulse` a new tier per odd value
    // forever.
    name: "flat-healing",
    pattern: /\bregains? (\d+d\d+(?:\s*\+\s*\d+)?) hit points\b/i,
    build: (m) => {
      const dice = m[1].replace(/\s+/g, "");
      const mendingPulseTier = { "2d4+2": "tier-1", "4d4+4": "tier-2", "8d4+8": "tier-3", "10d4+20": "tier-4" }[dice];
      if (mendingPulseTier) return { featureName: "Mending Pulse", tierId: mendingPulseTier, params: null };
      return { featureName: "Healing", tierId: null, params: { healingDice: dice } };
    },
  },
  {
    // "+2 bonus to spell attack rolls" (Talisman of Pure Good/Ultimate
    // Evil) — a free-standing prose clause for the SAME shared
    // `feat.spell-attack-bonus` Feature `resolvePassiveBonusFeature`
    // already routes the rarity-variant Wand-of-the-War-Mage family onto;
    // no prose recognizer existed to reach it any other way.
    name: "spell-attack-bonus",
    pattern: /\+(1|2|3) bonus to spell attack rolls\b/i,
    build: (m) => ({ featureName: "Spell Attack Bonus", tierId: `plus-${m[1]}`, params: null }),
  },
  {
    // Attackers are disadvantaged against the wearer — "any creature to
    // have disadvantage on attack rolls against you" (Cloak of
    // Displacement) / "spell attacks have disadvantage against you"
    // (Spellguard Shield). `attackType` distinguishes "any" from a
    // narrower "spell"-only scope — same param-not-tier reasoning as
    // `damage-modification`'s own damageType (independent of any magnitude
    // ladder; there's no ladder here at all). `(?<!they have )` excludes a
    // real false-positive shape (confirmed live, all 4 Ring of [Element]
    // Elemental Command items): "...advantage on attack rolls against air
    // elementals, and THEY have disadvantage on attack rolls against you"
    // — "they" refers back to the named creature TYPE, a narrow combat-
    // parity clause against one specific foe, not this item's own general
    // defensive property the way Cloak of Displacement's "any creature..."
    // phrasing is.
    // "against the target"/"against targets within X" alternatives added —
    // confirmed live, Protection from Evil and Good's own "have
    // disadvantage on attack rolls against the target" and Magic Circle's
    // own "has disadvantage on attack rolls against targets within the
    // cylinder" (a third-person spell effect protecting someone else, not
    // just an item worn by the reader).
    name: "attacker-disadvantage",
    pattern:
      /\b(spell attacks have disadvantage against (?:you|the target)|(?<!they have )disadvantage on attack rolls against (?:you\b|the target\b|targets within[\w\s]+?(?=\.|,|;|$)))\b/i,
    build: (m) => ({ featureName: "Attacker Disadvantage", tierId: null, params: { attackType: /spell/i.test(m[0]) ? "spell" : "any" } }),
  },
  {
    // Same feat.condition-immunity as the "immune to X" recognizer above,
    // just a different real verb for the same idea — confirmed live,
    // Protection from Evil and Good's own "can't be charmed, frightened,
    // or possessed by them" and Magic Circle's own identical clause
    // ("...by the creature"). Condition list constrained to
    // KNOWN_CONDITION_WORDS for the same reason as the impose-condition
    // siblings — a free-text capture here would risk pulling in unrelated
    // "can't be X" flavor clauses that aren't real conditions.
    name: "condition-immunity-cant-be",
    pattern: new RegExp(
      `can't be ((?:${KNOWN_CONDITION_WORDS})(?:,\\s*(?:${KNOWN_CONDITION_WORDS}))*(?:,?\\s*or\\s*(?:${KNOWN_CONDITION_WORDS}))?)\\s+by`,
      "i",
    ),
    build: (m) => ({ featureName: "Condition Immunity", tierId: null, params: { condition: m[1].trim().toLowerCase() } }),
  },
  {
    // A save-or-suffer-a-CONDITION clause with NO damage attached — Wand
    // of Paralysis ("...DC 15 Constitution saving throw or be paralyzed
    // for 1 minute"), Rod of Rulership ("...or be charmed by you for 8
    // hours"), Mace of Terror ("...or become frightened of you for 1
    // minute"), Dust of Sneezing and Choking ("...or become unable to
    // breathe"). Distinct from `area-damage-save-half`/`-binary` above
    // (those require damage dice) and from `condition-immunity` (immune
    // TO a condition, never imposing one). `condition`/`duration` are kept
    // as free text — real values range from a bare word to "charmed by
    // you", and duration isn't always present. `DC\s*(\d+)` is OPTIONAL —
    // same reasoning as the two area-damage recognizers above: a spell's
    // own save DC is never a literal number in its own text (confirmed
    // live, Antipathy/Sympathy's own "must succeed on a wisdom saving
    // throw or become frightened", no DC stated at all).
    name: "impose-condition",
    pattern: /succeed on an? (?:DC\s*(\d+)\s*)?(\w+) saving throw or (?:become|be) ([a-z][a-z\s]*?)(?:\s+for\s+([\w\s]+?))?(?:\.|,|;)/i,
    build: (m) => ({
      featureName: "Impose Condition",
      tierId: resolveConditionTier(m[3]),
      params: {
        condition: m[3].trim(),
        saveAbility: m[2].toLowerCase(),
        ...(m[1] ? { saveDC: Number(m[1]) } : {}),
        ...(m[4] ? { duration: m[4].trim() } : {}),
      },
    }),
  },
  {
    // Same "Impose Condition" concept, but the trigger is a successful
    // ATTACK ROLL rather than a failed save — Iron Bands of Binding's own
    // "On a hit, the target is restrained until...". `trigger` replaces
    // the save fields since there's genuinely no save involved.
    name: "impose-condition-on-hit",
    pattern: /on a hit,? the target is ([a-z][a-z\s]*?)(?:\.|,|;| until)/i,
    build: (m) => ({ featureName: "Impose Condition", tierId: resolveConditionTier(m[1]), params: { condition: m[1].trim(), trigger: "hit" } }),
  },
  {
    // Same "Impose Condition" concept as the base recognizer above, but with
    // an intervening clause between "or" and the condition verb — Fear's
    // own "or drop whatever it is holding and become frightened", Hideous
    // Laughter's own "or fall prone, becoming incapacitated" (confirmed
    // live: a full SRD-spell sweep found the base recognizer's own direct
    // "or (become|be) CONDITION" adjacency missed both). The condition
    // itself is constrained to KNOWN_CONDITION_WORDS — see that constant's
    // own comment for why a free-text capture doesn't work here.
    name: "impose-condition-intervening",
    pattern: new RegExp(
      `succeed on an? (?:DC\\s*(\\d+)\\s*)?(\\w+) saving throw or (?:[\\w\\s']{0,40}? and )?(?:become|becomes|be|is|are|falls?) (${KNOWN_CONDITION_WORDS})\\b(?:\\s+for\\s+([\\w\\s]+?)(?:\\.|,|;))?`,
      "i"
    ),
    build: (m) => ({
      featureName: "Impose Condition",
      tierId: resolveConditionTier(m[3]),
      params: {
        condition: m[3].toLowerCase(),
        saveAbility: m[2].toLowerCase(),
        ...(m[1] ? { saveDC: Number(m[1]) } : {}),
        ...(m[4] ? { duration: m[4].trim() } : {}),
      },
    }),
  },
  {
    // Same concept again, but the two clauses are split across TWO
    // sentences instead of one — Hypnotic Pattern's own "must succeed on a
    // wisdom saving throw. On a failed save, the creature becomes charmed
    // for the duration.", Flesh to Stone's own "...must make a
    // constitution saving throw. On a failed save, it is restrained...".
    // Spans the gap the same non-greedy way area-damage-save-half above
    // already does — safe here since candidate units are per-paragraph,
    // not the whole record's text, so this can't bridge two unrelated
    // clauses the way an unbounded whole-document search could.
    name: "impose-condition-failed-save",
    pattern: new RegExp(
      `must make an? (?:DC\\s*(\\d+)\\s*)?(\\w+) saving throw[\\s\\S]{0,300}?on a failed save,?\\s*(?:a creature |the creature |the target |it )?(?:becomes?|is|falls?)\\s+(${KNOWN_CONDITION_WORDS})\\b(?:\\s+for\\s+([\\w\\s]+?)(?:\\.|,|;))?`,
      "i"
    ),
    build: (m) => ({
      featureName: "Impose Condition",
      tierId: resolveConditionTier(m[3]),
      params: {
        condition: m[3].toLowerCase(),
        saveAbility: m[2].toLowerCase(),
        ...(m[1] ? { saveDC: Number(m[1]) } : {}),
        ...(m[4] ? { duration: m[4].trim() } : {}),
      },
    }),
  },
  {
    // A third real word order — Symbol's own per-rune sub-effects: "must
    // make a wisdom saving throw and becomes frightened for 1 minute on a
    // failed save" (condition AND duration both come BEFORE the trailing
    // "on a failed save", not after it the way the other two shapes have
    // it). The optional filler before "for" (`[\w\s]{0,30}?\bfor\s+`)
    // handles Symbol's own "Pain" rune specifically: "...becomes
    // incapacitated with excruciating pain for 1 minute on a failed save."
    name: "impose-condition-trailing",
    pattern: new RegExp(
      `must make an? (?:DC\\s*(\\d+)\\s*)?(\\w+) saving throw and (?:becomes?|falls?)\\s+(${KNOWN_CONDITION_WORDS})\\b(?:[\\w\\s]{0,30}?\\bfor\\s+([\\w\\s]+?))?\\s+on a failed save`,
      "i"
    ),
    build: (m) => ({
      featureName: "Impose Condition",
      tierId: resolveConditionTier(m[3]),
      params: {
        condition: m[3].toLowerCase(),
        saveAbility: m[2].toLowerCase(),
        ...(m[1] ? { saveDC: Number(m[1]) } : {}),
        ...(m[4] ? { duration: m[4].trim() } : {}),
      },
    }),
  },
  {
    // A fourth real word order — Charm Person's own "It must make a wisdom
    // saving throw... If it fails the saving throw, it is charmed by you
    // until the spell ends." "If it fails the saving throw" (not "on a
    // failed save") is the trigger phrase here, confirmed live.
    name: "impose-condition-if-fails",
    pattern: new RegExp(
      `must make an? (?:DC\\s*(\\d+)\\s*)?(\\w+) saving throw[\\s\\S]{0,200}?if it fails the saving throw,?\\s*(?:it is|it becomes|the target is)\\s+(${KNOWN_CONDITION_WORDS})\\b(?:\\s+for\\s+([\\w\\s]+?)(?:\\.|,|;))?`,
      "i"
    ),
    build: (m) => ({
      featureName: "Impose Condition",
      tierId: resolveConditionTier(m[3]),
      params: {
        condition: m[3].toLowerCase(),
        saveAbility: m[2].toLowerCase(),
        ...(m[1] ? { saveDC: Number(m[1]) } : {}),
        ...(m[4] ? { duration: m[4].trim() } : {}),
      },
    }),
  },
  {
    // A fifth real shape — Blindness/Deafness's own "the target is either
    // blinded or deafened (your choice) for the duration" — a CHOICE
    // between two conditions, not a single fixed one. `condition` stores
    // both, joined ("blinded or deafened"), rather than picking one
    // arbitrarily.
    name: "impose-condition-either-or",
    pattern: new RegExp(
      `(\\w+) saving throw[\\s\\S]{0,100}?is either (${KNOWN_CONDITION_WORDS}) or (${KNOWN_CONDITION_WORDS}) \\(your choice\\)(?:\\s+for\\s+([\\w\\s]+?)(?:\\.|,|;))?`,
      "i"
    ),
    build: (m) => ({
      featureName: "Impose Condition",
      tierId: resolveMoreSevereConditionTier(m[2], m[3]),
      params: {
        condition: `${m[2].toLowerCase()} or ${m[3].toLowerCase()}`,
        saveAbility: m[1].toLowerCase(),
        ...(m[4] ? { duration: m[4].trim() } : {}),
      },
    }),
  },
  {
    // Same concept again, but fully AUTOMATIC — no save, no attack roll —
    // Philter of Love's own "you become charmed by that creature for 1
    // hour". Deliberately narrow (a fixed condition-word list, not a
    // generic capture) since "become" is common prose that would
    // otherwise false-positive on unrelated sentences.
    name: "impose-condition-automatic",
    pattern: /you become (charmed|frightened|poisoned|paralyzed|stunned|restrained|blinded|deafened|incapacitated)(?:\s+by\s+[\w\s]+?)?\s+for\s+([\w\s]+?)(?:\.|,|;)/i,
    build: (m) => ({ featureName: "Impose Condition", tierId: resolveConditionTier(m[1]), params: { condition: m[1].toLowerCase(), trigger: "automatic", duration: m[2].trim() } }),
  },
  {
    // "the boots double your walking speed" (Boots of Speed) — a
    // MULTIPLIER, distinct from `speed-grant` above (which is always a
    // flat new movement type — climbing/swimming/burrowing/flying — never
    // walking speed itself).
    name: "speed-increase-double",
    pattern: /doubles? your walking speed/i,
    build: () => ({ featureName: "Speed Increase", tierId: null, params: { mode: "double" } }),
  },
  {
    // "your walking speed becomes 30 feet, unless your walking speed is
    // higher" (Boots of Striding and Springing) — a FLOOR, not a bonus;
    // never reduces an already-higher speed.
    name: "speed-increase-floor",
    pattern: /your walking speed becomes (\d+) feet, unless your walking speed is higher/i,
    build: (m) => ({ featureName: "Speed Increase", tierId: null, params: { mode: "minimum", distance: Number(m[1]) } }),
  },
  {
    // "increase the creature's walking speed by 30 feet" (Horseshoes of
    // Speed) — an additive bonus to the EXISTING walking speed. Longstrider's
    // own real (and much terser) phrasing — "The target's speed increases
    // by 10 feet" — drops "walking" entirely and uses "increases" (3rd
    // person) rather than the imperative "increase", so it's a second,
    // looser alternative rather than a tweak to the first (the first stays
    // anchored to "walking speed" specifically, since a bare "speed"
    // alternative that loose would risk matching an unrelated speed-type
    // sentence elsewhere in the same text).
    name: "speed-increase-by",
    pattern: /increase (?:the creature'?s |your )?walking speed by (\d+) feet|\bspeed increases by (\d+) feet\b/i,
    build: (m) => ({ featureName: "Speed Increase", tierId: null, params: { mode: "increase", distance: Number(m[1] || m[2]) } }),
  },
  {
    // Expeditious Retreat's own "as a bonus action on each of your turns...
    // you can take the Dash action" — effectively doubles ground covered
    // per turn (Dash grants your speed again as movement) without literally
    // saying "doubles your speed" the way speed-increase-double's own
    // pattern requires, so kept as its own `mode` rather than folded in.
    name: "speed-increase-dash",
    pattern: /bonus action[\s\S]{0,60}?you can take the dash action/i,
    build: () => ({ featureName: "Speed Increase", tierId: null, params: { mode: "dash" } }),
  },
  {
    // "you can jump three times the normal distance" (Boots of Striding
    // and Springing).
    name: "jump-increase",
    pattern: /\byou can jump (one|two|three|four) times the normal distance/i,
    build: (m) => ({ featureName: "Jump Increase", tierId: null, params: { multiplier: { one: 1, two: 2, three: 3, four: 4 }[m[1].toLowerCase()] } }),
  },
  {
    // "you have proficiency with the longbow and shortbow" (Bracers of
    // Archery) — kept as free text (never a fixed enum — real values
    // range from one weapon to a whole category like "martial weapons").
    name: "weapon-proficiency",
    pattern: /\byou have proficiency with the ([\w\s,]+?)(?:,? and you gain|\.|,|;)/i,
    build: (m) => ({ featureName: "Weapon Proficiency", tierId: null, params: { weapons: m[1].trim() } }),
  },
  {
    // All-Purpose Tool's own "Whatever form the tool takes, you are
    // proficient with it" — "it" refers back to a tool the wearer chooses,
    // so unlike weapon-proficiency above there's no fixed name to capture
    // in that (the common) case; a named-tool phrasing ("proficient with
    // thieves' tools") still captures the tool the same way.
    name: "tool-proficiency",
    pattern: /\byou (?:are|become) proficient with (it|that tool|the tool|[\w\s]+? tools?)\b/i,
    build: (m) => {
      const tool = m[1].trim();
      return { featureName: "Tool Proficiency", tierId: null, params: /^(it|that tool|the tool)$/i.test(tool) ? null : { tool } };
    },
  },
  {
    // "+2 bonus to damage rolls on ranged attacks" (Bracers of Archery) —
    // DAMAGE ONLY, distinct from `weapon-attack-bonus` above (a combined
    // attack-AND-damage bonus) and scoped to ranged weapons specifically.
    name: "ranged-damage-bonus",
    pattern: /\+(1|2|3) bonus to damage rolls on ranged attacks/i,
    build: (m) => ({ featureName: "Ranged Damage Bonus", tierId: `plus-${m[1]}`, params: null }),
  },
  {
    // A creature comes into being under the user's control — confirmed
    // live across 4 distinct real phrasings: Figurine of Wondrous Power's
    // own "the figurine becomes a living creature"; a Manual of [X]
    // Golems' own "the golem becomes animate ... It is under your
    // control"; Bag of Tricks' own "it transforms into a creature"; Horn
    // of Valhalla's own "3d4 + 3 warrior spirits ... appear within 60
    // feet of you". Kept as 4 confirmed shapes in one pattern (not a
    // broader "any creature summoning" guess) — real summon-shaped prose
    // varies too much to generalize further without false-positive risk.
    // A 5th confirmed real shape: "has the statistics of a [creature]"
    // (Feather Token, Bird's own "The bird has the statistics of a roc").
    // 2 more confirmed real shapes: Ring of Djinni Summoning's own
    // "summon a particular djinni" / "the djinni appears in an unoccupied
    // space" (no dice-count prefix, unlike Horn of Valhalla's own
    // multi-creature version above), and Staff of the Python's own
    // "becomes a giant constrictor snake under your control" (a NAMED
    // creature, not the generic word "animate"). An 8th confirmed real
    // shape, common across the whole SRD Conjure family (Conjure
    // Celestial/Elemental/Fey, all 3 confirmed live, identical wording):
    // "The [creature] is friendly to you and your companions for the
    // duration. Roll initiative for the [creature]...". A 9th-11th
    // confirmed shape, common to the SRD's own remaining
    // summon-a-companion spells (Conjure Animals/Minor Elementals/
    // Woodland Beings, Find Familiar, Find Steed, Phantom Steed, all
    // confirmed live): "you summon [creatures] that ... appear in an
    // unoccupied space" / "Appearing in an unoccupied space within
    // range, the [creature]..." / "[creature] appears ... in an
    // unoccupied space" — three word orders for the same "a creature
    // shows up in an unoccupied space you designate" idea. The final two
    // alternatives cover a controlled-duplicate/controlled-swarm variant
    // with no "appears" language at all — Simulacrum's own "friendly to
    // you and creatures you designate. It obeys your spoken commands" and
    // Giant Insect's own "Each creature obeys your verbal commands" (both
    // confirmed live) — the same "you now have a controlled creature
    // acting alongside you" mechanic as the rest of this cluster.
    name: "summoned-companion",
    pattern:
      /becomes a living creature|becomes animate[\s\S]{0,80}?under your control|becomes an? [\w\s]+? under your control|transforms? into a creature|\d+d\d+(?:\s*\+\s*\d+)? [\w\s]+? appears? within \d+ feet of you|has the statistics of a|summon a particular \w+|the \w+ appears in an unoccupied space|friendly to you and your companions for the duration[\s\S]{0,120}?roll initiative for|you summon [\w\s]+? that[\s\S]{0,60}?appears? in (?:an? )?unoccupied space|appearing in an unoccupied space|\bcreature appears (?:on the ground )?in an? unoccupied space|friendly to you and creatures you designate\.\s*It obeys your spoken commands|each creature obeys your verbal commands/i,
    build: () => ({ featureName: "Summoned Companion", tierId: null, params: null }),
  },
  {
    // A nonliving object is conjured — Marvelous Pigments' own "becomes a
    // real, nonmagical object", Robe of Useful Items' own "causing it to
    // become the object ... it represents", and 3 more confirmed real
    // shapes from the Feather Token family: "flapping fan takes its
    // place" (Fan), "springs into existence" (Tree), a boat "takes its
    // place" (Swan Boat — also tagged `vehicle` below for its own
    // separate seaworthy-craft properties). Distinct from
    // `summoned-companion` above (a living creature, not an object) and
    // from `summoned-weapon` below (an object that then fights on its
    // own, not just a static object).
    name: "summoned-object",
    pattern:
      /becomes a real, nonmagical object|causing it to become the object or creature it represents|flapping fan takes its place|springs into existence|boat[\s\S]{0,20}?takes its place/i,
    build: () => ({ featureName: "Summoned Object", tierId: null, params: null }),
  },
  {
    // Feather Token (Whip)'s own "a floating whip takes its place" — the
    // conjured object then fights on its own (see the item's own
    // follow-up spell-attack text), distinct from a static
    // `summoned-object`.
    name: "summoned-weapon",
    pattern: /whip takes its place/i,
    build: () => ({ featureName: "Summoned Weapon", tierId: null, params: null }),
  },
  {
    // Extradimensional/oversized storage — Bag of Holding's own "interior
    // space considerably larger than its outside dimensions", Efficient
    // Quiver/Handy Haversack's own literal "extradimensional space", Bag
    // of Devouring's own "resembles a bag of holding".
    name: "inventory-expansion",
    pattern: /extradimensional space|considerably larger than its outside dimensions|hold numerous items while never weighing|resembles a bag of holding/i,
    build: () => ({ featureName: "Inventory Expansion", tierId: null, params: null }),
  },
  {
    // Apparatus of the Crab's own real stat-block shape — a vehicle with
    // its own AC/HP, distinct from the wearer's/pilot's own stats.
    // Two confirmed real shapes: Apparatus of the Crab's own real stat-
    // block header ("Armor Class: 20 ... Hit Points: 200") AND a plainer
    // prose form for an autonomous OBJECT rather than a pilotable vehicle
    // (Rope of Climbing/Rope of Entanglement: "The rope has AC 20 and 20
    // hit points") — reused here rather than inventing a near-duplicate
    // Feature, since mechanically both are "this object has its own
    // combat stats independent of its wielder".
    // 2 more confirmed real shapes with NO stated AC/HP at all — Folding
    // Boat's own "causes the box to unfold into a boat/ship", Feather
    // Token (Swan Boat)'s own "The boat is self-propelled" — still a real
    // vehicle (something the user rides/pilots), just without its own
    // combat stats; `ac`/`hp` are simply omitted from params in that case
    // rather than forced to a guessed value.
    name: "vehicle",
    pattern: /Armor Class:\s*(\d+)[\s\S]{0,40}?Hit Points:\s*(\d+)|has AC (\d+) and (\d+) hit points|unfolds? into a (?:boat|ship)|self-propelled/i,
    build: (m) => {
      const ac = m[1] || m[3];
      const hp = m[2] || m[4];
      return { featureName: "Vehicle", tierId: null, params: ac ? { ac: Number(ac), hp: Number(hp) } : null };
    },
  },
  {
    // Decanter of Endless Water's own "produces N gallons/gallon of
    // water" — kept as free text since the produced resource (and its
    // amount) varies per option.
    name: "resource-production",
    pattern: /produces? ([\w\s]*?) of (?:fresh )?(?:salt )?water/i,
    build: (m) => ({ featureName: "Resource Production", tierId: null, params: { resourceText: `${m[1].trim()} of water` } }),
  },
  {
    // Eversmoking Bottle's own "the cloud's area is heavily obscured".
    name: "obscurement",
    pattern: /\b(?:is|becomes) (heavily obscured|lightly obscured)/i,
    build: (m) => ({ featureName: "Obscurement", tierId: null, params: { level: m[1].toLowerCase() } }),
  },
  {
    // Two confirmed real phrasings: Dimensional Shackles' own "prevent a
    // creature ... from using any method of extradimensional movement",
    // Feather Token (Anchor)'s own "the vessel can't be moved by any
    // means".
    // A 3rd confirmed real shape: Immovable Rod's own "causes the rod to
    // become magically fixed in place".
    name: "restrict-movement",
    pattern: /prevents? (?:a |the )?creature[\s\S]{0,20}?from using any method of extradimensional movement|vessel can'?t be moved by any means|become magically fixed in place/i,
    build: () => ({ featureName: "Restrict Movement", tierId: null, params: null }),
  },
  {
    // Dancing Sword's own "the sword begins to hover, flies up to 30
    // feet, and attacks one creature" — a weapon that fights on its own.
    name: "animated-weapon",
    pattern: /begins to hover[\s\S]{0,40}?attacks one creature/i,
    build: () => ({ featureName: "Animated Weapon", tierId: null, params: null }),
  },
  {
    // Wand of Enemy Detection's own "you know the direction of the
    // nearest creature hostile to you".
    // A 2nd confirmed real shape: Lantern of Revealing's own "Invisible
    // creatures and objects are visible" (while in the lantern's own
    // light), distinct from the "you know the direction" active-search
    // shape.
    // A 3rd confirmed real shape: Wand of Secrets' own "the wand pulses
    // and points at the one nearest to you" (secret doors/traps).
    name: "detection",
    pattern: /you know the direction of the nearest ([\w\s]+?)(?:\s+within|\.|,)|invisible creatures and objects are visible|pulses and points at/i,
    build: (m) => ({
      featureName: "Detection",
      tierId: null,
      params: { detects: m[1] ? m[1].trim() : /pulses/i.test(m[0]) ? "nearest secret door or trap" : "invisible creatures and objects" },
    }),
  },
  {
    // Detect Magic's own "you sense the presence of magic within 30 feet",
    // Detect Poison and Disease's own "sense the presence and location of
    // poisons, poisonous creatures, and diseases within 30 feet" — same
    // "Detection" Feature the item-oriented shapes above already share,
    // now with a real numeric `range` captured too (an item's own detection
    // clause almost never states one explicitly the way a spell's own
    // "within N feet" always does).
    name: "detect-presence-within-range",
    pattern: /sense the presence(?: and location)? of ([\w\s,]+?) within (\d+) (feet|miles?)/i,
    build: (m) => ({ featureName: "Detection", tierId: null, params: { detects: m[1].trim(), range: Number(m[2]), rangeUnit: /mile/i.test(m[3]) ? "miles" : "feet" } }),
  },
  {
    // Detect Evil and Good's own "you know if there is an aberration,
    // celestial, elemental, fey, fiend, or undead within 30 feet of you".
    name: "detect-know-if-within-range",
    pattern: /you know if there is an? ([\w\s,]+?) within (\d+) (feet|miles?)/i,
    build: (m) => ({ featureName: "Detection", tierId: null, params: { detects: m[1].trim(), range: Number(m[2]), rangeUnit: /mile/i.test(m[3]) ? "miles" : "feet" } }),
  },
  {
    // Locate Creature/Object's own "you sense the direction to the
    // creature's location, as long as that creature is within 1,000 feet".
    name: "detect-sense-direction-to",
    pattern: /you sense the direction to (?:the )?([\w\s']+?)(?:'s location)?,? as long as (?:that|it is)?[\s\S]{0,20}?within ([\d,]+) (feet|miles?)/i,
    build: (m) => ({ featureName: "Detection", tierId: null, params: { detects: m[1].trim(), range: Number(m[2].replace(/,/g, "")), rangeUnit: /mile/i.test(m[3]) ? "miles" : "feet" } }),
  },
  {
    // Locate Animals or Plants' own "you learn the direction and distance
    // to the closest creature or plant of that kind within 5 miles".
    name: "detect-learn-direction-distance",
    pattern: /you learn the direction and distance to the closest ([\w\s]+?) within (\d+) (feet|miles?)/i,
    build: (m) => ({ featureName: "Detection", tierId: null, params: { detects: m[1].trim(), range: Number(m[2]), rangeUnit: /mile/i.test(m[3]) ? "miles" : "feet" } }),
  },
  {
    // Commune with Nature's own "the spell gives you knowledge of the land
    // within 3 miles of you" — a broader "sense your surroundings" shape
    // than the others above, still fundamentally the same Detection
    // concept (what's around you, out to a range), not a distinct one.
    name: "detect-knowledge-of-territory",
    pattern: /(?:gain(?:s)?|gives you) knowledge of the (?:surrounding )?(?:land|territory) within (\d+) (feet|miles?)/i,
    build: (m) => ({ featureName: "Detection", tierId: null, params: { detects: "the surrounding land", range: Number(m[1]), rangeUnit: /mile/i.test(m[2]) ? "miles" : "feet" } }),
  },
  {
    // Find Traps' own "you sense the presence of any trap within range" —
    // no numeric range stated (it's the spell's own cast RANGE, a separate
    // stats.range field, not restated in prose the way the others above
    // give a fixed sensing radius) — `range` stays unset rather than
    // guessed.
    name: "detect-presence-of-traps",
    pattern: /sense the presence of any trap/i,
    build: () => ({ featureName: "Detection", tierId: null, params: { detects: "traps" } }),
  },
  {
    // The SRD's whole light-creating spell family shares this shape —
    // Light's own "sheds bright light in a 20-foot radius and dim light
    // for an additional 20 feet" (confirmed live). `dimRadius` is the
    // TOTAL reach from the source (bright radius + the "additional" span
    // stated), not the additional span alone — more directly useful than
    // forcing a reader to add the two together themselves.
    name: "creates-light-bright-and-dim",
    pattern: /sheds bright light in an? (\d+)-foot radius and dim light for an additional (\d+) feet/i,
    build: (m) => ({
      featureName: "Create Light/Darkness",
      tierId: null,
      params: { mode: "light", brightRadius: Number(m[1]), dimRadius: Number(m[1]) + Number(m[2]) },
    }),
  },
  {
    // Daylight's own real (differently-shaped) phrasing: the bright radius
    // comes from the sphere's own stated size ("A 60-foot-radius sphere of
    // light..."), not restated next to "bright light" directly, and the
    // dim "additional" span trails afterward in its own sentence.
    name: "creates-light-sphere-and-dim",
    pattern: /(\d+)-foot-radius sphere of light[\s\S]{0,150}?dim light for an additional (\d+) feet/i,
    build: (m) => ({
      featureName: "Create Light/Darkness",
      tierId: null,
      params: { mode: "light", brightRadius: Number(m[1]), dimRadius: Number(m[1]) + Number(m[2]) },
    }),
  },
  {
    // Dancing Lights'/Faerie Fire's own real shape — dim light ONLY, no
    // bright radius at all: "each light sheds dim light in a 10-foot
    // radius" / "objects and affected creatures shed dim light in a
    // 10-foot radius". "sheds?" covers both the singular and plural
    // subject forms confirmed live.
    name: "creates-light-dim-only",
    pattern: /sheds? dim light in an? (\d+)-foot radius/i,
    build: (m) => ({ featureName: "Create Light/Darkness", tierId: null, params: { mode: "light", dimRadius: Number(m[1]) } }),
  },
  {
    // The SRD's own "Speak with X"/language-comprehension spell cluster
    // shares this shape, confirmed live: Speak with Animals' own "gain the
    // ability to comprehend and verbally communicate with beasts",
    // Comprehend Languages' own "understand the literal meaning of any
    // spoken language", Tongues' own "understand any spoken language it
    // hears".
    name: "comprehend-language",
    pattern: /comprehend and (?:verbally )?communicate with|understand (?:the literal meaning of )?any (?:spoken )?language|understand any written language|ability to communicate with/i,
    build: () => ({ featureName: "Comprehend Language", tierId: null, params: null }),
  },
  {
    // The SRD's own oracle/consultation spell cluster shares this shape,
    // confirmed live: Divination's own "You ask a single question... The
    // GM offers a truthful reply", Augury's own "you receive an omen",
    // Commune's own "ask up to three questions that can be answered with
    // a yes or no... You receive a correct answer".
    name: "divine-consultation",
    pattern: /ask (?:a|an|up to \w+) (?:single )?questions?[\s\S]{0,150}?(?:reply|answer|omen)|receive an omen/i,
    build: () => ({ featureName: "Divine Consultation", tierId: null, params: null }),
  },
  {
    // The SRD's own discrete-image illusion cluster — Minor Illusion's own
    // "create a sound or an image of an object", Silent Image's/Major
    // Image's own "create the image of an object, a creature", Project
    // Image's own "create an illusory copy of yourself", all confirmed
    // live. A single object/creature/sound, not a whole area — see
    // terrain-illusion below for that shape instead.
    name: "creates-illusion",
    pattern: /create (?:the |a )?(?:sound or an? )?image of (?:an? )?(?:object|creature)|create an illusory copy of yourself/i,
    build: () => ({ featureName: "Creates Illusion", tierId: null, params: null }),
  },
  {
    // Disguise Self's own "look different until the spell ends", Seeming's
    // own "change the appearance of... a new, illusory appearance" — an
    // illusory change to how the TARGET looks, not a conjured object/
    // creature that wasn't there before (creates-illusion above).
    name: "illusory-disguise",
    pattern: /look different until the spell ends|change the appearance of|new,? illusory appearance/i,
    build: () => ({ featureName: "Illusory Disguise", tierId: null, params: null }),
  },
  {
    // Mirage Arcane's own "make terrain... look, sound, smell, and even
    // feel like some other sort of terrain", Hallucinatory Terrain's own
    // near-identical "make natural terrain... look, sound, and smell like
    // some other sort of natural terrain" — a WHOLE AREA'S apparent
    // terrain type, distinct from creates-illusion (one discrete object/
    // creature/sound) and from shapes-terrain below (a REAL physical
    // change, not merely perceived).
    name: "terrain-illusion",
    pattern: /terrain[\s\S]{0,40}?look,? sound,? (?:and smell|smell,? and (?:even feel|feel))? like some other/i,
    build: () => ({ featureName: "Terrain Illusion", tierId: null, params: null }),
  },
  {
    // The SRD's own cure-an-ailment cluster — Lesser Restoration's own
    // "end either one disease or one condition", Greater Restoration's own
    // "undo a debilitating effect", Remove Curse's own "all curses
    // affecting one creature or object end", Spare the Dying's own "the
    // creature becomes stable" — all confirmed live, all "end an ongoing
    // bad thing" rather than restoring hit points (feat.healing) or
    // bringing someone back from death entirely (revives-dead below).
    name: "cures-condition",
    pattern: /end (?:either )?one (?:disease|condition)|undo a debilitating effect|curses? affecting (?:one|the) (?:creature|object)(?:\s+or\s+\w+)? end|becomes? stable/i,
    build: () => ({ featureName: "Cures Condition", tierId: null, params: null }),
  },
  {
    // The SRD's own resurrection cluster — Raise Dead's/Revivify's/
    // Resurrection's/True Resurrection's own shared "the creature returns
    // to life"/"the creature is restored to life", confirmed live across
    // all 4.
    name: "revives-dead",
    pattern: /returns? to life|restored to life/i,
    build: () => ({ featureName: "Revives Dead", tierId: null, params: null }),
  },
  {
    // Stone Shape's own "form it into any shape that suits your purpose",
    // Move Earth's own "reshape dirt, sand, or clay... raise or lower the
    // area's elevation" — a REAL physical change to terrain/stone, unlike
    // terrain-illusion above (only how it's perceived).
    name: "shapes-terrain",
    pattern: /form it into any shape|reshape dirt, sand, or clay|raise or lower the area'?s elevation/i,
    build: () => ({ featureName: "Shapes Terrain", tierId: null, params: null }),
  },
  {
    // The SRD's own remote-message spell cluster shares this shape,
    // confirmed live: Contact Other Plane's own "You mentally contact a
    // demigod...", Message's own "The target...hears the message and can
    // reply", Sending's own "The creature hears the message in its mind...
    // and can answer", Telepathic Bond's own "the targets can communicate
    // telepathically through the bond". Distinct from feat.comprehend-
    // language (understanding a language) and feat.detection (sensing
    // presence/direction, not exchanging messages).
    name: "communication",
    pattern: /mentally contact|hears the message[\s\S]{0,40}?can reply|hears the message in its mind|communicate telepathically/i,
    build: () => ({ featureName: "Communication", tierId: null, params: null }),
  },
  {
    // Dispel Magic's own "the spell ends", Counterspell's own "its spell
    // fails and has no effect"/"the creature's spell fails" — both
    // confirmed live, both "make another spell stop working outright"
    // rather than resisting its damage or curing its aftereffects.
    name: "negate-magic",
    pattern: /the spell ends\.|its spell fails and has no effect|the creature'?s spell fails/i,
    build: () => ({ featureName: "Negate Magic", tierId: null, params: null }),
  },
  {
    // Darkness's own "Magical darkness spreads from a point you choose
    // within range to fill a 15-foot-radius sphere" — the direct inverse
    // of the creates-light-* recognizers above, folded into the SAME
    // feat.create-light-darkness rather than a separate Feature — same
    // shape (a radius from a source), opposite `mode`.
    name: "creates-darkness",
    pattern: /darkness spreads[\s\S]{0,60}?fill an? (\d+)-foot-radius sphere/i,
    build: (m) => ({ featureName: "Create Light/Darkness", tierId: null, params: { mode: "darkness", radius: Number(m[1]) } }),
  },
  {
    // Mithral Armor's own real shape — REMOVES an inherent disadvantage
    // ("If the armor normally imposes disadvantage on Dexterity (Stealth)
    // checks ... the mithral version ... doesn't") rather than granting
    // advantage outright, but mechanically identical: advantage and
    // disadvantage on the same roll cancel, so removing an inherent
    // disadvantage IS the "advantage" tier of the same shared
    // `feat.skill-bonus` Feature the plain-advantage recognizer above
    // targets — not a new concept.
    name: "mithral-removes-disadvantage",
    pattern: /imposes disadvantage on (\w+) \((\w+)\) checks/i,
    build: (m) => ({ featureName: "Skill Bonus", tierId: "advantage", params: { skill: m[2].trim().toLowerCase() } }),
  },
  {
    // "you become invisible" (Dust of Disappearance, Potion of
    // Invisibility) / "you can turn invisible" (Ring of Invisibility) —
    // confirmed live across all 3.
    name: "invisibility",
    pattern: /become invisible|can turn invisible|becomes? invisible/i,
    build: () => ({ featureName: "Invisibility", tierId: null, params: null }),
  },
  {
    // Generalized from "Unlock or Open" — Arcane Lock's own "it becomes
    // locked for the duration" and Knock's own "becomes unlocked, unstuck,
    // or unbarred" are the SAME underlying concept (this record acts on a
    // door/lock/latch from a distance) as Chime of Opening's own "one lock
    // or latch on the object opens" — just a different one of the four
    // real actions confirmed live (lock/unlock/open/close), so one shared
    // Feature with an `action` param rather than three near-duplicates.
    name: "lock-control-lock",
    pattern: /becomes locked for the duration/i,
    build: () => ({ featureName: "Lock Control", tierId: null, params: { action: "lock" } }),
  },
  {
    name: "lock-control-unlock",
    pattern: /becomes unlocked, unstuck, or unbarred/i,
    build: () => ({ featureName: "Lock Control", tierId: null, params: { action: "unlock" } }),
  },
  {
    // Chime of Opening's own "one lock or latch on the object opens" /
    // "the object itself opens".
    name: "lock-control-open",
    pattern: /lock or latch[\s\S]{0,20}?opens|the object itself opens/i,
    build: () => ({ featureName: "Lock Control", tierId: null, params: { action: "open" } }),
  },
  {
    // Dust of Dryness' own "turns a cube of water ... into one marble-
    // sized pellet" — removes water from an area into a compact, storable
    // form.
    name: "desiccation",
    pattern: /turns? a cube of water[\s\S]{0,40}?into (?:a |one )?(?:marble-sized )?pellet/i,
    build: () => ({ featureName: "Desiccation", tierId: null, params: null }),
  },
  {
    // Ring of Water Walking's own "you can stand on and move across any
    // liquid surface as if it were solid ground" — OR the Water Walk
    // SPELL's own shorter real phrasing (confirmed live), which drops
    // "stand on and" entirely: "grants the ability to move across any
    // liquid surface... as if it were harmless solid ground".
    name: "water-walking",
    pattern: /(?:stand on and )?move across (?:any )?liquid surface/i,
    build: () => ({ featureName: "Water Walking", tierId: null, params: null }),
  },
  {
    // Horseshoes of a Zephyr's own "allow the creature to move normally
    // while floating 4 inches above the ground" — hovering just above the
    // ground, distinct from an actual flying speed (`feat.speed-grant`).
    name: "hover",
    pattern: /floating \d+ inches? above the ground|move normally while floating/i,
    build: () => ({ featureName: "Hover", tierId: null, params: null }),
  },
  {
    // Amulet of Proof against Detection and Location's own "hidden from
    // divination magic".
    name: "divination-immunity",
    pattern: /hidden from divination magic/i,
    build: () => ({ featureName: "Divination Immunity", tierId: null, params: null }),
  },
  {
    // Animated Shield's own "hovers in your space to protect you" /
    // "leaving your hands free" — the item functions without being held.
    // "leaving your hands free" was REMOVED as a trigger — confirmed live
    // it's a false positive: Slippers of Spider Climbing/Cloak of
    // Arachnida both use the exact same phrase for an unrelated meaning
    // ("you don't need your hands to climb"), not "the item works without
    // being held" the way Animated Shield's own text means it. Only the
    // one unambiguous confirmed shape remains.
    name: "self-wielding",
    pattern: /hovers? in your space to protect you/i,
    build: () => ({ featureName: "Self-Wielding", tierId: null, params: null }),
  },
  {
    // Gem of Seeing's own "you have truesight out to 120 feet" — OR True
    // Seeing's own real (spell) phrasing, confirmed live: "the creature has
    // truesight, notices secret doors hidden by magic, and can see into
    // the Ethereal Plane, all out to a range of 120 feet" — the range
    // trails a whole list of OTHER granted senses, not "truesight"
    // directly, so it's captured as a separate optional group rather than
    // required immediately after "truesight" the way the item phrasing has
    // it.
    name: "truesight",
    pattern: /\b(?:you have |has )truesight\b(?:[\s\S]{0,120}?(?:out to|range of) (\d+) feet)?/i,
    build: (m) => ({ featureName: "Truesight", tierId: null, params: m[1] ? { range: Number(m[1]) } : null }),
  },
  {
    // Gloves of Missile Snaring's own "reduce the damage by 1d10 + your
    // Dexterity modifier".
    name: "damage-reduction",
    pattern: /reduce the damage by (\d+d\d+(?:\s*\+\s*[\w\s]+)?)/i,
    build: (m) => ({ featureName: "Damage Reduction", tierId: null, params: { reductionDice: m[1].trim() } }),
  },
  {
    // Pearl of Power's own "regain one expended spell slot".
    name: "spell-slot-recovery",
    pattern: /regain one expended spell slot/i,
    build: () => ({ featureName: "Spell Slot Recovery", tierId: null, params: null }),
  },
  {
    // Periapt of Wound Closure's own "you stabilize whenever you are
    // dying".
    name: "auto-stabilize",
    pattern: /you stabilize whenever you are dying/i,
    build: () => ({ featureName: "Auto-Stabilize", tierId: null, params: null }),
  },
  {
    // Pipes of the Sewers' own "becomes friendly to you and your
    // companions" (via a contested check, not a save) — an EXISTING
    // creature won over, distinct from `summoned-companion` (a new one
    // conjured).
    name: "animal-charm",
    pattern: /becomes friendly to you and your companions/i,
    build: () => ({ featureName: "Animal Charm", tierId: null, params: null }),
  },
  {
    // Two confirmed real phrasings: Ring of Evasion's own "succeed on
    // that saving throw instead", Staff of Charming's own "turn your
    // failed save into a successful one".
    name: "reroll-save",
    pattern: /succeed on that saving throw instead|turn your failed save into a successful one/i,
    build: () => ({ featureName: "Reroll Save", tierId: null, params: null }),
  },
  {
    // Clockwork Amulet's own "you can forgo rolling the d20 to get a 10 on
    // the die" — sets a specific roll's own d20 result to a fixed number
    // instead of actually rolling it. Distinct from reroll-save above
    // (rolls AGAIN) and from a flat bonus (adds to whatever's rolled) —
    // this replaces the roll outright. `mode: "fixed"` distinguishes this
    // from the bonus-die sibling right below (Bane/Bless/Guidance) — both
    // share the "Modifies Roll" Feature since both change how a roll
    // resolves, but a fixed substitution and a rolled bonus die are
    // different enough mechanically to need their own params shape.
    name: "modifies-roll",
    pattern: /when you make an? ([\w\s]+?) roll[^.]*?forgo rolling the d20 to get an? (\d+) on the die/i,
    build: (m) => ({ featureName: "Modifies Roll", tierId: null, params: { rollType: m[1].trim(), mode: "fixed", value: Number(m[2]) } }),
  },
  {
    // Bane's own "roll a d4 and subtract the number rolled from the attack
    // roll or saving throw", Bless's own near-identical "...add the number
    // rolled to the attack roll or saving throw", Guidance's own "...add
    // the number rolled to one ability check of its choice" — all
    // confirmed live: a rolled BONUS die (not a fixed substitute value)
    // added to or subtracted from a specific kind of roll.
    name: "modifies-roll-bonus-die",
    pattern: /roll an? (d\d+) and (add|subtract) the number rolled (?:to|from) (?:the |one )?([\w\s]+?)(?:\s+of its choice)?(?:\.|,|;)/i,
    build: (m) => ({ featureName: "Modifies Roll", tierId: null, params: { rollType: m[3].trim(), mode: "bonus-die", die: m[1].toLowerCase(), sign: m[2].toLowerCase() } }),
  },
  {
    // Ring of Feather Falling's own "you descend 60 feet per round and
    // take no damage from falling" — OR the Feather Fall SPELL's own real
    // (and structurally different) phrasing, confirmed live: "rate of
    // descent slows to 60 feet per round... it takes no falling damage",
    // the two clauses split across two sentences rather than joined by
    // "and" in one.
    name: "feather-fall",
    pattern: /descend \d+ feet per round and take no damage from falling|descent slows to \d+ feet per round[\s\S]{0,120}?takes? no (?:falling damage|damage from falling)/i,
    build: () => ({ featureName: "Feather Fall", tierId: null, params: null }),
  },
  {
    // Ring of Free Action's own "difficult terrain doesn't cost you extra
    // movement" — OR the Freedom of Movement SPELL's own real (3rd-person)
    // phrasing, confirmed live: "the target's movement is unaffected by
    // difficult terrain".
    name: "freedom-of-movement",
    pattern: /difficult terrain doesn'?t cost you extra movement|movement is unaffected by difficult terrain/i,
    build: () => ({ featureName: "Freedom of Movement", tierId: null, params: null }),
  },
  {
    // Ring of the Ram's own "pushed 5 feet away from you".
    name: "forced-movement",
    pattern: /pushed? (\d+) feet away from you/i,
    build: (m) => ({ featureName: "Forced Movement", tierId: null, params: { distance: Number(m[1]) } }),
  },
  {
    // Ring of X-ray Vision's own "see into and through solid matter".
    name: "x-ray-vision",
    pattern: /see into and through solid matter/i,
    build: () => ({ featureName: "X-Ray Vision", tierId: null, params: null }),
  },
  {
    // Talisman of the Sphere's own "double your proficiency bonus on the
    // check".
    name: "expertise",
    pattern: /double your proficiency bonus on the check/i,
    build: () => ({ featureName: "Expertise", tierId: null, params: null }),
  },
  {
    // Sword of Wounding's own "at the start of each of the wounded
    // creature's turns, it takes 1d4 necrotic damage" — OR the reverse word
    // order, Alchemist's Fire's own real (and more common) phrasing: "the
    // target takes 1d4 fire damage at the start of each of its turns".
    // Same concept, same shared Feature either way.
    name: "damage-over-time",
    pattern:
      /(?:at the start of each of (?:the wounded creature'?s|its) turns,?\s*(?:it|the target) takes (\d+d\d+) (\w+) damage|(?:the target|it) takes (\d+d\d+) (\w+) damage at the start of each of (?:the wounded creature'?s|its) turns)/i,
    build: (m) => ({ featureName: "Damage Over Time", tierId: null, params: { damageDice: m[1] || m[3], damageType: (m[2] || m[4]).toLowerCase() } }),
  },
  {
    // Rod of Absorption's own "absorb a spell that is targeting only
    // you".
    name: "spell-absorption",
    pattern: /absorb a spell that is targeting only you/i,
    build: () => ({ featureName: "Spell Absorption", tierId: null, params: null }),
  },
  {
    // Staff of Charming's own "turn the spell back on its caster".
    name: "spell-reflection",
    pattern: /turn the spell back on its caster/i,
    build: () => ({ featureName: "Spell Reflection", tierId: null, params: null }),
  },
  {
    // Robe of Stars' own "enter the Astral Plane" — OR the Etherealness
    // SPELL's own real phrasing, confirmed live: "You step into the border
    // regions of the Ethereal Plane" — same underlying concept (crossing
    // to another plane), a different specific plane and verb. Named
    // "Planar Travel", NOT "Etherealness" — Crucible already has a
    // MONSTER Feature literally named "Etherealness" (feat.etherealness,
    // categories: ["monster"], its own "passive" mechanics type); reusing
    // that name here would collide on the same slugified id even though
    // Vault's own candidatePool filtering keeps the two apart at match
    // time, same reasoning as personal-teleportation's own name choice
    // below (Crucible's own separate "Teleport").
    name: "planar-travel",
    pattern: /enter the astral plane|step into[\s\S]{0,40}?ethereal plane/i,
    build: () => ({ featureName: "Planar Travel", tierId: null, params: null }),
  },
  {
    // Amulet of the Black Skull's own "transport yourself and anything you
    // are wearing or carrying to a location within 100 feet of you" — a
    // short-range, SAME-plane teleport, distinct from planar-travel above
    // (which crosses planes with no distance limit). Named "Personal
    // Teleportation", NOT "Teleport" — Crucible already has a monster
    // Feature literally named "Teleport" (feat.teleport, a passive
    // teleport-as-part-of-its-move ability with its own tiers); reusing
    // that name here would collide on the same slugified id even though
    // Vault's own candidatePool filtering keeps the two apart at match
    // time (monster-category vs item-category).
    name: "personal-teleportation",
    pattern: /transport (?:yourself|you)(?: and [\w\s]+?)? to an? (?:location|point|space|unoccupied space) within (\d+) feet/i,
    build: (m) => ({ featureName: "Personal Teleportation", tierId: null, params: { range: Number(m[1]) } }),
  },
  {
    // Same concept, Misty Step's own real (and much shorter) phrasing:
    // "you teleport up to 30 feet to an unoccupied space that you can
    // see" — the verb IS "teleport" here rather than "transport", and the
    // range comes right after "up to" instead of after "within".
    name: "personal-teleportation-up-to",
    pattern: /\byou teleport up to (\d+) feet to an? (?:location|point|space|unoccupied space)/i,
    build: (m) => ({ featureName: "Personal Teleportation", tierId: null, params: { range: Number(m[1]) } }),
  },
  {
    // Stone of Good Luck's own "+1 bonus to ability checks and saving
    // throws" — a BROADER bonus than `feat.skill-bonus` (one named skill)
    // or `feat.protection-bonus` (AC/saves specifically).
    name: "general-bonus",
    pattern: /\+(1|2|3) bonus to ability checks and saving throws/i,
    build: (m) => ({ featureName: "General Bonus", tierId: `plus-${m[1]}`, params: null }),
  },
];

// Runs the WHOLE library against one candidate unit's own text — returns
// every DISTINCT recognizer that matches, not just the first. A single
// sentence can genuinely describe two independent abilities at once
// (confirmed live: "...you can breathe underwater, and you have a
// swimming speed of 60 feet." — one unit, two unrelated generic Features,
// `water-breathing` and `speed-modification`) — stopping at the first hit
// would silently drop the second ability instead of just leaving it less
// granular. Deduped by recognizer `name` (a unit that happens to match the
// SAME recognizer's pattern twice — regex quirk, not a real second
// ability — only produces one result). Empty array (not `null`) when
// nothing in the known list recognizes any part of it — convertCandidateUnit
// below reports nothing for this unit in that case, rather than minting a
// Feature from unclassified text.
function recognizeClause(text) {
  const results = [];
  const seen = new Set();
  for (const recognizer of CLAUSE_RECOGNIZERS) {
    const match = text.match(recognizer.pattern);
    if (!match) continue;
    const result = recognizer.build(match);
    if (!result || seen.has(recognizer.name)) continue;
    seen.add(recognizer.name);
    results.push(result);
  }
  return results;
}

// The 5e API's own `***Label.***` bold markdown lead-in (confirmed live:
// Armor of Vulnerability's own "***Curse.*** This armor is cursed...",
// Feather Token's own "***Anchor.*** You can use an action...") is a
// STRUCTURAL signal the source itself already gives for what one candidate
// unit is conceptually called — far better than this module's own
// generated "Effect N" fallback, and (for the one label checked below)
// reliable enough to route straight to a dedicated shared Feature without
// running it through the generic clause recognizers at all. Stripped from
// the returned `text` either way, so it never leaks literal asterisks into
// a Feature's own description.
const BOLD_LABEL_PATTERN = /^\*\*\*([^*]+?)\.?\*\*\*\s*/;
function extractBoldLabel(text) {
  const match = BOLD_LABEL_PATTERN.exec(text);
  if (!match) return { label: null, text };
  return { label: match[1].trim(), text: text.slice(match[0].length) };
}

// Converts ONE candidate unit into ZERO OR MORE `{featureId, featureParams,
// tierId}` references (see recognizeClause's own comment on why more than
// one is possible). ALLOWLIST policy, not "always capture something": a
// magic item's own prose is unstructured free text (unlike a monster's own
// pre-segmented traits/actions), and a real spot-check of a 355-item bulk
// import showed trying to classify every leftover clause as "a real
// mechanic" vs. "just flavor" is fundamentally unreliable from text alone —
// genuine mechanics ("Speak with animals", "the rod becomes a flame
// tongue") and pure description ("This tiny object looks like a feather.")
// both read the same way to a generic heuristic, and a purpose-built
// pattern for ONE item's own wording doesn't belong in shared code. So this
// only ever maps a clause onto a Feature that's part of the KNOWN list —
// CLAUSE_RECOGNIZERS above, or one of the structural dispatches below
// (Curse, Spell Menu) — and otherwise reports NOTHING for this unit rather
// than minting a fresh one-off Feature from raw, unclassified text. That's
// not data loss: the Effect's own `notes` already preserves the complete
// original description regardless (mapping-custom-functions.js binds
// `notes` to the whole `itemStats.description`, untouched by this
// function). Growing the known list — a new CLAUSE_RECOGNIZERS entry, or a
// new structural dispatch — is how a recurring concept gets captured;
// never a text-dump fallback.
async function convertCandidateUnit(rawText, ctx) {
  const { candidatePool, existingFeatures, systemId, dataManager, result, substitute } = ctx;
  const { label, text: labelStrippedText } = extractBoldLabel(rawText);
  const text = substitute(labelStrippedText);

  // "Curse" is common and recognizable enough (attunement-linked, ongoing
  // while attuned, ends only via remove curse/similar magic) to warrant its
  // own shared Feature — but the actual DRAWBACK varies too much item to
  // item (forced vulnerability, disadvantage on attacks/saves, forced
  // behavior, redirected attacks — all confirmed live across 4 different
  // cursed items) to decompose further than one freeform `curseText` param,
  // same "compound fact stays together" reasoning as `feat.cast-a-spell`'s
  // own params. Routed BEFORE the generic clause recognizers (skipping them
  // entirely for this unit) since a curse's own internal clauses (e.g. "you
  // have vulnerability to two of the three damage types") are part of ONE
  // conceptual drawback, not independent abilities to split out further.
  if (label && label.toLowerCase() === "curse") {
    const template = await matchOrCreateParameterizedFeature("Curse", GENERIC_ACTIVE_TYPE, { candidatePool, existingFeatures, systemId, dataManager, result });
    return [{ featureId: template.id, featureParams: { curseText: text.trim() }, tierId: null }];
  }

  const recognized = recognizeClause(text);
  if (recognized.length) {
    const refs = [];
    for (const entry of recognized) {
      const template = await matchOrCreateParameterizedFeature(entry.featureName, GENERIC_ACTIVE_TYPE, { candidatePool, existingFeatures, systemId, dataManager, result });
      refs.push({ featureId: template.id, featureParams: entry.params, tierId: entry.tierId });
    }
    return refs;
  }

  return [];
}

// feat.damage's own six tiers are deliberately spell-level-shaped
// (Cantrip/1st–2nd/3rd–4th/5th–6th/7th–8th/9th — see that record's own
// `shortName` values) — a spell's own parsed `stats.level` (srdSpellStats/
// markdownSpellStats in mapping-custom-functions.js both already return it)
// maps onto them directly. Returns null for anything without a numeric
// level (every item — items have no spell-level concept at all), leaving
// featureTiers untouched for those, same as before this existed.
function resolveSpellDamageTier(level) {
  if (!Number.isFinite(level)) return null;
  if (level <= 0) return "tier-1";
  if (level <= 2) return "tier-2";
  if (level <= 4) return "tier-3";
  if (level <= 6) return "tier-4";
  if (level <= 8) return "tier-5";
  return "tier-6";
}

// `record` — an already-mapped Effect record (5e-api-spell.json/
// 5e-api-magic-item.json's own output, or a hand-authored one carrying the
// same `stats` shape). Three paths, tried in priority order per record:
// (1) a recognized structured mechanic (spell damage/heal, or an item's own
// rarity-bonus-family membership) — the clean, already-well-tested fast
// path, unchanged from before; (2) a markdown-table random-effect list
// (Wand of Wonder-style) — the WHOLE remaining `candidateUnits` text is
// checked for this BEFORE per-unit processing, since a table is one
// options-bearing Feature, not several independent ones; (3) otherwise,
// every `stats.candidateUnits` entry is converted independently via
// `convertCandidateUnit` above — the core structural fix this redesign
// exists for: one Effect can now produce several small, reusable Features,
// exactly like one monster already produces several Features from its own
// traits/actions, instead of one giant blob named after the Effect itself.
export async function convertSpellOrItemToFeatures(record, { dataManager, existingFeatures }) {
  const stats = record?.stats;
  const result = { featureIds: [], matchedCount: 0, createdCount: 0, errors: [] };
  if (!stats || !dataManager) return result;

  const systemId = Array.isArray(record.systemIds) ? record.systemIds[0] : record.systemIds || null;
  const ownFeatureIds = new Set(record.featureIds || []);
  const candidatePool = (existingFeatures || []).filter((feature) => {
    const categories = feature.tags?.categories;
    const matchesCategory = !Array.isArray(categories) || !categories.length || categories.some((c) => VAULT_CATEGORIES.includes(c));
    const ids = Array.isArray(feature.systemIds) ? feature.systemIds : [];
    const matchesSystem = !systemId || !ids.length || ids.includes(systemId);
    const matchesScope = feature.mechanics?.scope !== "unique" || ownFeatureIds.has(feature.id);
    return matchesCategory && matchesSystem && matchesScope;
  });

  const featureIds = [];
  const featureParams = { ...(record.featureParams || {}) };
  const featureTiers = { ...(record.featureTiers || {}) };
  // No genericizing needed today — unlike a monster's own stat block, a
  // spell/item's own prose essentially never self-references its own name
  // the way "the dragon exhales..." does; kept as a real hook (not a no-op
  // inlined away) so a future source that DOES self-reference has
  // somewhere to plug in, matching monster import's own `substitute`
  // contract exactly.
  const substitute = (text) => text;

  const mechanic = stats.mechanic;
  try {
    if (mechanic?.kind === "damage") {
      // A FIXED name ("Damage"), not `stats.name` — every clean-mechanic
      // damage spell used to mint its OWN uniquely-named Feature
      // (feat.fireball, feat.acid-splash, feat.lightning-bolt, ...), each a
      // near-identical shape (attack/save resolution + damage type + a
      // per-level/slot scaling ladder) with nothing but its own params
      // actually differing — confirmed live: importing just the SRD's own
      // "A" spells alone already produced 4 of these one-off Features.
      // Named plainly "Damage" (not "Spell Damage") since an item could
      // just as well hit this same shape someday — `tags.categories` on
      // the Feature itself already covers both, no need to bake "spell"
      // into its own name/id. The spell's own name doesn't need to be
      // repeated in featureParams here — it's already `record.name` on the
      // very Effect this Feature is attached to.
      const template = await matchOrCreateParameterizedFeature("Damage", GENERIC_ACTIVE_TYPE, { candidatePool, existingFeatures, systemId, dataManager, result });
      featureIds.push(template.id);
      featureParams[template.id] = {
        resolutionKind: mechanic.resolutionKind,
        saveAbility: mechanic.saveAbility,
        saveEffect: mechanic.saveEffect,
        damageType: mechanic.damageType,
        areaShape: mechanic.areaShape,
        areaSize: mechanic.areaSize,
        scaling: mechanic.scaling,
      };
      // Confirmed real gap, not just for markdown-sourced spells: this
      // branch never set a tier at all, for ANY spell (SRD or hand-authored
      // markdown alike) — feat.damage.json's own comment already documents
      // the fallback ("no tier chosen falls back to tier-1, the cheapest"),
      // meaning every damage spell imported through here silently landed
      // at the CHEAPEST possible budget tier regardless of its real level.
      const damageTier = resolveSpellDamageTier(stats.level);
      if (damageTier) featureTiers[template.id] = damageTier;
    } else if (mechanic?.kind === "heal") {
      // Reuses the SAME feat.healing an item's own flat-healing clause
      // already matches onto (see the `flat-healing` clause recognizer
      // below) — never a spell-specific duplicate of it. A spell's own
      // healing almost always scales by slot/character level
      // (mechanic.scaling's own full ladder); an item's own healing is
      // usually one fixed value (`healingDice`) — feat.healing's own render
      // function (healingDescriptionText, vault/js/app.js) shows whichever
      // of the two this record's own featureParams actually has.
      const template = await matchOrCreateParameterizedFeature("Healing", GENERIC_ACTIVE_TYPE, { candidatePool, existingFeatures, systemId, dataManager, result });
      featureIds.push(template.id);
      featureParams[template.id] = { scaling: mechanic.scaling };
    } else if (mechanic?.kind === "passive-bonus") {
      const { featureId, featureParams: params, tierId } = await resolvePassiveBonusFeature(stats, { candidatePool, existingFeatures, systemId, dataManager, result });
      featureIds.push(featureId);
      if (params) featureParams[featureId] = params;
      if (tierId) featureTiers[featureId] = tierId;
    } else {
      const units = Array.isArray(stats.candidateUnits) ? stats.candidateUnits.filter(Boolean) : [];
      const joinedUnits = units.join("\n");
      // A whole-record markdown table (Armor of Resistance's own "roll a
      // d10 for a damage type" table, Apparatus of the Crab's own lever-
      // control table) USED to always become a fresh, item-specific
      // "options" Feature (feature-import-core.js's own saveOptionsFeature)
      // — the exact same one-off-per-item anti-pattern the rest of this
      // module now avoids for per-unit prose. The ONE table shape that's
      // actually a known, mappable concept (a damage-type-choice table —
      // see recognizeDamageTypeChoiceTable above) still SHORT-CIRCUITS onto
      // Damage Modification, same as before; any OTHER table (Cube of
      // Force's own face-choice table, Deck of Illusions'/Wand of Wonder's
      // own genuinely random d100 lists, Bag of Tricks' own creature
      // table, ...) now tags the generic `feat.random-effect` marker
      // instead of reporting nothing — the SPECIFIC options remain
      // unstructured (still only in `notes`), but the ITEM now correctly
      // carries a real Feature acknowledging it has a table-driven varied
      // effect, for budget/generation purposes. Additive, not exclusive —
      // per-unit processing still runs afterward either way, so any OTHER
      // real clause in the same record (the item's own intro text before
      // the table, e.g.) is still independently recognized.
      const damageTypeChoice = recognizeDamageTypeChoiceTable(joinedUnits);
      if (damageTypeChoice) {
        const template = await matchOrCreateParameterizedFeature("Damage Modification", GENERIC_ACTIVE_TYPE, { candidatePool, existingFeatures, systemId, dataManager, result });
        featureIds.push(template.id);
        featureParams[template.id] = { damageType: "random" };
        featureTiers[template.id] = damageTypeChoice.tierId;
      } else {
        const table = splitMarkdownTableOptions(joinedUnits);
        if (table) {
          const template = await matchOrCreateParameterizedFeature("Random Effect", GENERIC_ACTIVE_TYPE, { candidatePool, existingFeatures, systemId, dataManager, result });
          featureIds.push(template.id);
          featureParams[template.id] = { optionCount: table.options.length };
        }
        // Ring of Animal Influence's own real shape: "cast one of the
        // following spells:" ends its own paragraph with NOTHING after the
        // colon at all — each option is a SEPARATE paragraph after it
        // ("Animal friendship (save DC 13)", "Fear (save DC 13),
        // targeting...", "Speak with animals"). The per-unit `spell-menu`
        // recognizer below only ever sees one paragraph at a time and can
        // never reassemble this, so it's also checked here against the
        // WHOLE record's own joined units (a negated character class like
        // `[^.]` already spans the newlines between those paragraphs fine).
        // Additive, not exclusive, like the table check above — per-unit
        // processing still runs afterward for anything else in the record.
        const wholeRecordSpellMenu = SPELL_MENU_LEAD_PATTERN.exec(joinedUnits);
        if (wholeRecordSpellMenu) {
          const spells = parseSpellMenuList(wholeRecordSpellMenu[2]);
          if (spells.length) {
            const template = await matchOrCreateParameterizedFeature("Spell Menu", GENERIC_ACTIVE_TYPE, { candidatePool, existingFeatures, systemId, dataManager, result });
            const saveDC = parseSpellMenuSaveDC(wholeRecordSpellMenu[1]);
            if (!featureIds.includes(template.id)) featureIds.push(template.id);
            featureParams[template.id] = { spells, ...(saveDC ? { saveDC } : {}) };
          }
        }
        const unitCtx = { candidatePool, existingFeatures, systemId, dataManager, result, substitute };
        for (let i = 0; i < units.length; i++) {
          const refs = await convertCandidateUnit(units[i], unitCtx);
          for (const { featureId, featureParams: params, tierId } of refs) {
            if (!featureIds.includes(featureId)) featureIds.push(featureId);
            if (params) featureParams[featureId] = params;
            if (tierId) featureTiers[featureId] = tierId;
          }
        }
      }
    }
  } catch (error) {
    const message = error?.message || String(error);
    result.errors.push({ trait: stats.name, message });
    console.warn(`vault-feature-matching: failed to convert "${stats.name}" — ${message}`);
  }

  // stats.charges (mapping-custom-functions.js's own srdExtractCharges) is
  // Effect-level activation data, never Feature content — surfaced directly
  // on the record rather than folded into any Feature's own featureParams.
  // ALSO given its own Feature (`feat.charges`, budgetCost 0 — it's not a
  // power source itself, whatever ability the charges power already has
  // its own cost via `feat.cast-a-spell`/`feat.spell-menu`/etc.) so a
  // charged item is never counted as featureless purely because its own
  // charge economy isn't otherwise a "clause" — every charged item DOES
  // have this real, structural property.
  if (stats.charges) {
    record.charges = stats.charges;
    const chargesTemplate = await matchOrCreateParameterizedFeature("Charges", GENERIC_ACTIVE_TYPE, { candidatePool, existingFeatures, systemId, dataManager, result });
    if (!featureIds.includes(chargesTemplate.id)) featureIds.push(chargesTemplate.id);
    featureParams[chargesTemplate.id] = { max: stats.charges.max, rechargeFormula: stats.charges.rechargeFormula };
  }
  // `stats.requiresAttunement` (srdItemStats's own `/requires attunement/i`
  // check against the item's own header paragraph) is a real balance cost
  // — attunement is a scarce resource (max 3 at a time) independent of
  // whatever else the item does — captured as its own drawback Feature
  // (negative budgetCost) rather than left as a plain boolean nobody's
  // budget math ever sees.
  if (stats.requiresAttunement) {
    const attunementTemplate = await matchOrCreateParameterizedFeature("Requires Attunement", GENERIC_ACTIVE_TYPE, { candidatePool, existingFeatures, systemId, dataManager, result });
    if (!featureIds.includes(attunementTemplate.id)) featureIds.push(attunementTemplate.id);
  }
  // stats.properties (mapping-custom-functions.js's own srdItemProperties/
  // srdSpellStats — {rarity, form, activation}, only keys it could
  // confidently resolve) is Effect-level generator-property data, in
  // exactly the shape Vault's own record.properties already expects
  // ({[field.key]: slugified value id} — see tables.js#getSystemPropertyTypes
  // and vault/CLAUDE.md). The mapping layer owns this translation (5e SRD
  // vocabulary -> sys.dnd5e's own field keys/value ids) the same way
  // monster import's own resolveCreatureType maps SRD creature types onto a
  // System's own creatureTypes vocabulary — this shared library has no
  // opinion on what "form"/"rarity"/"activation" mean, it just merges
  // whatever the mapping layer already resolved.
  if (stats.properties && Object.keys(stats.properties).length) {
    record.properties = { ...stats.properties, ...(record.properties || {}) };
  }

  record.featureIds = featureIds;
  result.featureIds = featureIds;
  if (Object.keys(featureTiers).length) record.featureTiers = featureTiers;
  if (Object.keys(featureParams).length) record.featureParams = featureParams;
  delete record.stats;
  return result;
}

// Loom's own saveEntity checks this before running the conversion above —
// an Effect whose importer already produced no `stats` at all (a hand-
// authored/generated one, or one already converted on an earlier save) has
// nothing to convert. Distinct from monster's own `hasConvertibleStatBlock`
// (which keys off `stats.traits`/`stats.actions`/etc arrays) specifically
// so the two never both fire on the same record — an Effect's own `stats`
// shape (`stats.mechanic`/`stats.name`/`stats.candidateUnits`) never
// carries any of monster's own ABILITY_GROUP_KEYS.
export function hasConvertibleSpellItemStats(record) {
  return Boolean(record?.stats?.name);
}
