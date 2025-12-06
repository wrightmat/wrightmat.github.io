// D&D Beyond character parser for Undercroft
// Architecture follows the declarative rules model described in PARSER.md.

const ABILITIES = [
  { id: 1, name: 'strength', friendlyName: 'Strength', shortName: 'STR' },
  { id: 2, name: 'dexterity', friendlyName: 'Dexterity', shortName: 'DEX' },
  { id: 3, name: 'constitution', friendlyName: 'Constitution', shortName: 'CON' },
  { id: 4, name: 'intelligence', friendlyName: 'Intelligence', shortName: 'INT' },
  { id: 5, name: 'wisdom', friendlyName: 'Wisdom', shortName: 'WIS' },
  { id: 6, name: 'charisma', friendlyName: 'Charisma', shortName: 'CHA' },
];

const ALIGNMENTS = [
  { id: 1, name: 'lawful-good', friendlyName: 'Lawful Good', shortName: 'LG' },
  { id: 2, name: 'neutral-good', friendlyName: 'Neutral Good', shortName: 'NG' },
  { id: 3, name: 'chaotic-good', friendlyName: 'Chaotic Good', shortName: 'CG' },
  { id: 4, name: 'lawful-neutral', friendlyName: 'Lawful Neutral', shortName: 'LN' },
  { id: 5, name: 'neutral', friendlyName: 'True Neutral', shortName: 'N' },
  { id: 6, name: 'chaotic-neutral', friendlyName: 'Chaotic Neutral', shortName: 'CN' },
  { id: 7, name: 'lawful-evil', friendlyName: 'Lawful Evil', shortName: 'LE' },
  { id: 8, name: 'neutral-evil', friendlyName: 'Neutral Evil', shortName: 'NE' },
  { id: 9, name: 'chaotic-evil', friendlyName: 'Chaotic Evil', shortName: 'CE' },
];

const SAVING_THROW_SUBTYPES = {
  strength: 'strength-saving-throws',
  dexterity: 'dexterity-saving-throws',
  constitution: 'constitution-saving-throws',
  intelligence: 'intelligence-saving-throws',
  wisdom: 'wisdom-saving-throws',
  charisma: 'charisma-saving-throws',
};

const SENSES = [
  { id: 1, name: 'blindsight' },
  { id: 2, name: 'darkvision' },
  { id: 3, name: 'tremorsense' },
  { id: 4, name: 'truesight' },
  { id: 5, name: 'unknown' },
];

const SKILLS = [
  { id: 3, name: 'acrobatics', friendlyName: 'Acrobatics', stat: 1 },
  { id: 11, name: 'animal-handling', friendlyName: 'Animal Handling', stat: 4 },
  { id: 6, name: 'arcana', friendlyName: 'Arcana', stat: 3 },
  { id: 2, name: 'athletics', friendlyName: 'Athletics', stat: 0 },
  { id: 16, name: 'deception', friendlyName: 'Deception', stat: 5 },
  { id: 7, name: 'history', friendlyName: 'History', stat: 3 },
  { id: 12, name: 'insight', friendlyName: 'Insight', stat: 4 },
  { id: 17, name: 'intimidation', friendlyName: 'Intimidation', stat: 5 },
  { id: 8, name: 'investigation', friendlyName: 'Investigation', stat: 3 },
  { id: 13, name: 'medicine', friendlyName: 'Medicine', stat: 4 },
  { id: 9, name: 'nature', friendlyName: 'Nature', stat: 3 },
  { id: 14, name: 'perception', friendlyName: 'Perception', stat: 4 },
  { id: 18, name: 'performance', friendlyName: 'Performance', stat: 5 },
  { id: 19, name: 'persuasion', friendlyName: 'Persuasion', stat: 5 },
  { id: 10, name: 'religion', friendlyName: 'Religion', stat: 3 },
  { id: 4, name: 'sleight-of-hand', friendlyName: 'Sleight of Hand', stat: 1 },
  { id: 5, name: 'stealth', friendlyName: 'Stealth', stat: 1 },
  { id: 15, name: 'survival', friendlyName: 'Survival', stat: 4 },
];

const ABILITY_ID_LOOKUP = ABILITIES.reduce((map, ability) => {
  map[ability.id] = ability.name;
  return map;
}, {});

const DEFAULT_OPTIONS = {};

const RULES = [
  { section: 'identity', from: ['name', 'classes', 'race', 'alignmentId'], handler: buildIdentity },
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
  {
    section: 'skills',
    from: ['stats', 'bonusStats', 'overrideStats', 'modifiers', 'classes'],
    handler: buildSkills,
  },
  { section: 'senses', from: ['modifiers'], handler: buildSenses },
  { section: 'inventory', from: ['inventory'], handler: buildInventory },
];

