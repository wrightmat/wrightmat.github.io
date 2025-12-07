// D&D Beyond character parser for Undercroft
// Architecture follows the declarative rules model described in PARSER.md.

// Constants
const ACTIVATIONS = ['', 'A', '', 'BA', 'R', 's', 'm', 'h', 'S'];
const COMPONENTS = ['', 'V', 'S', 'M'];
const CONDITIONS = [
  '',
  'Blinded',
  'Charmed',
  'Deafened',
  'Exhausted',
  'Frightened',
  'Grappled',
  'Incapacitated',
  'Invisible',
  'Paralyzed',
  'Petrified',
  'Poisoned',
  'Prone',
  'Restrained',
  'Stunned',
  'Unconscious',
];
const DAMAGES = ['', 'ddb-bludgeoning', 'ddb-piercing', 'ddb-slashing'];
const DURATIONS = ['', 'Short Rest', 'Long Rest'];
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
const SIZES = [
  { id: 2, name: 'Tiny', value: 'tiny' },
  { id: 3, name: 'Small', value: 'sm' },
  { id: 4, name: 'Medium', value: 'med' },
  { id: 5, name: 'Large', value: 'lg' },
  { id: 6, name: 'Huge', value: 'huge' },
  { id: 7, name: 'Gargantuan', value: 'grg' },
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
const SPEEDS = [
  { id: 1, name: 'walk', innate: 'walking' },
  { id: 2, name: 'burrow', innate: 'burrowing' },
  { id: 3, name: 'climb', innate: 'climbing' },
  { id: 4, name: 'fly', innate: 'flying' },
  { id: 5, name: 'swim', innate: 'swimming' },
];
const WEAPONS = {
  simple: [
    'Club',
    'Dagger',
    'Greatclub',
    'Handaxe',
    'Javelin',
    'Light Hammer',
    'Mace',
    'Quarterstaff',
    'Sickle',
    'Spear',
    'Crossbow, Light',
    'Dart',
    'Shortbow',
    'Sling',
  ],
  martial: [
    'Battleaxe',
    'Flail',
    'Glaive',
    'Greataxe',
    'Greatsword',
    'Halberd',
    'Lance',
    'Longsword',
    'Maul',
    'Morningstar',
    'Pike',
    'Rapier',
    'Scimitar',
    'Shortsword',
    'Trident',
    'War Pick',
    'Warhammer',
    'Whip',
    'Blowgun',
    'Crossbow, Hand',
    'Crossbow, Heavy',
    'Longbow',
    'Net',
  ],
  melee: [
    'Club',
    'Dagger',
    'Greatclub',
    'Handaxe',
    'Javelin',
    'Light hammer',
    'Mace',
    'Quarterstaff',
    'Sickle',
    'Spear',
    'Battleaxe',
    'Flail',
    'Glaive',
    'Greataxe',
    'Greatsword',
    'Halberd',
    'Lance',
    'Longsword',
    'Maul',
    'Morningstar',
    'Pike',
    'Rapier',
    'Scimitar',
    'Shortsword',
    'Trident',
    'War pick',
    'Warhammer',
    'Whip',
  ],
  ranged: [
    'Crossbow, light',
    'Dart',
    'Shortbow',
    'Sling',
    'Blowgun',
    'Crossbow, hand',
    'Crossbow, heavy',
    'Longbow',
    'Net',
  ],
};
const PROFICIENCY_NONE = 0;
const PROFICIENCY_HALF = 1;
const PROFICIENCY_HALF_ROUND_UP = 2;
const PROFICIENCY_FULL = 3;
const PROFICIENCY_EXPERTISE = 4;

const DEFAULT_OPTIONS = {};

// Rules
const RULES = [
  {
    section: 'identity',
    from: ['id', 'userId', 'username', 'name', 'classes', 'race', 'inspiration', 'notes', 'age', 'eyes', 'hair', 'skin', 'height', 'weight', 'faith'],
    handler: buildIdentity,
  },
  { section: 'campaign', from: ['campaign'], handler: (context) => context.campaign || null },
  { section: 'decorations', from: ['decorations'], handler: (context) => context.decorations || null },
  { section: 'alignment', from: ['alignmentId'], handler: (context) => ALIGNMENTS.find((entry) => entry.id === context.alignmentId) || null },
  { section: 'conditions', from: ['conditions'], handler: buildConditions },
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
    section: 'initiative',
    from: ['stats', 'bonusStats', 'overrideStats', 'modifiers', 'classes'],
    handler: buildInitiative,
  },
  {
    section: 'skills',
    from: ['stats', 'bonusStats', 'overrideStats', 'modifiers', 'classes'],
    handler: buildSkills,
  },
  {
    section: 'senses',
    from: ['stats', 'bonusStats', 'overrideStats', 'modifiers', 'classes', 'customSenses', 'race'],
    handler: buildSenses,
  },
  { section: 'speeds', from: ['race', 'customSpeeds', 'modifiers'], handler: buildSpeeds },
  { section: 'ac', from: ['stats', 'bonusStats', 'overrideStats', 'modifiers', 'inventory'], handler: buildArmorClass },
  {
    section: 'hp',
    from: [
      'baseHitPoints',
      'bonusHitPoints',
      'overrideHitPoints',
      'removedHitPoints',
      'temporaryHitPoints',
      'stats',
      'bonusStats',
      'overrideStats',
      'modifiers',
      'classes',
    ],
    handler: buildHitPoints,
  },
  { section: 'deathSaves', from: ['deathSaves'], handler: buildDeathSaves },
  { section: 'proficiency', from: ['classes'], handler: buildProficiencyBonus },
  { section: 'background', from: ['background'], handler: buildBackground },
  { section: 'currencies', from: ['currencies'], handler: buildCurrencies },
  { section: 'feats', from: ['feats'], handler: buildFeats },
  { section: 'features', from: ['classes', 'race'], handler: buildFeatures },
  { section: 'proficiencies', from: ['modifiers'], handler: buildProficiencies },
  { section: 'attacking', from: ['modifiers', 'feats'], handler: buildAttacking },
  { section: 'attacks', from: ['actions', 'inventory', 'modifiers', 'classes', 'stats', 'bonusStats', 'overrideStats', 'spells'], handler: buildAttacks },
  { section: 'limitedUses', from: ['actions', 'features', 'feats', 'spellSlots', 'classes', 'pactMagic'], handler: buildLimitedUses },
  {
    section: 'spellCasting',
    from: ['classes', 'spells', 'pactMagic', 'spellSlots', 'stats', 'bonusStats', 'overrideStats', 'modifiers'],
    handler: buildSpellcasting,
  },
  { section: 'spells', from: ['spells', 'classSpells'], handler: buildSpells },
  { section: 'inventory', from: ['inventory'], handler: buildInventory },
  { section: 'notes', from: ['notes'], handler: buildNotes },
  { section: 'traits', from: ['age', 'eyes', 'hair', 'skin', 'height', 'weight', 'faith', 'traits'], handler: buildTraits },
];

