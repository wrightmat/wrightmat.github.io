// Common functions to access and parse D&D Beyond data
// good reference resource: https://github.com/kjbro/Roll20APIScripts/blob/master/BeyondImporter_5eOGL/BeyondImporter.js
// script to convert pdf into json: https://github.com/sonofwau/dndbeyond_to_json

const activation = [ '', 'A', '', 'BA', 'R', 's', 'm', 'h', 'S' ]  // need to validate all of these entries
const alignments = [ '', 'Lawful Good', 'Neutral Good', 'Chaotic Good', 'Lawful Neutral', 'Neutral', 'Chaotic Neutral', 'Lawful Evil', 'Neutral Evil', 'Chaotic Evil' ]
const components = [ '', 'V', 'S', 'M' ]
const conditions = [ '', 'Blinded', 'Charmed', 'Deafened', 'Exhausted', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious' ]
const damages = [ '', 'ddb-bludgeoning', 'ddb-piercing', 'ddb-slashing' ]
const saves = [ { name: 'strength-saving-throws', friendlyName: 'Strength', shortName: 'STR', stat: 0, mod: 0 }, { name: 'dexterity-saving-throws', friendlyName: 'Dexterity', shortName: 'DEX', stat: 1, mod: 0 }, { name: 'constitution-saving-throws', friendlyName: 'Constitution', shortName: 'CON', stat: 2, mod: 0 }, { name: 'intelligence-saving-throws', friendlyName: 'Intelligence', shortName: 'INT', stat: 3, mod: 0 }, { name: 'wisdom-saving-throws', friendlyName: 'Wisdom', shortName: 'WIS', stat: 4, mod: 0 }, { name: 'charisma-saving-throws', friendlyName: 'Charisma', shortName: 'CHA', stat: 5, mod: 0 } ]
const skills = [ { name: 'acrobatics', friendlyName: 'Acrobatics', stat: 1, mod: 0 }, { name: 'animal-handling', friendlyName: 'Animal Handling', stat: 4, mod: 0 }, { name: 'arcana', friendlyName: 'Arcana', stat: 3, mod: 0 }, { name: 'athletics', friendlyName: 'Athletics', stat: 0, mod: 0 }, { name: 'deception', friendlyName: 'Deception', stat: 5, mod: 0 }, { name: 'history', friendlyName: 'History', stat: 3, mod: 0 }, { name: 'insight', friendlyName: 'Insight', stat: 4, mod: 0 }, { name: 'intimidation', friendlyName: 'Intimidation', stat: 5, mod: 0 }, { name: 'investigation', friendlyName: 'Investigation', stat: 3, mod: 0 }, { name: 'medicine', friendlyName: 'Medicine', stat: 4, mod: 0 }, { name: 'nature', friendlyName: 'Nature', stat: 3, mod: 0 }, { name: 'perception', friendlyName: 'Perception', stat: 4, mod: 0 }, { name: 'performance', friendlyName: 'Performance', stat: 5, mod: 0 }, { name: 'persuasion', friendlyName: 'Persuasion', stat: 5, mod: 0 }, { name: 'religion', friendlyName: 'Religion', stat: 3, mod: 0 }, { name: 'sleight-of-hand', friendlyName: 'Sleight of Hand', stat: 1, mod: 0 }, { name: 'stealth', friendlyName: 'Stealth', stat: 1, mod: 0 }, { name: 'survival', friendlyName: 'Survival', stat: 4, mod: 0 } ]
const weapons = { simple: [ 'Club', 'Dagger', 'Greatclub', 'Handaxe', 'Javelin', 'Light Hammer', 'Mace', 'Quarterstaff', 'Sickle', 'Spear', 'Crossbow, Light', 'Dart', 'Shortbow', 'Sling' ], martial: [ 'Battleaxe', 'Flail', 'Glaive', 'Greataxe', 'Greatsword', 'Halberd', 'Lance', 'Longsword', 'Maul', 'Morningstar', 'Pike', 'Rapier', 'Scimitar', 'Shortsword', 'Trident', 'War Pick', 'Warhammer', 'Whip', 'Blowgun', 'Crossbow, Hand', 'Crossbow, Heavy', 'Longbow', 'Net' ], melee: [ 'Club', 'Dagger', 'Greatclub', 'Handaxe', 'Javelin', 'Light hammer', 'Mace', 'Quarterstaff', 'Sickle', 'Spear', 'Battleaxe', 'Flail', 'Glaive', 'Greataxe', 'Greatsword', 'Halberd', 'Lance', 'Longsword', 'Maul', 'Morningstar', 'Pike', 'Rapier', 'Scimitar', 'Shortsword', 'Trident', 'War pick', 'Warhammer', 'Whip' ], ranged: [ 'Crossbow, light', 'Dart', 'Shortbow', 'Sling', 'Blowgun', 'Crossbow, hand', 'Crossbow, heavy', 'Longbow', 'Net' ] }

function updateStrVal( val, valStr ) {
  if ( val >= 0 ) { valStr = "+" + val } else { valStr = "" + val }
  return valStr;
}

function ddbParseSpell( char, spell ) {

  const getMaxObject = ( array, attr, limit ) => {
    let max = -Infinity;
    array.forEach(obj => {
      if ( obj[attr] > max && obj[attr] <= limit ) { max = obj[attr]; }
    });
    var obj = {}; obj = array.find( o => o.level == max );
    return obj;
  };

  spell.a_effect = {};
  var dmg = jsonSearch(spell.definition.modifiers, 'type', 'damage')[0];
  if ( dmg && dmg.atHigherLevels ) {
    dmgHigherLevel = getMaxObject( dmg.atHigherLevels.higherLevelDefinitions, 'level', char.a_level );
    if ( dmgHigherLevel ) { dmg.die = dmgHigherLevel.dice; }
  }

  if ( !char.a_spells[spell.definition.level] ) { char.a_spells[spell.definition.level] = []; }
  if ( spell.definition.activation.activationTime >= 1 ) { spell.a_time = spell.definition.activation.activationTime; } else { spell.a_time = ''; }
  spell.a_time += activation[spell.definition.activation.activationType];

  if ( spell.definition.requiresAttackRoll == true ) {
    if ( spell.definition.modifiers[0].die.diceString ) {
      spell.a_effect.value = spell.definition.modifiers[0].die.diceString.replaceAll(' ', '');
      spell.a_effect.icon = 'ddb-' + dmg.subType;
    }
    if ( spell.definition.asPartOfWeaponAttack == true ) { spell.a_hit = '-'; }
    else if ( !char.a_spellCastingAttack ) { spell.a_hit = Number(char.stats[0].mod) + Number(char.a_profBonus); spell.a_hit = updateStrVal( spell.a_hit ); }
    else { spell.a_hit = char.a_spellCastingAttack; }
  } else if ( spell.definition.requiresSavingThrow == true ) {
    if ( dmg ) {
      spell.a_effect.value = dmg.die.diceString.replaceAll(' ', '');
      spell.a_effect.icon = 'ddb-' + dmg.subType;
    } else {
      spell.a_effect.value = spell.definition.tags[0];
      spell.a_effect.icon = '';
    }
    spell.a_hit = saves[spell.definition.saveDcAbilityId - 1].shortName + ( spell.overrideSaveDc || char.a_spellCastingSave || 8 + Number(char.a_profBonus) );
  } else {
    if ( dmg ) {
      spell.a_effect.value = dmg.die.diceString.replaceAll(' ', '');
      spell.a_effect.icon = 'ddb-' + dmg.subType;
    } else {
      spell.a_effect.value = spell.definition.tags[0];
      spell.a_effect.icon = '';
    }
    spell.a_hit = '-';
  }
  spell.a_range = [];
  if ( spell.definition.range.rangeValue > 0 ) { spell.a_range.value = spell.definition.range.rangeValue + ' ft.'; } else { spell.a_range.value = spell.definition.range.origin; }
  if ( spell.definition.range.aoeValue > 0 ) { spell.a_range.aoe = spell.definition.range.aoeValue + ' ft.'; spell.a_range.aoe_icon = 'ddb-' + spell.definition.range.aoeType.toLowerCase(); }
  if ( spell.definition.concentration == true ) { spell.a_icon = 'ddb-concentration'; } else { spell.a_icon = ''; }

  var comp = [];
  for ( let i = 0; i < spell.definition.components.length; i++ ) { comp.push(components[spell.definition.components[i]]); }
  spell.a_notes = comp.join('/');
  if ( spell.definition.duration.durationInterval > 0 ) {
    var dur = 'D: ' + spell.definition.duration.durationInterval;
console.log(spell.definition.duration);
    if ( spell.definition.duration.durationUnit == 'Minute' ) { dur += 'm' }
    else if ( spell.definition.duration.durationUnit == 'Hour' ) { dur += 'h' }
    else { dur += spell.definition.duration.durationUnit; }
    spell.a_notes += ', ' + dur;
  }

  return spell;
}

function ddbGetCharacter( r_id, r_async ) {
  // run through a proxy to avoid CORS errors
  var r_json, r_proxy
  r_proxy = "https://corsproxy.io/?url="
  $.get({
    url: r_proxy + "https://character-service.dndbeyond.com/character/v5/character/" + r_id,
    success: function(result) { r_json = result },
    error: function(xhr, error) { console.log(xhr) },
    async: r_async || false
  });
  return r_json;
}

function ddbParseCharacter( char ) {
  // Parses the json response of ddbGetCharacter to create easier access to common numbers that are overly complex by default.
  // a_* objects added to the json are calculated in this function. All other json is unmodified.

  char.a_ac = 0;
  char.a_level = 0;
  char.a_classes = [];
  char.a_subclasses = [];
  char.a_spells = [];
  char.a_attacks = [];
  char.a_stats = char.stats;
  char.a_saves = saves;
  char.a_skills = skills;
  char.a_initiative = {};
  char.a_proficiencies = {};
  char.a_proficiencies.saves = [];
  char.a_proficiencies.skills = [];
  char.a_proficiencies.weapons = [];
  char.a_proficiencies.armor = [];
  char.a_proficiencies.languages = [];
  char.a_proficiencies.defenses = [];
  char.a_proficiencies.scores = [];
  char.a_proficiencies.tools = [];
  char.a_proficiencies.other = [];
  char.a_attacksPerAction = 1;
  char.a_limitedUses = [];
  char.a_feats = [];

  // convert alignmentId to actual alignment text using hard-coded array above (wasn't able to find another reference in the json)
  char.a_alignment = alignments[char.alignmentId];

  // add calculated initial modifier to the stats
  char.a_stats.forEach((stat) => { stat.mod = Math.floor((stat.value - 10) / 2); stat.modStr = updateStrVal(stat.mod, stat.modStr); })

  // add together levels and create array of classes and subclasses
  char.classes.forEach((cls) => {  char.a_level += cls.level;
    if ( !char.a_classes.includes(cls.definition.name ) ) { char.a_classes.push(cls.definition.name); }
    if ( cls.subclassDefinition && !char.a_subclasses.includes(cls.subclassDefinition.name) ) { char.a_subclasses.push(cls.subclassDefinition.name); }
  });

  // calculate proficiency bonus from combined level (with formula I created based in the table in the PHB - I think it's correct)
  char.a_profBonus = "+" + ( Math.ceil(char.a_level / 4) + 1 );

  // we have to do an initial pass for score bonuses because they can impact the other proficiencies and we can't be sure of the order
  for ( var source in char.modifiers ) {  // multiple sources of modifiers exist in the json, from background, class, feat, item, and race
    char.modifiers[source].forEach((mod) => {
      if ( mod.entityTypeId == 1472902489 && mod.isGranted == false ) {  // score bonus (need to double-check the isGranted part, seems counter-intuitive)
        char.a_stats[mod.entityId - 1].value += Number(mod.fixedValue);
	char.a_stats[mod.entityId - 1].mod = Math.floor((char.a_stats[mod.entityId - 1].value - 10) / 2);
	char.a_stats[mod.entityId - 1].modStr = updateStrVal(char.a_stats[mod.entityId - 1].mod, char.a_stats[mod.entityId - 1].modStr);
      }
    });
  }
  char.a_initiative.value = char.a_stats[1].mod;
  char.a_initiative.valueStr = updateStrVal(char.a_initiative.value, char.a_initiative.valueStr);

  // create base modifier for each of the saving throws and skills (using the hard-coded list above, since I wasn't able to find a complete reference in the json)
  char.a_saves.forEach((save) => { save.mod = char.a_stats[save.stat].mod; save.modStr = updateStrVal(save.mod, save.modStr); });
  char.a_skills.forEach((skill) => { skill.mod = char.a_stats[skill.stat].mod; skill.modStr = updateStrVal(skill.mod, skill.modStr); });

  // add proficiency bonus for proficiencies (and expertise)
  for ( var source in char.modifiers ) {  // multiple sources of modifiers exist in the json, from background, class, feat, item, and race
    char.modifiers[source].forEach((mod) => {
      if ( mod.type == "proficiency" && mod.subType.includes('-saving-throws') ) {	// saves
	if ( jsonSearch(char.a_proficiencies.saves, 'subType', mod.subType).length == 0 ) {
	  char.a_proficiencies.saves.push(mod);
	  var prof = jsonSearch(char.a_saves, 'name', mod.subType)[0];
	  prof.proficiency = "proficient";
	  prof.mod += Number(char.a_profBonus);
	  prof.modStr = updateStrVal(prof.mod, prof.modStr);
	}
      } else if ( mod.entityTypeId == 1958004211 ) {	// skills
	char.a_proficiencies.skills.push(mod);
	var prof = jsonSearch(char.a_skills, 'name', mod.subType)[0];
	if ( mod.type == "expertise" && !prof.proficiency ) {
	  prof.proficiency = "expert";
	  prof.mod = Number(char.a_stats[prof.stat].mod) + ( Number(char.a_profBonus) * 2 );
	  prof.modStr = updateStrVal(prof.mod, prof.modStr);
	} else if ( mod.type == "proficiency" && !prof.proficiency ) {
	  prof.proficiency = "proficient";
	  prof.mod = Number(char.a_stats[prof.stat].mod) + Number(char.a_profBonus);
	  prof.modStr = updateStrVal(prof.mod, prof.modStr);
	} else if ( mod.type == "half-proficiency" && !prof.proficiency ) {
	  prof.proficiency = "half-proficient";
	  prof.mod = Number(char.a_stats[prof.stat].mod) + Math.floor( Number(char.a_profBonus) / 2 );
	  prof.modStr = updateStrVal(prof.mod, prof.modStr);
	}
      } else if ( mod.entityTypeId == 1782728300 || mod.subType.includes('weapons') ) {	// weapons
	char.a_proficiencies.weapons.push(mod);
      } else if ( mod.entityTypeId == 174869515 ) {	// armor
	char.a_proficiencies.armor.push(mod);
      } else if ( mod.entityTypeId == 906033267 ) {	// languages
	var lang = jsonSearch(char.a_proficiencies.languages, 'friendlySubtypeName', mod.friendlySubtypeName)
	if ( lang.length == 0 ) { char.a_proficiencies.languages.push(mod); }
      } else if ( ( mod.entityTypeId == 349597128 || mod.type == 'immunity' ) && mod.type !== 'natural-weapon' ) {	// defenses
	char.a_proficiencies.defenses.push(mod);
      } else if ( mod.entityTypeId == 1472902489 ) {	// scores
	char.a_proficiencies.scores.push(mod);
      } else if ( mod.entityTypeId == 2103445194 ) {	// tools
	char.a_proficiencies.tools.push(mod);
      } else {
	char.a_proficiencies.other.push(mod);
	if ( mod.subType == 'saving-throws' && mod.statId ) { char.a_saves.forEach((save) => { save.mod += char.a_stats[mod.statId - 1].mod; save.modStr = updateStrVal(save.mod, save.modStr); }) }
	if ( mod.subType == 'initiative' && mod.isGranted ) { char.a_initiative.value += Number(char.a_profBonus); char.a_initiative.valueStr = updateStrVal(char.a_initiative.value, char.a_initiative.valueStr); }
	if ( mod.subType == 'extra-attacks' && mod.isGranted ) { char.a_attacksPerAction += mod.fixedValue || 1; }
      }
    });
  }	// second loop for catch-all cases like half-proficiency (only where proficiency hasn't already been assigned)
  for ( var source in char.modifiers ) {
    char.modifiers[source].forEach((mod) => {
      if ( mod.subType == 'ability-checks' && mod.type == 'half-proficiency' ) {
	char.a_skills.forEach((skill) => {
	  if ( !skill.proficiency ) {
	    skill.proficiency = 'half-proficient';
	    skill.mod += Math.floor( Number(char.a_profBonus) / 2 );
	    skill.modStr = updateStrVal(skill.mod, skill.modStr);
	  }
	})
      }
    });
  }

  // populate AC from any equipped armor, unarmored defense, or shield
  char.inventory.forEach((inv) => { if ( inv.equipped == true && inv.definition && Number(inv.definition.armorClass) > 0 ) { char.a_ac = Number(inv.definition.armorClass); } });
  var armored = jsonSearch(char.a_proficiencies.other, 'subType', 'armored-armor-class')[0];
  var unarmored = jsonSearch(char.a_proficiencies.other, 'subType', 'unarmored-armor-class')[0];
  var ac_bonus = jsonSearch(char.a_proficiencies.other, 'subType', 'armor-class')[0];
  if ( char.a_ac == 0 ) {
    char.a_ac = 10 + Number(char.a_stats[1].mod);	// regular unarmored defense (Dex)
    if ( unarmored ) { char.a_ac += Number(char.a_stats[unarmored.statId - 1].mod); }	// unarmored defense proficiency
  } else {
    if ( armored ) { char.a_ac += Number(armored.fixedValue); }	// armored defense proficiency
  }
  if ( ac_bonus && ac_bonus.subType == 'armor-class' ) { char.a_ac += Number(ac_bonus.fixedValue); }
  char.inventory.forEach((inv) => {	// items that add to AC (shields)
    if ( inv.equipped == true && inv.definition && inv.definition.armorTypeId == 4 && Number(inv.definition.armorClass) > 0 ) {
      char.a_ac += Number(inv.definition.armorClass);
      if ( inv.definition.grantedModifiers ) {
        inv.definition.grantedModifiers.forEach((mod) => { if ( mod.subType == "armor-class" ) { char.a_ac += mod.fixedValue; } });
      }
    }
  });

  // other misc derived stats (some are used for spells, so we set them here)
  char.a_passivePerception = 10 + Number(char.a_skills[11].mod);
  char.a_passiveInvestigation = 10 + Number(char.a_skills[8].mod);
  char.a_passiveInsight = 10 + Number(char.a_skills[6].mod);
  var hp_bonus = jsonSearch(char.a_proficiencies.other, 'subType', 'hit-points-per-level')[0];
  if ( hp_bonus ) {
    char.a_hp = Number(char.baseHitPoints) + ( ( Number(char.a_stats[2].mod) + hp_bonus.fixedValue ) * Number(char.a_level) );
  } else {
    char.a_hp = Number(char.baseHitPoints) + ( Number(char.a_stats[2].mod) * Number(char.a_level) );
  }
  char.a_hitDice = char.a_level - char.classes[0].hitDiceUsed;
  if ( char.a_stats[2].mod > 0 ) {
    char.a_hitDieSize = '1d' + char.classes[0].definition.hitDice + '+' + char.a_stats[2].mod;
  } else if ( char.a_stats[2].mod < 0 ) {
    char.a_hitDieSize = '1d' + char.classes[0].definition.hitDice + char.a_stats[2].mod;
  } else {
    char.a_hitDieSize = '1d' + char.classes[0].definition.hitDice;
  }
  if ( char.classes[0].definition.spellCastingAbilityId ) {  // these only apply to spellcasting classes
    char.a_spellCastingAbility = saves[char.classes[0].definition.spellCastingAbilityId - 1].shortName;
    char.a_spellCastingMod = char.a_stats[char.classes[0].definition.spellCastingAbilityId - 1].mod;
    if ( char.a_spellCastingMod >= 0 ) { char.a_spellCastingMod = "+" + char.a_spellCastingMod; }
    char.a_spellCastingAttack = Number(char.a_stats[char.classes[0].definition.spellCastingAbilityId - 1].mod) + Number(char.a_profBonus);
    if ( char.a_spellCastingAttack >= 0 ) { char.a_spellCastingAttack = "+" + char.a_spellCastingAttack; }
    char.a_spellCastingSave = 8 + Number(char.a_stats[char.classes[0].definition.spellCastingAbilityId - 1].mod) + Number(char.a_profBonus);
  } else if ( char.classes[0].subclassDefinition && char.classes[0].subclassDefinition.spellCastingAbilityId ) {  // it can be the case that only the subclass is spellcasting
    char.a_spellCastingAbility = saves[char.classes[0].subclassDefinition.spellCastingAbilityId - 1].shortName;
    char.a_spellCastingMod = char.a_stats[char.classes[0].subclassDefinition.spellCastingAbilityId - 1].mod;
    if ( char.a_spellCastingMod >= 0 ) { char.a_spellCastingMod = "+" + char.a_spellCastingMod; }
    char.a_spellCastingAttack = Number(char.a_stats[char.classes[0].subclassDefinition.spellCastingAbilityId - 1].mod) + Number(char.a_profBonus);
    if ( char.a_spellCastingAttack >= 0 ) { char.a_spellCastingAttack = "+" + char.a_spellCastingAttack; }
    char.a_spellCastingSave = 8 + Number(char.a_stats[char.classes[0].subclassDefinition.spellCastingAbilityId - 1].mod) + Number(char.a_profBonus);
  } else if (char.classes[0].definition.name == "Monk" ) {
    char.a_spellCastingSave = 8 + Number(char.a_stats[4].mod) + Number(char.a_profBonus);  // 8 + WIS + Prof for monks
  }

  // add spells to a new object grouped by level (not sure what's up with this separate classSpells object, but seems it's necessary)
  for ( var source in char.spells ) {  // multiple sources of spells exist in the json, from background, class, feat, item, and race
    if ( char.spells[source] ) {
      char.spells[source].forEach((spell) => {
	spell = ddbParseSpell( char, spell );  // parse the spell, and if it doesn't already exist in the spell list, then add it
	var obj = {}; char.a_spells.forEach((lvl) => { obj = lvl.find( o => o.definition.id == spell.definition.id ); });
	if ( !obj ) { char.a_spells[spell.definition.level].push( spell ); }
      });
    }}
  for ( var index in char.classSpells ) {
    if ( char.classSpells[index] ) {
      char.classSpells[index].spells.forEach((spell) => {
	spell = ddbParseSpell( char, spell );
	var obj = {}; char.a_spells.forEach((lvl) => { obj = lvl.find( o => o.definition.id == spell.definition.id ); });
        if ( !obj ) { char.a_spells[spell.definition.level].push( spell ); }
      });
    }}

  // max stats out at 20 (we do it here because some items can increase stats beyond 20)
  char.a_stats.forEach((stat) => { stat.value = Math.min( stat.value, 20 ); });

  // inventory weapons and attacks
  char.inventory.forEach((inv) => {
    if ( inv.equipped == true && inv.isAttuned == true ) { inv.a_icon = 'ddb-attunement'; }
    if ( inv.definition ) {
      if ( inv.equipped == true && inv.definition.filterType == "Weapon" ) {
        inv.a_damage = {}; inv.a_bonus = 0;
        var simple = weapons.simple.includes(inv.definition.type);
        var martial = weapons.martial.includes(inv.definition.type);
        var finesse = jsonSearch(inv.definition.properties, 'name', 'Finesse')[0];
        var prof = jsonSearch(char.a_proficiencies.weapons, 'friendlySubtypeName', inv.definition.type)[0] || ( simple && jsonSearch(char.a_proficiencies.weapons, 'subType', 'simple-weapons')[0] ) || ( martial && jsonSearch(char.a_proficiencies.weapons, 'subType', 'martial-weapons')[0] );
        if ( inv.definition.grantedModifiers ) { inv.definition.grantedModifiers.forEach((mod) => { if ( mod.type == "bonus" ) { inv.a_bonus += mod.fixedValue; } }); }
        if ( inv.definition.attackType == 2 || finesse || ( inv.definition.isMonkWeapon && char.a_classes.includes('Monk') ) ) {
	  inv.a_hit = Number(char.stats[1].mod);	// Dex-based
        } else {
	  inv.a_hit = Number(char.stats[0].mod);	// Str-based
        }
        // are you always proficient with weapons you have weapon mastery of? seems like you should.
        if ( prof && ( prof.type == "proficiency" || prof.type == "weapon-mastery" ) ) { inv.a_hit += Number(char.a_profBonus); } else if ( prof && prof.type == "expertise" ) { inv.a_hit += Number(char.a_profBonus) * 2; }
        inv.a_hit += inv.a_bonus;
        if ( inv.a_hit >= 0 ) { inv.a_hit = "+" + inv.a_hit; }
        if ( inv.definition.attackType == 2 || finesse ) {
          inv.a_bonusDamage = Number(char.a_stats[1].mod) + Number(inv.a_bonus);
          if ( inv.a_bonusDamage >= 0 ) { inv.a_bonusDamage = "+" + inv.a_bonusDamage; }
	  inv.a_damage.value = inv.definition.damage.diceString + inv.a_bonusDamage;
        } else if ( inv.definition.attackType == 1 ) {
          inv.a_bonusDamage = Number(char.a_stats[0].mod) + Number(inv.a_bonus);
          if ( inv.a_bonusDamage > 0 ) {
	    inv.a_bonusDamage = "+" + inv.a_bonusDamage;
	    inv.a_damage.value = inv.definition.damage.diceString + inv.a_bonusDamage;
	  } else {
	    inv.a_damage.value = inv.definition.damage.diceString;
	  }
        }
        inv.a_damage.icon = 'ddb-' + inv.definition.damageType.toLowerCase();
        if ( !char.a_attacks[1] ) { char.a_attacks[1] = []; }
        char.a_attacks[1].push( inv );
      }
      var notes = [];
      if ( inv.definition.weight == 0 ) { inv.a_weightStr = '-'; } else { inv.a_weightStr = inv.definition.weight + ' lb.'; }
      if ( inv.definition.armorClass ) { notes.push('AC: ' + inv.definition.armorClass); }
      if ( inv.definition.properties ) { inv.definition.properties.forEach((prop) => { notes.push(prop.name); }); }
      if ( notes.length == 0 ) { notes = inv.definition.tags; }
      inv.a_notes = notes.join(', ');
    }
  });

  // actions (such as unarmed strike)
  for ( var source in char.actions ) {
    if ( char.actions[source] ) {
      char.actions[source].forEach((act) => {
        if ( act.displayAsAttack || act.dice ) {
	  var attack = {}; attack.definition = act;
	  if ( act.saveStatId ) {
	    attack.a_hit = saves[act.saveStatId - 1].shortName + ( act.overrideSaveDc || char.a_spellCastingSave || 8 + Number(char.a_profBonus) );
	  } else if ( act.attackType ) {
	    if ( char.a_classes.includes('Monk') ) { attack.a_hit = Number(char.a_stats[1].mod) } else { attack.a_hit = Number(char.a_stats[0].mod) }
	    if ( act.isProficient ) { attack.a_hit += Number(char.a_profBonus); }
	    if ( attack.a_hit >= 0 ) { attack.a_hit = "+" + attack.a_hit; }
	  }
	  attack.a_damage = {}; attack.a_damage.icon = damages[act.damageTypeId];
	  if ( act.dice ) { attack.a_damage.value = act.dice.diceString.replaceAll(' ','') } else { attack.a_damage.value = 1 + Number(char.a_stats[0].mod); }
	  if ( Number(attack.a_damage.value) < 0 ) { attack.a_damage.value = 0 }
	  if ( act.tags ) { attack.a_notes = act.tags.join(', '); } else if ( act.range.range ) { attack.a_notes = act.range.range + ' ft.' }
	  attack.id = Number(act.id); attack.displayAsAttack = act.displayAsAttack;
          if ( act.limitedUse ) { attack.a_notes = "Uses: " + ( act.limitedUse.maxUses - act.limitedUse.numberUsed ) + "/" + act.limitedUse.maxUses }
	  if ( !char.a_attacks[act.activation.activationType] ) { char.a_attacks[act.activation.activationType] = []; }
	  char.a_attacks[act.activation.activationType].push( attack );
        } else if ( act.limitedUse && act.limitedUse.length > 0 ) { //act.componentId == 228
	  char.a_limitedUses[0].name = act.name;
	  char.a_limitedUses[0].maxUses = act.limitedUse.maxUses;
	  char.a_limitedUses[0].numberUsed = act.limitedUse.numberUsed;
	  char.a_limitedUses[0].remainingUses = act.limitedUse.maxUses - act.limitedUse.numberUsed;
	  char.a_limitedUses[0].activation = act.activation;
	}
      });
    }}

  // spell slots and other limited uses (not already covered in previous section)
  if ( char.classes[0].definition.spellRules ) {
    char.classes[0].definition.spellRules.levelSpellSlots[char.a_level].forEach(function(lvl, ind) {
      char.a_limitedUses[ind + 1] = [];
      char.a_limitedUses[ind + 1].available = lvl;
      char.a_limitedUses[ind + 1].used = lvl;
    });
  } else if ( char.spellSlots ) {
    for ( var lvl in char.spellSlots ) {
      char.a_limitedUses[Number(lvl) + 1] = char.spellSlots[lvl];
    }
  }

  // features & traits
  var featExcludes = [ "Creature Type", "Size", "Speed", "Hit Points", "Ability Score Increase", "Ability Score Increases", "Sage Ability Score Improvements", "Languages" ]
  char.feats.forEach( function( feat, ind ) {
    if ( !featExcludes.includes(feat.definition.name) ) { char.a_feats.push(feat); }
  });
  char.classes.forEach((cls) => {
    cls.classFeatures.forEach( function( feat, ind ) {
      if ( !feat.definition.requiredLevel || ( feat.definition.requiredLevel && char.a_level >= feat.definition.requiredLevel ) ) {
	if ( feat.definition.hideInSheet == false && !featExcludes.includes(feat.definition.name) ) { char.a_feats.push(feat); }
      }
    })
  });
  char.race.racialTraits.forEach( function( feat, ind ) {
    if ( !feat.definition.requiredLevel || ( feat.definition.requiredLevel && char.a_level >= feat.definition.requiredLevel ) ) {
      if ( feat.definition.hideInSheet == false && !featExcludes.includes(feat.definition.name) ) { char.a_feats.push(feat); }
    }
  });

  // speeds and modifiers to walking speed
  char.a_speeds = char.race.weightSpeeds.normal;
  var speedMods = [ ...jsonSearch(char.a_proficiencies.other, 'subType', 'speed'), ...jsonSearch(char.a_proficiencies.other, 'subType', 'unarmored-movement') ];
  speedMods.forEach((mod) => { char.a_speeds.walk += mod.fixedValue;
    if ( char.a_speeds.fly ) { char.a_speeds.fly += mod.fixedValue; }
    if ( char.a_speeds.swim ) { char.a_speeds.swim += mod.fixedValue; }
    if ( char.a_speeds.climb ) { char.a_speeds.climb += mod.fixedValue; }
    if ( char.a_speeds.burrow ) { char.a_speeds.burrow += mod.fixedValue; }
  });

  // misc. racial traits
  for ( var trait in char.race.racialTraits ) {
    if ( char.race.racialTraits[trait].definition.name == 'Size' ) {
      if ( char.race.racialTraits[trait].definition.snippet ) {
        char.a_size = char.race.racialTraits[trait].definition.snippet.replace('You are ', '').replace('.', '');
      } else {
	if ( char.race.racialTraits[trait].definition.description.includes('Medium') ) { char.a_size = 'Medium'; }
      }
    }
  }

  // conditions - just need to add the name
  char.conditions.forEach((cond) => { cond.name = conditions[cond.id]; });

  // icons and other misc.
  var init = jsonSearch(char.a_proficiencies.other, 'subType', 'initiative')[0];
  if ( init ) { char.a_initiative.icon = 'ddb-' + init.friendlyTypeName.toLowerCase(); }

  return char;
}
