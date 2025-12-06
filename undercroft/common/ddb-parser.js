// D&D Beyond character parser for Undercroft

const ABILITY_IDS = {
  1: 'strength',
  2: 'dexterity',
  3: 'constitution',
  4: 'intelligence',
  5: 'wisdom',
  6: 'charisma',
};

const SAVING_THROW_SUBTYPES = {
  strength: 'strength-saving-throws',
  dexterity: 'dexterity-saving-throws',
  constitution: 'constitution-saving-throws',
  intelligence: 'intelligence-saving-throws',
  wisdom: 'wisdom-saving-throws',
  charisma: 'charisma-saving-throws',
};

const DEFAULT_OPTIONS = {};

const RULES = [
  { section: 'identity', from: ['name', 'classes', 'race'], handler: buildIdentity },
  {
    section: 'abilities',
    from: ['stats', 'bonusStats', 'overrideStats', 'modifiers'],
    handler: buildAbilities,
  },
  {
    section: 'saves',
    from: ['stats', 'bonusStats', 'overrideStats', 'modifiers', 'classes'],
    handler: buildSavingThrows,
  },
  { section: 'inventory', from: ['inventory'], handler: buildInventory },
];

function ddbGetFromEndpoint( r_type, r_id, r_async ) {
  var r_json, r_proxy, r_url;
  r_proxy = "https://corsproxy.io/?url="  // Run through proxy to avoid CORS errors
  if ( r_type == "character" ) r_url = r_proxy + "https://character-service.dndbeyond.com/character/v5/character/" + r_id
  if ( r_type == "monster" ) r_url = r_proxy + "https://monster-service.dndbeyond.com/v1/Monster/" + r_id
  $.get({
    url: r_url,
    success: function(result) { r_json = result },
    error: function(xhr, error) { console.log(xhr) },
    async: r_async || false
  });
  return r_json;
}

function ddbParseCharacter(rawInput, options = DEFAULT_OPTIONS) {
  const rawCharacter = normaliseRawCharacter(rawInput);
  if (!rawCharacter || typeof rawCharacter !== 'object') return {};

  const resolvedOptions = { ...DEFAULT_OPTIONS, ...options };
  return RULES.reduce((output, rule) => {
    const context = pickContext(rawCharacter, rule.from);
    output[rule.section] = rule.handler(context, rawCharacter, resolvedOptions);
    return output;
  }, {});
}

function normaliseRawCharacter(rawInput) {
  if (!rawInput || typeof rawInput !== 'object') return null;
  if (rawInput.data && rawInput.data.stats) return rawInput.data;
  return rawInput.stats ? rawInput : null;
}

function pickContext(rawCharacter, fields) {
  return fields.reduce((acc, key) => {
    acc[key] = rawCharacter[key];
    return acc;
  }, {});
}

function buildIdentity(context) {
  const classes = Array.isArray(context.classes) ? context.classes : [];
  const primaryClass = classes.find((cls) => cls.isStartingClass) || classes[0] || {};
  const className = primaryClass.definition?.name || '';

  return {
    name: context.name || '',
    class: className,
    classes: classes.map((cls) => ({
      name: cls.definition?.name || 'Unknown Class',
      level: cls.level || 0,
      subclass: cls.subclassDefinition?.name || null,
    })),
    species: context.race?.fullName || context.race?.baseRaceName || '',
    level: classes.reduce((total, cls) => total + (cls.level || 0), 0),
  };
}

function buildAbilities(context, rawCharacter) {
  const modifiers = flattenModifiers(rawCharacter.modifiers);
  const abilityScores = calculateAbilityScores(context, modifiers);
  return abilityScores;
}

function buildSavingThrows(context, rawCharacter) {
  const modifiers = flattenModifiers(rawCharacter.modifiers);
  const abilityScores = calculateAbilityScores(context, modifiers);
  const totalLevel = Array.isArray(context.classes)
    ? context.classes.reduce((sum, cls) => sum + (cls.level || 0), 0)
    : 0;
  const proficiencyBonus = totalLevel > 0 ? 2 + Math.floor((totalLevel - 1) / 4) : 0;

  const savingThrows = {};
  Object.values(ABILITY_IDS).forEach((abilityName) => {
    const subtype = SAVING_THROW_SUBTYPES[abilityName];
    const abilityModifier = Math.floor(((abilityScores[abilityName] || 10) - 10) / 2);
    const proficiencyLevel = determineProficiencyLevel(modifiers, subtype);
    const savingThrowBonus = collectModifiers(modifiers, subtype, 'bonus');

    savingThrows[abilityName] = abilityModifier + Math.floor(proficiencyBonus * proficiencyLevel) + savingThrowBonus;
  });

  return savingThrows;
}

function buildInventory(context) {
  if (!Array.isArray(context.inventory)) return [];
  return context.inventory.map((item) => {
    const definition = item.definition || {};
    const weight = (definition.weightMultiplier || 1) * (definition.weight || 0) * (item.quantity || 0);
    return {
      name: definition.name || 'Unknown Item',
      quantity: item.quantity || 0,
      weight,
      notes: definition.snippet || definition.description || '',
    };
  });
}

function calculateAbilityScores(context, modifiers) {
  const baseStats = mapStats(context.stats);
  const bonusStats = mapStats(context.bonusStats);
  const overrideStats = mapStats(context.overrideStats);

  return Object.entries(ABILITY_IDS).reduce((scores, [id, name]) => {
    const base = overrideStats[name] ?? baseStats[name] ?? 10;
    const bonus = (bonusStats[name] || 0) + collectModifiers(modifiers, `${name}-score`, 'bonus');
    const overrideFromModifier = collectModifiers(modifiers, `${name}-score`, 'set');
    const finalScore = overrideFromModifier || base + bonus;
    scores[name] = finalScore;
    return scores;
  }, {});
}

function mapStats(statsArray) {
  if (!Array.isArray(statsArray)) return {};
  return statsArray.reduce((map, entry) => {
    const abilityName = ABILITY_IDS[entry.id];
    if (abilityName && typeof entry.value === 'number') {
      map[abilityName] = entry.value;
    }
    return map;
  }, {});
}

function flattenModifiers(modifierGroups) {
  if (!modifierGroups || typeof modifierGroups !== 'object') return [];
  return Object.values(modifierGroups).reduce((all, group) => {
    if (Array.isArray(group)) all.push(...group);
    return all;
  }, []);
}

function collectModifiers(modifiers, subtype, type) {
  if (!Array.isArray(modifiers)) return 0;
  return modifiers
    .filter((modifier) => modifier.subType === subtype && (!type || modifier.type === type))
    .reduce((total, modifier) => total + (modifier.fixedValue ?? modifier.value ?? 0), 0);
}

function determineProficiencyLevel(modifiers, subtype) {
  if (!Array.isArray(modifiers)) return 0;
  let level = 0;
  modifiers
    .filter((modifier) => modifier.subType === subtype)
    .forEach((modifier) => {
      if (modifier.type === 'proficiency') level = Math.max(level, 1);
      if (modifier.type === 'expertise') level = Math.max(level, 2);
      if (modifier.type === 'half-proficiency') level = Math.max(level, 0.5);
    });
  return level;
}