// Handlers
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

function buildIdentity(context, rawCharacter) {
  const classes = Array.isArray(context.classes) ? context.classes : [];
  const primaryClass = classes.find((cls) => cls.isStartingClass) || classes[0] || {};
  const className = primaryClass.definition?.name || '';
  const monkLevels = classes
    .filter((cls) => (cls.definition?.name || '').toLowerCase() === 'monk')
    .reduce((total, cls) => total + (cls.level || 0), 0);
  const totalLevel = getTotalLevel(classes);
  const primaryClassName = (primaryClass.definition?.name || '').toLowerCase();
  const primaryLevels = classes
    .filter((cls) => (cls.definition?.name || '').toLowerCase() === primaryClassName)
    .reduce((sum, cls) => sum + (cls.level || 0), 0);

  return {
    id: rawCharacter.id || null,
    userId: rawCharacter.userId || null,
    username: rawCharacter.username || '',
    name: context.name || '',
    class: className,
    classes: classes.map((cls) => ({
      name: cls.definition?.name || 'Unknown Class',
      level: cls.level || 0,
      subclass: cls.subclassDefinition?.name || null,
    })),
    race: context.race || null,
    level: totalLevel,
    levels: {
      level_monk: monkLevels,
      level_multiclass: Math.max(totalLevel - primaryLevels, 0),
    },
    inspiration: Boolean(context.inspiration),
  };
}

function buildAbilities(context, rawCharacter) {
  const modifiers = getActiveModifiers(rawCharacter);
  const abilityScores = calculateAbilityScores(context, modifiers);
  return ABILITIES.map((ability) => {
    const score = abilityScores[ability.name] ?? 10;
    const modifier = Math.floor((score - 10) / 2);
    return { ...ability, score, modifier };
  });
}

function buildSavingThrows(context, rawCharacter) {
  const modifiers = getActiveModifiers(rawCharacter);
  const abilityScores = calculateAbilityScores(context, modifiers);
  const totalLevel = getTotalLevel(context.classes);
  const proficiencyBonus = getProficiencyBonus(totalLevel);
  const generalSaveBonus = collectGeneralSavingThrowBonus(modifiers);

  return ABILITIES.map((ability) => {
    const subtype = SAVING_THROW_SUBTYPES[ability.name];
    const abilityModifier = Math.floor(((abilityScores[ability.name] || 10) - 10) / 2);
    const { level, roundUp } = determineProficiencyLevel(modifiers, [subtype, 'saving-throws']);
    const savingThrowBonus = collectModifiers(modifiers, subtype, 'bonus') + generalSaveBonus;
    const proficiencyValue = applyProficiency(level, proficiencyBonus, roundUp);

    return {
      ...ability,
      value: abilityModifier + proficiencyValue + savingThrowBonus,
      proficiency: level,
    };
  });
}

function buildInitiative(context, rawCharacter) {
  const modifiers = getActiveModifiers(rawCharacter);
  const abilityScores = calculateAbilityScores(context, modifiers);
  const totalLevel = getTotalLevel(context.classes);
  const proficiencyBonus = getProficiencyBonus(totalLevel);

  const dexModifier = Math.floor(((abilityScores.dexterity || 10) - 10) / 2);
  const { level, roundUp } = determineProficiencyLevel(modifiers, 'initiative');
  const bonus = collectModifiers(modifiers, ['initiative', 'dexterity-ability-checks'], 'bonus');

  const value = dexModifier + applyProficiency(level, proficiencyBonus, roundUp) + bonus;
  const advantage = modifiers.some((modifier) => modifier.subType === 'initiative' && modifier.type === 'advantage');
  const disadvantage = modifiers.some((modifier) => modifier.subType === 'initiative' && modifier.type === 'disadvantage');

  return { value, advantage, disadvantage };
}

function buildSkills(context, rawCharacter) {
  const modifiers = getActiveModifiers(rawCharacter);
  const abilityScores = calculateAbilityScores(context, modifiers);
  const totalLevel = getTotalLevel(context.classes);
  const proficiencyBonus = getProficiencyBonus(totalLevel);

  return SKILLS.map((skill) => {
    const linkedAbility = ABILITIES[skill.stat];
    const abilityModifier = Math.floor(((abilityScores[linkedAbility.name] || 10) - 10) / 2);
    const { level, roundUp } = determineProficiencyLevel(modifiers, [skill.name, `skill-${skill.name}`, `${linkedAbility.name}-ability-checks`, 'ability-checks']);
    const skillBonus = collectModifiers(
      modifiers,
      [skill.name, `skill-${skill.name}`, `${linkedAbility.name}-ability-checks`, 'ability-checks'],
      'bonus'
    );

    return {
      ...skill,
      ability: linkedAbility.shortName,
      value: abilityModifier + applyProficiency(level, proficiencyBonus, roundUp) + skillBonus,
      proficiency: level,
    };
  });
}

function buildSenses(context, rawCharacter) {
  const modifiers = getActiveModifiers(rawCharacter);
  const allowed = new Set(SENSES.map((sense) => sense.name));
  const knownSenses = [];

  (Array.isArray(modifiers) ? modifiers : [])
    .filter((modifier) => modifier.subType && allowed.has(modifier.subType.toLowerCase()))
    .forEach((modifier) => {
      const normalized = modifier.subType.toLowerCase();
      const baseSense = SENSES.find((sense) => sense.name === normalized) || {
        id: modifier.id,
        name: normalized,
      };

      knownSenses.push({
        ...baseSense,
        range: modifier.fixedValue ?? modifier.value ?? null,
      });
    });

  const raceModifiers = (context.race?.racialTraits || [])
    .flatMap((trait) => trait.definition?.grantedModifiers || [])
    .filter((modifier) => modifier.subType && allowed.has(modifier.subType.toLowerCase()));
  raceModifiers.forEach((modifier) => {
    const normalized = modifier.subType.toLowerCase();
    const baseSense = SENSES.find((sense) => sense.name === normalized) || {
      id: modifier.id,
      name: normalized,
    };

    knownSenses.push({
      ...baseSense,
      range: modifier.fixedValue ?? modifier.value ?? null,
    });
  });

  const customSenses = context.customSenses || rawCharacter.customSenses || [];
  customSenses.forEach((entry) => {
    const baseSense = SENSES.find((sense) => sense.id === entry.senseId || sense.id === entry.id);
    const name = (baseSense?.name || entry.name || '').toLowerCase();
    if (!name) return;
    knownSenses.push({ id: baseSense?.id || entry.id, name, range: entry.distance ?? entry.value ?? null });
  });

  const deduped = {};
  knownSenses.forEach((sense) => {
    const key = sense.name;
    const current = deduped[key];
    if (!current || (sense.range ?? 0) > (current.range ?? 0)) {
      deduped[key] = sense;
    }
  });

  const skills = buildSkills(context, rawCharacter);
  const lookup = skills.reduce((map, skill) => {
    map[skill.name] = skill.value;
    return map;
  }, {});

  const flattened = {
    passives: {
      perception: 10 + (lookup['perception'] || 0),
      investigation: 10 + (lookup['investigation'] || 0),
      insight: 10 + (lookup['insight'] || 0),
    },
  };

  Object.values(deduped).forEach((sense) => {
    flattened[sense.name] = sense.range ?? null;
  });

  return flattened;
}

