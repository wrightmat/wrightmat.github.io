const debug = true;

// Common functions to access and parse D&D Beyond data
// good reference resource: https://github.com/kjbro/Roll20APIScripts/blob/master/BeyondImporter_5eOGL/BeyondImporter.js
// script to convert pdf into json: https://github.com/sonofwau/dndbeyond_to_json

const _ABILITIES = { 1:'STR', 2:'DEX', 3:'CON', 4:'INT', 5:'WIS', 6:'CHA' };
const _ABILITY = { 'STR': 'strength', 'DEX': 'dexterity', 'CON': 'constitution', 'INT': 'intelligence', 'WIS': 'wisdom', 'CHA': 'charisma' };
const activation = [ '', 'A', '', 'BA', 'R', 's', 'm', 'h', 'S' ]  // need to validate all of these entries
const alignment_descs = [ '', 'Lawful Good', 'Neutral Good', 'Chaotic Good', 'Lawful Neutral', 'Neutral', 'Chaotic Neutral', 'Lawful Evil', 'Neutral Evil', 'Chaotic Evil' ];
const alignment_names = [ '', 'LG', 'NG', 'CG', 'LN', 'N', 'CN', 'LE', 'NE', 'CE' ];
const components = [ '', 'V', 'S', 'M' ];
const conditions = [ '', 'Blinded', 'Charmed', 'Deafened', 'Exhausted', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious' ];
const damages = [ '', 'ddb-bludgeoning', 'ddb-piercing', 'ddb-slashing' ];
const durations = [ '', 'Short Rest', 'Long Rest' ];
const sizes = [ 'Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan' ];
const saves = [ { name: 'strength-saving-throws', friendlyName: 'Strength', shortName: 'STR', stat: 0, mod: 0 }, { name: 'dexterity-saving-throws', friendlyName: 'Dexterity', shortName: 'DEX', stat: 1, mod: 0 }, { name: 'constitution-saving-throws', friendlyName: 'Constitution', shortName: 'CON', stat: 2, mod: 0 }, { name: 'intelligence-saving-throws', friendlyName: 'Intelligence', shortName: 'INT', stat: 3, mod: 0 }, { name: 'wisdom-saving-throws', friendlyName: 'Wisdom', shortName: 'WIS', stat: 4, mod: 0 }, { name: 'charisma-saving-throws', friendlyName: 'Charisma', shortName: 'CHA', stat: 5, mod: 0 } ]
const skills = [ { name: 'acrobatics', friendlyName: 'Acrobatics', stat: 1, mod: 0 }, { name: 'animal-handling', friendlyName: 'Animal Handling', stat: 4, mod: 0 }, { name: 'arcana', friendlyName: 'Arcana', stat: 3, mod: 0 }, { name: 'athletics', friendlyName: 'Athletics', stat: 0, mod: 0 }, { name: 'deception', friendlyName: 'Deception', stat: 5, mod: 0 }, { name: 'history', friendlyName: 'History', stat: 3, mod: 0 }, { name: 'insight', friendlyName: 'Insight', stat: 4, mod: 0 }, { name: 'intimidation', friendlyName: 'Intimidation', stat: 5, mod: 0 }, { name: 'investigation', friendlyName: 'Investigation', stat: 3, mod: 0 }, { name: 'medicine', friendlyName: 'Medicine', stat: 4, mod: 0 }, { name: 'nature', friendlyName: 'Nature', stat: 3, mod: 0 }, { name: 'perception', friendlyName: 'Perception', stat: 4, mod: 0 }, { name: 'performance', friendlyName: 'Performance', stat: 5, mod: 0 }, { name: 'persuasion', friendlyName: 'Persuasion', stat: 5, mod: 0 }, { name: 'religion', friendlyName: 'Religion', stat: 3, mod: 0 }, { name: 'sleight-of-hand', friendlyName: 'Sleight of Hand', stat: 1, mod: 0 }, { name: 'stealth', friendlyName: 'Stealth', stat: 1, mod: 0 }, { name: 'survival', friendlyName: 'Survival', stat: 4, mod: 0 } ]
const weapons = { simple: [ 'Club', 'Dagger', 'Greatclub', 'Handaxe', 'Javelin', 'Light Hammer', 'Mace', 'Quarterstaff', 'Sickle', 'Spear', 'Crossbow, Light', 'Dart', 'Shortbow', 'Sling' ], martial: [ 'Battleaxe', 'Flail', 'Glaive', 'Greataxe', 'Greatsword', 'Halberd', 'Lance', 'Longsword', 'Maul', 'Morningstar', 'Pike', 'Rapier', 'Scimitar', 'Shortsword', 'Trident', 'War Pick', 'Warhammer', 'Whip', 'Blowgun', 'Crossbow, Hand', 'Crossbow, Heavy', 'Longbow', 'Net' ], melee: [ 'Club', 'Dagger', 'Greatclub', 'Handaxe', 'Javelin', 'Light hammer', 'Mace', 'Quarterstaff', 'Sickle', 'Spear', 'Battleaxe', 'Flail', 'Glaive', 'Greataxe', 'Greatsword', 'Halberd', 'Lance', 'Longsword', 'Maul', 'Morningstar', 'Pike', 'Rapier', 'Scimitar', 'Shortsword', 'Trident', 'War pick', 'Warhammer', 'Whip' ], ranged: [ 'Crossbow, light', 'Dart', 'Shortbow', 'Sling', 'Blowgun', 'Crossbow, hand', 'Crossbow, heavy', 'Longbow', 'Net' ] }

const silent_features = [
  'Age',
  'Alignment',
  'Spellcasting',
  'Feat',
  'Size',
  'Speed',
  'Skills',
  'Bonus Proficiency',
  'Ability Score Increases',
  'Ability Score Improvement',
  'Sage Ability Score Improvements',
  'Bonus Cantrip',
  'Proficiencies',
  'Hit Points',
  'Pact Magic',
  'Expanded Spell List',
  'Druidic',
  'Expertise',
  'Oath Spells',
  'Languages',
  'Darkvision',
  'Superior Darkvision',
  'Ability Score Increase',
  'Creature Type',
  'Skill Versatility',
  'Dwarven Combat Training',
  'Keen Senses',
  'Elf Weapon Training',
  'Extra Language',
  'Tool Proficiency',
  'Core Fighter Traits'
]

const passthrough_keys = {
  'traits': '',
  'age': 'traits',
  'background': '',
  'campaign': '',
  'currencies': '',
  'deathSaves': '',
  'decorations': '',
  'eyes': 'traits',
  'faith': 'traits',
  'gender': 'traits',
  'hair': 'traits',
  'height': 'traits',
  'id': 'ids',
  'inspiration': '',
  'lifestyle': 'traits',
  'name': '',
  'notes': '',
  'race': '',
  'skin': 'traits',
  'userId': 'ids',
  'username': 'ids',
  'weight': 'traits'
}

const 
  PROFICIENCY_NONE = 0,
  PROFICIENCY_HALF = 1,
  PROFICIENCY_HALF_ROUND_UP = 2,
  PROFICIENCY_FULL = 3,
  PROFICIENCY_EXPERTISE = 4;


const originalConsoleLog = console.log;
console.log = function( message ) {
  if ( debug ) originalConsoleLog(message);
};

const combineObjects = ( obj1, obj2 ) => {
  let result = {};
  for ( let key in obj1 ) { result[key] = obj1[key]; }
  for ( let key in obj2 ) { result.hasOwnProperty(key) ? typeof result[key] == 'number' ? result[key] += obj2[key] : result[key] = obj2[key] : result[key] = obj2[key]; }
  return result;
};

// return an array of objects according to key, value, or key and value matching, optionally ignoring objects in array of names
const getObjects = ( obj, key, val, except ) => {
  except = except || [];
  let objects = [];
  for ( let i in obj ) {
    if ( !obj.hasOwnProperty(i) ) continue;
    if ( typeof obj[i] == 'object' ) {
      if ( except.indexOf(i) != -1 ) { continue; }
      objects = objects.concat(getObjects(obj[i], key, val));
    } else if ( i == key && obj[i] == val || i == key && val == '' ) {
      // if key matches and value matches or if key matches and value is not passed (eliminating the case where key matches but passed value does not)
      objects.push(obj);
    } else if ( obj[i] == val && key == '' ) {
      // only add if the object is not already in the array
      if ( objects.lastIndexOf(obj) == -1 ) { objects.push(obj); }
    }
  }
  return objects;
};

const getMaxObject = ( array, attr, limit ) => {
  let max = -Infinity;
  array.forEach(obj => { if ( obj[attr] > max && obj[attr] <= limit ) { max = obj[attr]; } });
  var obj = {}; obj = array.find( o => o.level == max );
  return obj;
};

const getPactMagicSlots = (level) => {
  switch (level) {
    case 1:
      return 1;
      break;
    case 2: case 3: case 4: case 5: case 6: case 7: case 8: case 9: case 10:
      return 2;
      break;
    case 11: case 12: case 13: case 14: case 15: case 16:
      return 3;
      break;
    default:
      return 4
      break;
  }
  return 0;
};

function updateStrVal( val ) {
  val >= 0 ? valStr = "+" + val : valStr = "" + val;
  return valStr;
}


function ddbGetCharacter( r_id, r_async ) {
  // Run through proxy to avoid CORS errors
  var r_json, r_proxy;
  r_proxy = "https://corsproxy.io/?url="
  $.get({
    url: r_proxy + "https://character-service.dndbeyond.com/character/v5/character/" + r_id,
    success: function(result) { r_json = result },
    error: function(xhr, error) { console.log(xhr) },
    async: r_async || false
  });
  return r_json;
}


function ddbParseCharacter( character ) {

  const getAbilityScore = ( character, scoreId ) => {
    let index = scoreId - 1;
    let base = ( character.stats[index].value == null ? 10 : character.stats[index].value ),
      bonus = (character.bonusStats[index].value == null ? 0 : character.bonusStats[index].value),
      override = (character.overrideStats[index].value == null ? 0 : character.overrideStats[index].value),
      total = base + bonus,
      modifiers = getObjects(character, '', _ABILITY[_ABILITIES[scoreId]] + "-score");
    if ( override > 0 ) total = override;
    if ( modifiers.length > 0 ) {
      let used_ids = [];
      for ( let i = 0; i < modifiers.length; i++ ) {
        if ( modifiers[i].type == 'bonus' && used_ids.indexOf(modifiers[i].id) == -1 ) {
          total += modifiers[i].value;
          used_ids.push(modifiers[i].id);
        }
      }
    }
    return total;
  };

  const loadHitPoints = ( character, total_level ) => {
    let hp = Math.floor(character.baseHitPoints + ( total_level * Math.floor( ( ( character.stats[2].value - 10 ) / 2 ) ) ) );
    // scan for modifiers except those in items, because we will get those bonuses from the items once they are imported
    // NOTE: this also handles the problem that Beyond includes modifiers from items that are not currently equipped/attuned
    let hpLevelBonus = getObjects(character.modifiers, 'subType', 'hit-points-per-level', ['item']).forEach((bonus) => {
      let level = total_level;
      // Ensure that per-level bonuses from class features only apply for the levels of the class and not the character's total level.
      let charClasses = character.classes.filter((charClass) => {
        let output = charClass.definition.classFeatures.findIndex(cF => cF.id == bonus.componentId) >= 0;
        if ( charClass.subclassDefinition != null ) { output = output || charClass.subclassDefinition.classFeatures.findIndex(cF => cF.id == bonus.componentId) >= 0; }
        return output;
      });
      if ( charClasses.length > 0 ) {
        level = 0;
        charClasses.forEach((charClass) => { level += parseInt(charClass.level); });
      }
      hp += level * bonus.value;
    });
    return hp;
  };

  const updateProficiency = ( character, prof, level ) => {
    // Saving Throws
    if ( prof.subType.includes('-saving-throws') ) {
      character.proficiencies.saves.push(prof);
      let save = getObjects(character.saves, 'name', prof.subType)[0];
      save.mod += character.pb.value; save.str = updateStrVal(save.mod);
      save.proficiency = level;
    // Skills
    } else if ( prof.entityTypeId == 1958004211 ) {
      character.proficiencies.skills.push(prof);
      let skill = getObjects(character.skills, 'name', prof.subType)[0];
      skill.mod += character.pb.value; skill.str = updateStrVal(skill.mod);
      skill.proficiency = level;
    // Scores
    } else if ( prof.entityTypeId == 1472902489 ) {
      character.proficiencies.scores.push(prof);
    // Weapons
    } else if ( prof.entityTypeId == 1782728300 || prof.subType.includes('weapons') ) {
      character.proficiencies.weapons.push(prof);
    // Armor
    } else if ( prof.entityTypeId == 174869515 ) {
      character.proficiencies.armor.push(prof);
    // Scores
    } else if ( prof.entityTypeId == 1472902489 ) {
      character.proficiencies.scores.push(prof);
    // Tools
    } else if ( prof.entityTypeId == 2103445194 ) {
      character.proficiencies.tools.push(prof);
    // Defenses
    } else if ( prof.entityTypeId == 349597128 || prof.type == 'immunity' ) {
      character.proficiencies.defenses.push(prof);
    // Languages
    } else if ( prof.entityTypeId == 906033267 ) {
      if ( getObjects(character.proficiencies.languages, 'subType', prof.subType).length == 0 ) character.proficiencies.languages.push(prof);
    // Senses
    } else if ( prof.entityTypeId == 668550506 ) {
      if ( getObjects(character.proficiencies.senses, 'id', prof.id).length == 0 ) character.proficiencies.senses.push(prof);
    } else {
      character.proficiencies.other.push(prof);
      let attacks = getObjects(character, 'subType', 'extra-attacks');
      if ( attacks.isGranted ) { character.attacking.attacksPerAction += attacks.fixedValue || 1; }
    }
  };

  function parseSpell( character, spell ) {
    spell.effect = {};
    if ( !character.spells[spell.definition.level] ) character.spells[spell.definition.level] = [];
    spell.definition.activation.activationTime >= 1 ? spell.time = spell.definition.activation.activationTime : spell.time = '';
    spell.time += activation[spell.definition.activation.activationType];

    var dmg = getObjects(spell.definition.modifiers, 'type', 'damage')[0];
    var dmg_bonus = getObjects(character.proficiencies, 'friendlyTypeName', spell.definition.name)[0];
    var heal = getObjects(spell.definition.modifiers, 'subType', 'hit-points')[0];

    if ( dmg && dmg.atHigherLevels ) {
      dmgHigherLevel = getMaxObject( dmg.atHigherLevels.higherLevelDefinitions, 'level', character.level );
      if ( dmgHigherLevel ) dmg.die = dmgHigherLevel.dice;
    }

    if ( spell.definition.requiresAttackRoll == true ) {
      if ( dmg && dmg.die ) {
        if ( dmg.die.diceString ) spell.effect.value = dmg.die.diceString.replaceAll(' ', '');
        if ( dmg.usePrimaryStat == true ) spell.effect.value = character.spellCasting.mod;
        if ( dmg_bonus ) spell.effect.value += character.stats[dmg_bonus.statId - 1].str;
        spell.effect.icon = 'ddb-' + dmg.subType;
      }
      if ( spell.definition.asPartOfWeaponAttack == true ) { spell.hit = '-'; }
      else if ( !character.spellCasting.attack ) { spell.hit = character.stats[0].mod + character.pb.value; spell.hit = updateStrVal( spell.hit ); }
      else { spell.hit = character.spellCasting.attack; }
    } else if ( spell.definition.requiresSavingThrow == true ) {
      if ( dmg && dmg.die ) {
        spell.effect.value = dmg.die.diceString.replaceAll(' ', '');
        spell.effect.icon = 'ddb-' + dmg.subType;
      } else {
        spell.effect.value = spell.definition.tags[0];
        spell.effect.icon = '';
      }
      spell.hit = saves[spell.definition.saveDcAbilityId - 1].shortName + ( spell.overrideSaveDc || character.spellCasting.save || 8 + character.pb.value );
    } else {
      if ( dmg && dmg.die ) {
        spell.effect.value = dmg.die.diceString.replaceAll(' ', '');
        spell.effect.icon = 'ddb-' + dmg.subType;
      } else if ( heal && heal.die ) {
        spell.effect.value = heal.die.diceString.replaceAll(' ', '');
        if ( heal.usePrimaryStat == true ) spell.effect.value += character.spellCasting.mod;
        spell.effect.icon = 'ddb-healing';
      } else {
        spell.effect.value = spell.definition.tags[0];
        spell.effect.icon = '';
      }
      spell.hit = '-';
    }
    spell.range = []; spell.range.value = ''; spell.range.origin = ''; spell.range.aoe = ''; spell.range.aoe_icon = '';
    if ( spell.definition.range ) {
      spell.definition.range.rangeValue > 0 ? spell.range.value = spell.definition.range.rangeValue + ' ft.' : spell.range.value = spell.definition.range.origin;
      if ( spell.definition.range.aoeType ) {
        if ( spell.definition.range.aoeValue > 0 ) { spell.range.aoe = spell.definition.range.aoeValue + ' ft.'; spell.range.aoe_icon = 'ddb-' + spell.definition.range.aoeType.toLowerCase(); }
      }
    }
    spell.icon = ''; spell.icon_school = '';
    if ( spell.definition.concentration == true ) { spell.icon = 'ddb-concentration'; } else if ( spell.definition.ritual == true ) { spell.icon = 'ddb-ritual'; }
    if ( spell.definition.school ) spell.icon_school = 'ddb-' + spell.definition.school.toLowerCase();

    var comp = [];
    for ( let i = 0; i < spell.definition.components.length; i++ ) { comp.push(components[spell.definition.components[i]]); }
    spell.notes = comp.join('/');
    if ( spell.definition.duration.durationInterval > 0 ) {
      var dur = 'D: ' + spell.definition.duration.durationInterval;
      if ( spell.definition.duration.durationUnit == 'Minute' ) { dur += 'm' }
      else if ( spell.definition.duration.durationUnit == 'Hour' ) { dur += 'h' }
      else { dur += spell.definition.duration.durationUnit; }
      spell.notes += ', ' + dur;
    }
    return spell;
  };

  function parseTags( character, text, feat ) {
    return text.replace(/\{\{(\w+)(?::([^}]+))?\}\}/g, ( match, tag, options ) => {
      switch ( tag ) {
        case "modifier":
          return processModifier(options, character);
        case "scalevalue":
          return processScaleValue(feat);
        case "proficiency":
          return character.pb.value;
        default:
          return match; // Return unchanged if tag is unknown
      }
    });

    function processModifier( options, char ) {
      const [stat, ...modifiers] = options.split(/[@#]/); // Extract base stat and options
      let index = Object.keys(_ABILITIES).find(key => _ABILITIES[key] === stat.toUpperCase()) - 1;
      if ( !index ) return `{{modifier:${options}}}`; // Fail gracefully if invalid stat
      let value = character.stats[index].mod; // Default to mod value
      let minValue = null; let unsigned = false;
      modifiers.forEach( option => {
        if ( option.startsWith("min:") ) minValue = parseInt(option.split(":")[1], 10);
        if ( option === "unsigned" ) unsigned = true;
      });
      if (minValue !== null) value = Math.max(value, minValue);
      if ( !unsigned && value >= 0 ) value = `+${value}`;

      return value;
    };

    function processScaleValue( feat ) {
      if ( feat.levelScale.fixedValue ) {
        return feat.levelScale.fixedValue;
      } else if ( feat.levelScale.dice && feat.levelScale.dice.diceString ) {
        return feat.levelScale.dice.diceString;
      }
      return "{{scalevalue}}"; // Fail gracefully if no valid value
    };
  };

  let char = {};
  let jack_feature;    // jack of all trades feature in input, or undefined
  let weapon_critical_range = 20;
  let critical_range = 20;
  char.attacking = {}; char.attacking.attacksPerAction = 1;
  char.spellCasting = {};

  // Pass Throughs
  for ( var key of Object.keys(passthrough_keys) ) {
    if ( passthrough_keys[key] !== '' && !(passthrough_keys[key] in char) ) char[passthrough_keys[key]] = {};
    passthrough_keys[key] !== '' ? char[passthrough_keys[key]][key] = character[key] : char[key] = character[key];
  }


  // Alignment
  char.alignment = {};
  char.alignment.id = character.alignmentId;
  char.alignment.description = alignment_descs[character.alignmentId];
  char.alignment.name = alignment_names[character.alignmentId];


  // Stats and Modifiers
  char.stats = character.stats;
  char.stats.forEach((stat, si) => {
    stat.name = _ABILITIES[si + 1];
    stat.value = getAbilityScore(character, stat.id);
    stat.mod = Math.floor((stat.value - 10) / 2);
    stat.str = updateStrVal(stat.mod, stat.str);
  })

  // Levels, Classes, and Subclasses
  char.classes = []; char.subclasses = [];
  char.level = 0; char.level_monk = 0; char.level_multiclass = 0;
  if ( character.classes && ( character.classes.length > 0 ) ) {
    character.classes.forEach((cls, ci) => {
      char.level += cls.level;
      if ( cls.definition.name.toLowerCase() == 'monk') char.level_monk = cls.level;
      if ( cls.definition.name.toLowerCase() == 'warlock' ) char.spellCasting.pactMagic = getPactMagicSlots(cls.level);
      if ( !cls.isStartingClass ) char.level_multiclass = cls.level;
      if ( !char.classes.includes(cls.definition.name) ) char.classes.push(cls);
      if ( cls.subclassDefinition && !char.subclasses.includes(cls.subclassDefinition.name) ) char.subclasses.push(cls.subclassDefinition);
    });
  }


  // Saves and Skills
  char.saves = saves; char.skills = skills;
  char.saves.forEach((save, si) => {
    save.mod = char.stats[save.stat].mod;
    save.str = updateStrVal(save.mod);
  });
  char.skills.forEach((skill, si) => {
    skill.mod = char.stats[skill.stat].mod;
    skill.str = updateStrVal(skill.mod);
  });


  // Proficiency Bonus
  char.pb = {};
  char.pb.value = Math.ceil(char.level / 4) + 1;
  char.pb.str = updateStrVal(char.pb.value);


  // Features & Traits
  char.feats = [];
  character.feats.forEach((feat, fi) => {
    if ( !silent_features.includes(feat.definition.name) ) { char.feats.push(feat); }
  });
  character.classes.forEach((cls, ci) => {
    cls.classFeatures.forEach((feat, fi) => {
      if ( !feat.definition.requiredLevel || ( feat.definition.requiredLevel && char.level >= feat.definition.requiredLevel ) ) {
	if ( feat.definition.hideInSheet == false && !silent_features.includes(feat.definition.name) ) char.feats.push(feat);
      }
      if ( feat.definition.name.includes('Jack of All Trades') ) { jack_feature = feat; }
    })
  });
  character.race.racialTraits.forEach((feat, fi) => {
    if ( !feat.definition.requiredLevel || ( feat.definition.requiredLevel && char.level >= feat.definition.requiredLevel ) ) {
      if ( feat.definition.hideInSheet == false && !silent_features.includes(feat.definition.name) ) char.feats.push(feat);
    }
  });
  char.feats.forEach((feat, fi) => {
    var act = getObjects(character.actions, 'componentId', feat.definition.id)[0];
    if ( feat.definition.snippet ) feat.definition.snippet = parseTags( char, feat.definition.snippet, feat );
    if ( act && act.limitedUse ) {
      feat.definition.limitedUse = act.limitedUse;
      feat.limitedUse = {}; feat.limitedUse.str = '';
      feat.limitedUse.maxUses = act.limitedUse.maxUses || ( act.limitedUse.useProficiencyBonus == true ? act.limitedUse.proficiencyBonusOperator + act.limitedUse.operator : act.limitedUse.operator );
      for ( let i = 0; i < feat.limitedUse.maxUses; i++ ) { feat.limitedUse.str += '[ &nbsp; ] '; }
      feat.limitedUse.str += '/ ' + durations[act.limitedUse.resetType];
      feat.limitedUse.reset = durations[act.limitedUse.resetType];
    }
  });


  // Proficiencies
  char.proficiencies = {};
  char.proficiencies.saves = []; char.proficiencies.skills = []; char.proficiencies.scores = [];
  char.proficiencies.armor = []; char.proficiencies.weapons = []; char.proficiencies.tools = [];
  char.proficiencies.languages = []; char.proficiencies.defenses = []; char.proficiencies.senses = []; char.proficiencies.other = [];
  for ( let half_proficiency of getObjects(character.modifiers, 'type', 'half-proficiency') ) {
    if ( (jack_feature !== undefined) && (half_proficiency.componentId === jack_feature.id) && (half_proficiency.componentTypeId === 12168134) ) {
      continue;	// filter out all jack of all trade mods
    }
    updateProficiency(char, half_proficiency, PROFICIENCY_HALF);
  }
  for ( let half_proficiency_round_up of getObjects(character.modifiers, 'type', 'half-proficiency-round-up') ) {
    updateProficiency(char, half_proficiency_round_up, PROFICIENCY_HALF_ROUND_UP);
  }
  for ( let proficiency of getObjects(character.modifiers, 'type', 'proficiency') ) {
    updateProficiency(char, proficiency, PROFICIENCY_FULL);
  }
  for ( let expertise of getObjects(character.modifiers, 'type', 'expertise') ) {
    updateProficiency(char, expertise, PROFICIENCY_EXPERTISE);
  }
  for ( let adv of getObjects(character, 'type', 'advantage') ) { updateProficiency(char, adv, PROFICIENCY_NONE); }
  for ( let bonus of getObjects(character, 'type', 'bonus') ) { updateProficiency(char, bonus, PROFICIENCY_NONE); }
  for ( let bonus of getObjects(character, 'subType', 'bonus-damage') ) { updateProficiency(char, bonus, PROFICIENCY_NONE); }
  for ( let def of getObjects(character, 'type', 'immunity') ) { updateProficiency(char, def, PROFICIENCY_NONE); }
  for ( let def of getObjects(character, 'type', 'resistance') ) { updateProficiency(char, def, PROFICIENCY_NONE); }
  for ( let lang of getObjects(character, 'type', 'language') ) { updateProficiency(char, lang, PROFICIENCY_NONE); }
  for ( let sense of getObjects(character, 'type', 'sense') ) { updateProficiency(char, sense, PROFICIENCY_NONE); }
  for ( let sense of getObjects(character, 'subType', 'darkvision') ) { updateProficiency(char, sense, PROFICIENCY_NONE); }
  var dv = getObjects(character, 'subType', 'darkvision');	// REVISIT: there has to be a better and more general way to combine multiple proficiency values!
  if ( dv.length > 1 ) {
    var dvTotal = combineObjects(dv[0], dv[1]);
    char.proficiencies.senses = char.proficiencies.senses.filter(function(el) { return el.subType != 'darkvision' });
    char.proficiencies.senses.push(dvTotal);
  }


  // Inventory
  char.ac = {}; char.ac.value = 0;
  char.attacks = []; let prevAdded = [];
  char.inventory = character.inventory;
  let hasArmor = false; let shieldEquipped = false;
  if ( character.inventory ) {
    let fightingStylesSelected = new Set()
    let fightingStyles = getObjects(character.classes, 'name', 'Fighting Style');

    character.inventory.forEach((item, i) => {
      let paIndex = prevAdded.filter((pAdded) => { return pAdded == item.definition.name; }).length;
      prevAdded.push(item.definition.name);

      item.weight = []; var notes = [];
      item.name = item.definition.name; item.description = item.definition.description; item.cost = item.definition.cost;
      if ( item.definition.weight == 0 ) { item.weight.value = 0; item.weight.str = '-'; } else { item.weight.value = item.definition.weight; item.weight.str = item.definition.weight + ' lb.'; }
      if ( item.definition.armorClass ) notes.push('AC: ' + item.definition.armorClass);
      if ( item.definition.properties ) item.definition.properties.forEach((prop) => { notes.push(prop.name); });
      if ( notes.length == 0 ) notes = item.definition.tags; item.notes = notes.join(', ');

      if ( item.equipped == true ) {
        if ( item.definition.type == 'Shield' ) shieldEquipped = true;
        if ( item.definition.stealthCheck == 2 ) char.skills[16].icon = 'ddb-disadvantage';  // REVISIT: is a value of 1 here anything? advantage?
        item.definition.grantedModifiers.forEach((grantedMod) => {
          if ( grantedMod.type == 'bonus' && grantedMod.subType == 'saving-throws' ) {
	    char.saves.forEach((save) => { save.mod += grantedMod.fixedValue; save.str = updateStrVal(save.mod); });
	  }
        });
      }

      if ( item.definition.damage && item.definition.type !== 'Ammunition' ) {
        let properties = ''; let versatileDice = '';
        let finesse = false; let versatile = false;
        let twohanded = false; let isOffhand = false;
        let ranged = false; let hasOffhand = false;

        let isSimple = weapons.simple.includes(item.definition.type);
        let isMartial = weapons.martial.includes(item.definition.type);
        if ( isSimple ) properties += 'Simple, ';
	if ( isMartial ) properties += 'Martial, ';

        item.definition.properties.forEach((prop) => {
          if ( prop.name == 'Two-Handed' ) twohanded = true; 
          if ( prop.name == 'Range' ) ranged = true;
          if ( prop.name == 'Finesse' ) finesse = true;
          if ( prop.name == 'Versatile' ) versatile = true; versatileDice = prop.notes;
          properties += prop.name + ', ';
        });

        let cv = getObjects(character.characterValues, 'valueTypeId', item.entityTypeId);
        cv.forEach((v) => {
          if ( v.typeId == 18 && v.value === true ) { hasOffhand = true; if( v.valueId == item.id ) isOffhand = true; }
        });

        let magic = 0;
        item.definition.grantedModifiers.forEach((grantedMod) => {
          if ( grantedMod.type == 'bonus' && grantedMod.subType == 'magic' ) magic += grantedMod.value;
        });

        // Finesse Weapon (Dexterity-based)
        let isFinesse = item.definition.properties.filter((property) => { return property.name == 'Finesse'; }).length > 0;
        if ( isFinesse && getAbilityScore(character, 2) > getAbilityScore(character, item.definition.attackType) ) item.definition.attackType = 2;

        // Pact Blade or Hexblade's Weapon (Charisma-based)
        let characterValues = getObjects(character.characterValues, 'valueId', item.id);
        characterValues.forEach((cv) => {
          if ( cv.value == true && ( cv.typeId == 28 || cv.typeId == 29 ) ) {
	    if ( getAbilityScore(character, 6) >= getAbilityScore(character, item.definition.attackType) ) item.definition.attackType = 6;
	  }
        });

        let gwf = false; let hasTWFS = false; let atkmod = 0; let dmgmod = 0;
        fightingStyles.forEach((fightingStyle) => {  // process each fighting style only once
          if ( fightingStyle == 'Great Weapon Fighting' && twohanded && (!ranged) ) gwf = true;
          if ( fightingStyle == 'Archery' && ranged ) atkmod += 2;
          if ( fightingStyle== 'Dueling' && !(hasOffhand || ranged || twohanded) ) dmgmod += 2;
          if ( fightingStyle == 'Two-Weapon Fighting' ) hasTWFS = true;
        });
        if ( versatile && !(hasOffhand || shieldEquipped) ) { item.definition.damage.diceString = versatileDice; }
        if ( item.definition.isMonkWeapon && char.level_monk > 0 ) {
          let itemAvgDmg = 0;
          if ( item.definition.damage ) {
            let dS = item.definition.damage.diceString;
            let itemDieCount = parseInt(dS.substr(0, dS.indexOf('d')));
            let itemDieSize = parseInt(dS.substr(dS.indexOf('d')+1));
            itemAvgDmg = (itemDieCount * (itemDieSize + 1)) / 2;
          }
          let monkDieSize = Math.floor((char.level_monk - 1) / 4) * 2 + 4;
          let monkAvgDmg = (1 + monkDieSize) / 2;
          if ( monkAvgDmg > itemAvgDmg ) { item.definition.damage.diceString = '1d' + monkDieSize; }
          if ( getAbilityScore(character, 2) > getAbilityScore(character, 1) ) { item.definition.attackType = 2; }
        }
        let dmgattr = _ABILITY[_ABILITIES[item.definition.attackType]];
        if ( !hasTWFS && isOffhand ) dmgattr = '0';

        // Attacks
        item.damage = []; item.hit = [];
	if ( item.definition.damage && item.definition.damage.diceString == null && item.definition.damage.diceValue ) {
	  item.definition.damage.diceString = item.definition.damage.diceCount + 'd' + item.definition.damage.diceValue;
	}
	var hitBonusRanged = getObjects(char.proficiencies, 'subType', 'ranged-weapon-attacks')[0];
	var hitBonusMelee = getObjects(char.proficiencies, 'subType', 'melee-weapon-attacks')[0];
        item.hit.value = char.stats[item.definition.attackType - 1].mod;
        if ( ranged && hitBonusRanged ) item.hit.value += hitBonusRanged.value;
        if ( !ranged && hitBonusMelee ) item.hit.value += hitBonusMelee.value;
	item.damage.mod = char.stats[item.definition.attackType - 1].mod;
        item.damage.mod >= 0 ? item.damage.str = item.definition.damage.diceString + '+' + item.damage.mod : item.damage.str = item.definition.damage.diceString + item.damage.mod;
        item.damage.icon = 'ddb-' + item.definition.damageType.toLowerCase();
        var prof = getObjects(char.proficiencies.weapons, 'friendlySubtypeName', item.definition.type);
        var profSimple = getObjects(char.proficiencies.weapons, 'subType', 'simple-weapons');
	var profMartial = getObjects(char.proficiencies.weapons, 'subType', 'martial-weapons');
        if ( prof || ( isSimple && profSimple ) || ( isMartial && profMartial ) ) {
	  item.hit.value = Number(item.hit.value) + Number(char.pb.value);
          item.hit.str = updateStrVal(item.hit.value);
	}
        item.range = []; item.range.range = item.definition.range; item.range.longRange = item.definition.longRange;
	item.definition.range !== item.definition.longRange ? item.range.str = item.definition.range + ' (' + item.definition.longRange + ')' : item.range.str = item.definition.range + ' ft.';
	item.notes = properties.slice(0, -2);

        item.definition.grantedModifiers.forEach((grantedMod) => {
          if ( grantedMod.type == 'damage' && grantedMod.dice ) {
            item.damage2 = {
              diceString: grantedMod.dice.diceString,
              type: grantedMod.friendlySubtypeName,
              attribute: grantedMod.statId == null ? '0' : _ABILITY[_ABILITIES[grantedMod.statId]]
            };
          }
        });
	if ( !char.attacks[1] ) char.attacks[1] = [];
        if ( item.equipped ) char.attacks[1].push(item);
      }

      // Armors
      let itemArmorClass = 0;
      itemArmorClass += ( item.definition.armorClass == null ? 0 : item.definition.armorClass );
      item.definition.grantedModifiers.forEach((grantedMod) => {
        for ( let abilityId in _ABILITIES ) {
          let ABL = _ABILITIES[abilityId];
          if ( grantedMod.type == 'set' && grantedMod.subType == _ABILITY[ABL] + '-score' ) { _itemmodifiers += ', '+ucFirst(_ABILITY[ABL]) + ': ' + grantedMod.value; }
        }
        if ( grantedMod.type == 'bonus' ) {
          switch ( grantedMod.subType ) {
            case 'armor-class':
              // wielding a shield or wearing other item which only give a bonus to armor class doesn't qualify as wearing armor
              // including items such as staff of power, ring of protection, etc. - fall through
            case 'unarmored-armor-class':
              if ( item.definition.hasOwnProperty('armorClass') ) { itemArmorClass += grantedMod.value; } else { char.ac.value += grantedMod.value; }
              break;
            case 'saving-throws':
              //_itemmodifiers += ', Saving Throws +' + grantedMod.value;
              break;
            case 'ability-checks':
              //_itemmodifiers += ', Ability Checks +' + grantedMod.value;
              break;
            case 'speed':
              // Speed attribute in Roll20 OGL sheets is not calculated. They must be manually set
              break;
            case 'magic':
              // these are picked up in the weapons code above
              break;
            default:  // these may indicate an unimplemented conversion
              console.log('ignoring item ' + item.definition.name + ' bonus modifier for ' + grantedMod.subType);
          }
        }
        if ( grantedMod.type == 'set' ) {
          switch ( grantedMod.subType ) {
            case 'armor-class':
              // If an item qualifies as armor, it will be given the .armorClass property and a type property of "Light/Medium/Heavy Armor".
              // Items with modifiers like this don't qualify as armor. I don't know of any items that have this specific modifier. - fall through
            case 'unarmored-armor-class':
              char.ac.value += grantedMod.value;
              break;
            case 'innate-speed-walking':
              // REVISIT boots of striding and springing give a floor to walking speed through this - fall through for now
            default:  // these may indicate an unimplemented conversion
              console.log('ignoring item ' + item.definition.name + ' set modifier for ' + grantedMod.subType);
          }
        }
      });
      if ( item.definition.hasOwnProperty('armorClass') ) {
        let ac = itemArmorClass;
        if ( item.definition.armorTypeId > 0 ) {
          // This includes features such as defense fighting style, which require the user to wear armor
          let aac = getObjects(character, 'subType', 'armored-armor-class');
          aac.forEach((aacb) => { ac = parseInt(ac) + parseInt(aacb.value); });
          hasArmor = true;
	  if ( item.definition.armorTypeId == 1 ) { ac += char.stats[1].mod; }
	  else if ( item.definition.armorTypeId == 2 ) { ac += Math.min( char.stats[1].mod, 2 ); }
        }
        if ( ac > 0 ) char.ac.value = ac;
      }
    });
    character.customItems.forEach((item, i) => {
      item.definition = {};
      item.definition.weight = item.weight; item.definition.name = item.name; item.definition.description = item.description;
      item.weight = []; item.definition.isCustomItem = true; item.definition.isHomebrew = true;
      if ( item.definition.weight == 0 || item.definition.weight == null ) { item.weight.value = 0; item.weight.str = '-'; } else { item.weight.value = item.definition.weight; item.weight.str = item.definition.weight + ' lb.'; }
      char.inventory.push(item);
    });
  }
  // AC
  var unarmored = getObjects(char.proficiencies.other, 'subType', 'unarmored-armor-class')[0];
  var ac_bonus = getObjects(char.proficiencies.other, 'subType', 'armor-class')[0];
  if ( !char.ac || !char.ac.value || char.ac.value == 0 ) {
    char.ac.value = 10 + Number(char.stats[1].mod);	// regular unarmored defense (Dex)
    if ( unarmored ) char.ac.value += Number(char.stats[unarmored.statId - 1].mod);	// unarmored defense proficiency
  }
  if ( ac_bonus && ac_bonus.subType == 'armor-class' ) { char.ac.value += Number(ac_bonus.fixedValue); }


  // Actions
  for ( var source in character.actions ) {
    if ( character.actions[source] ) {
      character.actions[source].forEach((act, ai) => {
        if ( act.displayAsAttack || act.dice ) {
	  var attack = {}; attack.definition = act;
	  if ( act.saveStatId ) {
	    attack.hit.str = saves[act.saveStatId - 1].shortName + ( act.overrideSaveDc || char.spellCasting.save || 8 + char.pb.value );
	  } else if ( act.attackType ) {
	    char.level_monk > 0 ? attack.hit.value = char.stats[1].mod : attack.hit.value = char.stats[0].mod;
	    if ( act.isProficient ) attack.hit.value += char.pb.value;
	    attack.hit.str = updateStrVal(attack.hit.value);
	  }
	  attack.damage = {}; attack.damage.icon = damages[act.damageTypeId];
	  if ( act.dice ) { attack.damage.str = act.dice.diceString.replaceAll(' ','') } else { attack.damage.str = 1 + Number(char.stats[0].mod); }
	  if ( Number(attack.damage.value) < 0 ) attack.damage.value = 0;
	  if ( act.tags ) { attack.notes = act.tags.join(', '); } else if ( act.range.range ) { attack.notes = act.range.range + ' ft.' }
	  attack.id = Number(act.id); attack.displayAsAttack = act.displayAsAttack;
          if ( act.limitedUse ) attack.notes = "Uses: " + ( act.limitedUse.maxUses - act.limitedUse.numberUsed ) + "/" + act.limitedUse.maxUses;
	  if ( !char.attacks[act.activation.activationType] ) char.attacks[act.activation.activationType] = [];

          attack.range = act.range;
	  if ( act.range.range ) {
	    act.range.range !== act.range.longRange ? attack.range.str = act.range.range + ' (' + act.range.longRange + ')' : attack.range.str = act.range.range + ' ft.';
	  } else { attack.range.str = '-'; }

	  char.attacks[act.activation.activationType].push( attack );
        } else if ( act.limitedUse && act.limitedUse.length > 0 ) { //act.componentId == 228
	  char.limitedUses[0].name = act.name;
	  char.limitedUses[0].maxUses = act.limitedUse.maxUses;
	  char.limitedUses[0].numberUsed = act.limitedUse.numberUsed;
	  char.limitedUses[0].remainingUses = act.limitedUse.maxUses - act.limitedUse.numberUsed;
	  char.limitedUses[0].activation = act.activation;
	}
      });
    }}


  // Spellcasting and Spells
  char.spellCasting.abilityId = ( char.classes[0].subclassDefinition && char.classes[0].subclassDefinition.spellCastingAbilityId ) ? char.classes[0].subclassDefinition.spellCastingAbilityId : char.classes[0].definition.spellCastingAbilityId
  if ( char.spellCasting.abilityId ) char.spellCasting.ability = _ABILITIES[char.spellCasting.abilityId];
  if ( char.levels_monk > 0 ) {
    char.spellCasting.save = 8 + Number(char.stats[4].mod) + char.pb.value;
  } else if ( char.spellCasting.ability ) {
    char.spellCasting.mod = char.stats[char.spellCasting.abilityId - 1].mod;
    if ( char.spellCasting.mod >= 0 ) char.spellCasting.mod = "+" + char.spellCasting.mod;
    char.spellCasting.attack = Number(char.stats[char.spellCasting.abilityId - 1].mod) + char.pb.value;
    if ( char.spellCasting.attack >= 0 ) char.spellCasting.attack = "+" + char.spellCasting.attack;
    char.spellCasting.save = 8 + Number(char.stats[char.spellCasting.abilityId - 1].mod) + char.pb.value;
  }

  char.spells = [];
  for ( var source in character.spells ) {
    if ( character.spells[source] ) {
      character.spells[source].forEach((spell, si) => {
	spell = parseSpell( char, spell );
	var obj = {}; char.spells.forEach((lvl) => { obj = lvl.find( o => o.definition.id == spell.definition.id ); });
	if ( !obj ) { char.spells[spell.definition.level].push( spell ); }
      });
    }}
  for ( var index in character.classSpells ) {
    if ( character.classSpells[index].spells ) {
      character.classSpells[index].spells.forEach((spell, si) => {
	spell = parseSpell( char, spell );
	var obj = {}; char.spells.forEach((lvl) => { obj = lvl.find( o => o.definition.id == spell.definition.id ); });
        if ( !obj ) { char.spells[spell.definition.level].push( spell ); }
      });
    }}

  char.limitedUses = [];
  if ( character.classes[0].definition.spellRules ) {
    character.classes[0].definition.spellRules.levelSpellSlots[char.level].forEach((lvl, li) => {
      char.limitedUses[li + 1] = [];
      char.limitedUses[li + 1].available = lvl;
      char.limitedUses[li + 1].used = lvl;
    });
  } else if ( character.spellSlots ) {
    for ( var lvl in character.spellSlots ) { char.limitedUses[Number(lvl) + 1] = char.spellSlots[lvl]; }
  }
  char.limitedUses.forEach((lim) => {
    lim.str = "";
    for ( let i = 0; i < lim.available; i++ ) { lim.str += '[ &nbsp; ] '; }
  });


  // Speeds (and Modifiers)
  let weightSpeeds = character.race.weightSpeeds;
  if ( weightSpeeds == null ) {
    weightSpeeds = { "normal": { "walk": 30, "fly": 0, "burrow": 0, "swim": 0, "climb": 0 }};
  }
  let speedMods = getObjects(character.modifiers, 'subType', 'speed');
  if ( speedMods != null ) {
    speedMods.forEach((speedMod) => {
      if ( speedMod.type == 'set' ) { weightSpeeds.normal.walk = (speedMod.value > weightSpeeds.normal.walk ? speedMod.value : weightSpeeds.normal.walk); }
    });
  }
  speedMods = getObjects(character.modifiers, 'subType', 'innate-speed-flying');
  if ( speedMods != null ) {
    speedMods.forEach((speedMod) => {
      if ( speedMod.type == 'set' && speedMod.id.indexOf('spell') == -1 ) {
        if ( speedMod.value == null ) speedMod.value = weightSpeeds.normal.walk;
        weightSpeeds.normal.fly = ( speedMod.value > weightSpeeds.normal.fly ? speedMod.value : weightSpeeds.normal.fly );
      }
    });
  }
  speedMods = getObjects(character.modifiers, 'subType', 'innate-speed-swimming');
  if ( speedMods != null ) {
    speedMods.forEach((speedMod) => {
      if ( speedMod.type == 'set' && speedMod.id.indexOf('spell') == -1 ) {
        if ( speedMod.value == null ) speedMod.value = weightSpeeds.normal.walk;
        weightSpeeds.normal.swim = ( speedMod.value > weightSpeeds.normal.swim ? speedMod.value : weightSpeeds.normal.swim );
      }
    });
  }
  speedMods = getObjects(character.modifiers, 'subType', 'innate-speed-climbing');
  if ( speedMods != null ) {
    speedMods.forEach((speedMod) => {
      if ( speedMod.type == 'set' && speedMod.id.indexOf('spell') == -1 ) {
        if ( speedMod.value == null ) speedMod.value = weightSpeeds.normal.walk;
        weightSpeeds.normal.climb = ( speedMod.value > weightSpeeds.normal.climb ? speedMod.value : weightSpeeds.normal.climb );
      }
    });
  }
  speedMods = getObjects(character.modifiers, 'subType', 'unarmored-movement');
  if ( speedMods != null ) {
    speedMods.forEach((speedMod) => {
      if ( speedMod.type == 'bonus' ) {
        speedMod.value = isNaN(weightSpeeds.normal.walk + speedMod.value) ? 0 : speedMod.value;
        weightSpeeds.normal.walk += speedMod.value;
        if ( weightSpeeds.normal.fly > 0 ) weightSpeeds.normal.fly += speedMod.value;
        if ( weightSpeeds.normal.swim > 0 ) weightSpeeds.normal.swim += speedMod.value;
        if ( weightSpeeds.normal.climb > 0 ) weightSpeeds.normal.climb += speedMod.value;
      }
    });
  }
  speedMods = getObjects(character.modifiers, 'subType', 'speed');
  if ( speedMods != null ) {
    speedMods.forEach((speedMod) => {
      if ( speedMod.type == 'bonus' ) {
        speedMod.value = isNaN(weightSpeeds.normal.walk + speedMod.value) ? 0 : speedMod.value;
        weightSpeeds.normal.walk += speedMod.value;
        if ( weightSpeeds.normal.fly > 0 ) weightSpeeds.normal.fly += speedMod.value;
        if ( weightSpeeds.normal.swim > 0 ) weightSpeeds.normal.swim += speedMod.value;
        if ( weightSpeeds.normal.climb > 0 ) weightSpeeds.normal.climb += speedMod.value;
      }
    });
  }
  char.weightSpeeds = weightSpeeds;


  // Hit Points
  char.hp = {};
  char.hp.max = loadHitPoints(character, char.level);
  char.hp.current = loadHitPoints(character, char.level) - Number(character.removedHitPoints);
  char.hp.hitDice = char.level - char.classes[0].hitDiceUsed;
  char.hp.hitDieSize = '1d' + char.classes[0].definition.hitDice
  char.hp.hitDieSize += ( char.stats[2].mod > 0 ) ? '+' + char.stats[2].mod : ( char.stats[2].mod == 0 ) ? '' : char.stats[2].mod;
  char.hp.temp = character.temporaryHitPoints;


  // Passive Senses
  char.passives = {};
  char.passives.perception = 10 + Number(char.skills[11].mod);
  char.passives.investigation = 10 + Number(char.skills[8].mod);
  char.passives.insight = 10 + Number(char.skills[6].mod);


  // Misc. Traits
  var sizes = getObjects(character.race.racialTraits, 'name', 'Size');
  var sizeChoice = getObjects(character.choices, 'label', 'Choose a Character Size');
  var sizeChoices = { 5735: 'Small', 5736: 'Medium' };
  if ( sizes[0].description.includes('choose') || sizes[0].description.includes('chosen') ) {
    char.traits.size = sizeChoices[sizeChoice[0].optionValue];
  } else {
    sizes.forEach((size, si) => { char.traits.size = Object.values(sizeChoices).find( el => ( size.snipped && size.snippet.includes(el) ) || size.description.includes(el) ); });
  }
  let fs = getObjects(character, 'componentId', '1675305')[0];
  if ( fs && fs.definition ) char.attacking.fightingStyle = fs.definition;
  char.init = {};
  char.init.value = char.stats[1].mod;
  var init_bonus = getObjects(char.proficiencies.other, 'subType', 'initiative', 'type', 'bonus')[0];
  var init_mod = getObjects(char.proficiencies.other, 'subType', 'initiative', 'type', 'advantage')[0] || getObjects(char.proficiencies.other, 'subType', 'initiative', 'type', 'disadvantage')[0];
  if ( init_bonus) {
    if ( init_bonus.fixedValue ) { char.init.value += init_bonus.fixedValue; } else if ( init_bonus.statId ) { char.init.value += char.stats[init_bonus.statId - 1].mod; }
  }
  char.init.str = updateStrVal(char.init.value);
  if ( init_mod ) { char.init.icon = 'ddb-' + init_mod.friendlyTypeName.toLowerCase(); }


  // Active Conditions
  character.conditions.forEach((cond, ci) => { char.conditions.push(conditions[cond.id]); });


  return char;
};


function ddbParseMonster( monster ) {


  return monster_parsed;
};
