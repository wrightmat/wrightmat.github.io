// D&D Beyond character parser for Undercroft
// Architecture follows the declarative rules model described in PARSER.md.

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

const RULES = [
  { section: 'identity', from: ['id', 'username', 'name', 'classes', 'race', 'alignmentId'], handler: buildIdentity },
  { section: 'alignment', from: ['alignmentId'], handler: buildAlignment },
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
  { section: 'senses', from: ['stats', 'bonusStats', 'overrideStats', 'modifiers', 'classes'], handler: buildSenses },
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
  { section: 'pb', from: ['classes'], handler: buildProficiencyBonus },
  { section: 'background', from: ['background'], handler: buildBackground },
  { section: 'currencies', from: ['currencies'], handler: buildCurrencies },
  { section: 'feats', from: ['feats'], handler: buildFeats },
  { section: 'features', from: ['classes', 'race'], handler: buildFeatures },
  { section: 'proficiencies', from: ['modifiers'], handler: buildProficiencies },
  { section: 'attacking', from: ['modifiers', 'feats'], handler: buildAttacking },
  { section: 'attacks', from: ['actions', 'inventory', 'modifiers', 'classes', 'stats', 'bonusStats', 'overrideStats', 'spells'], handler: buildAttacks },
  { section: 'limitedUses', from: ['actions', 'features', 'feats'], handler: buildLimitedUses },
  { section: 'spellCasting', from: ['classes', 'spells', 'pactMagic', 'spellSlots'], handler: buildSpellcasting },
  { section: 'spells', from: ['spells'], handler: buildSpells },
  { section: 'inventory', from: ['inventory'], handler: buildInventory },
];

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

function buildIdentity(context, rawCharacter) {
  const classes = Array.isArray(context.classes) ? context.classes : [];
  const primaryClass = classes.find((cls) => cls.isStartingClass) || classes[0] || {};
  const className = primaryClass.definition?.name || '';
  const alignment = findAlignment(context.alignmentId);

  return {
    id: rawCharacter.id || null,
    username: rawCharacter.username || '',
    name: context.name || '',
    class: className,
    classes: classes.map((cls) => ({
      name: cls.definition?.name || 'Unknown Class',
      level: cls.level || 0,
      subclass: cls.subclassDefinition?.name || null,
    })),
    race: context.race || null,
    level: getTotalLevel(classes),
    alignment,
  };
}