function buildConditions(context) {
  if (!Array.isArray(context.conditions)) return [];
  return context.conditions
    .map((value) => CONDITIONS[value] || null)
    .filter(Boolean);
}

function buildInventory(context) {
  if (!Array.isArray(context.inventory)) return [];

  const itemsByContainer = new Map();
  const containerIds = new Set(context.inventory.map((item) => item.id).filter(Boolean));
  const simplify = (item) => {
    const definition = item.definition || {};
    const weight = (definition.weightMultiplier || 1) * (definition.weight || 0) * (item.quantity || 0);
    return {
      name: definition.name || 'Unknown Item',
      quantity: item.quantity || 0,
      weight,
      notes: definition.snippet || definition.description || '',
      canAttune: Boolean(definition.canAttune),
      isAttuned: Boolean(item.isAttuned),
      canEquip: Boolean(definition.canEquip),
      isEquipped: Boolean(item.equipped),
      canContain: itemsByContainer.has(item.id),
      isContained: Boolean(item.containerEntityId && containerIds.has(item.containerEntityId)),
    };
  };

  context.inventory.forEach((item) => {
    const bucket = itemsByContainer.get(item.containerEntityId) || [];
    bucket.push(item);
    itemsByContainer.set(item.containerEntityId, bucket);
  });

  const fullInventory = context.inventory.map((item) => simplify(item));

  const containers = context.inventory.filter((candidate) => itemsByContainer.has(candidate.id));
  const nested = containers.map((container) => ({
    ...simplify(container),
    items: (itemsByContainer.get(container.id) || []).map((item) => simplify(item)),
  }));

  return [fullInventory, ...nested];
}

function buildNotes(context) {
  const notes = context.notes || {};
  return {
    allies: notes.allies || '',
    backstory: notes.backstory || '',
    enemies: notes.enemies || '',
    organizations: notes.organizations || '',
    personalPossessions: notes.personalPossessions || '',
    otherHoldings: notes.otherHoldings || '',
    otherNotes: notes.otherNotes || '',
  };
}

function buildSpeeds(context, rawCharacter) {
  const modifiers = getActiveModifiers(rawCharacter);
  const baseSpeeds = context.race?.weightSpeeds?.normal || {};

  const generalBonus = collectModifiers(modifiers, 'speed', 'bonus');
  const walkSpeed = (baseSpeeds.walk || 0) + generalBonus;

  return SPEEDS.reduce((speeds, speed) => {
    const innateSubtype = `innate-speed-${speed.innate}`;
    const base = (baseSpeeds[speed.name] || 0) + (speed.name === 'walk' ? generalBonus : 0);
    const innate = collectMaxSet(modifiers, innateSubtype);
    const bonus = collectModifiers(modifiers, `${speed.name}-speed`, 'bonus');

    const hasInnate = Array.isArray(modifiers)
      ? modifiers.some((modifier) => modifier.subType === innateSubtype && ['set', 'set-base'].includes(modifier.type))
      : false;

    const innateBase = innate || (hasInnate ? walkSpeed : 0);
    speeds[speed.name] = Math.max(base, innateBase) + bonus;
    return speeds;
  }, {});
}

function buildArmorClass(context, rawCharacter) {
  const modifiers = getActiveModifiers(rawCharacter);
  const abilityScores = calculateAbilityScores(context, modifiers);
  const dexMod = Math.floor(((abilityScores.dexterity || 10) - 10) / 2);
  const baseBonus = collectModifiers(modifiers, 'armor-class', 'bonus');

  const inventory = Array.isArray(context.inventory) ? context.inventory : [];
  const equippedArmor = inventory.filter((item) => item.equipped && item.definition?.armorClass != null);
  const shieldBonus = inventory.some((item) => item.equipped && /shield/i.test(item.definition?.type || item.definition?.filterType || ''))
    ? 2
    : 0;

  const armorValues = equippedArmor.map((item) => {
    const def = item.definition || {};
    const armorBase = def.armorClass || 0;
    const dexContribution = /light/i.test(def.type) || def.armorTypeId === 1
      ? dexMod
      : /medium/i.test(def.type) || def.armorTypeId === 2
      ? Math.min(dexMod, 2)
      : /heavy/i.test(def.type) || def.armorTypeId === 3
      ? 0
      : dexMod;

    return { value: armorBase + dexContribution, dexContribution };
  });

  const naturalAc = 10 + dexMod;
  const bestArmor = armorValues.sort((a, b) => (b?.value || 0) - (a?.value || 0))[0] || null;
  const baseAc = bestArmor?.value || naturalAc;
  const dexContribution = bestArmor?.dexContribution ?? dexMod;
  const calculated = baseAc + baseBonus + shieldBonus;
  return { value: calculated, shieldBonus, bonus: dexContribution + baseBonus };
}

function buildHitPoints(context, rawCharacter) {
  const modifiers = getActiveModifiers(rawCharacter);
  const abilityScores = calculateAbilityScores(context, modifiers);
  const conMod = Math.floor(((abilityScores.constitution || 10) - 10) / 2);
  const totalLevel = getTotalLevel(context.classes);
  const perLevelBonus = collectModifiers(modifiers, 'hit-points-per-level', 'bonus');

  const base = context.overrideHitPoints || (context.baseHitPoints || 0) + (context.bonusHitPoints || 0);
  const damageTaken = context.removedHitPoints || 0;
  const temp = context.temporaryHitPoints || 0;
  const max = base + totalLevel * (conMod + perLevelBonus);
  const current = max - damageTaken + temp;
  const primaryClass = (context.classes || []).find((cls) => cls.isStartingClass) || (context.classes || [])[0] || {};
  const hitDiceSize = primaryClass.definition?.hitDice || null;

  return {
    max,
    current: current < 0 ? 0 : current,
    temp,
    hitDice: totalLevel,
    hitDiceSize: hitDiceSize ? `1d${hitDiceSize}${conMod ? formatSigned(conMod) : ''}` : null,
  };
}

function buildProficiencyBonus(context) {
  const totalLevel = getTotalLevel(context.classes);
  return getProficiencyBonus(totalLevel);
}

function buildDeathSaves(context) {
  const saves = context.deathSaves || {};
  return {
    successes: saves.successCount ?? 0,
    failures: saves.failCount ?? 0,
    stabilized: Boolean(saves.isStabilized),
  };
}

function buildBackground(context) {
  const definition = context.background?.definition || {};
  return {
    name: definition.name || context.background?.name || '',
    description: definition.description || '',
    feature: definition.featureName || '',
    characteristics: context.background?.personalityTraits || [],
  };
}

function buildCurrencies(context) {
  const money = context.currencies || {};
  return {
    cp: money.cp || 0,
    sp: money.sp || 0,
    ep: money.ep || 0,
    gp: money.gp || 0,
    pp: money.pp || 0,
  };
}

function buildFeats(context) {
  if (!Array.isArray(context.feats)) return [];
  return context.feats.map((feat) => ({
    name: feat.definition?.name || 'Unknown Feat',
    description: feat.definition?.description || '',
    level: feat.requiredLevel || null,
    limitedUse: feat.definition?.limitedUse || null,
  }));
}

function buildProficiencies(context, rawCharacter) {
  const profs = getActiveModifiers(rawCharacter, { includeUngrantedProficiencies: true });
  const buckets = {
    armor: [],
    defenses: [],
    languages: [],
    saves: [],
    scores: [],
    senses: [],
    skills: [],
    tools: [],
    weapons: [],
    other: [],
  };

  const defenseMap = new Map();
  const addDefense = (entry) => {
    const key = `${(entry.type || '').toLowerCase()}|${(entry.name || '').toLowerCase()}|${(entry.condition || '').toLowerCase()}`;
    const existing = defenseMap.get(key);
    if (!existing) {
      defenseMap.set(key, entry);
      buckets.defenses.push(entry);
      return;
    }
    if (entry.value != null && (!existing.value || entry.value > existing.value)) {
      existing.value = entry.value;
    }
  };

  profs.forEach((prof) => {
    const subtype = (prof.subType || '').toLowerCase();
    const normalizedSubtype = subtype.startsWith('skill-') ? subtype.replace(/^skill-/, '') : subtype;
    const friendly = prof.friendlySubtypeName || prof.subType || 'Unknown';
    const profType = (prof.type || '').toLowerCase();
    const condition = prof.restriction ? prof.restriction : null;

    if (prof.isGranted === false && !['proficiency', 'language'].includes(profType)) return;

    if (profType === 'language') {
      buckets.languages.push(friendly);
      return;
    }
    if (['resistance', 'immunity', 'vulnerability', 'advantage', 'disadvantage'].includes(profType)) {
      addDefense({ name: friendly, type: prof.type, condition });
      return;
    }
    if (profType === 'bonus' && subtype.includes('saving-throws')) {
      addDefense({ name: friendly, type: prof.type, value: prof.fixedValue ?? prof.value ?? null, condition });
      return;
    }
    if (!profType.includes('proficiency')) {
      buckets.other.push(friendly);
      return;
    }

    if (subtype.includes('armor') || subtype === 'shields') {
      buckets.armor.push(friendly);
      return;
    }
    if (subtype.endsWith('saving-throws')) {
      buckets.saves.push(friendly);
      return;
    }
    if (normalizedSubtype === 'ability-checks' && profType.includes('proficiency')) {
      buckets.skills.push(friendly);
      return;
    }
    if (SKILLS.some((skill) => skill.name === normalizedSubtype)) {
      buckets.skills.push(friendly);
      return;
    }
    if (ABILITIES.some((ability) => ability.name === normalizedSubtype)) {
      buckets.scores.push(friendly);
      return;
    }
    if (SENSES.some((sense) => sense.name === normalizedSubtype)) {
      buckets.senses.push(friendly);
      return;
    }
    if (
      subtype.includes('tool') ||
      subtype.includes('kit') ||
      subtype.includes('suppl') ||
      subtype.includes('instrument') ||
      subtype.includes('gaming-set') ||
      subtype.includes('vehicle') ||
      prof.entityTypeId === 2103445194
    ) {
      buckets.tools.push(friendly);
      return;
    }
    if (subtype.includes('weapon')) {
      buckets.weapons.push(friendly);
      return;
    }

    buckets.other.push(friendly);
  });

  buckets.languages = Array.from(new Set(buckets.languages));
  buckets.armor = Array.from(new Set(buckets.armor));
  buckets.saves = Array.from(new Set(buckets.saves));
  buckets.scores = Array.from(new Set(buckets.scores));
  buckets.senses = Array.from(new Set(buckets.senses));
  buckets.skills = Array.from(new Set(buckets.skills));
  buckets.tools = Array.from(new Set(buckets.tools));
  buckets.weapons = Array.from(new Set(buckets.weapons));
  buckets.other = Array.from(new Set(buckets.other));

  return buckets;
}

function buildAttacks(context, rawCharacter) {
  const modifiers = getActiveModifiers(rawCharacter);
  const abilityScores = calculateAbilityScores(context, modifiers);
  const dexMod = Math.floor(((abilityScores.dexterity || 10) - 10) / 2);
  const strMod = Math.floor(((abilityScores.strength || 10) - 10) / 2);
  const totalLevel = getTotalLevel(context.classes);
  const proficiencyBonus = getProficiencyBonus(totalLevel);

  const spellNameSet = collectSpellNames(context.spells);
  const actions = flattenActions(context.actions).filter((action) => action.displayAsAttack);
  const filteredActions = actions.filter((action) => !spellNameSet.has((action.name || '').toLowerCase()));

  const itemsByContainer = new Set((context.inventory || []).map((item) => item.id));

  const equipmentAttacks = (context.inventory || [])
    .filter((item) => item.definition?.attackType || item.definition?.damage)
    .map((item) => {
      const definition = item.definition || {};
      const loweredName = (definition.name || '').toLowerCase();
      const isRanged =
        definition.attackType === 2 || WEAPONS.ranged.some((weapon) => weapon.toLowerCase() === loweredName);
      const isFinesse = Array.isArray(definition.properties)
        ? definition.properties.some((prop) => (prop.name || '').toLowerCase() === 'finesse')
        : false;
      const abilityMod = isRanged || (isFinesse && dexMod >= strMod) ? dexMod : strMod;

      const proficiency = isWeaponProficient(definition, modifiers) ? proficiencyBonus : 0;
      const attackBonus =
        (definition.attackBonus ?? 0) +
        abilityMod +
        proficiency +
        collectModifiers(modifiers, 'weapon-attacks', 'bonus') +
        collectModifiers(modifiers, isRanged ? 'ranged-attacks' : 'melee-attacks', 'bonus');

      const dice = definition.damage?.diceString || '';
      const damageMod = abilityMod ? formatSigned(abilityMod) : '';
      const damage = dice ? `${dice}${damageMod}` : null;
      const damageType = definition.damageType || null;

      const properties = Array.isArray(definition.properties) ? definition.properties.map((prop) => prop.name).filter(Boolean) : [];
      const notes = properties.join(', ');
      const longRange = definition.longRange ? `${definition.longRange} ft.` : null;
      const range = definition.range ? `${definition.range} ft.` : null;
      const weight = (definition.weight || 0) * (item.quantity || 1) * (definition.weightMultiplier || 1);

      return {
        name: definition.name || 'Attack',
        type: definition.attackType || 'action',
        activation: '1A',
        range,
        longRange,
        attackBonus,
        damage: damage || null,
        damageType,
        description: definition.description || definition.snippet || '',
        notes,
        equipped: Boolean(item.equipped),
        isAttuned: Boolean(item.isAttuned),
        isContained: Boolean(item.containerEntityId && itemsByContainer.has(item.containerEntityId)),
        weight,
      };
    });

  const combined = [
    ...filteredActions.map((action) => ({
      name: action.name || 'Attack',
      type: action.actionType || action.attackType || 'action',
      activation: '1A',
      range: action.range || action.attackTypeRange || '',
      longRange: action.longRange || null,
      attackBonus: action.fixedToHit ?? action.value ?? 0,
      damage: formatActionDamage(action.dice),
        damageType: DAMAGES[action.damageTypeId || 0] || null,
      description: action.description || action.snippet || '',
      notes: '',
      equipped: false,
      isAttuned: false,
      isContained: false,
      weight: 0,
    })),
    ...equipmentAttacks,
  ];

  const seen = new Set();
  const attacks = combined.reduce((list, action) => {
    const nameKey = (action.name || 'Attack').toLowerCase();
    if (seen.has(nameKey)) return list;
    seen.add(nameKey);

    list.push({
      ...action,
      activation: action.activation || '1A',
    });
    return list;
  }, []);

  return attacks.reverse();
}

function buildAttacking(context, rawCharacter) {
  const modifiers = getActiveModifiers(rawCharacter);
  const extraAttacks = collectMaxSet(modifiers, 'extra-attacks');
  const fightingStyle = determineFightingStyle(context.feats);

  return {
    attacksPerAction: 1 + extraAttacks,
    fightingStyle,
  };
}

function buildFeatures(context) {
  const classFeatures = (context.classes || [])
    .flatMap((cls) => [
      ...(cls.classFeatures || []),
      ...(cls.subclassDefinition?.classFeatures || []),
    ])
    .map((feature) => feature.definition)
    .filter(Boolean);
  const racialTraits = (context.race?.racialTraits || []).map((trait) => trait.definition).filter(Boolean);
  const featFeatures = (context.feats || []).map((feat) => feat.definition).filter(Boolean);

  const combined = [...classFeatures, ...racialTraits, ...featFeatures];
  const seen = new Set();

  return combined.reduce((list, feature) => {
    const name = feature.name || feature.friendlySubtypeName;
    if (!name || seen.has(name.toLowerCase())) return list;
    seen.add(name.toLowerCase());
    list.push({ name, description: feature.description || feature.snippet || '' });
    return list;
  }, []);
}

function buildLimitedUses(context) {
  const pools = [];
  const pactLevelRaw =
    context.pactMagic?.level ??
    context.pactMagic?.spellSlotLevel ??
    context.pactMagic?.slotLevel ??
    context.pactMagic?.pactLevel ??
    null;
  const pactLevel = pactLevelRaw != null && !Number.isNaN(Number(pactLevelRaw)) ? Number(pactLevelRaw) : null;
  const pactTotal =
    context.pactMagic?.totalSlots ??
    context.pactMagic?.slots ??
    context.pactMagic?.maxSlots ??
    context.pactMagic?.total ??
    context.pactMagic?.pactSlots ??
    0;
  const pactUsed =
    context.pactMagic?.usedSlots ??
    context.pactMagic?.slotsUsed ??
    context.pactMagic?.used ??
    context.pactMagic?.expendedSlots ??
    0;
  const pactAvailable =
    context.pactMagic?.availableSlots ??
    context.pactMagic?.slotsAvailable ??
    context.pactMagic?.available ??
    Math.max(pactTotal - pactUsed, 0);
  const hasPactMagicData = pactTotal || pactUsed || pactAvailable;
  ['actions', 'features', 'feats'].forEach((key) => {
    const entries = context[key];
    if (Array.isArray(entries)) {
      entries.forEach((entry) => {
        const limitedUse = entry.limitedUse || entry.definition?.limitedUse;
        if (limitedUse && (limitedUse.maxUses || limitedUse.useProficiencyBonus)) {
          pools.push({
            name: entry.name || entry.definition?.name || 'Resource',
            uses: limitedUse.maxUses || 0,
            used: limitedUse.numberUsed || 0,
            reset: DURATIONS[limitedUse.resetType || 0] || null,
          });
        }
      });
    }
  });
  if (Array.isArray(context.spellSlots)) {
    context.spellSlots.forEach((slot) => {
      const level = slot.level || 0;
      const available = slot.available ?? 0;
      const used = slot.used ?? 0;
      const total = available + used;
      pools.push({
        name: `Level ${level} Spell Slots`,
        level,
        total,
        available,
        used,
        reset: 'Long Rest',
      });
    });
  }
  const reservedPactLevels = new Set(
    pools.filter((pool) => pool.name === 'Pact Magic' && pool.level != null).map((pool) => pool.level)
  );
  const derivedSlots = deriveSpellSlots(context.classes || []);
  derivedSlots.forEach((slot) => {
    if (reservedPactLevels.has(slot.level)) return;
    const existing = pools.find((pool) => pool.name === `Level ${slot.level} Spell Slots`);
    if (existing) {
      if (!existing.total) {
        existing.total = slot.total;
        existing.used = existing.used ?? 0;
        existing.available = Math.max(slot.total - existing.used, 0);
      }
    } else {
      pools.push({
        name: `Level ${slot.level} Spell Slots`,
        level: slot.level,
        total: slot.total,
        available: slot.total,
        used: 0,
        reset: 'Long Rest',
      });
    }
  });

  const hasPactMagicFeature = (Array.isArray(context.classes) ? context.classes : []).some((cls) => {
    const classFeatures = [
      ...(Array.isArray(cls.classFeatures) ? cls.classFeatures : []),
      ...(Array.isArray(cls.subclassDefinition?.classFeatures) ? cls.subclassDefinition.classFeatures : []),
    ];
    return classFeatures.some((feature) => (feature.definition?.name || '').toLowerCase() === 'pact magic');
  });

  if (hasPactMagicFeature) {
    const spellSlotPools = pools
      .map((pool, index) => ({
        pool,
        index,
        level:
          pool.level ?? (typeof pool.name === 'string' && pool.name.match(/Level\s+(\d+)/i)
            ? Number(pool.name.match(/Level\s+(\d+)/i)[1])
            : null),
      }))
      .filter((entry) => entry.level != null)
      .sort((a, b) => a.level - b.level);

    const highest = spellSlotPools.pop();
    if (highest) {
      const total = hasPactMagicData
        ? pactTotal || pactAvailable + pactUsed
        : highest.pool.total ?? highest.pool.available + (highest.pool.used ?? 0);
      const used = hasPactMagicData ? pactUsed : highest.pool.used ?? 0;
      const available = hasPactMagicData ? pactAvailable : Math.max((total || 0) - (used || 0), 0);

      const updated = {
        ...highest.pool,
        name: 'Pact Magic',
        level: pactLevel ?? highest.level ?? highest.pool.level ?? null,
        total: total ?? 0,
        used: used ?? 0,
        available: available ?? 0,
        reset: 'Short Rest',
      };
      pools[highest.index] = updated;
    } else if (hasPactMagicData) {
      pools.push({
        name: 'Pact Magic',
        level: pactLevel,
        total: pactTotal || pactAvailable + pactUsed,
        used: pactUsed,
        available: pactAvailable,
        reset: 'Short Rest',
      });
    }
  }
  return pools;
}

