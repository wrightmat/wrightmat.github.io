// Turns an imported spell/magic item's own mapped `stats` (see
// mapping-custom-functions.js's srdSpellStats/srdItemStats) into real
// `feature` Library references, so an imported Wonder ends up structurally
// identical to a Vault-generated one — `featureIds` being a real array is
// what every existing Vault code path already expects, mirroring what
// monster-feature-matching.js does for Crucible's own import.
//
// Built on feature-import-core.js — the same matching/dedup/tiering/options
// engine Crucible's importer uses, hardened across a long SRD monster-
// import cleanup (false merges, id fragmentation, options-array
// destruction, dangling featureParams keys). Those safety properties are
// reused as-is rather than re-earned a second time.
//
// A magic item's OWN prose isn't pre-segmented into atomic abilities the
// way a monster's `stats.traits`/`actions` already are — the 5e API's
// `desc` field is just paragraphs of prose, often describing SEVERAL
// distinct abilities at once. This module processes every
// `stats.candidateUnits` entry (the mapping's paragraph/bullet-segmented
// remaining prose) independently against a library of generic clause
// recognizers, the way monster import processes every trait/action
// independently — one Wonder can produce several Features.
import {
  cappedSlug,
  cappedDisplayName,
  resolveTemplateId,
  splitMarkdownTableOptions,
} from "./feature-import-core.js";

const VAULT_CATEGORIES = ["spell", "item"];
const PASSIVE_BONUS_TEMPLATE_TYPE = "item-passive-bonus";
// Every generic reusable Feature the clause-recognizer library below
// targets already exists as ordinary hand-authored Vault content
// (`feat.damage-modification`, `feat.skill-bonus`, etc.) with
// `mechanics.type: "active"`, the same type Vault's pre-existing starter
// Features use — reused rather than inventing a new type per clause shape.
const GENERIC_ACTIVE_TYPE = "active";

