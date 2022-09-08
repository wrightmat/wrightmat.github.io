var align_selected = [];
function init() {
    // populate npc choices from json data
    npc_locations.forEach(function (item) {
	if (typeof item == "string") {
	    $('#npc-location').append(`<option id="${item}">${item}</option>`);
	}
    });
    npc_type.forEach(function (item) {
	if (item.title != undefined) {
	    $('#npc-type').append(`<option id="${item.title}">${item.title}</option>`);
	}
    });
    npc_race.forEach(function (item) {
	if (item.title != undefined) {
	    $('#npc-race').append(`<option id="${item.title}">${item.title}</option>`);
	}
    });
    npc_gender.forEach(function (item) {
	if (item.title != undefined) {
	    $('#npc-gender').append(`<option id="${item.pronouns[0]}">${item.title}</option>`);
	}
    });
    // highlight all alignments by default
    $('#tbl-alignment').find("td").each(function (i, item) {
	$(item).addClass('bg_grey');
	align_selected.push(item.id);
    });
}

function changeAlignment() {
    if ($('#npc-alignment').find(':selected').val() != 'random') {
	$('#tbl-alignment').hide();
    } else {
	$('#tbl-alignment').show();
    }
}

function generateNPC() {
    var output = ""

    if ($('#npc-type').find(':selected').val() == 'random') {
	var type = getTableResult(npc_type);
    } else {
	var ind = []
	npc_type.forEach(function (item) {
	    if (item.title != undefined) {
		if (item.title == $('#npc-type').find(':selected').val()) {
		    ind = item;
		}
	    }
	});
	var type = ind;
    }
    if ($('#npc-race').find(':selected').val() == 'random') {
	if ($('#npc-location').find(':selected').val() == 'eberron') {
	    var race = getTableResult(npc_race);
	} else if ($('#npc-location').find(':selected').val() == 'space') {
	    while (race == undefined || race == 'Other') {
		var race = getTableResult(npc_race[$('#npc-location').find(':selected').text()]);
		var ind = []; npc_race.forEach(function (item) {
		    if (item.title != undefined) {
			if (item.title == race) { ind = item; }
		    }
		}); var race = ind
	    }
	} else {
	    while (race == undefined || race == 'Other') {
		var race = getTableResult(npc_race[$('#npc-location').find(':selected').text()]);
		var ind = []; npc_race.forEach(function (item) {
		    if (item.title != undefined) {
			if (item.title == race) { ind = item; }
		    }
		}); var race = ind
	    }
	}
    } else {
	var ind = []
	npc_race.forEach(function (item) {
	    if (item.title != undefined) {
		if (item.title == $('#npc-race').find(':selected').val()) {
		    ind = item;
		}
	    }
	});
	var race = ind
    }
    if ($('#npc-gender').find(':selected').val() == 'random') {
	var gender = getTableResult(npc_gender);
    } else {
	var ind = []
	npc_gender.forEach(function (item) {
	    if (item.title != undefined) {
		if (item.title == $('#npc-gender').find(':selected').val()) {
		    ind = item;
		}
	    }
	});
	var gender = ind
    }
    if ($('#npc-alignment').find(':selected').val() == 'random') {
	var alignment = align_selected[Math.floor(Math.random() * align_selected.length)]
    } else {
	var alignment = $('#npc-alignment').find(':selected').val()
    }
    // Half races - combine the two name sets before using the markov generator
    if (race.title == "Half-Elf") {
	var names = name_set['Elf ' + gender.title].concat(name_set['Human ' + gender.title]);
	var name = generate_name(names);
    } else if (race.title == "Half-Orc") {
	var names = name_set['Orc ' + gender.title].concat(name_set['Human ' + gender.title]);
	var name = generate_name(names);
    // Non-gendered races
    } else if (['Changeling','Kalashtar'].includes(race.title)) {
	var name_type = race.title;
	var name = generate_name(name_type);
    // Races with specific names that shouldn't use the markov generator
    } else if (['Shifter','Warforged'].includes(race.title)) {
	var name = name_set[race.title][Math.floor(Math.random() * name_set[race.title].length)];
    } else {
	var name_type = race.title + ' ' + gender.title;
	var name = generate_name(name_type);
    }

    var age = []; var height; var weight; var speed; var eyes = ""; var hair = ""; var skin = "";
    var tiers = [ "Young Adult", "Adult", "Middle Aged", "Older Adult", "Elderly" ];
    if (race.age) {
	age.age = getRandomInt(race.age[0], race.age[1]);
	var age_tiers = Math.floor((race.age[1] - race.age[0]) / 5);
	var age_tier = Math.floor(age.age / age_tiers);
	age.group = tiers[age_tier - 1];
    }
    if (race.height) { height = getRandomInt(race.height[0], race.height[1]); }
    if (race.weight) { weight = getRandomInt(race.weight[0], race.weight[1]); }
    if (race.speed) { speed = race.speed; }
    if (race.eyes) { eyes = getTableResult(race.eyes); }
    if (race.hair) { hair = getTableResult(race.hair); }
    if (race.skin) { skin = getTableResult(race.skin); }

    var orientation = getTableResult(npc_orientation);
    var relationship = getTableResult(npc_relationship);
    var appearance = getTableResult(npc_appearance);
    var ability_high = getTableResult(npc_ability_high);
    var ability_low = getTableResult(npc_ability_low);
    var talent = getTableResult(npc_talents);
    var mannerism = getTableResult(npc_mannerisms);
    var interaction_trait = getTableResult(npc_interaction_traits);
    var bond = getTableResult(npc_bonds);
    var flaw = getTableResult(npc_flaws);
    var ideal_1 = getTableResult(npc_ideals[alignment.substring(0,1).toUpperCase()])
    var ideal_2 = getTableResult(npc_ideals[alignment.substring(2,1).toUpperCase()])
    if (getRandomInt(0,1) == 0) { var ideal = ideal_1 } else { var ideal = ideal_2 }
    var saying; do { saying = getTableResult(npc_sayings); }
    while ( (saying.race != undefined && !saying.race.includes(race)) || (saying.alignment != undefined && !(saying.alignment.includes(alignment.substring(0,1)) || saying.alignment.includes(alignment.substring(2,1)))) || (saying.type != undefined && !saying.type.includes(type)) );
    var stats = type.stats;
    stats[ability_high.stat - 1] += ability_high.mod;
    stats[ability_low.stat - 1] += ability_low.mod;

    var npc = [];
    npc.name = name;
    npc.race = race;
    npc.type = type;
    npc.gender = gender;
    npc.orientation = orientation;
    npc.relationship = relationship;
    npc.age = age;
    npc.height = height;
    npc.weight = weight;
    npc.eyes = eyes;
    npc.hair = hair;
    npc.skin = skin;
    npc.alignment = alignment;
    npc.stats = stats;
    npc.speed = speed;
    npc.appearance = appearance;
    npc.talent = talent;
    npc.mannerism = mannerism;
    npc.interaction_trait = interaction_trait;
    npc.bond = bond;
    npc.flaw = flaw;
    npc.ideal = ideal;
    npc.saying = saying.saying
console.log(npc);

    output += "<b>Name</b>: " + name + "<br /><br />";

    output += "<b>Race</b>: " + race.title + "<br />";
    output += "<b>Type</b>: " + type.title + "<br /><br />";

    output += "<b>Gender</b>: " + gender.title + "<br />";
    output += "<b>Sexual Orientation</b>: " + orientation + "<br />";
    output += "<b>Relationship Status</b>: " + relationship + "<br /><br />";

    output += "<b>Age</b>: " + age.age + " (" + age.group + ")<br />";
    output += "<b>Height</b>: " + Math.floor(height/12) + "' " + (height%12) + "\" (" + height +" in.)<br />";
    output += "<b>Weight</b>: " + weight + " lbs.<br />";
    output += "<b>Eyes</b>: " + eyes + "<br />";
    output += "<b>Hair</b>: " + hair + "<br />";
    output += "<b>Skin</b>: " + skin + "<br /><br />";

    output += "<b>Alignment</b>: " + alignment.toUpperCase() + "<br />";
    output += "<b>Stats</b>: STR " + stats[0] + ", DEX " + stats[1] + ", CON " + stats[2] + ", INT " + stats[3] + ", WIS " + stats[4] + ", CHA " + stats[5] + "<br />";
    output += "<iframe src='dice.htm?ability=" + stats[0] + "&label=Strength' style='width:100px;height:120px;border:0px;'></iframe>";
    output += "<iframe src='dice.htm?ability=" + stats[1] + "&label=Dexterity' style='width:100px;height:120px;border:0px;'></iframe>";
    output += "<iframe src='dice.htm?ability=" + stats[2] + "&label=Constitution' style='width:100px;height:120px;border:0px;'></iframe>";
    output += "<iframe src='dice.htm?ability=" + stats[3] + "&label=Intelligence' style='width:100px;height:120px;border:0px;'></iframe>";
    output += "<iframe src='dice.htm?ability=" + stats[4] + "&label=Wisdom' style='width:100px;height:120px;border:0px;'></iframe>";
    output += "<iframe src='dice.htm?ability=" + stats[5] + "&label=Charisma' style='width:100px;height:120px;border:0px;'></iframe><br />";
    output += "<b>Speed</b>: " + speed + "<br /><br />";

    output += "<b>Appearance</b>: " + appearance + "<br />";
    output += "<b>Talents</b>: " + talent + "<br />";
    output += "<b>Mannerisms</b>: " + mannerism + "<br />";
    output += "<b>Interaction Traits</b>: " + interaction_trait + "<br />";
    output += "<b>Bonds</b>: " + bond + "<br />";
    output += "<b>Flaws</b>: " + flaw + "<br />";
    output += "<b>Ideals</b>: " + ideal + "<br /><br />";

    output += "<b>Saying</b>: " + saying.saying + "<br />";
    $('#div-npc').html(output);
}

