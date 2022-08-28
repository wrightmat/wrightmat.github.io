var align_selected = [];
function init() {
    // populate npc choices from json data
    npc_type.forEach(function (item) {
	if (item.title != undefined) {
	    $('#npc-type').append(`<option id="${item.title}">${item.title}</option>`);
	}
    });
    npc_race.forEach(function (item) {
	if (typeof item == "string") {
	    $('#npc-race').append(`<option id="${item}">${item}</option>`);
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
    var ind

    var name = generate_name('Dragonborn Clan');
    if ($('#npc-type').find(':selected').val() == 'random') {
	var type = getTableResult(npc_type);
	var stats = type.stats;
	type = type.title;
    } else {
	npc_type.forEach(function (item) {
	    if (item.title != undefined) {
		if (item.title == $('#npc-type').find(':selected').val()) {
		    ind = item;
		}
	    }
	});
	var stats = ind.stats;
	var type = ind.title;
    }
    if ($('#npc-race').find(':selected').val() == 'random') {
	var race = getTableResult(npc_race);
    } else {
	var race = $('#npc-race').find(':selected').val()
    }
    if ($('#npc-gender').find(':selected').val() == 'random') {
	var gender = getTableResult(npc_gender).title;
    } else {
	var gender = $('#npc-gender').find(':selected').val()
    }
    if ($('#npc-alignment').find(':selected').val() == 'random') {
	var alignment = align_selected[Math.floor(Math.random() * align_selected.length)]
    } else {
	var alignment = $('#npc-alignment').find(':selected').val()
    }
    if (race == "Half-Elf") {
	var names = name_set['Elf ' + gender].concat(name_set['Human ' + gender]);
	var name = generate_name(names);
    } else if (race == "Half-Orc") {
	var names = name_set['Orc ' + gender].concat(name_set['Human ' + gender]);
	var name = generate_name(names);
    } else if (['Changeling','Kalashtar','Shifter','Warforged'].includes(race)) {
	var name_type = race;
	var name = generate_name(name_type);
    } else {
	var name_type = race + ' ' + gender;
	var name = generate_name(name_type);
    }
    var appearance = getTableResult(npc_appearance);
    var ability_high = getTableResult(npc_ability_high);
    var ability_low = getTableResult(npc_ability_low);
    var talents = getTableResult(npc_talents);
    var mannerisms = getTableResult(npc_mannerisms);
    var interaction_traits = getTableResult(npc_interaction_traits);
    var bonds = getTableResult(npc_bonds);
    var flaws = getTableResult(npc_flaws);
    var ideal_1 = getTableResult(npc_ideals[alignment.substring(0,1).toUpperCase()])
    var ideal_2 = getTableResult(npc_ideals[alignment.substring(2,1).toUpperCase()])
    stats[ability_high.stat - 1] += ability_high.mod;
    stats[ability_low.stat - 1] += ability_low.mod;
    output += "<b>Name</b>: " + name + "<br /><br />";
    output += "<b>Type</b>: " + type + "<br />";
    output += "<b>Race</b>: " + race + "<br />";
    output += "<b>Gender</b>: " + gender + "<br />";
    output += "<b>Alignment</b>: " + alignment.toUpperCase() + "<br /><br />";
    output += "<b>Stats</b>: STR " + stats[0] + " (" + (Math.floor((stats[0]-10)/2)) + "), DEX " + stats[1] + " (" + (Math.floor((stats[1]-10)/2)) + "), CON " + stats[2] + " (" + (Math.floor((stats[2]-10)/2)) + "), INT " + stats[3] + " (" + (Math.floor((stats[3]-10)/2)) + "), WIS " + stats[4] + " (" + (Math.floor((stats[4]-10)/2)) + "), CHA " + stats[5] + " (" + (Math.floor((stats[5]-10)/2)) + ")<br /><br />";
    output += "<b>Appearance</b>: " + appearance + "<br />";
    output += "<b>Talents</b>: " + talents + "<br />";
    output += "<b>Interaction Traits</b>: " + interaction_traits + "<br />";
    output += "<b>Bonds</b>: " + bonds + "<br />";
    output += "<b>Flaws</b>: " + flaws + "<br />";
    output += "<b>Ideals</b>: " + ideal_1 + ", " + ideal_2 + "<br />";
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