function buildSpellcasting(context, rawCharacter) {
  const classes = Array.isArray(context.classes) ? context.classes : [];
  const ability = determineSpellcastingAbility(classes);
  const modifiers = getActiveModifiers(rawCharacter);
  const abilityScores = calculateAbilityScores(context, modifiers);
  const modScore = ability ? abilityScores[ability.name] ?? 10 : 10;
  const abilityMod = Math.floor((modScore - 10) / 2);
  const totalLevel = getTotalLevel(classes);
  const proficiencyBonus = getProficiencyBonus(totalLevel);
  return {
    abilityId: ability?.id || null,
    ability: ability?.shortName || null,
    mod: formatSigned(abilityMod),
    attack: formatSigned(abilityMod + proficiencyBonus),
    save: 8 + proficiencyBonus + abilityMod,
  };
}

function buildSpells(context, rawCharacter) {
  const modifiers = getActiveModifiers(rawCharacter);
  const abilityScores = calculateAbilityScores(rawCharacter, modifiers);
  const totalLevel = getTotalLevel(rawCharacter.classes);
  const proficiencyBonus = getProficiencyBonus(totalLevel);
  const spellcastingAbility = determineSpellcastingAbility(rawCharacter.classes);
  const abilityMod = spellcastingAbility ? Math.floor(((abilityScores[spellcastingAbility.name] || 10) - 10) / 2) : 0;
  const saveDc = 8 + proficiencyBonus + abilityMod;

  const grouped = {};
  const addSpell = (spell, source) => {
    const level = spell.definition?.level || 0;
    const name = spell.definition?.name || 'Unknown Spell';
    const activationType = spell.definition?.activation?.activationType || 0;
    const activation = ACTIVATIONS[activationType] || '';
    const concentration = Boolean(spell.definition?.concentration);
    const ritual = Boolean(spell.definition?.ritual);
    const saveAbility = ABILITIES.find((ability) => ability.id === spell.definition?.saveDcAbilityId);
    const requiresSave = Boolean(spell.definition?.requiresSavingThrow);
    const requiresAttack = Boolean(spell.definition?.requiresAttackRoll);
    const dc = requiresSave
      ? `${saveAbility?.shortName || spellcastingAbility?.shortName || ''}${spell.overrideSaveDc || saveDc}`
      : null;
    const toHit = requiresAttack ? formatSigned(proficiencyBonus + abilityMod) : null;
    const tags = Array.isArray(spell.definition?.tags) ? spell.definition.tags : [];
    const effect = tags.length ? tags[0] : null;
    const duration = spell.definition?.duration
      ? `${spell.definition.duration.durationInterval || ''} ${spell.definition.duration.durationUnit || ''}`.trim() +
        (spell.definition.duration.durationType ? ` (${spell.definition.duration.durationType})` : '')
      : '';

    const entry = {
      name,
      level,
      prepared: spell.prepared || false,
      castingTime: activation,
      range: spell.definition?.range || '',
      components: (spell.definition?.components || []).map((comp) => COMPONENTS[comp] || comp),
      school: spell.definition?.school || '',
      source,
      concentration,
      ritual,
      toHit,
      dc,
      effect,
      duration: duration || null,
    };

    if (!grouped[level]) grouped[level] = [];
    if (!grouped[level].some((existing) => existing.name === name)) {
      grouped[level].push(entry);
    }
  };

  if (context.spells && typeof context.spells === 'object') {
    ['class', 'race', 'feat'].forEach((bucket) => {
      const entries = context.spells[bucket];
      if (Array.isArray(entries)) {
        entries.forEach((spell) => addSpell(spell, bucket));
      }
    });
  }

  if (Array.isArray(context.classSpells)) {
    context.classSpells.forEach((classSpell) => {
      (classSpell.spells || []).forEach((spell) => addSpell(spell, 'class'));
    });
  }

  const levels = Object.keys(grouped)
    .map((lvl) => Number(lvl))
    .sort((a, b) => a - b);

  return levels.map((level) => grouped[level].sort((a, b) => a.name.localeCompare(b.name)));
}

function buildTraits(context, rawCharacter) {
  const traits = context.traits || {};
  return {
    age: context.age ?? null,
    appearance: traits.appearance || '',
    bonds: traits.bonds || '',
    eyes: context.eyes || '',
    faith: context.faith || '',
    flaws: traits.flaws || '',
    hair: context.hair || '',
    ideals: traits.ideals || '',
    personalityTraits: traits.personalityTraits || '',
    skin: context.skin || '',
    height: context.height || '',
    weight: context.weight ?? null,
    size: determineSize(rawCharacter),
  };
}