$(document).on("click", "#tbl-alignment td", function() {
    if ($(this).attr("id") != undefined) {
	if (align_selected.includes($(this).attr("id"))) {
	    $(this).removeClass('bg_grey');
	    align_selected.splice(align_selected.indexOf($(this).attr("id")), 1)
	} else {
	    $(this).addClass('bg_grey');
	    align_selected.push($(this).attr("id"));
	}
    }
    console.log(align_selected);
});



// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
// name_generator.js
// written and released to the public domain by drow <drow@bin.sh>
// http://creativecommons.org/publicdomain/zero/1.0/

  let name_set = {};
  let chain_cache = {};

// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
// generator function

  function generate_name (type) {
    let chain; if (chain = markov_chain(type)) {
      return markov_name(chain);
    }
    return '';
  }

// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
// generate multiple

  function name_list (type, n_of) {
    let list = [];
    let i; for (i = 0; i < n_of; i++) {
      list.push(generate_name(type));
    }
    return list;
  }

// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
// get markov chain by type

  function markov_chain (type) {
    let chain; if (chain = chain_cache[type]) {
      return chain;
    } else if (typeof type == "object") {
      let list; if ((list = type) && list.length) {
        let chain; if (chain = construct_chain(list)) {
          chain_cache[type] = chain;
          return chain;
        }
      }
    } else {
      let list; if ((list = name_set[type]) && list.length) {
        let chain; if (chain = construct_chain(list)) {
          chain_cache[type] = chain;
          return chain;
        }
      }
    }
    return false;
  }

// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
// construct markov chain from list of names

  function construct_chain (list) {
    let chain = {};

    let i; for (i = 0; i < list.length; i++) {
      let names = list[i].split(/\s+/);
      chain = incr_chain(chain,'parts',names.length);

      let j; for (j = 0; j < names.length; j++) {
        let name = names[j];
        chain = incr_chain(chain,'name_len',name.length);

        let c = name.substr(0,1);
        chain = incr_chain(chain,'initial',c);

        let string = name.substr(1);
        let last_c = c;

        while (string.length > 0) {
          let c = string.substr(0,1);
          chain = incr_chain(chain,last_c,c);

          string = string.substr(1);
          last_c = c;
        }
      }
    }
    return scale_chain(chain);
  }
  function incr_chain (chain, key, token) {
    if (chain[key]) {
      if (chain[key][token]) {
        chain[key][token]++;
      } else {
        chain[key][token] = 1;
      }
    } else {
      chain[key] = {};
      chain[key][token] = 1;
    }
    return chain;
  }
  function scale_chain (chain) {
    let table_len = {};

    Object.keys(chain).forEach(key => {
      table_len[key] = 0;

      Object.keys(chain[key]).forEach(token => {
        let count = chain[key][token];
        let weighted = Math.floor(Math.pow(count,1.3));

        chain[key][token] = weighted;
        table_len[key] += weighted;
      });
    });
    chain['table_len'] = table_len;
    return chain;
  }

// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
// construct name from markov chain

  function markov_name (chain) {
    let parts = select_link(chain,'parts');
    let names = [];

    let i; for (i = 0; i < parts; i++) {
      let name_len = select_link(chain,'name_len');
      let c = select_link(chain,'initial');
      let name = c;
      let last_c = c;

      while (name.length < name_len) {
        c = select_link(chain,last_c);
        if (! c) break;

        name += c;
        last_c = c;
      }
      names.push(name);
    }
    return names.join(' ');
  }
  function select_link (chain, key) {
    let len = chain['table_len'][key];
        if (! len) return false;
    let idx = Math.floor(Math.random() * len);
    let tokens = Object.keys(chain[key]);
    let acc = 0;

    let i; for (i = 0; i < tokens.length; i++) {
      let token = tokens[i];

      acc += chain[key][token];
      if (acc > idx) return token;
    }
    return false;
  }

// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -