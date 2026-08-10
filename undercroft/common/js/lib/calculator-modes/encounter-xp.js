// Pure data-reading/math for the Dashboard Calculator's "Encounter
// Difficulty & XP" mode (common/js/lib/widgets/calculator.js) — no DOM here,
// same split travel-means.js already has from calculator.js's own Travel
// Time mode.
//
// `levels` is a reserved-key System field (Loom's Properties editor, an
// ordinary `type:"array"` field — no new PROPERTY_TYPE, same convention
// travelMeans/combatScaling already use): one row per character level,
// carrying an optional `xpToLevel` (character-advancement XP, not consumed
// by this calculator today but exposed for any future consumer) plus an
// ARBITRARY, GM-named set of difficulty-tier XP-budget numbers (e.g.
// easy/medium/hard/deadly for a D&D-flavored System, something else
// entirely for another) — see sys.dnd5e.json's own copy for a worked
// example. Tier vocabulary is never hardcoded: every key on a row besides
// name/level/xpToLevel is treated as a tier.
const LEVEL_ROW_RESERVED_KEYS = new Set(["name", "level", "xpToLevel", "id"]);

export function extractLevels(systemDefinition) {
  const fields = Array.isArray(systemDefinition?.fields) ? systemDefinition.fields : [];
  const field = fields.find((entry) => entry?.type === "array" && entry.key === "levels");
  const values = Array.isArray(field?.values) ? field.values : [];
  return values
    .filter((value) => value && typeof value.level === "number")
    .map((value) => ({
      level: value.level,
      name: value.name || `Level ${value.level}`,
      xpToLevel: typeof value.xpToLevel === "number" ? value.xpToLevel : null,
      tiers: extractTierMap(value),
    }));
}

function extractTierMap(value) {
  const tiers = {};
  Object.keys(value).forEach((key) => {
    if (LEVEL_ROW_RESERVED_KEYS.has(key)) return;
    if (typeof value[key] === "number") tiers[key] = value[key];
  });
  return tiers;
}

// Union of every tier key across every level row, in first-appearance order
// (not alphabetical) — preserves whatever easy→deadly-equivalent order the
// GM actually authored, and stays stable even if one row is missing a tier
// another row defines.
export function collectTierNames(levels) {
  const seen = [];
  (levels || []).forEach((row) => {
    Object.keys(row.tiers || {}).forEach((tier) => {
      if (!seen.includes(tier)) seen.push(tier);
    });
  });
  return seen;
}

// null (not 0) means "this System has no threshold data for this level" —
// a real absence must never look like a real zero-XP budget.
export function thresholdForLevel(levels, level, tier) {
  const row = (levels || []).find((entry) => entry.level === level);
  const value = row?.tiers?.[tier];
  return typeof value === "number" ? value : null;
}

// roster: [{level, count}]. Returns the summed budget plus any roster level
// this System's `levels` table has no row for, so the caller can say so
// instead of silently treating a gap as 0.
export function computePartyXpBudget(roster, levels, tier) {
  let total = 0;
  const missingLevels = [];
  (roster || []).forEach(({ level, count }) => {
    const perCharacter = thresholdForLevel(levels, level, tier);
    if (perCharacter == null) {
      missingLevels.push(level);
      return;
    }
    total += perCharacter * count;
  });
  return { total, missingLevels };
}

// selections: [{id, count}] against loadCombatScalingLevels' own returned
// rows (common/js/lib/combat-scaling.js) — each already carries `xp` as a
// plain passthrough field when the System's own rows define one.
export function computeMonsterXp(selections, combatScalingLevels) {
  let total = 0;
  const missingXp = [];
  (selections || []).forEach(({ id, count }) => {
    const level = (combatScalingLevels || []).find((entry) => entry.id === id);
    const xp = typeof level?.xp === "number" ? level.xp : null;
    if (xp == null) {
      missingXp.push(level?.name || id);
      return;
    }
    total += xp * count;
  });
  return { total, missingXp };
}

// The highest tier (in the System's own authored order) whose party budget
// is met or exceeded by the monster XP total — generalizes the classic
// "compare total monster XP to the party's per-tier budget" method to
// however many tiers a System defines, under whatever names it gives them.
// Returns null at either extreme (below the easiest tier's budget, or a
// tier couldn't be judged due to missing level data) rather than forcing a
// match.
export function resolveVerdict(roster, levels, tierNames, monsterXpTotal) {
  let verdictTier = null;
  for (const tier of tierNames) {
    const { total, missingLevels } = computePartyXpBudget(roster, levels, tier);
    if (missingLevels.length) break; // can't judge this or any harder tier without full data
    if (monsterXpTotal >= total) {
      verdictTier = tier;
    } else {
      break;
    }
  }
  return verdictTier;
}

// The two real level-path conventions observed across shipped Systems
// (D&D 5e nests it at identity.level, Daggerheart keeps it flat at level) —
// tried in order. A System with neither (Blades in the Dark has no level
// concept at all) resolves to null, never a guessed default.
const LEVEL_PATH_CANDIDATES = ["identity.level", "level"];

export function resolveCharacterLevel(characterPayload) {
  for (const path of LEVEL_PATH_CANDIDATES) {
    const value = path.split(".").reduce((obj, key) => (obj && typeof obj === "object" ? obj[key] : undefined), characterPayload);
    if (typeof value === "number") return value;
  }
  return null;
}

// Fetches every member of `groupId` and buckets them by resolved level into
// roster rows — the convenience "auto-fill" the always-available manual
// roster entry doesn't need. A member with no resolvable level is excluded
// (never defaulted to level 1 — an honest omission beats a wrong invented
// number), and the caller gets a skip count to report.
export async function autoFillRosterFromGroup(dataManager, groupId) {
  if (!dataManager || !groupId) return { roster: [], skipped: 0 };
  const group = await dataManager.get("group", groupId, { preferLocal: false }).catch(() => null);
  const memberIds = Array.isArray(group?.payload?.members)
    ? group.payload.members.filter((member) => member.content_type === "character").map((member) => member.content_id)
    : [];
  const levelCounts = new Map();
  let skipped = 0;
  for (const id of memberIds) {
    const character = await dataManager.get("character", id).catch(() => null);
    const level = resolveCharacterLevel(character?.payload);
    if (level == null) {
      skipped += 1;
      continue;
    }
    levelCounts.set(level, (levelCounts.get(level) || 0) + 1);
  }
  const roster = Array.from(levelCounts.entries())
    .map(([level, count]) => ({ level, count }))
    .sort((a, b) => a.level - b.level);
  return { roster, skipped };
}