// Helper Functions
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

function calculateAbilityScores(context, modifiers) {
  const baseStats = mapStats(context.stats);
  const bonusStats = mapStats(context.bonusStats);
  const overrideStats = mapStats(context.overrideStats);

  return ABILITIES.reduce((scores, ability) => {
    const base = overrideStats[ability.name] ?? baseStats[ability.name] ?? 10;
    const bonus = (bonusStats[ability.name] || 0) + collectModifiers(modifiers, `${ability.name}-score`, 'bonus');
    const overrideFromModifier = collectModifiers(modifiers, `${ability.name}-score`, ['set', 'set-base']);
    const finalScore = overrideFromModifier || base + bonus;
    scores[ability.name] = finalScore;
    return scores;
  }, {});
}

function collectSpellNames(spellsBucket) {
  if (!spellsBucket || typeof spellsBucket !== 'object') return new Set();
  const names = [];
  Object.values(spellsBucket).forEach((entries) => {
    if (Array.isArray(entries)) {
      entries.forEach((spell) => {
        if (spell?.definition?.name) names.push(spell.definition.name.toLowerCase());
      });
    }
  });
  return new Set(names);
}

function deriveSpellSlots(classes) {
  if (!Array.isArray(classes)) return [];
  const caster = classes.find((cls) => cls.definition?.canCastSpells);
  if (!caster) return [];
  const levelSlots = caster.definition?.spellRules?.levelSpellSlots || [];
  const slots = levelSlots[caster.level] || [];
  return slots
    .map((total, index) => ({ level: index + 1, total }))
    .filter((entry) => entry.total > 0);
}

function determineSpellcastingAbility(classes) {
  if (!Array.isArray(classes)) return null;
  const caster = classes.find((cls) => cls.definition?.canCastSpells) || classes[0];
  if (!caster) return null;
  return ABILITIES.find((entry) => entry.id === caster.definition?.spellCastingAbilityId) || null;
}

function determineFightingStyle(feats) {
  if (!Array.isArray(feats)) return null;
  const fightingStyles = new Set([
    'archery',
    'blind fighting',
    'defense',
    'dueling',
    'great weapon fighting',
    'interception',
    'protection',
    'superior technique',
    'thrown weapon fighting',
    'two-weapon fighting',
  ]);

  const match = feats.find((feat) => {
    const name = feat?.definition?.name || feat?.name;
    if (!name) return false;
    return fightingStyles.has(name.toLowerCase());
  });

  return match || null;
}

function determineSize(rawCharacter) {
  if (!rawCharacter) return null;
  const modifiers = getActiveModifiers(rawCharacter);
  const sizeModifier = Array.isArray(modifiers)
    ? modifiers.find((modifier) => (modifier.type || '').toLowerCase() === 'size' && modifier.subType)
    : null;

  const candidates = [
    sizeModifier?.subType,
    sizeModifier?.fixedValue ?? sizeModifier?.value,
    rawCharacter.race?.sizeId,
    rawCharacter.race?.weightSpeeds?.sizeId,
    rawCharacter.race?.weightSpeeds?.size,
    rawCharacter.traits?.size,
  ].filter(Boolean);

  const match = candidates
    .map((entry) => (typeof entry === 'string' ? entry.toLowerCase() : entry))
    .map((candidate) =>
      SIZES.find(
        (size) =>
          size.id === candidate ||
          size.value === candidate ||
          (typeof candidate === 'string' && size.name.toLowerCase() === candidate)
      )
    )
    .find(Boolean);

  return match?.name || null;
}

function isWeaponProficient(definition, modifiers) {
  if (!definition) return false;
  const proficiencies = Array.isArray(modifiers)
    ? modifiers.filter((modifier) => modifier.type === 'proficiency').map((modifier) => (modifier.subType || '').toLowerCase())
    : [];

  const name = (definition.type || definition.name || '').toLowerCase();
  if (!name) return false;

  if (proficiencies.some((subtype) => subtype === name || subtype === `${name}-weapons`)) return true;

  const isSimple = WEAPONS.simple.some((weapon) => weapon.toLowerCase() === name);
  const isMartial = WEAPONS.martial.some((weapon) => weapon.toLowerCase() === name);
  const isRanged = WEAPONS.ranged.some((weapon) => weapon.toLowerCase() === name);

  if (isSimple && proficiencies.includes('simple-weapons')) return true;
  if (isMartial && proficiencies.includes('martial-weapons')) return true;
  if (isRanged && proficiencies.includes('martial-weapons')) return true;

  return false;
}