// Every SRD spell/magic item this pipeline recognizes is matched/created
// against a shared template keyed purely by NAME — same reasoning
// monster-feature-matching.js's parseWeaponAttack/parseSaveEffect
// establish: the shared template carries no numbers of its own (those live
// in this record's `featureParams`), so comparing descriptions would
// always disagree. Two different spells/items sharing an exact name is the
// same tolerated edge case monster import accepts for Bite/Claw/etc.
async function matchOrCreateParameterizedFeature(name, mechanicsType, { candidatePool, existingFeatures, systemId, dataManager, result }) {
  const templateId = resolveTemplateId(`feat.${cappedSlug(name)}`, existingFeatures, VAULT_CATEGORIES, "wonder");
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

// A magic item's rarity-linked bonus family (Weapon +1/+2/+3, Armor
// +1/+2/+3, ...) is given to us pre-grouped by the SRD — the parent list
// entry carries `variant: false` plus a `variants` array naming each
// concrete child; each child carries `variant: true` and no `variants` of
// its own. The mapping never produces a Wonder record for the PARENT row
// (not a concrete item a GM would hand a player), so this module only sees
// CHILD rows, each carrying `stats.variantGroup` (the parent's index, e.g.
// "weapon") and `stats.variantTier` ({id, name}, e.g. {id: "plus-1", name:
// "+1"}). Different from a spell's slot-level scaling: an owned magic item
// really IS exactly one rarity/bonus tier, a fixed choice per Wonder record
// — precisely what Tiers model, never a value chosen fresh at every use.
//
// `stats.variantGroup` names the item's FORM, never a mechanic — routed
// through this lookup rather than used as a Feature name directly, so the
// family maps onto the Feature that actually describes what the bonus DOES
// (`feat.weapon-enhancement`/`feat.armor-class-bonus`/`feat.spell-attack-
// bonus`, pre-existing Vault content). The item's Form belongs on the
// Wonder record itself (`record.properties.form`), never baked into a
// Feature's identity.
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

  // First child of this family to import seeds the template's tiers; every
  // subsequent child just adds its own — mirrors resolveNamedTier's
  // "create tier if missing" idempotency (monster-feature-matching.js).
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

// A wand/staff/rod's "cast one of the following spells" menu is the SAME
// shape as a monster's Multiattack: a single generic Feature
// (`feat.spell-menu` / `feat.multiattack`) whose text carries no numbers,
// plus a per-record params list referencing the actual options — never a
// fresh Feature per item or per listed spell (each spell is only
// meaningful as part of THIS item's menu). `saveDC` is the item's own
// literal fixed value, absent for items whose spells need no save.
//
// List-splitting is genuinely ambiguous from punctuation alone — one real
// item's list mixes normal ", "-joined entries with a spell name that
// itself contains the word "or". Splitting on every top-level comma FIRST
// (treating " or " as a separator only when there's no comma, or as the
// leading word of the LAST comma-split segment) resolves this correctly
// against all 4 real phrasings this shape uses.
// The lead-in text between "spells" and the colon isn't always just "from
// it" / "(save DC N)" — one item adds a trailing "using your spell save DC
// and spellcasting ability modifier" qualifier the old fixed-shape optional
// groups couldn't match. Captured as free text (group 1) and searched
// separately for a literal DC afterward, since fitting both the flexible
// lead-in and DC extraction into one pass doesn't reliably find the DC.
// `[^.]+` for the list already spans newlines fine — the same pattern also
// runs against the WHOLE record's joined candidate units, which fixes one
// real item's shape where the list isn't on the same line as the lead-in
// at all, each option its own paragraph.
// Splits `text` on `separator`, but only OUTSIDE parentheses — a plain
// `.split(separator)` breaks the moment an option's descriptive text
// contains a comma inside its own parenthetical.
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
  // Newline-separated (each option its own paragraph, not comma-joined)
  // takes priority — a comma WITHIN one of those lines is part of that
  // option's own descriptive text, not a list separator.
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
  // contains a comma. `splitRespectingParens` only splits on a comma
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

// "Roll a die to pick which damage type this applies to" (a markdown table
// whose every option IS a damage type) is the SAME `feat.damage-
// modification` concept the plain-prose "resistance/immunity/vulnerability
// to ACID damage" recognizer already covers — just presented as a table
// because the type is GM-chosen/random. Recognized against the WHOLE
// record's joined candidate units rather than added as a THIRD bespoke
// options-Feature shape: `damageType: "random"` captures the only thing
// still unknown, rather than guessing a specific type.
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
  // splitMarkdownTableOptions's convention: the first column is the
  // option's "name" (here a roll RANGE, never the damage type itself),
  // everything else joins into "text" — the damage type names live in the
  // SECOND column.
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
    // "resistance/immunity/vulnerability to ACID damage" — real SRD text
    // uses both "to" and "against" prepositions, plus adjective forms
    // ("is immune to psychic damage") alongside the noun forms — all mapped
    // back to the same resistance/immunity/vulnerability tier ids in `build`.
    name: "damage-modification",
    pattern: /\b(resistance|immunity|vulnerability|immune|resistant|vulnerable) (?:to|against) (\w+) damage\b/i,
    build: (m) => {
      const word = m[1].toLowerCase();
      const tierId = word.startsWith("immun") ? "immunity" : word.startsWith("resist") ? "resistance" : "vulnerability";
      return { featureName: "Damage Modification", tierId, params: { damageType: m[2].toLowerCase() } };
    },
  },
  {
    // "resistance to one of the following damage types: X, Y, or Z" — the
    // GM-chosen/random-type sibling of the plain single-type recognizer
    // above; see recognizeDamageTypeChoiceTable for the TABLE-shaped
    // version of the same concept. `\s+` (not a literal space) between "to"
    // and the count — real SRD text has a stray double space there.
    name: "damage-modification-choice",
    pattern: /\b(resistance|immunity|vulnerability)\s+to\s+(?:one|two|\d+)\s+of\s+the\s+(?:following\s+|three\s+|several\s+)?damage\s+types?\b/i,
    build: (m) => ({ featureName: "Damage Modification", tierId: m[1].toLowerCase(), params: { damageType: "random" } }),
  },
  {
    // A weapon's own bonus damage dice on a hit — "the target takes an
    // extra 2d6 fire damage" / "it deals an extra 2d6 fire damage". Two
    // verb families ("takes/take" and "deals/deal") for the plain
    // unconditional case; separately, a save-conditional shape uses the
    // GERUND "taking" ("...must make a DC 17 Constitution saving throw,
    // taking an extra 6d10 piercing damage on a failed save, or half as
    // much on a successful one"). Both shapes are ONE pattern, not two
    // array entries, so a save-conditional clause can't ALSO independently
    // match the looser plain-shape pattern and double up on the same
    // Feature — the save clause is one optional LEADING group;
    // `saveDC`/`saveAbility`/`saveEffect` only populate together.
    // Distinct from `weapon-attack-bonus` (a flat bonus to the ATTACK/
    // DAMAGE ROLL) and `damage-modification` (resistance/immunity, not
    // damage dealt).
    // "damage OF THE WEAPON'S TYPE" (no explicit type word) means the extra
    // dice deal the SAME type as whatever weapon this is attached to —
    // captured as the marker `damageType: "weapon"` rather than unrecognized.
    // The save-conditional branch doesn't always say "extra" — some items'
    // save-triggered damage is the item's SOLE damage, not bonus damage
    // stacked on a separate attack — made optional ONLY in that branch (the
    // leading "must make a DC..." clause is already a strong gate); the
    // plain unconditional branch still REQUIRES "extra" to avoid a
    // false-positive on an unrelated damage mention.
    // `DC\s*(\d+)` in the save-conditional branch is OPTIONAL — a spell's
    // save DC is never a literal number in its text (always "your spell
    // save DC", implicit), unlike an item's fixed value. `saveDC` in
    // `build` below is only set when the item DID state one;
    // `saveAbility`/`saveEffect` key off the ability capture (m[2], always
    // present when this branch matches) rather than the now-optional DC.
    // Bare `damage\b` added as a third damage-type alternative — some real
    // text states NO type at all, which the existing two alternatives (a
    // named type, or "of the weapon's type") both required; `build` already
    // defaults an untyped match to "weapon", so this is a pure widening.
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
    // clause — those stay with `skill-bonus-advantage` above). The
    // lookahead requires an actual "roll"/"throw" word in the captured
    // span so a bare skill-checks clause (already that recognizer's job)
    // never double-matches here.
    name: "grants-advantage",
    pattern:
      /(?:you gain|has) advantage on (?=[^.,]*(?:rolls?\b|throws?\b))([^.,]+(?:, [\w\s]+? checks?,? and [\w\s]+? throws?)?)/i,
    build: (m) => ({ featureName: "Grants Advantage", tierId: null, params: { rollType: m[1].trim().toLowerCase() } }),
  },
  {
    // A creature's own game statistics are wholesale replaced by another
    // creature's (Polymorph, Shapechange, Magic Jar). Distinct from
    // `summoned-companion` (a NEW creature appears) — this is an EXISTING
    // creature's stat block being swapped out.
    name: "transforms-creature",
    pattern: /game statistics(?:, including mental ability scores,)? are replaced by the statistics of/i,
    build: () => ({ featureName: "Transforms Creature", tierId: null, params: null }),
  },
  {
    // Shields a target from divination magic outright — the SAME concept
    // as the pre-existing feat.divination-immunity, reused rather than
    // duplicated. Matches three independently-worded phrasings, including
    // one bundled inside a larger immunity list — `recognizeClause` runs
    // every recognizer against the same candidate text, so this fires
    // independently of whatever else `damage-modification`/`condition-
    // immunity` catch in that same sentence. Distinct from feat.detection
    // (the user's OWN sense) and feat.obscurement (blocks ordinary senses,
    // not specifically divination magic).
    name: "divination-warding",
    pattern:
      /hides? [\w\s]*? from divination magic|can't be targeted by (?:any )?divination (?:magic|spells)|immune to (?:[\w\s,]+?,\s*)?divination spells\b/i,
    build: () => ({ featureName: "Divination Immunity", tierId: null, params: null }),
  },
  {
    // "+2 bonus to Wisdom (Perception) checks" / "+10 bonus to Strength
    // checks" — feat.skill-bonus carries a matching tier for each value.
    name: "skill-bonus-flat",
    pattern: /\+(2|5|10) bonus to (?:[\w\s]+\(([\w\s]+)\)|(\w+)) checks\b/i,
    build: (m) => ({
      featureName: "Skill Bonus",
      tierId: m[1] === "10" ? "plus-10" : m[1] === "5" ? "plus-5" : "plus-2",
      params: { skill: (m[2] || m[3]).trim().toLowerCase() },
    }),
  },
  {
    // "your Strength score is 27 while you wear this belt" / "your
    // Strength score changes to 21" — real phrasing sometimes has an
    // article between the verb and the number ("changes to A 21").
    name: "ability-score-set",
    pattern: /\byour (\w+) score (?:is|becomes|changes to) (?:an? )?(19|21|23|25|27|29)\b/i,
    build: (m) => ({ featureName: "Ability Score Increase", tierId: `set-${m[2]}`, params: { ability: m[1].toLowerCase() } }),
  },
  {
    // "your Constitution score increases by 2, as does your maximum" — the
    // sibling of ability-score-set above, for the Tome/Manual-of-[Ability]
    // family's phrasing.
    name: "ability-score-increase-by",
    pattern: /\byour (\w+) score increases by (1|2|4)\b/i,
    build: (m) => ({ featureName: "Ability Score Increase", tierId: `increase-${m[2]}`, params: { ability: m[1].toLowerCase() } }),
  },
  {
    // speed grant — type and distance are one compound fact, no tiers.
    // Four verb forms across real text: "gives you a", "has", "gain(s)" —
    // spell text is 3rd person about its target ("The target GAINS a
    // flying speed"), so bare "gain" alone misses it.
    name: "speed-grant",
    pattern: /\b(?:gains?|has|have|gives? you) a (climbing|swimming|burrowing|flying) speed of (\d+) feet\b/i,
    build: (m) => ({ featureName: "Speed Modification", tierId: null, params: { speedType: m[1].toLowerCase(), distance: Number(m[2]) } }),
  },
  {
    // A RELATIVE grant, not a fixed number — "you gain a flying speed
    // equal to your walking speed" — `distance` is the string "walking
    // speed" rather than a number (mirrors feat.charges' own dice-formula-
    // as-string convention). Same 3rd-person forms as speed-grant above,
    // plus "its"/"the target's" alongside "your" for a touched target.
    name: "speed-grant-relative",
    pattern: /\b(?:gains?|has|have|gives? you) a (climbing|swimming|burrowing|flying) speed equal to (?:your|its|the target'?s|the creature'?s) walking speed/i,
    build: (m) => ({ featureName: "Speed Modification", tierId: null, params: { speedType: m[1].toLowerCase(), distance: "walking speed" } }),
  },
  {
    // "+1 bonus to AC and saving throws" / "+2 bonus to your AC" — some
    // real text has NO "AC" at all, just "+1 bonus to saving throws" alone.
    // `ac`/`savingThrows` are independent booleans (not a single
    // `alsoSavingThrows` flag assuming AC is always present) so a
    // saves-only grant renders correctly. "5" is in the enum for Shield's
    // "+5 bonus to AC" (feat.protection-bonus carries a matching plus-5 tier).
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
    // weapon bonus is one clause among several, not the item's sole
    // mechanic) — reuses the pre-existing `feat.weapon-enhancement` Feature
    // rather than inventing a second "weapon bonus" concept.
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
    // critical hits become normal hits — real SRD text uses "becomes",
    // singular, not "become".
    name: "no-critical-hits",
    pattern: /critical hits? against you (?:becomes?|(?:is|are) treated as) (?:a )?normal hits?\b/i,
    build: () => ({ featureName: "No Critical Hits", tierId: null, params: null }),
  },
  {
    // A pure action-economy restriction with no damage/condition attached
    // ("it can't use reactions"). Shares feat.action-restricted with the
    // bonus-action/action tiers below rather than being its own Feature —
    // all three are the same "can't take X" shape, naming a different
    // piece of the action economy — and NOT folded into Impose Condition,
    // since this isn't a named 5e condition, just a standalone restriction
    // some effects apply on their own. Real data uses both "can't take
    // reactions" and "can't use reactions", matched interchangeably.
    name: "restrict-reactions",
    pattern: /can't (?:take|use) reactions/i,
    build: () => ({ featureName: "Action Restricted", tierId: "reaction", params: null }),
  },
  {
    // Same shape as restrict-reactions above, for a target's bonus action.
    name: "restrict-bonus-actions",
    pattern: /can't (?:take|use) (?:a |an )?bonus actions?/i,
    build: () => ({ featureName: "Action Restricted", tierId: "bonus-action", params: null }),
  },
  {
    // Same shape again, for a target's action outright — "can't take
    // actions or move"; the "or move" clause is a separate movement
    // restriction not modeled by this Feature.
    name: "restrict-actions",
    pattern: /can't take actions\b/i,
    build: () => ({ featureName: "Action Restricted", tierId: "action", params: null }),
  },
  {
    // "you can breathe underwater" OR the 3rd-person phrasing "gives ...
    // the ability to breathe underwater" — structurally different (no "you
    // can"), kept as its own alternative rather than one shared lead-in.
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
      // A self-referential "immune to it for 1 minute" (referring back to
      // the spell's own effect, not a named condition) matches the same
      // shape as a real condition — only the captured word being a pronoun
      // tells them apart.
      if (!condition || /damage$/.test(condition) || ["it", "this", "that", "them", "itself", "themselves"].includes(condition)) return null;
      return { featureName: "Condition Immunity", tierId: null, params: { condition } };
    },
  },
  {
    // "you can cast the X spell" / "cast X (save DC 15) once" / "casts X
    // from the wand" — MUST be case-insensitive, since SRD prose almost
    // always lowercases a referenced spell's name in running text ("cast
    // the levitate spell"), unlike a Feature/Wonder's own `.name` field.
    //
    // Two more real lead-in phrasings, neither containing "cast" at all:
    // potions often say "you gain the effect of the X spell" (including a
    // quoted variant for a spell with two named modes, where the spell's
    // own name legitimately contains a "/"); a wand/rod clause duplicating
    // a spell's effect without granting the spell itself often says "as
    // with the X spell". Same target Feature either way — mechanically,
    // experiencing a spell's effect is the same concept regardless of phrasing.
    // A GENERIC reference to spellcasting — "attacks or casts A spell",
    // "cast THE spell as normal" (meaning whatever spell's already in
    // play) — matches this same shape and would produce a garbage
    // `spellName: "a"`/`"the"`. Rejected in `build`, not the pattern, since
    // "a"/"an"/"the" are otherwise ordinary word characters.
    // An optional ordinal spell-level phrase between "as a/an" and the
    // spell name — "detonates as a 3rd-level fireball spell".
    name: "cast-a-spell",
    pattern:
      /(?:\bcast(?:s)? (?:the )?|gains? (?:the|a) (?:"[\w/]+" )?effect of (?:the|a) |as with the |detonates as an? (?:\d+\w{2}-level )?)([\w][\w\s/]*?) spell\b/i,
    build: (m) => {
      const spellName = m[1].trim();
      // Self-referential "cast THIS spell (again/on the creature/...)" and
      // generic descriptor phrases like "cast A SUPPRESSED spell" name no
      // actual spell, but the exact-match-only "a"/"an"/"the" reject list
      // lets both through — the first word matters, not the whole phrase.
      const firstWord = spellName.toLowerCase().split(/\s+/)[0];
      if (["a", "an", "the", "this", "that", "it", "its", "your", "my", "his", "her", "their"].includes(firstWord)) return null;
      return { featureName: "Cast a Spell", tierId: null, params: { spellName } };
    },
  },
  {
    // "cast magic missile AS A 5TH-LEVEL spell" — the spell name comes
    // BEFORE "as a[n] Nth-level", the reverse word order from "detonates
    // as a 3rd-level fireball spell" above. Kept as its own recognizer: the
    // main pattern's capture class excludes hyphens, so it can't cross
    // "5th-level" to reach the trailing "spell" at all.
    name: "cast-a-spell-as-level",
    pattern: /\bcast(?:s)? ([a-z][a-z' ]*?) as an? \d+\w{2}-level spell\b/i,
    build: (m) => ({ featureName: "Cast a Spell", tierId: null, params: { spellName: m[1].trim() } }),
  },
  {
    // "cast dominate beast (save DC 15) from it" — no trailing "spell"
    // word at all, unlike every other phrasing; `(save DC N)` right after
    // the name is the only reliable anchor.
    name: "cast-a-spell-with-dc",
    pattern: /\bcast(?:s)? ([a-z][a-z' ]*?) \(save DC \d+\) from it\b/i,
    build: (m) => ({ featureName: "Cast a Spell", tierId: null, params: { spellName: m[1].trim() } }),
  },
  {
    // A menu of several spells (charge-gated or not) — the Multiattack-
    // shaped concept, see SPELL_MENU_LEAD_PATTERN above for the parsing
    // design. Checked AFTER cast-a-spell purely for reading order — the two
    // patterns never collide (cast-a-spell's trailing `spell\b` never
    // matches this clause's plural "spells"), and recognizeClause tries
    // every recognizer regardless of array position.
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
    // "advantage on saving throws against X" — a common defensive shape,
    // distinct from `skill-bonus-advantage` (ABILITY CHECKS, never saving
    // throws) and `damage-modification` (a damage TYPE, not a category of
    // effects a save defends against). `against` is free text — real
    // values range from a single word to a whole parenthetical list —
    // captured up to the sentence's end or a trailing "while you..."
    // dependent clause (some real items' whole description is one sentence
    // with no period until the very end, needing that second boundary).
    name: "saving-throw-advantage",
    pattern: /\badvantage on saving throws (?:made )?against ([^.]+?)(?:\.|\s+while you\b)/i,
    build: (m) => ({ featureName: "Saving Throw Advantage", tierId: null, params: { against: m[1].trim() } }),
  },
  {
    // Flat, unconditional healing with no associated spell name — "You
    // regain 2d4 + 2 hit points when you drink this potion" (the subject
    // isn't always "you", so the verb alone is the anchor). Vault's starter
    // `feat.mending-pulse` ships FIXED tiers matching the 4 real Potion of
    // Healing values (2d4+2/4d4+4/8d4+8/10d4+20) — reused via exact dice
    // match; any OTHER flat healing dice value goes to a separate, ordinary
    // `feat.healing` Feature with a plain `{healingDice}` param, rather than
    // growing `feat.mending-pulse` a new tier per odd value forever.
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
    // "+2 bonus to spell attack rolls" — a free-standing prose clause for
    // the SAME shared `feat.spell-attack-bonus` Feature
    // resolvePassiveBonusFeature already routes the rarity-variant
    // Wand-of-the-War-Mage family onto.
    name: "spell-attack-bonus",
    pattern: /\+(1|2|3) bonus to spell attack rolls\b/i,
    build: (m) => ({ featureName: "Spell Attack Bonus", tierId: `plus-${m[1]}`, params: null }),
  },
  {
    // Attackers are disadvantaged against the wearer — "any creature to
    // have disadvantage on attack rolls against you" / "spell attacks have
    // disadvantage against you". `attackType` distinguishes "any" from a
    // narrower "spell"-only scope. `(?<!they have )` excludes a real
    // false-positive shape: "...advantage on attack rolls against air
    // elementals, and THEY have disadvantage on attack rolls against you"
    // — "they" refers back to the named creature TYPE, a narrow combat-
    // parity clause against one specific foe, not the item's own general
    // defensive property.
    // "against the target"/"against targets within X" alternatives cover a
    // third-person spell effect protecting someone else, not just an item
    // worn by the reader.
    name: "attacker-disadvantage",
    pattern:
      /\b(spell attacks have disadvantage against (?:you|the target)|(?<!they have )disadvantage on attack rolls against (?:you\b|the target\b|targets within[\w\s]+?(?=\.|,|;|$)))\b/i,
    build: (m) => ({ featureName: "Attacker Disadvantage", tierId: null, params: { attackType: /spell/i.test(m[0]) ? "spell" : "any" } }),
  },
  {
    // Same feat.condition-immunity as the "immune to X" recognizer above,
    // just a different real verb ("can't be charmed, frightened, or
    // possessed by them"). Condition list constrained to
    // KNOWN_CONDITION_WORDS for the same reason as the impose-condition
    // siblings — free-text here would risk pulling in unrelated "can't be
    // X" flavor clauses that aren't real conditions.
    name: "condition-immunity-cant-be",
    pattern: new RegExp(
      `can't be ((?:${KNOWN_CONDITION_WORDS})(?:,\\s*(?:${KNOWN_CONDITION_WORDS}))*(?:,?\\s*or\\s*(?:${KNOWN_CONDITION_WORDS}))?)\\s+by`,
      "i",
    ),
    build: (m) => ({ featureName: "Condition Immunity", tierId: null, params: { condition: m[1].trim().toLowerCase() } }),
  },
  {
    // A save-or-suffer-a-CONDITION clause with NO damage attached
    // ("...saving throw or be paralyzed for 1 minute"). Distinct from
    // `area-damage-save-half`/`-binary` (those require damage dice) and
    // from `condition-immunity` (immune TO a condition, never imposing
    // one). `condition`/`duration` are free text — real values range from
    // a bare word to "charmed by you", and duration isn't always present.
    // `DC\s*(\d+)` is OPTIONAL — a spell's save DC is never a literal
    // number in its own text.
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
    // ATTACK ROLL rather than a failed save — "On a hit, the target is
    // restrained until...". `trigger` replaces the save fields since
    // there's genuinely no save involved.
    name: "impose-condition-on-hit",
    pattern: /on a hit,? the target is ([a-z][a-z\s]*?)(?:\.|,|;| until)/i,
    build: (m) => ({ featureName: "Impose Condition", tierId: resolveConditionTier(m[1]), params: { condition: m[1].trim(), trigger: "hit" } }),
  },
  {
    // Same "Impose Condition" concept as the base recognizer above, but
    // with an intervening clause between "or" and the condition verb —
    // "or drop whatever it is holding and become frightened". The
    // condition is constrained to KNOWN_CONDITION_WORDS — see that
    // constant's comment for why free-text capture doesn't work here.
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
    // sentences instead of one — "must succeed on a wisdom saving throw.
    // On a failed save, the creature becomes charmed for the duration."
    // Spans the gap the same non-greedy way area-damage-save-half above
    // does — safe here since candidate units are per-paragraph, so this
    // can't bridge two unrelated clauses the way an unbounded search could.
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
    // Same concept again, but fully AUTOMATIC — no save, no attack roll
    // ("you become charmed by that creature for 1 hour"). Deliberately
    // narrow (a fixed condition-word list, not a generic capture) since
    // "become" is common prose that would otherwise false-positive.
    name: "impose-condition-automatic",
    pattern: /you become (charmed|frightened|poisoned|paralyzed|stunned|restrained|blinded|deafened|incapacitated)(?:\s+by\s+[\w\s]+?)?\s+for\s+([\w\s]+?)(?:\.|,|;)/i,
    build: (m) => ({ featureName: "Impose Condition", tierId: resolveConditionTier(m[1]), params: { condition: m[1].toLowerCase(), trigger: "automatic", duration: m[2].trim() } }),
  },
  {
    // "the boots double your walking speed" — a MULTIPLIER, distinct from
    // `speed-grant` above (always a flat new movement type, never walking
    // speed itself).
    name: "speed-increase-double",
    pattern: /doubles? your walking speed/i,
    build: () => ({ featureName: "Speed Increase", tierId: null, params: { mode: "double" } }),
  },
  {
    // "your walking speed becomes 30 feet, unless your walking speed is
    // higher" — a FLOOR, not a bonus; never reduces an already-higher speed.
    name: "speed-increase-floor",
    pattern: /your walking speed becomes (\d+) feet, unless your walking speed is higher/i,
    build: (m) => ({ featureName: "Speed Increase", tierId: null, params: { mode: "minimum", distance: Number(m[1]) } }),
  },
  {
    // "increase the creature's walking speed by 30 feet" — additive bonus
    // to the EXISTING walking speed. A looser second alternative ("speed
    // increases by 10 feet", 3rd person, no "walking") covers a terser real
    // phrasing without risking a bare "speed" match against an unrelated
    // speed-type sentence elsewhere.
    name: "speed-increase-by",
    pattern: /increase (?:the creature'?s |your )?walking speed by (\d+) feet|\bspeed increases by (\d+) feet\b/i,
    build: (m) => ({ featureName: "Speed Increase", tierId: null, params: { mode: "increase", distance: Number(m[1] || m[2]) } }),
  },
  {
    // "as a bonus action on each of your turns... you can take the Dash
    // action" — effectively doubles ground covered per turn without
    // literally saying "doubles your speed", so kept as its own `mode`.
    name: "speed-increase-dash",
    pattern: /bonus action[\s\S]{0,60}?you can take the dash action/i,
    build: () => ({ featureName: "Speed Increase", tierId: null, params: { mode: "dash" } }),
  },
  {
    // "you can jump three times the normal distance".
    name: "jump-increase",
    pattern: /\byou can jump (one|two|three|four) times the normal distance/i,
    build: (m) => ({ featureName: "Jump Increase", tierId: null, params: { multiplier: { one: 1, two: 2, three: 3, four: 4 }[m[1].toLowerCase()] } }),
  },
  {
    // "you have proficiency with the longbow and shortbow" — kept as free
    // text, real values range from one weapon to a whole category.
    name: "weapon-proficiency",
    pattern: /\byou have proficiency with the ([\w\s,]+?)(?:,? and you gain|\.|,|;)/i,
    build: (m) => ({ featureName: "Weapon Proficiency", tierId: null, params: { weapons: m[1].trim() } }),
  },
  {
    // "Whatever form the tool takes, you are proficient with it" — "it"
    // refers to a tool the wearer chooses, so unlike weapon-proficiency
    // there's no fixed name in that (common) case; a named-tool phrasing
    // still captures the tool the same way.
    name: "tool-proficiency",
    pattern: /\byou (?:are|become) proficient with (it|that tool|the tool|[\w\s]+? tools?)\b/i,
    build: (m) => {
      const tool = m[1].trim();
      return { featureName: "Tool Proficiency", tierId: null, params: /^(it|that tool|the tool)$/i.test(tool) ? null : { tool } };
    },
  },
  {
    // "+2 bonus to damage rolls on ranged attacks" — DAMAGE ONLY, distinct
    // from `weapon-attack-bonus` (a combined attack-AND-damage bonus) and
    // scoped to ranged weapons specifically.
    name: "ranged-damage-bonus",
    pattern: /\+(1|2|3) bonus to damage rolls on ranged attacks/i,
    build: (m) => ({ featureName: "Ranged Damage Bonus", tierId: `plus-${m[1]}`, params: null }),
  },
  {
    // A creature comes into being under the user's control — one pattern
    // covering the several distinct real SRD phrasings this shape uses
    // ("becomes a living creature", "becomes animate ... under your
    // control", "transforms into a creature", a dice-count-prefixed
    // "appear within N feet of you", "has the statistics of a [creature]",
    // "summon a particular [creature]" / "appears in an unoccupied space",
    // the Conjure-spell-family's "friendly to you ... roll initiative
    // for", the summon-companion spells' "you summon [creatures] that
    // appear in an unoccupied space" in its several word orders, and a
    // controlled-duplicate/swarm variant with no "appears" language at all
    // — "friendly to you and creatures you designate, it obeys your
    // spoken commands" / "each creature obeys your verbal commands").
    // Kept as one fixed set of confirmed shapes, not a broader "any
    // creature summoning" guess — real summon-shaped prose varies too much
    // to generalize further without false-positive risk.
    name: "summoned-companion",
    pattern:
      /becomes a living creature|becomes animate[\s\S]{0,80}?under your control|becomes an? [\w\s]+? under your control|transforms? into a creature|\d+d\d+(?:\s*\+\s*\d+)? [\w\s]+? appears? within \d+ feet of you|has the statistics of a|summon a particular \w+|the \w+ appears in an unoccupied space|friendly to you and your companions for the duration[\s\S]{0,120}?roll initiative for|you summon [\w\s]+? that[\s\S]{0,60}?appears? in (?:an? )?unoccupied space|appearing in an unoccupied space|\bcreature appears (?:on the ground )?in an? unoccupied space|friendly to you and creatures you designate\.\s*It obeys your spoken commands|each creature obeys your verbal commands/i,
    build: () => ({ featureName: "Summoned Companion", tierId: null, params: null }),
  },
  {
    // A nonliving object is conjured — "becomes a real, nonmagical
    // object", "causing it to become the object ... it represents", and a
    // few Feather-Token-family shapes ("flapping fan takes its place",
    // "springs into existence", a boat "takes its place" — also tagged
    // `vehicle` below for its seaworthy-craft properties). Distinct from
    // `summoned-companion` (a living creature) and `summoned-weapon` below
    // (an object that then fights on its own, not just static).
    name: "summoned-object",
    pattern:
      /becomes a real, nonmagical object|causing it to become the object or creature it represents|flapping fan takes its place|springs into existence|boat[\s\S]{0,20}?takes its place/i,
    build: () => ({ featureName: "Summoned Object", tierId: null, params: null }),
  },
  {
    // "a floating whip takes its place" — the conjured object then fights
    // on its own, distinct from a static `summoned-object`.
    name: "summoned-weapon",
    pattern: /whip takes its place/i,
    build: () => ({ featureName: "Summoned Weapon", tierId: null, params: null }),
  },
  {
    // Extradimensional/oversized storage — "interior space considerably
    // larger than its outside dimensions", "extradimensional space",
    // "resembles a bag of holding".
    name: "inventory-expansion",
    pattern: /extradimensional space|considerably larger than its outside dimensions|hold numerous items while never weighing|resembles a bag of holding/i,
    build: () => ({ featureName: "Inventory Expansion", tierId: null, params: null }),
  },
  {
    // A vehicle with its own AC/HP, distinct from the wearer's/pilot's own
    // stats. Two shapes: a real stat-block header ("Armor Class: 20 ...
    // Hit Points: 200") and a plainer prose form for an autonomous OBJECT
    // rather than a pilotable vehicle ("The rope has AC 20 and 20 hit
    // points") — reused rather than a near-duplicate Feature, since both
    // are "this object has its own combat stats independent of its
    // wielder". Two more shapes have NO stated AC/HP at all ("unfold into
    // a boat/ship", "self-propelled") — still a real vehicle, just without
    // combat stats; `ac`/`hp` are omitted from params in that case.
    name: "vehicle",
    pattern: /Armor Class:\s*(\d+)[\s\S]{0,40}?Hit Points:\s*(\d+)|has AC (\d+) and (\d+) hit points|unfolds? into a (?:boat|ship)|self-propelled/i,
    build: (m) => {
      const ac = m[1] || m[3];
      const hp = m[2] || m[4];
      return { featureName: "Vehicle", tierId: null, params: ac ? { ac: Number(ac), hp: Number(hp) } : null };
    },
  },
  {
    // "produces N gallons/gallon of water" — kept as free text since the
    // produced resource (and its amount) varies per option.
    name: "resource-production",
    pattern: /produces? ([\w\s]*?) of (?:fresh )?(?:salt )?water/i,
    build: (m) => ({ featureName: "Resource Production", tierId: null, params: { resourceText: `${m[1].trim()} of water` } }),
  },
  {
    // "the cloud's area is heavily obscured".
    name: "obscurement",
    pattern: /\b(?:is|becomes) (heavily obscured|lightly obscured)/i,
    build: (m) => ({ featureName: "Obscurement", tierId: null, params: { level: m[1].toLowerCase() } }),
  },
  {
    // Three real phrasings: "prevent a creature ... from using any method
    // of extradimensional movement", "the vessel can't be moved by any
    // means", "causes the rod to become magically fixed in place".
    name: "restrict-movement",
    pattern: /prevents? (?:a |the )?creature[\s\S]{0,20}?from using any method of extradimensional movement|vessel can'?t be moved by any means|become magically fixed in place/i,
    build: () => ({ featureName: "Restrict Movement", tierId: null, params: null }),
  },
  {
    // "the sword begins to hover, flies up to 30 feet, and attacks one
    // creature" — a weapon that fights on its own.
    name: "animated-weapon",
    pattern: /begins to hover[\s\S]{0,40}?attacks one creature/i,
    build: () => ({ featureName: "Animated Weapon", tierId: null, params: null }),
  },
  {
    // "you know the direction of the nearest creature hostile to you" —
    // plus two more real shapes: "Invisible creatures and objects are
    // visible" (distinct passive-light form) and "the wand pulses and
    // points at the one nearest to you" (secret doors/traps).
    name: "detection",
    pattern: /you know the direction of the nearest ([\w\s]+?)(?:\s+within|\.|,)|invisible creatures and objects are visible|pulses and points at/i,
    build: (m) => ({
      featureName: "Detection",
      tierId: null,
      params: { detects: m[1] ? m[1].trim() : /pulses/i.test(m[0]) ? "nearest secret door or trap" : "invisible creatures and objects" },
    }),
  },
  {
    // "you sense the presence of magic within 30 feet" — same "Detection"
    // Feature the item-oriented shapes above share, with a real numeric
    // `range` too (an item's detection clause almost never states one
    // explicitly the way a spell's "within N feet" always does).
    name: "detect-presence-within-range",
    pattern: /sense the presence(?: and location)? of ([\w\s,]+?) within (\d+) (feet|miles?)/i,
    build: (m) => ({ featureName: "Detection", tierId: null, params: { detects: m[1].trim(), range: Number(m[2]), rangeUnit: /mile/i.test(m[3]) ? "miles" : "feet" } }),
  },
  {
    // "you know if there is an aberration, celestial, ... within 30 feet of you".
    name: "detect-know-if-within-range",
    pattern: /you know if there is an? ([\w\s,]+?) within (\d+) (feet|miles?)/i,
    build: (m) => ({ featureName: "Detection", tierId: null, params: { detects: m[1].trim(), range: Number(m[2]), rangeUnit: /mile/i.test(m[3]) ? "miles" : "feet" } }),
  },
  {
    // "you sense the direction to the creature's location, as long as that
    // creature is within 1,000 feet".
    name: "detect-sense-direction-to",
    pattern: /you sense the direction to (?:the )?([\w\s']+?)(?:'s location)?,? as long as (?:that|it is)?[\s\S]{0,20}?within ([\d,]+) (feet|miles?)/i,
    build: (m) => ({ featureName: "Detection", tierId: null, params: { detects: m[1].trim(), range: Number(m[2].replace(/,/g, "")), rangeUnit: /mile/i.test(m[3]) ? "miles" : "feet" } }),
  },
  {
    // "you learn the direction and distance to the closest creature or
    // plant of that kind within 5 miles".
    name: "detect-learn-direction-distance",
    pattern: /you learn the direction and distance to the closest ([\w\s]+?) within (\d+) (feet|miles?)/i,
    build: (m) => ({ featureName: "Detection", tierId: null, params: { detects: m[1].trim(), range: Number(m[2]), rangeUnit: /mile/i.test(m[3]) ? "miles" : "feet" } }),
  },
  {
    // "the spell gives you knowledge of the land within 3 miles of you" —
    // a broader "sense your surroundings" shape, still the same Detection
    // concept (what's around you, out to a range).
    name: "detect-knowledge-of-territory",
    pattern: /(?:gain(?:s)?|gives you) knowledge of the (?:surrounding )?(?:land|territory) within (\d+) (feet|miles?)/i,
    build: (m) => ({ featureName: "Detection", tierId: null, params: { detects: "the surrounding land", range: Number(m[1]), rangeUnit: /mile/i.test(m[2]) ? "miles" : "feet" } }),
  },
  {
    // "you sense the presence of any trap within range" — no numeric range
    // stated (it's the spell's own cast RANGE, not restated in prose) —
    // `range` stays unset rather than guessed.
    name: "detect-presence-of-traps",
    pattern: /sense the presence of any trap/i,
    build: () => ({ featureName: "Detection", tierId: null, params: { detects: "traps" } }),
  },
  {
    // The SRD's whole light-creating spell family shares this shape —
    // "sheds bright light in a 20-foot radius and dim light for an
    // additional 20 feet". `dimRadius` is the TOTAL reach from the source
    // (bright + additional), more directly useful than making a reader add
    // the two together themselves.
    name: "creates-light-bright-and-dim",
    pattern: /sheds bright light in an? (\d+)-foot radius and dim light for an additional (\d+) feet/i,
    build: (m) => ({
      featureName: "Create Light/Darkness",
      tierId: null,
      params: { mode: "light", brightRadius: Number(m[1]), dimRadius: Number(m[1]) + Number(m[2]) },
    }),
  },
  {
    // A differently-shaped real phrasing: the bright radius comes from a
    // sphere's stated size ("A 60-foot-radius sphere of light...") rather
    // than next to "bright light" directly, with the dim "additional" span
    // trailing in its own sentence.
    name: "creates-light-sphere-and-dim",
    pattern: /(\d+)-foot-radius sphere of light[\s\S]{0,150}?dim light for an additional (\d+) feet/i,
    build: (m) => ({
      featureName: "Create Light/Darkness",
      tierId: null,
      params: { mode: "light", brightRadius: Number(m[1]), dimRadius: Number(m[1]) + Number(m[2]) },
    }),
  },
  {
    // Dim light ONLY, no bright radius — "each light sheds dim light in a
    // 10-foot radius". "sheds?" covers both singular and plural subject forms.
    name: "creates-light-dim-only",
    pattern: /sheds? dim light in an? (\d+)-foot radius/i,
    build: (m) => ({ featureName: "Create Light/Darkness", tierId: null, params: { mode: "light", dimRadius: Number(m[1]) } }),
  },
  {
    // The SRD's "Speak with X"/language-comprehension spell cluster shares
    // this shape — "gain the ability to comprehend and verbally
    // communicate with beasts", "understand the literal meaning of any
    // spoken language".
    name: "comprehend-language",
    pattern: /comprehend and (?:verbally )?communicate with|understand (?:the literal meaning of )?any (?:spoken )?language|understand any written language|ability to communicate with/i,
    build: () => ({ featureName: "Comprehend Language", tierId: null, params: null }),
  },
  {
    // The SRD's oracle/consultation spell cluster shares this shape — "You
    // ask a single question... The GM offers a truthful reply", "you
    // receive an omen".
    name: "divine-consultation",
    pattern: /ask (?:a|an|up to \w+) (?:single )?questions?[\s\S]{0,150}?(?:reply|answer|omen)|receive an omen/i,
    build: () => ({ featureName: "Divine Consultation", tierId: null, params: null }),
  },
  {
    // The SRD's discrete-image illusion cluster — "create a sound or an
    // image of an object", "create an illusory copy of yourself". A single
    // object/creature/sound, not a whole area — see terrain-illusion below
    // for that shape instead.
    name: "creates-illusion",
    pattern: /create (?:the |a )?(?:sound or an? )?image of (?:an? )?(?:object|creature)|create an illusory copy of yourself/i,
    build: () => ({ featureName: "Creates Illusion", tierId: null, params: null }),
  },
  {
    // "look different until the spell ends" / "change the appearance
    // of... a new, illusory appearance" — an illusory change to how the
    // TARGET looks, not a conjured object/creature (creates-illusion above).
    name: "illusory-disguise",
    pattern: /look different until the spell ends|change the appearance of|new,? illusory appearance/i,
    build: () => ({ featureName: "Illusory Disguise", tierId: null, params: null }),
  },
  {
    // "make terrain... look, sound, smell, and even feel like some other
    // sort of terrain" — a WHOLE AREA'S apparent terrain type, distinct
    // from creates-illusion (one discrete object/creature/sound) and from
    // shapes-terrain below (a REAL physical change, not merely perceived).
    name: "terrain-illusion",
    pattern: /terrain[\s\S]{0,40}?look,? sound,? (?:and smell|smell,? and (?:even feel|feel))? like some other/i,
    build: () => ({ featureName: "Terrain Illusion", tierId: null, params: null }),
  },
  {
    // The SRD's cure-an-ailment cluster — "end either one disease or one
    // condition", "undo a debilitating effect", "curses affecting one
    // creature or object end", "the creature becomes stable" — all "end an
    // ongoing bad thing" rather than restoring hit points (feat.healing)
    // or reviving from death (revives-dead below).
    name: "cures-condition",
    pattern: /end (?:either )?one (?:disease|condition)|undo a debilitating effect|curses? affecting (?:one|the) (?:creature|object)(?:\s+or\s+\w+)? end|becomes? stable/i,
    build: () => ({ featureName: "Cures Condition", tierId: null, params: null }),
  },
  {
    // The SRD's resurrection cluster — shared "the creature returns to
    // life" / "the creature is restored to life".
    name: "revives-dead",
    pattern: /returns? to life|restored to life/i,
    build: () => ({ featureName: "Revives Dead", tierId: null, params: null }),
  },
  {
    // "form it into any shape that suits your purpose" / "reshape dirt,
    // sand, or clay... raise or lower the area's elevation" — a REAL
    // physical change to terrain/stone, unlike terrain-illusion above
    // (only how it's perceived).
    name: "shapes-terrain",
    pattern: /form it into any shape|reshape dirt, sand, or clay|raise or lower the area'?s elevation/i,
    build: () => ({ featureName: "Shapes Terrain", tierId: null, params: null }),
  },
  {
    // The SRD's remote-message spell cluster shares this shape — "You
    // mentally contact a demigod...", "hears the message and can reply",
    // "communicate telepathically through the bond". Distinct from
    // feat.comprehend-language (understanding a language) and
    // feat.detection (sensing presence/direction, not exchanging messages).
    name: "communication",
    pattern: /mentally contact|hears the message[\s\S]{0,40}?can reply|hears the message in its mind|communicate telepathically/i,
    build: () => ({ featureName: "Communication", tierId: null, params: null }),
  },
  {
    // "the spell ends" / "its spell fails and has no effect" — both "make
    // another spell stop working outright" rather than resisting its
    // damage or curing its aftereffects.
    name: "negate-magic",
    pattern: /the spell ends\.|its spell fails and has no effect|the creature'?s spell fails/i,
    build: () => ({ featureName: "Negate Magic", tierId: null, params: null }),
  },
  {
    // "Magical darkness spreads from a point you choose within range to
    // fill a 15-foot-radius sphere" — the direct inverse of the
    // creates-light-* recognizers above, folded into the SAME
    // feat.create-light-darkness rather than a separate Feature — same
    // shape (a radius from a source), opposite `mode`.
    name: "creates-darkness",
    pattern: /darkness spreads[\s\S]{0,60}?fill an? (\d+)-foot-radius sphere/i,
    build: (m) => ({ featureName: "Create Light/Darkness", tierId: null, params: { mode: "darkness", radius: Number(m[1]) } }),
  },
  {
    // REMOVES an inherent disadvantage ("If the armor normally imposes
    // disadvantage on Dexterity (Stealth) checks ... the mithral version
    // ... doesn't") rather than granting advantage outright, but
    // mechanically identical: advantage and disadvantage on the same roll
    // cancel, so removing an inherent disadvantage IS the "advantage" tier
    // of the same shared `feat.skill-bonus` Feature — not a new concept.
    name: "mithral-removes-disadvantage",
    pattern: /imposes disadvantage on (\w+) \((\w+)\) checks/i,
    build: (m) => ({ featureName: "Skill Bonus", tierId: "advantage", params: { skill: m[2].trim().toLowerCase() } }),
  },
  {
    // "you become invisible" / "you can turn invisible".
    name: "invisibility",
    pattern: /become invisible|can turn invisible|becomes? invisible/i,
    build: () => ({ featureName: "Invisibility", tierId: null, params: null }),
  },
  {
    // Generalized from "Unlock or Open" — "it becomes locked for the
    // duration" and "becomes unlocked, unstuck, or unbarred" are the SAME
    // underlying concept (this record acts on a door/lock/latch from a
    // distance) as "one lock or latch on the object opens" — just a
    // different one of four real actions (lock/unlock/open/close), so one
    // shared Feature with an `action` param rather than three near-duplicates.
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
    // "one lock or latch on the object opens" / "the object itself opens".
    name: "lock-control-open",
    pattern: /lock or latch[\s\S]{0,20}?opens|the object itself opens/i,
    build: () => ({ featureName: "Lock Control", tierId: null, params: { action: "open" } }),
  },
  {
    // "turns a cube of water ... into one marble-sized pellet" — removes
    // water from an area into a compact, storable form.
    name: "desiccation",
    pattern: /turns? a cube of water[\s\S]{0,40}?into (?:a |one )?(?:marble-sized )?pellet/i,
    build: () => ({ featureName: "Desiccation", tierId: null, params: null }),
  },
  {
    // "you can stand on and move across any liquid surface as if it were
    // solid ground" — OR a shorter real phrasing dropping "stand on and"
    // entirely.
    name: "water-walking",
    pattern: /(?:stand on and )?move across (?:any )?liquid surface/i,
    build: () => ({ featureName: "Water Walking", tierId: null, params: null }),
  },
  {
    // "allow the creature to move normally while floating 4 inches above
    // the ground" — hovering just above the ground, distinct from an
    // actual flying speed (`feat.speed-grant`).
    name: "hover",
    pattern: /floating \d+ inches? above the ground|move normally while floating/i,
    build: () => ({ featureName: "Hover", tierId: null, params: null }),
  },
  {
    // "hidden from divination magic".
    name: "divination-immunity",
    pattern: /hidden from divination magic/i,
    build: () => ({ featureName: "Divination Immunity", tierId: null, params: null }),
  },
  {
    // "hovers in your space to protect you" — the item functions without
    // being held. "leaving your hands free" was REMOVED as a trigger: it's
    // a false positive shared by unrelated items meaning "you don't need
    // your hands to climb", not "the item works without being held".
    name: "self-wielding",
    pattern: /hovers? in your space to protect you/i,
    build: () => ({ featureName: "Self-Wielding", tierId: null, params: null }),
  },
  {
    // "you have truesight out to 120 feet" — OR a spell phrasing where the
    // range trails a whole list of OTHER granted senses, not "truesight"
    // directly, so it's a separate optional group rather than required
    // immediately after "truesight".
    name: "truesight",
    pattern: /\b(?:you have |has )truesight\b(?:[\s\S]{0,120}?(?:out to|range of) (\d+) feet)?/i,
    build: (m) => ({ featureName: "Truesight", tierId: null, params: m[1] ? { range: Number(m[1]) } : null }),
  },
  {
    // "reduce the damage by 1d10 + your Dexterity modifier".
    name: "damage-reduction",
    pattern: /reduce the damage by (\d+d\d+(?:\s*\+\s*[\w\s]+)?)/i,
    build: (m) => ({ featureName: "Damage Reduction", tierId: null, params: { reductionDice: m[1].trim() } }),
  },
  {
    // "regain one expended spell slot".
    name: "spell-slot-recovery",
    pattern: /regain one expended spell slot/i,
    build: () => ({ featureName: "Spell Slot Recovery", tierId: null, params: null }),
  },
  {
    // "you stabilize whenever you are dying".
    name: "auto-stabilize",
    pattern: /you stabilize whenever you are dying/i,
    build: () => ({ featureName: "Auto-Stabilize", tierId: null, params: null }),
  },
  {
    // "becomes friendly to you and your companions" (via a contested
    // check, not a save) — an EXISTING creature won over, distinct from
    // `summoned-companion` (a new one conjured).
    name: "animal-charm",
    pattern: /becomes friendly to you and your companions/i,
    build: () => ({ featureName: "Animal Charm", tierId: null, params: null }),
  },
  {
    // Two real phrasings: "succeed on that saving throw instead", "turn
    // your failed save into a successful one".
    name: "reroll-save",
    pattern: /succeed on that saving throw instead|turn your failed save into a successful one/i,
    build: () => ({ featureName: "Reroll Save", tierId: null, params: null }),
  },
  {
    // "you can forgo rolling the d20 to get a 10 on the die" — sets a
    // specific roll's d20 result to a fixed number instead of rolling it.
    // Distinct from reroll-save above (rolls AGAIN) and a flat bonus (adds
    // to whatever's rolled) — this replaces the roll outright. `mode:
    // "fixed"` distinguishes this from the bonus-die sibling right below —
    // both share the "Modifies Roll" Feature, but a fixed substitution and
    // a rolled bonus die need their own params shape.
    name: "modifies-roll",
    pattern: /when you make an? ([\w\s]+?) roll[^.]*?forgo rolling the d20 to get an? (\d+) on the die/i,
    build: (m) => ({ featureName: "Modifies Roll", tierId: null, params: { rollType: m[1].trim(), mode: "fixed", value: Number(m[2]) } }),
  },
  {
    // "roll a d4 and subtract the number rolled from the attack roll or
    // saving throw" — a rolled BONUS die (not a fixed substitute value)
    // added to or subtracted from a specific kind of roll.
    name: "modifies-roll-bonus-die",
    pattern: /roll an? (d\d+) and (add|subtract) the number rolled (?:to|from) (?:the |one )?([\w\s]+?)(?:\s+of its choice)?(?:\.|,|;)/i,
    build: (m) => ({ featureName: "Modifies Roll", tierId: null, params: { rollType: m[3].trim(), mode: "bonus-die", die: m[1].toLowerCase(), sign: m[2].toLowerCase() } }),
  },
  {
    // "you descend 60 feet per round and take no damage from falling" —
    // OR a structurally different real phrasing splitting the two clauses
    // across two sentences rather than joined by "and" in one.
    name: "feather-fall",
    pattern: /descend \d+ feet per round and take no damage from falling|descent slows to \d+ feet per round[\s\S]{0,120}?takes? no (?:falling damage|damage from falling)/i,
    build: () => ({ featureName: "Feather Fall", tierId: null, params: null }),
  },
  {
    // "difficult terrain doesn't cost you extra movement" — OR a 3rd-person
    // spell phrasing "the target's movement is unaffected by difficult terrain".
    name: "freedom-of-movement",
    pattern: /difficult terrain doesn'?t cost you extra movement|movement is unaffected by difficult terrain/i,
    build: () => ({ featureName: "Freedom of Movement", tierId: null, params: null }),
  },
  {
    // "pushed 5 feet away from you".
    name: "forced-movement",
    pattern: /pushed? (\d+) feet away from you/i,
    build: (m) => ({ featureName: "Forced Movement", tierId: null, params: { distance: Number(m[1]) } }),
  },
  {
    // "see into and through solid matter".
    name: "x-ray-vision",
    pattern: /see into and through solid matter/i,
    build: () => ({ featureName: "X-Ray Vision", tierId: null, params: null }),
  },
  {
    // "double your proficiency bonus on the check".
    name: "expertise",
    pattern: /double your proficiency bonus on the check/i,
    build: () => ({ featureName: "Expertise", tierId: null, params: null }),
  },
  {
    // "at the start of each of the wounded creature's turns, it takes 1d4
    // necrotic damage" — OR the reverse word order, "the target takes 1d4
    // fire damage at the start of each of its turns". Same concept, same
    // shared Feature either way.
    name: "damage-over-time",
    pattern:
      /(?:at the start of each of (?:the wounded creature'?s|its) turns,?\s*(?:it|the target) takes (\d+d\d+) (\w+) damage|(?:the target|it) takes (\d+d\d+) (\w+) damage at the start of each of (?:the wounded creature'?s|its) turns)/i,
    build: (m) => ({ featureName: "Damage Over Time", tierId: null, params: { damageDice: m[1] || m[3], damageType: (m[2] || m[4]).toLowerCase() } }),
  },
  {
    // "absorb a spell that is targeting only you".
    name: "spell-absorption",
    pattern: /absorb a spell that is targeting only you/i,
    build: () => ({ featureName: "Spell Absorption", tierId: null, params: null }),
  },
  {
    // "turn the spell back on its caster".
    name: "spell-reflection",
    pattern: /turn the spell back on its caster/i,
    build: () => ({ featureName: "Spell Reflection", tierId: null, params: null }),
  },
  {
    // "enter the Astral Plane" — OR "You step into the border regions of
    // the Ethereal Plane" — same underlying concept (crossing to another
    // plane), a different specific plane and verb. Named "Planar Travel",
    // NOT "Etherealness" — Crucible already has a MONSTER Feature
    // literally named "Etherealness" (categories: ["monster"]); reusing
    // that name would collide on the same slugified id even though
    // Vault's candidatePool filtering keeps the two apart at match time,
    // same reasoning as personal-teleportation's name choice below.
    name: "planar-travel",
    pattern: /enter the astral plane|step into[\s\S]{0,40}?ethereal plane/i,
    build: () => ({ featureName: "Planar Travel", tierId: null, params: null }),
  },
  {
    // "transport yourself and anything you are wearing or carrying to a
    // location within 100 feet of you" — a short-range, SAME-plane
    // teleport, distinct from planar-travel above (crosses planes with no
    // distance limit). Named "Personal Teleportation", NOT "Teleport" —
    // Crucible already has a monster Feature literally named "Teleport"
    // (a passive teleport-as-part-of-its-move ability); reusing that name
    // would collide on the same slugified id even though Vault's
    // candidatePool filtering keeps the two apart at match time.
    name: "personal-teleportation",
    pattern: /transport (?:yourself|you)(?: and [\w\s]+?)? to an? (?:location|point|space|unoccupied space) within (\d+) feet/i,
    build: (m) => ({ featureName: "Personal Teleportation", tierId: null, params: { range: Number(m[1]) } }),
  },
  {
    // Same concept, a shorter real phrasing: "you teleport up to 30 feet
    // to an unoccupied space that you can see" — the verb IS "teleport"
    // here rather than "transport", and the range follows "up to" instead
    // of "within".
    name: "personal-teleportation-up-to",
    pattern: /\byou teleport up to (\d+) feet to an? (?:location|point|space|unoccupied space)/i,
    build: (m) => ({ featureName: "Personal Teleportation", tierId: null, params: { range: Number(m[1]) } }),
  },
  {
    // "+1 bonus to ability checks and saving throws" — a BROADER bonus
    // than `feat.skill-bonus` (one named skill) or `feat.protection-bonus`
    // (AC/saves specifically).
    name: "general-bonus",
    pattern: /\+(1|2|3) bonus to ability checks and saving throws/i,
    build: (m) => ({ featureName: "General Bonus", tierId: `plus-${m[1]}`, params: null }),
  },
];

// Runs the WHOLE library against one candidate unit's own text — returns
// every DISTINCT recognizer that matches, not just the first. A single
// sentence can genuinely describe two independent abilities at once
// ("...you can breathe underwater, and you have a swimming speed of 60
// feet." — one unit, two unrelated generic Features) — stopping at the
// first hit would silently drop the second ability. Deduped by recognizer
// `name` (a unit matching the SAME recognizer's pattern twice — a regex
// quirk, not a real second ability — only produces one result). Empty
// array (not `null`) when nothing recognizes any part of it —
// convertCandidateUnit below reports nothing for this unit in that case,
// rather than minting a Feature from unclassified text.
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

// The 5e API's own `***Label.***` bold markdown lead-in ("***Curse.*** This
// armor is cursed...") is a STRUCTURAL signal the source itself gives for
// what one candidate unit is conceptually called — far better than this
// module's generated "Wonder N" fallback, and (for the one label checked
// below) reliable enough to route straight to a dedicated shared Feature
// without running it through the generic clause recognizers at all.
// Stripped from the returned `text` either way, so it never leaks literal
// asterisks into a Feature's description.
const BOLD_LABEL_PATTERN = /^\*\*\*([^*]+?)\.?\*\*\*\s*/;
function extractBoldLabel(text) {
  const match = BOLD_LABEL_PATTERN.exec(text);
  if (!match) return { label: null, text };
  return { label: match[1].trim(), text: text.slice(match[0].length) };
}

// Converts ONE candidate unit into ZERO OR MORE `{featureId, featureParams,
// tierId}` references (see recognizeClause's own comment on why more than
// one is possible). ALLOWLIST policy, not "always capture something": a
// magic item's prose is unstructured free text (unlike a monster's
// pre-segmented traits/actions), and classifying every leftover clause as
// "a real mechanic" vs. "just flavor" is fundamentally unreliable from
// text alone — genuine mechanics and pure description both read the same
// way to a generic heuristic, and a purpose-built pattern for ONE item's
// wording doesn't belong in shared code. So this only maps a clause onto a
// Feature that's part of the KNOWN list — CLAUSE_RECOGNIZERS above, or one
// of the structural dispatches below (Curse, Spell Menu) — and otherwise
// reports NOTHING rather than minting a fresh one-off Feature from raw,
// unclassified text. Not data loss: the Wonder's own `notes` already
// preserves the complete original description regardless. Growing the
// known list is how a recurring concept gets captured; never a text-dump
// fallback.
async function convertCandidateUnit(rawText, ctx) {
  const { candidatePool, existingFeatures, systemId, dataManager, result, substitute } = ctx;
  const { label, text: labelStrippedText } = extractBoldLabel(rawText);
  const text = substitute(labelStrippedText);

  // "Curse" is common and recognizable enough (attunement-linked, ongoing
  // while attuned, ends only via remove curse/similar magic) to warrant its
  // own shared Feature — but the actual DRAWBACK varies too much item to
  // item (forced vulnerability, disadvantage on attacks/saves, forced
  // behavior, redirected attacks) to decompose further than one freeform
  // `curseText` param, same "compound fact stays together" reasoning as
  // `feat.cast-a-spell`'s own params. Routed BEFORE the generic clause
  // recognizers (skipping them entirely for this unit) since a curse's
  // internal clauses are part of ONE conceptual drawback, not independent
  // abilities to split out further.
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
// (Cantrip/1st–2nd/3rd–4th/5th–6th/7th–8th/9th) — a spell's parsed
// `stats.level` maps onto them directly. Returns null for anything without
// a numeric level (every item — no spell-level concept), leaving
// featureTiers untouched for those.
function resolveSpellDamageTier(level) {
  if (!Number.isFinite(level)) return null;
  if (level <= 0) return "tier-1";
  if (level <= 2) return "tier-2";
  if (level <= 4) return "tier-3";
  if (level <= 6) return "tier-4";
  if (level <= 8) return "tier-5";
  return "tier-6";
}

// `record` — an already-mapped Wonder record (5e-api-spell.json/
// 5e-api-magic-item.json's output, or a hand-authored one carrying the same
// `stats` shape). Three paths, tried in priority order: (1) a recognized
// structured mechanic (spell damage/heal, or an item's rarity-bonus-family
// membership) — the clean, well-tested fast path; (2) a markdown-table
// random-effect list — the WHOLE remaining `candidateUnits` text is
// checked for this BEFORE per-unit processing, since a table is one
// options-bearing Feature, not several independent ones; (3) otherwise,
// every `stats.candidateUnits` entry is converted independently via
// `convertCandidateUnit` above — one Wonder can produce several small,
// reusable Features, like one monster produces several from its own
// traits/actions, instead of one giant blob named after the Wonder itself.
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
  // No genericizing needed today — unlike a monster's stat block, a
  // spell/item's prose essentially never self-references its own name the
  // way "the dragon exhales..." does; kept as a real hook (not inlined
  // away) so a future self-referencing source has somewhere to plug in,
  // matching monster import's `substitute` contract exactly.
  const substitute = (text) => text;

  const mechanic = stats.mechanic;
  try {
    if (mechanic?.kind === "damage") {
      // A FIXED name ("Damage"), not `stats.name` — every clean-mechanic
      // damage spell used to mint its OWN uniquely-named Feature
      // (feat.fireball, feat.acid-splash, ...), each a near-identical
      // shape (attack/save resolution + damage type + a per-level/slot
      // scaling ladder) with nothing but its own params actually
      // differing. Named plainly "Damage" (not "Spell Damage") since an
      // item could hit this same shape someday — `tags.categories` on the
      // Feature already covers both. The spell's own name doesn't need
      // repeating in featureParams — it's already `record.name` on the
      // Wonder this Feature is attached to.
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
      // Without this, a damage spell imported through here silently landed
      // at the CHEAPEST possible budget tier regardless of its real level
      // (feat.damage.json's own fallback: "no tier chosen falls back to
      // tier-1").
      const damageTier = resolveSpellDamageTier(stats.level);
      if (damageTier) featureTiers[template.id] = damageTier;
    } else if (mechanic?.kind === "heal") {
      // Reuses the SAME feat.healing an item's flat-healing clause matches
      // onto (see the `flat-healing` clause recognizer above), never a
      // spell-specific duplicate. A spell's healing almost always scales by
      // slot/character level (mechanic.scaling's full ladder); an item's
      // healing is usually one fixed value (`healingDice`) —
      // feat.healing's own render function shows whichever of the two this
      // record's featureParams actually has.
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
      // A whole-record markdown table USED to always become a fresh,
      // item-specific "options" Feature — the same one-off-per-item
      // anti-pattern the rest of this module avoids for per-unit prose.
      // The ONE table shape that's a known, mappable concept (a
      // damage-type-choice table — see recognizeDamageTypeChoiceTable
      // above) still SHORT-CIRCUITS onto Damage Modification; any OTHER
      // table now tags the generic `feat.random-effect` marker instead of
      // reporting nothing — the SPECIFIC options remain unstructured
      // (still only in `notes`), but the ITEM correctly carries a real
      // Feature acknowledging a table-driven varied effect, for
      // budget/generation purposes. Additive, not exclusive — per-unit
      // processing still runs afterward, so any OTHER real clause in the
      // same record is still independently recognized.
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
        // One real shape has "cast one of the following spells:" end its
        // own paragraph with NOTHING after the colon — each option is a
        // SEPARATE paragraph after it. The per-unit `spell-menu` recognizer
        // above only sees one paragraph at a time and can never reassemble
        // this, so it's also checked here against the WHOLE record's
        // joined units. Additive, not exclusive, like the table check
        // above — per-unit processing still runs afterward for anything
        // else in the record.
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

  // stats.charges is Wonder-level activation data, never Feature content —
  // surfaced directly on the record rather than folded into any Feature's
  // featureParams. ALSO given its own Feature (`feat.charges`, budgetCost
  // 0 — it's not a power source itself, whatever ability the charges power
  // already has its own cost via `feat.cast-a-spell`/`feat.spell-menu`) so
  // a charged item is never counted as featureless purely because its
  // charge economy isn't otherwise a "clause".
  if (stats.charges) {
    record.charges = stats.charges;
    const chargesTemplate = await matchOrCreateParameterizedFeature("Charges", GENERIC_ACTIVE_TYPE, { candidatePool, existingFeatures, systemId, dataManager, result });
    if (!featureIds.includes(chargesTemplate.id)) featureIds.push(chargesTemplate.id);
    featureParams[chargesTemplate.id] = { max: stats.charges.max, rechargeFormula: stats.charges.rechargeFormula };
  }
  // `stats.requiresAttunement` is a real balance cost — attunement is a
  // scarce resource (max 3 at a time) independent of whatever else the
  // item does — captured as its own drawback Feature (negative
  // budgetCost) rather than left as a plain boolean nobody's budget math sees.
  if (stats.requiresAttunement) {
    const attunementTemplate = await matchOrCreateParameterizedFeature("Requires Attunement", GENERIC_ACTIVE_TYPE, { candidatePool, existingFeatures, systemId, dataManager, result });
    if (!featureIds.includes(attunementTemplate.id)) featureIds.push(attunementTemplate.id);
  }
  // stats.properties ({rarity, form, activation}, only keys it could
  // confidently resolve) is Wonder-level generator-property data, in
  // exactly the shape Vault's record.properties already expects
  // ({[field.key]: slugified value id}). The mapping layer owns this
  // translation (5e SRD vocabulary -> sys.dnd5e's field keys/value ids)
  // the same way monster import's resolveCreatureType maps SRD creature
  // types onto a System's creatureTypes vocabulary — this shared library
  // has no opinion on what "form"/"rarity"/"activation" mean, it just
  // merges whatever the mapping layer already resolved.
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

// Loom's saveEntity checks this before running the conversion above — a
// Wonder whose importer produced no `stats` at all (hand-authored/
// generated, or already converted on an earlier save) has nothing to
// convert. Distinct from monster's `hasConvertibleStatBlock` (keys off
// `stats.traits`/`stats.actions` arrays) so the two never both fire on the
// same record — a Wonder's `stats` shape never carries monster's
// ABILITY_GROUP_KEYS.
export function hasConvertibleSpellItemStats(record) {
  return Boolean(record?.stats?.name);
}