function buildAlignment(context) {
  return findAlignment(context.alignmentId);
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
  const totalLevel = getTotalLevel(context.classes);
  const proficiencyBonus = getProficiencyBonus(totalLevel);

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

function buildInitiative(context, rawCharacter) {
  const modifiers = flattenModifiers(rawCharacter.modifiers);
  const abilityScores = calculateAbilityScores(context, modifiers);
  const totalLevel = getTotalLevel(context.classes);
  const proficiencyBonus = getProficiencyBonus(totalLevel);

  const dexModifier = Math.floor(((abilityScores.dexterity || 10) - 10) / 2);
  const proficiencyLevel = determineProficiencyLevel(modifiers, 'initiative');
  const bonus = collectModifiers(modifiers, 'initiative', 'bonus');

  const value = dexModifier + Math.floor(proficiencyBonus * proficiencyLevel) + bonus;
  const advantage = modifiers.some((modifier) => modifier.subType === 'initiative' && modifier.type === 'advantage');
  const disadvantage = modifiers.some((modifier) => modifier.subType === 'initiative' && modifier.type === 'disadvantage');

  return { value, advantage, disadvantage };
}

function buildSkills(context, rawCharacter) {
  const modifiers = flattenModifiers(rawCharacter.modifiers);
  const abilityScores = calculateAbilityScores(context, modifiers);
  const totalLevel = getTotalLevel(context.classes);
  const proficiencyBonus = getProficiencyBonus(totalLevel);

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

function buildSenses(context, rawCharacter) {
  const modifiers = flattenModifiers(rawCharacter.modifiers);
  const allowed = new Set(SENSES.map((sense) => sense.name));

  const senses = (Array.isArray(modifiers) ? modifiers : [])
    .filter((modifier) => modifier.subType && allowed.has(modifier.subType.toLowerCase()))
    .map((modifier) => {
      const normalized = modifier.subType.toLowerCase();
      const baseSense = SENSES.find((sense) => sense.name === normalized) || {
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

  const skills = buildSkills(context, rawCharacter);
  const lookup = skills.reduce((map, skill) => {
    map[skill.name] = skill.value;
    return map;
  }, {});

  return {
    senses: Object.values(deduped),
    passives: {
      perception: 10 + (lookup['perception'] || 0),
      investigation: 10 + (lookup['investigation'] || 0),
      insight: 10 + (lookup['insight'] || 0),
    },
  };
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

function buildSpeeds(context) {
  const modifiers = flattenModifiers(context.modifiers);
  const baseSpeeds = context.race?.weightSpeeds?.normal || {};

  return SPEEDS.reduce((speeds, speed) => {
    const innateSubtype = `innate-speed-${speed.innate}`;
    const base = baseSpeeds[speed.name] || 0;
    const innate = collectMaxSet(modifiers, innateSubtype);
    const bonus = collectModifiers(modifiers, `${speed.name}-speed`, 'bonus');
    speeds[speed.name] = Math.max(base, innate || 0) + bonus;
    return speeds;
  }, {});
}

function buildArmorClass(context, rawCharacter) {
  const modifiers = flattenModifiers(context.modifiers);
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
    if (/light/i.test(def.type) || def.armorTypeId === 1) return armorBase + dexMod;
    if (/medium/i.test(def.type) || def.armorTypeId === 2) return armorBase + Math.min(dexMod, 2);
    if (/heavy/i.test(def.type) || def.armorTypeId === 3) return armorBase;
    return armorBase + dexMod;
  });

  const naturalAc = 10 + dexMod;
  const calculated = Math.max(naturalAc, ...armorValues) + baseBonus + shieldBonus;
  return { value: calculated, shieldBonus, bonus: baseBonus };
}

function buildHitPoints(context, rawCharacter) {
  const modifiers = flattenModifiers(context.modifiers);
  const abilityScores = calculateAbilityScores(context, modifiers);
  const conMod = Math.floor(((abilityScores.constitution || 10) - 10) / 2);
  const totalLevel = getTotalLevel(context.classes);
  const perLevelBonus = collectModifiers(modifiers, 'hit-points-per-level', 'bonus');

  const base = context.overrideHitPoints || (context.baseHitPoints || 0) + (context.bonusHitPoints || 0);
  const damageTaken = context.removedHitPoints || 0;
  const temp = context.temporaryHitPoints || 0;
  const max = base + totalLevel * (conMod + perLevelBonus);
  const current = max - damageTaken + temp;
  return {
    max,
    current: current < 0 ? 0 : current,
    temp,
  };
}

function buildProficiencyBonus(context) {
  const totalLevel = getTotalLevel(context.classes);
  return getProficiencyBonus(totalLevel);
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

function buildProficiencies(context) {
  const profs = flattenModifiers(context.modifiers).filter((modifier) => modifier.type === 'proficiency');
  return profs.map((prof) => ({
    name: prof.friendlySubtypeName || prof.subType || 'Unknown',
    type: prof.friendlyTypeName || 'Proficiency',
  }));
}

function buildAttacks(context, rawCharacter) {
  const modifiers = flattenModifiers(rawCharacter.modifiers);
  const abilityScores = calculateAbilityScores(context, modifiers);
  const dexMod = Math.floor(((abilityScores.dexterity || 10) - 10) / 2);
  const strMod = Math.floor(((abilityScores.strength || 10) - 10) / 2);

  const spellNameSet = collectSpellNames(context.spells);
  const actions = flattenActions(context.actions).filter((action) => action.displayAsAttack);
  const filteredActions = actions.filter((action) => !spellNameSet.has((action.name || '').toLowerCase()));

  const equipmentAttacks = (context.inventory || []).filter((item) => item.equipped && item.definition?.attackType);
  const combined = [...filteredActions, ...equipmentAttacks.map((item) => item.definition)];

  const seen = new Set();
  const attacks = combined.reduce((list, action) => {
    const nameKey = (action.name || 'Attack').toLowerCase();
    if (seen.has(nameKey)) return list;
    seen.add(nameKey);

    const activation = ACTIVATIONS[action.activation?.type || 0] || '';
    const usesDex = action.attackSubtype === 3 || WEAPONS.ranged.includes(action.name || '');
    const abilityMod = usesDex ? dexMod : strMod;
    const attackBonus = (action.fixedToHit ?? action.value ?? 0) + abilityMod;

    list.push({
      name: action.name || 'Attack',
      type: action.actionType || action.attackType || 'action',
      activation,
      range: action.range || action.attackTypeRange || '',
      attackBonus,
      damage: action.dice || null,
      damageType: DAMAGES[action.damageTypeId || 0] || null,
      description: action.description || action.snippet || '',
    });
    return list;
  }, []);

  return attacks.reverse();
}

function buildAttacking(context) {
  const modifiers = flattenModifiers(context.modifiers);
  const extraAttacks = collectMaxSet(modifiers, 'extra-attacks');
  const fightingStyle = determineFightingStyle(context.feats);

  return {
    attacksPerAction: 1 + extraAttacks,
    fightingStyle,
  };
}

function buildFeatures(context) {
  const whitelist = new Set([
    'core ranger traits',
    'spellcasting',
    'favored enemy',
    'deft explorer',
    'dread ambusher',
    'gloom stalker spells',
    'umbral sight',
    'extra attack',
    'roving',
    'iron mind',
    'resourceful',
    'skillful',
    'skillfull',
    'versatile',
  ]);

  const classFeatures = (context.classes || [])
    .flatMap((cls) => cls.classFeatures || [])
    .map((feature) => feature.definition)
    .filter(Boolean)
    .filter((feature) => whitelist.has((feature.name || '').toLowerCase()));
  const racialTraits = (context.race?.racialTraits || [])
    .map((trait) => trait.definition)
    .filter(Boolean)
    .filter((feature) => whitelist.has((feature.name || '').toLowerCase()));

  const combined = [...classFeatures, ...racialTraits];
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
  return pools;
}

function buildSpellcasting(context) {
  const totalLevel = getTotalLevel(context.classes);
  const proficiencyBonus = getProficiencyBonus(totalLevel);
  return {
    spellSlots: context.spellSlots || [],
    pactMagic: context.pactMagic || null,
    proficiencyBonus,
  };
}

function buildSpells(context) {
  if (!context.spells || typeof context.spells !== 'object') return [];
  const buckets = ['class', 'race', 'item', 'feat'];
  const spells = [];
  buckets.forEach((bucket) => {
    const entries = context.spells[bucket];
    if (Array.isArray(entries)) {
      entries.forEach((spell) => {
        spells.push({
          name: spell.definition?.name || 'Unknown Spell',
          level: spell.definition?.level || 0,
          prepared: spell.prepared || false,
          castingTime: spell.definition?.activation?.activationTime || '',
          range: spell.definition?.range || '',
          components: (spell.definition?.components || []).map((comp) => COMPONENTS[comp] || comp),
          school: spell.definition?.school || '',
          source: bucket,
        });
      });
    }
  });
  return spells;
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

function findAlignment(alignmentId) {
  return ALIGNMENTS.find((entry) => entry.id === alignmentId) || null;
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

const parseDdbCharacter = ddbParseCharacter;