function formatSigned(value) {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value}`;
}

function formatActionDamage(dice) {
  if (!dice) return null;
  const base = typeof dice === 'string' ? dice : dice.diceString || '';
  return base || null;
}

function mapStats(statsArray) {
  if (!Array.isArray(statsArray)) return {};
  return statsArray.reduce((map, entry) => {
    const ability = ABILITIES.find((candidate) => candidate.id === entry.id);
    if (ability && typeof entry.value === 'number') {
      map[ability.name] = entry.value;
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

function getActiveModifiers(rawCharacter, options = {}) {
  if (!rawCharacter || typeof rawCharacter !== 'object') return [];
  const modifiers = rawCharacter.modifiers || {};
  const inventory = Array.isArray(rawCharacter.inventory) ? rawCharacter.inventory : [];
  const activeComponentIds = new Set();
  const respectIsGranted = Boolean(options.respectIsGranted);

  inventory.forEach((item) => {
    const defId = item.definition?.id;
    if (!defId) return;
    const requiresAttunement = Boolean(item.definition?.canAttune);
    const attuned = !requiresAttunement || item.isAttuned;
    const equippable = Boolean(item.definition?.canEquip);
    const equipped = equippable ? item.equipped : true;
    const usable = equipped && attuned;

    if (usable) {
      activeComponentIds.add(defId);
    }
  });

  return Object.entries(modifiers).reduce((all, [group, entries]) => {
    if (!Array.isArray(entries)) return all;
    entries.forEach((modifier) => {
      if (group === 'item' && !activeComponentIds.has(modifier.componentId)) return;
      if (respectIsGranted && modifier.isGranted === false) return;
      all.push(modifier);
    });
    return all;
  }, []);
}

function collectModifiers(modifiers, subtype, type) {
  if (!Array.isArray(modifiers)) return 0;
  const subtypes = Array.isArray(subtype) ? subtype.filter(Boolean) : [subtype];
  const normalized = subtypes.map((entry) => (entry || '').toLowerCase()).filter(Boolean);
  if (!normalized.length) return 0;

  const types = Array.isArray(type)
    ? type.map((entry) => (entry || '').toLowerCase()).filter(Boolean)
    : type
    ? [(type || '').toLowerCase()]
    : [];

  return modifiers
    .filter((modifier) => {
      if (types.length && !types.includes((modifier.type || '').toLowerCase())) return false;
      const modSubtype = (modifier.subType || '').toLowerCase();
      const cleanedSubtype = modSubtype.startsWith('skill-') ? modSubtype.slice(6) : modSubtype;
      return normalized.includes(modSubtype) || normalized.includes(cleanedSubtype);
    })
    .reduce((total, modifier) => total + (modifier.fixedValue ?? modifier.value ?? 0), 0);
}

function collectMaxModifier(modifiers, subtype, type) {
  if (!Array.isArray(modifiers)) return 0;
  const subtypes = Array.isArray(subtype) ? subtype.filter(Boolean) : [subtype];
  const normalized = subtypes.map((entry) => (entry || '').toLowerCase()).filter(Boolean);
  if (!normalized.length) return 0;

  const types = Array.isArray(type)
    ? type.map((entry) => (entry || '').toLowerCase()).filter(Boolean)
    : type
    ? [(type || '').toLowerCase()]
    : [];

  return modifiers
    .filter((modifier) => {
      if (types.length && !types.includes((modifier.type || '').toLowerCase())) return false;
      const modSubtype = (modifier.subType || '').toLowerCase();
      const cleanedSubtype = modSubtype.startsWith('skill-') ? modSubtype.slice(6) : modSubtype;
      return normalized.includes(modSubtype) || normalized.includes(cleanedSubtype);
    })
    .reduce((max, modifier) => Math.max(max, modifier.fixedValue ?? modifier.value ?? 0), 0);
}

function collectGeneralSavingThrowBonus(modifiers) {
  if (!Array.isArray(modifiers)) return 0;
  const abilitySubtypes = new Set(Object.values(SAVING_THROW_SUBTYPES));
  const abilityNames = ABILITIES.map((ability) => ability.friendlyName.toLowerCase());
  const shortNames = ABILITIES.map((ability) => ability.shortName.toLowerCase());
  return modifiers
    .filter((modifier) => (modifier.type || '').toLowerCase() === 'bonus')
    .filter((modifier) => {
      const subtype = (modifier.subType || '').toLowerCase();
      const friendlySubtype = (modifier.friendlySubtypeName || '').toLowerCase();
      const restriction = (modifier.restriction || '').toLowerCase();
      const matchesSaving =
        subtype === 'saving-throws' ||
        subtype.includes('saving') ||
        friendlySubtype.includes('saving throw') ||
        restriction.includes('saving throw');
      if (!matchesSaving) return false;

      const abilityFriendly = abilityNames.some((name) => friendlySubtype.includes(name));
      const abilityShort = shortNames.some((short) => friendlySubtype.includes(short));
      return !abilitySubtypes.has(subtype) && !abilityFriendly && !abilityShort;
    })
    .reduce((max, modifier) => Math.max(max, modifier.fixedValue ?? modifier.value ?? 0), 0);
}

function determineProficiencyLevel(modifiers, subtype) {
  if (!Array.isArray(modifiers)) return { level: 0, roundUp: false };
  const subtypes = Array.isArray(subtype) ? subtype.filter(Boolean) : [subtype];
  const normalized = subtypes.map((entry) => (entry || '').toLowerCase()).filter(Boolean);
  let level = 0;
  let roundUp = false;

  modifiers
    .filter((modifier) => {
      const modSubtype = (modifier.subType || '').toLowerCase();
      const cleanedSubtype = modSubtype.startsWith('skill-') ? modSubtype.slice(6) : modSubtype;
      return normalized.includes(modSubtype) || normalized.includes(cleanedSubtype);
    })
    .forEach((modifier) => {
      if (modifier.type === 'proficiency') level = Math.max(level, modifier.value ?? 1);
      if (modifier.type === 'expertise') level = Math.max(level, modifier.value ?? 2);
      if (modifier.type === 'half-proficiency') level = Math.max(level, modifier.value ?? 0.5);
      if (modifier.type === 'half-proficiency-round-up') {
        level = Math.max(level, modifier.value ?? 0.5);
        roundUp = true;
      }
    });
  return { level, roundUp };
}

function applyProficiency(level, proficiencyBonus, roundUp = false) {
  if (!level || !proficiencyBonus) return 0;
  if (level === PROFICIENCY_FULL || level === 1) return proficiencyBonus;
  if (level === PROFICIENCY_EXPERTISE || level === 2) return proficiencyBonus * 2;
  if (level === PROFICIENCY_HALF || level === 0.5) {
    const scaled = proficiencyBonus / 2;
    return roundUp ? Math.ceil(scaled) : Math.floor(scaled);
  }
  return Math.floor(proficiencyBonus * level);
}

function collectMaxSet(modifiers, subtype) {
  if (!Array.isArray(modifiers)) return 0;
  return modifiers
    .filter((modifier) => modifier.subType === subtype && ['set', 'set-base'].includes(modifier.type))
    .reduce((max, modifier) => Math.max(max, modifier.fixedValue ?? modifier.value ?? 0), 0);
}

function flattenActions(actions) {
  if (!actions || typeof actions !== 'object') return [];
  return Object.values(actions).reduce((all, group) => {
    if (Array.isArray(group)) all.push(...group);
    return all;
  }, []);
}

function getTotalLevel(classes) {
  if (!Array.isArray(classes)) return 0;
  return classes.reduce((total, cls) => total + (cls.level || 0), 0);
}

function getProficiencyBonus(totalLevel) {
  return totalLevel > 0 ? 2 + Math.floor((totalLevel - 1) / 4) : 0;
}

function ddbGetFromEndpoint(r_type, r_id, r_async) {
  let r_json;
  let r_proxy;
  let r_url;
  r_proxy = 'https://corsproxy.io/?url=';
  if (r_type == 'character') r_url = `${r_proxy}https://character-service.dndbeyond.com/character/v5/character/${r_id}`;
  if (r_type == 'monster') r_url = `${r_proxy}https://monster-service.dndbeyond.com/v1/Monster/${r_id}`;
  $.get({
    url: r_url,
    success: function (result) {
      r_json = result;
    },
    error: function (xhr) {
      console.log(xhr);
    },
    async: r_async || false,
  });
  return r_json;
}