export function parseDdbCharacter(rawInput, options = DEFAULT_OPTIONS) {
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
  const alignment = ALIGNMENTS.find((entry) => entry.id === context.alignmentId) || null;

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
    alignment,
  };
}

function buildAbilities(context, rawCharacter) {
  const modifiers = flattenModifiers(rawCharacter.modifiers);
  const abilityScores = calculateAbilityScores(context, modifiers);
  return ABILITIES.map((ability) => {
    const score = abilityScores[ability.name] ?? 10;
    const modifier = Math.floor((score - 10) / 2);
    return { ...ability, score, modifier };
  });
}

function buildSavingThrows(context, rawCharacter) {
  const modifiers = flattenModifiers(rawCharacter.modifiers);
  const abilityScores = calculateAbilityScores(context, modifiers);
  const totalLevel = Array.isArray(context.classes)
    ? context.classes.reduce((sum, cls) => sum + (cls.level || 0), 0)
    : 0;
  const proficiencyBonus = totalLevel > 0 ? 2 + Math.floor((totalLevel - 1) / 4) : 0;

  return ABILITIES.map((ability) => {
    const subtype = SAVING_THROW_SUBTYPES[ability.name];
    const abilityModifier = Math.floor(((abilityScores[ability.name] || 10) - 10) / 2);
    const proficiencyLevel = determineProficiencyLevel(modifiers, subtype);
    const savingThrowBonus = collectModifiers(modifiers, subtype, 'bonus');

    return {
      ...ability,
      value: abilityModifier + Math.floor(proficiencyBonus * proficiencyLevel) + savingThrowBonus,
      proficiency: proficiencyLevel,
    };
  });
}

function buildSkills(context, rawCharacter) {
  const modifiers = flattenModifiers(rawCharacter.modifiers);
  const abilityScores = calculateAbilityScores(context, modifiers);
  const totalLevel = Array.isArray(context.classes)
    ? context.classes.reduce((sum, cls) => sum + (cls.level || 0), 0)
    : 0;
  const proficiencyBonus = totalLevel > 0 ? 2 + Math.floor((totalLevel - 1) / 4) : 0;

  return SKILLS.map((skill) => {
    const linkedAbility = ABILITIES[skill.stat];
    const abilityModifier = Math.floor(((abilityScores[linkedAbility.name] || 10) - 10) / 2);
    const proficiencyLevel = determineProficiencyLevel(modifiers, skill.name);
    const skillBonus = collectModifiers(modifiers, skill.name, 'bonus');

    return {
      ...skill,
      ability: linkedAbility.shortName,
      value: abilityModifier + Math.floor(proficiencyBonus * proficiencyLevel) + skillBonus,
      proficiency: proficiencyLevel,
    };
  });
}

function buildSenses(context) {
  const modifiers = flattenModifiers(context.modifiers);
  if (!Array.isArray(modifiers) || modifiers.length === 0) return [];

  const senses = modifiers
    .filter((modifier) => modifier.type === 'sense' && modifier.subType)
    .map((modifier) => {
      const baseSense = SENSES.find((sense) => sense.name === modifier.subType.toLowerCase()) || {
        id: modifier.id,
        name: modifier.subType,
      };

      return {
        ...baseSense,
        range: modifier.fixedValue ?? modifier.value ?? null,
      };
    });

  const deduped = {};
  senses.forEach((sense) => {
    const key = sense.name;
    const current = deduped[key];
    if (!current || (sense.range ?? 0) > (current.range ?? 0)) {
      deduped[key] = sense;
    }
  });

  return Object.values(deduped);
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

  return ABILITIES.reduce((scores, ability) => {
    const base = overrideStats[ability.name] ?? baseStats[ability.name] ?? 10;
    const bonus = (bonusStats[ability.name] || 0) + collectModifiers(modifiers, `${ability.name}-score`, 'bonus');
    const overrideFromModifier = collectModifiers(modifiers, `${ability.name}-score`, 'set');
    const finalScore = overrideFromModifier || base + bonus;
    scores[ability.name] = finalScore;
    return scores;
  }, {});
}

function mapStats(statsArray) {
  if (!Array.isArray(statsArray)) return {};
  return statsArray.reduce((map, entry) => {
    const abilityName = ABILITY_ID_LOOKUP[entry.id];
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

export default parseDdbCharacter;
