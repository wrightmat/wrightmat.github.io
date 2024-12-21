// Common functions to access and parse D&D Beyond data
// good reference resource: https://github.com/kjbro/Roll20APIScripts/blob/master/BeyondImporter_5eOGL/BeyondImporter.js
// script to convert pdf into json: https://github.com/sonofwau/dndbeyond_to_json

const activation = [ '', 'A', '', 'BA', 'R', 's', 'm', 'h', 'S' ]  // need to validate all of these entries
const alignments = [ '', 'Lawful Good', 'Neutral Good', 'Chaotic Good', 'Lawful Neutral', 'Neutral', 'Chaotic Neutral', 'Lawful Evil', 'Neutral Evil', 'Chaotic Evil' ]
const components = [ 'V', 'S', 'M' ]
const conditions = [ '', 'Blinded', 'Charmed', 'Deafened', 'Exhausted', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious' ]
const saves = [ { name: 'strength-saving-throws', friendlyName: 'Strength', shortName: 'STR', stat: 0, value: 0 }, { name: 'dexterity-saving-throws', friendlyName: 'Dexterity', shortName: 'DEX', stat: 1, value: 0 }, { name: 'constitution-saving-throws', friendlyName: 'Constitution', shortName: 'CON', stat: 2, value: 0 }, { name: 'intelligence-saving-throws', friendlyName: 'Intelligence', shortName: 'INT', stat: 3, value: 0 }, { name: 'wisdom-saving-throws', friendlyName: 'Wisdom', shortName: 'WIS', stat: 4, value: 0 }, { name: 'charisma-saving-throws', friendlyName: 'Charisma', shortName: 'CHA', stat: 5, value: 0 } ]
const skills = [ { name: 'acrobatics', friendlyName: 'Acrobatics', stat: 1, value: 0 }, { name: 'animal-handling', friendlyName: 'Animal Handling', stat: 4, value: 0 }, { name: 'arcana', friendlyName: 'Arcana', stat: 3, value: 0 }, { name: 'athletics', friendlyName: 'Athletics', stat: 0, value: 0 }, { name: 'deception', friendlyName: 'Deception', stat: 5, value: 0 }, { name: 'history', friendlyName: 'History', stat: 3, value: 0 }, { name: 'insight', friendlyName: 'Insight', stat: 4, value: 0 }, { name: 'intimidation', friendlyName: 'Intimidation', stat: 5, value: 0 }, { name: 'investigation', friendlyName: 'Investigation', stat: 3, value: 0 }, { name: 'medicine', friendlyName: 'Medicine', stat: 4, value: 0 }, { name: 'nature', friendlyName: 'Nature', stat: 3, value: 0 }, { name: 'perception', friendlyName: 'Perception', stat: 4, value: 0 }, { name: 'performance', friendlyName: 'Performance', stat: 5, value: 0 }, { name: 'persuasion', friendlyName: 'Persuasion', stat: 5, value: 0 }, { name: 'religion', friendlyName: 'Religion', stat: 3, value: 0 }, { name: 'sleight-of-hand', friendlyName: 'Sleight of Hand', stat: 1, value: 0 }, { name: 'stealth', friendlyName: 'Stealth', stat: 1, value: 0 }, { name: 'survival', friendlyName: 'Survival', stat: 4, value: 0 } ]
const weapons = { simple: [ 'Club', 'Dagger', 'Greatclub', 'Handaxe', 'Javelin', 'Light Hammer', 'Mace', 'Quarterstaff', 'Sickle', 'Spear', 'Crossbow, Light', 'Dart', 'Shortbow', 'Sling' ], martial: [ 'Battleaxe', 'Flail', 'Glaive', 'Greataxe', 'Greatsword', 'Halberd', 'Lance', 'Longsword', 'Maul', 'Morningstar', 'Pike', 'Rapier', 'Scimitar', 'Shortsword', 'Trident', 'War Pick', 'Warhammer', 'Whip', 'Blowgun', 'Crossbow, Hand', 'Crossbow, Heavy', 'Longbow', 'Net' ] }

function ddbGetCharacter(r_id, r_async) {
  // run through a proxy to avoid CORS errors
  var r_json, r_proxy
  r_proxy = "https://corsproxy.io/?"
  $.get({
    url: r_proxy + "https://character-service.dndbeyond.com/character/v5/character/" + r_id,
    success: function(result) { r_json = result },
    error: function(xhr, error) { console.log(xhr) },
    async: r_async || false
  });
  return r_json;
}

function ddbParseCharacter(char) {
  // Parses the json response of ddbGetCharacter to create easier access to common numbers that are overly complex by default.
  // a_* objects added to the json are calculated in this function. All other json is unmodified.

  char.a_ac = 0;
  char.a_level = 0;
  char.a_classes = [];
  char.a_subclasses = [];
  char.a_spells = [];
  char.a_weapons = [];
  char.a_stats = char.stats;
  char.a_proficiencies = {};
  char.a_proficiencies.saves = saves;
  char.a_proficiencies.skills = skills;
  char.a_proficiencies.weapons = [];
  char.a_proficiencies.armor = [];
  char.a_proficiencies.languages = [];
  char.a_proficiencies.defenses = [];
  char.a_proficiencies.scores = [];
  char.a_proficiencies.tools = [];
  char.a_proficiencies.other = [];

  // convert alignmentId to actual alignment text using hard-coded array above (wasn't able to find another reference in the json)
  char.a_alignment = alignments[char.alignmentId];

  // add calculated initial modifier to the stats
  char.a_stats.forEach((stat) => { stat.mod = Math.floor((stat.value - 10) / 2); if ( stat.mod >= 0 ) { stat.mod = "+" + stat.mod; } });

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
      if ( mod.entityTypeId == 1472902489 ) {  // score bonus
        char.a_stats[mod.entityId - 1].value += Number(mod.fixedValue);
	char.a_stats[mod.entityId - 1].mod = Math.floor((char.a_stats[mod.entityId - 1].value - 10) / 2);
	if ( char.a_stats[mod.entityId - 1].mod >= 0 ) { char.a_stats[mod.entityId - 1].mod = "+" + char.a_stats[mod.entityId - 1].mod; }
      }
    });
  }

  // create base modifier for each of the saving throws and skills (using the hard-coded list above, since I wasn't able to find a complete reference in the json)
  for ( var source in char.a_proficiencies ) {
    char.a_proficiencies[source].forEach((prof) => { prof.mod = Number(char.a_stats[prof.stat].mod); if ( prof.mod >= 0 ) { prof.mod = "+" + prof.mod; } });
  }

  // add proficiency bonus for proficiencies (and expertise)
  for ( var source in char.modifiers ) {  // multiple sources of modifiers exist in the json, from background, class, feat, item, and race
    char.modifiers[source].forEach((mod) => {
      if ( mod.subType.includes('-saving-throws') ) {  // saves
	var prof = jsonSearch(char.a_proficiencies.saves, 'name', mod.subType)[0];
	prof.proficiency = "proficient";
	prof.mod = Number(char.a_stats[prof.stat].mod) + Number(char.a_profBonus);
	if ( prof.mod >= 0 ) { prof.mod = "+" + prof.mod; }
      } else if ( mod.entityTypeId == 1958004211 ) {  // skills
	var prof = jsonSearch(char.a_proficiencies.skills, 'name', mod.subType)[0];
	if ( mod.type == "expertise" && !prof.proficiency ) {
	  prof.proficiency = "expert";
	  prof.mod = Number(char.a_stats[prof.stat].mod) + ( Number(char.a_profBonus) * 2 );
	  if ( prof.mod >= 0 ) { prof.mod = "+" + prof.mod; }
	} else if ( mod.type == "proficiency" && !prof.proficiency ) {
	  prof.proficiency = "proficient";
	  prof.mod = Number(char.a_stats[prof.stat].mod) + Number(char.a_profBonus);
	  if ( prof.mod >= 0 ) { prof.mod = "+" + prof.mod; }
	} else if ( mod.type == "half-proficiency" && !prof.proficiency ) {
	  prof.proficiency = "half-proficient";
	  prof.mod = Number(char.a_stats[prof.stat].mod) + Math.floor( Number(char.a_profBonus) / 2 );
	  if ( prof.mod >= 0 ) { prof.mod = "+" + prof.mod; }
	}
      } else if ( mod.entityTypeId == 1782728300 || mod.subType.includes('weapons') ) {  // weapons
	char.a_proficiencies.weapons.push(mod);
      } else if ( mod.entityTypeId == 174869515 ) {  // armor
	char.a_proficiencies.armor.push(mod);
      } else if ( mod.entityTypeId == 906033267 ) {  // languages
	char.a_proficiencies.languages.push(mod);
      } else if ( mod.entityTypeId == 349597128 ) {  // defenses
	char.a_proficiencies.defenses.push(mod);
      } else if ( mod.entityTypeId == 1472902489 ) {  // scores
	char.a_proficiencies.scores.push(mod);
      } else if ( mod.entityTypeId == 2103445194 ) {  // tools
	char.a_proficiencies.tools.push(mod);
      } else { char.a_proficiencies.other.push(mod); }
    });
  }

  // simply set initiative modifier to the Dexterity modifier
  var init = jsonSearch(char.a_proficiencies.other, 'subType', 'initiative')[0];
  char.a_initiative = {}; char.a_initiative.value = char.a_stats[1].mod;
  if ( init ) { char.a_initiative.icon = 'ddb-' + init.friendlyTypeName.toLowerCase(); }

  // populate AC from any equipped armor, unarmored defense, or shield
  char.inventory.forEach((inv) => { if ( inv.equipped == true && inv.definition && inv.definition.armorTypeId == 3 && Number(inv.definition.armorClass) > 0 ) { char.a_ac = Number(inv.definition.armorClass); } });
  var unarmored = jsonSearch(char.a_proficiencies.other, 'subType', 'unarmored-armor-class')[0];
  if ( char.a_ac == 0 && unarmored ) {
    char.a_ac = 10 + Number(char.a_stats[1].mod) + Number(char.a_stats[unarmored.statId - 1].mod)
  }
  char.inventory.forEach((inv) => {
    if ( inv.equipped == true && inv.definition && inv.definition.armorTypeId == 4 && Number(inv.definition.armorClass) > 0 ) {
      char.a_ac += Number(inv.definition.armorClass);
      if ( inv.definition.grantedModifiers ) {
        inv.definition.grantedModifiers.forEach((mod) => { if ( mod.subType == "armor-class" ) { char.a_ac += mod.fixedValue; } });
      }
    }
  });

  // other misc derived stats (some are used for spells, so we set them here)
  char.a_passivePerception = 10 + Number(char.a_proficiencies.skills[11].mod);
  char.a_passiveInvestigation = 10 + Number(char.a_proficiencies.skills[8].mod);
  char.a_passiveInsight = 10 + Number(char.a_proficiencies.skills[6].mod);
  char.a_hp = Number(char.baseHitPoints) + ( Number(char.a_stats[2].mod) * Number(char.a_level) );
  char.a_hitDice = char.a_level - char.classes[0].hitDiceUsed;
  char.a_hitDieSize = '1d' + char.classes[0].definition.hitDice + char.a_stats[2].mod;
  if ( char.classes[0].definition.spellCastingAbilityId ) {  // these only apply to spellcasting classes
    char.a_spellCastingAbility = saves[char.classes[0].definition.spellCastingAbilityId - 1].shortName;
    char.a_spellCastingMod = char.a_stats[char.classes[0].definition.spellCastingAbilityId - 1].mod;
    char.a_spellCastingAttack = Number(char.a_stats[char.classes[0].definition.spellCastingAbilityId - 1].mod) + Number(char.a_profBonus);
    if ( char.a_spellCastingAttack >= 0 ) { char.a_spellCastingAttack = "+" + char.a_spellCastingAttack; }
    char.a_spellCastingSave = 8 + Number(char.a_stats[char.classes[0].definition.spellCastingAbilityId - 1].mod) + Number(char.a_profBonus);
  } else if (char.classes[0].definition.name == "Monk" ) {
    char.a_spellCastingSave = 8 + Number(char.a_stats[4].mod) + Number(char.a_profBonus);  // 8 + WIS + Prof for monks
  }

  // add spells to a new object grouped by level (not sure what's up with this separate classSpells object, but seems it's necessary)
  for ( var source in char.spells ) {  // multiple sources of spells exist in the json, from background, class, feat, item, and race
    if ( char.spells[source] ) {
      char.spells[source].forEach((spell) => {
	spell.a_effect = {};
        var dmg = jsonSearch(spell.definition.modifiers, 'type', 'damage')[0];
        if ( !char.a_spells[spell.definition.level] ) { char.a_spells[spell.definition.level] = []; }
        if ( spell.definition.activation.activationTime >= 1 ) { spell.a_time = spell.definition.activation.activationTime; } else { spell.a_time = ''; }
        spell.a_time += activation[spell.definition.activation.activationType];
	if ( spell.definition.requiresAttackRoll == true ) {
          spell.a_effect.value = spell.definition.modifiers[0].die.diceString;
	  spell.a_hit = char.a_spellCastingAttack;
	} else if ( spell.definition.requiresSavingThrow == true ) {
	  if ( dmg ) { spell.a_effect.value = dmg.die.diceString; spell.a_effect.icon = 'ddb-' + dmg.subType; } else { spell.a_effect.value = spell.definition.tags[0]; }
	  spell.a_hit = saves[spell.definition.saveDcAbilityId - 1].shortName + char.a_spellCastingSave;
        } else {
	  if ( dmg ) { spell.a_effect.value = dmg.die.diceString; spell.a_effect.icon = 'ddb-' + dmg.subType; } else { spell.a_effect.value = spell.definition.tags[0]; }
	  spell.a_hit = '-';
	}
	if ( spell.definition.range.rangeValue > 0 ) { spell.a_range = spell.definition.range.rangeValue + ' ft.'; } else { spell.a_range = spell.definition.range.origin; }
        spell.a_notes = spell.definition.components;
        for ( let i = 0; i < spell.a_notes.length; i++ ) { spell.a_notes[i] = components[i]; }
        spell.a_notes = spell.a_notes.join('/');
        char.a_spells[spell.definition.level].push(spell);
      });
    }
  }
  for ( var index in char.classSpells ) {
    if ( char.classSpells[index] ) {
      char.classSpells[index].spells.forEach((spell) => {
	spell.a_effect = {};
        var dmg = jsonSearch(spell.definition.modifiers, 'type', 'damage')[0];
        if ( !char.a_spells[spell.definition.level] ) { char.a_spells[spell.definition.level] = []; }
        if ( spell.definition.activation.activationTime >= 1 ) { spell.a_time = spell.definition.activation.activationTime; } else { spell.a_time = ''; }
        spell.a_time += activation[spell.definition.activation.activationType];
	if ( spell.definition.requiresAttackRoll == true ) {
          spell.a_effect.value = spell.definition.modifiers[0].die.diceString;
	  spell.a_hit = char.a_spellCastingAttack;
	} else if ( spell.definition.requiresSavingThrow == true ) {
	  if ( dmg ) { spell.a_effect.value = dmg.die.diceString; spell.a_effect.icon = 'ddb-' + dmg.subType; } else { spell.a_effect.value = spell.definition.tags[0]; }
	  spell.a_hit = saves[spell.definition.saveDcAbilityId - 1].shortName + char.a_spellCastingSave;
        } else {
	  if ( dmg ) { spell.a_effect.value = dmg.die.diceString; spell.a_effect.icon = 'ddb-' + dmg.subType; } else { spell.a_effect.value = spell.definition.tags[0]; }
	  spell.a_hit = '-';
	}
	if ( spell.definition.range.rangeValue > 0 ) { spell.a_range = spell.definition.range.rangeValue + ' ft.'; } else { spell.a_range = spell.definition.range.origin; }
        spell.a_notes = spell.definition.components;
        for ( let i = 0; i < spell.a_notes.length; i++ ) { spell.a_notes[i] = components[i]; }
        spell.a_notes = spell.a_notes.join('/');
        char.a_spells[spell.definition.level].push(spell);
      });
    }
  }

  // inventory and weapons (including unarmed strike)
  char.inventory.forEach((inv) => {
    if ( inv.equipped == true && inv.isAttuned == true ) {
      inv.a_icon = 'ddb-attunement';
    }
    if ( inv.equipped == true && inv.definition && inv.definition.filterType == "Weapon" ) {
      inv.a_damage = {}; inv.a_bonus = 0;
      var simple = weapons.simple.includes(inv.definition.type);
      var martial = weapons.martial.includes(inv.definition.type);
      var finesse = jsonSearch(inv.definition.properties, 'name', 'Finesse')[0];
      var prof = jsonSearch(char.a_proficiencies.weapons, 'friendlySubtypeName', inv.definition.name)[0] || ( simple && jsonSearch(char.a_proficiencies.weapons, 'subType', 'simple-weapons')[0] ) || ( martial && jsonSearch(char.a_proficiencies.weapons, 'subType', 'martial-weapons')[0] );
      if ( inv.definition.grantedModifiers ) { inv.definition.grantedModifiers.forEach((mod) => { if ( mod.type == "bonus" ) { inv.a_bonus += mod.fixedValue; } }); }
      if ( inv.definition.attackType == 2 || finesse ) { inv.a_hit = Number(char.stats[1].mod); } else if ( inv.definition.attackType == 1 ) { inv.a_hit = Number(char.stats[0].mod); }
      if ( prof && prof.type == "proficiency" ) { inv.a_hit += Number(char.a_profBonus); } else if ( prof && prof.type == "expertise" ) { inv.a_hit += Number(char.a_profBonus) * 2; }
      inv.a_hit += inv.a_bonus;
      if ( inv.a_hit >= 0 ) { inv.a_hit = "+" + inv.a_hit; }
      if ( inv.definition.attackType == 2 || finesse ) {
        inv.a_bonusDamage = Number(char.a_stats[1].mod) + Number(inv.a_bonus);
        if ( inv.a_bonusDamage >= 0 ) { inv.a_bonusDamage = "+" + inv.a_bonusDamage; }
	inv.a_damage.value = inv.definition.damage.diceString + inv.a_bonusDamage;
      } else if ( inv.definition.attackType == 1 ) {
        inv.a_bonusDamage = Number(char.a_stats[0].mod) + Number(inv.a_bonus);
        if ( inv.a_bonusDamage >= 0 ) { inv.a_bonusDamage = "+" + inv.a_bonusDamage; }
	inv.a_damage.value = inv.definition.damage.diceString + inv.a_bonusDamage;
      }
      inv.a_damage.icon = 'ddb-' + inv.definition.damageType.toLowerCase();
      inv.a_notes = inv.definition.tags.join(', ');
      char.a_weapons.push(inv);
    }
  });  // add special case of unarmed strike
  var unarmed = { "definition": { "name": "Unarmed Strike", "damage": {} } }
  unarmed.a_hit = Number(char.a_stats[0].mod) + Number(char.a_profBonus); if ( unarmed.a_hit >= 0 ) { unarmed.a_hit = "+" + unarmed.a_hit; }
  unarmed.a_damage = {}; unarmed.a_damage.icon = 'ddb-bludgeoning';
  unarmed.a_damage.value = 1 + Number(char.a_stats[0].mod); if ( unarmed.a_damage.value < 0 ) { unarmed.a_damage.value = 0 }
  char.a_weapons.push(unarmed);

  // speeds and modifiers to walking speed
  char.a_speeds = char.race.weightSpeeds.normal;
  var speedMods = [ ...jsonSearch(char.a_proficiencies.other, 'subType', 'speed'), ...jsonSearch(char.a_proficiencies.other, 'subType', 'unarmored-movement') ];
  speedMods.forEach((mod) => { char.a_speeds.walk += mod.fixedValue; });

  // conditions - just need to add the name
  char.conditions.forEach((cond) => { cond.name = conditions[cond.id]; });

  return char;
}
