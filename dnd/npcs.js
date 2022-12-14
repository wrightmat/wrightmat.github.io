var npcs = [];
var align_selected = [];
var page;
var blocks = [];

window.addEventListener("load", init, false);

function init() {
    navbar();
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

function exportToNotion(npc) {
  var pageId
  var ob = {
	name: npc.name, 
        gender: npc.gender.title,
        race: npc.race.title,
        attitude: npc.attitude,
	occupation: npc.type.title,
  };
  d = JSON.stringify(ob);
  pageId = notionCreatePage(d);
  return pageId
}

function notionCreatePage(d) {
  var r
  $.post({
    url: "https://eofnfmyljbhw62c.m.pipedream.net",
    headers: { 'Authorization': 'Bearer ' + getCookie("notion-key") },
    contentType: "application/json",
    data: d,
    success: function(result) {
	r = result
    },
    error: function(xhr, error) {
	console.log(xhr)
    },
    async: false
  });
  return r
}

function notionAppendBlock(p, b) {
  var r
  var d = new Object();
  d.pageId = p;
  d.blocks = b;
  d = JSON.stringify(d);

  $.post({
    url: "https://eowhfyaadh1pn3s.m.pipedream.net",
    headers: { 'Authorization': 'Bearer ' + getCookie("notion-key") },
    contentType: "application/json",
    data: d,
    success: function(result) {
	r = result
    },
    error: function(xhr, error) {
	console.log(xhr)
    },
    async: false
  });
  return r
}

function changeAlignment() {
    if ($('#npc-alignment').find(':selected').val() != 'random') {
	$('#tbl-alignment').hide();
    } else {
	$('#tbl-alignment').show();
    }
}

function generateNPC() {
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

    var attitude = getTableResult(npc_attitude);
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
    var hp = [];
    hp.value = type.hp[0];
    hp.roll = type.hp[1];

    var npc = new Object();
    npc.location = $('#npc-location').find(':selected').val();
    npc.name = name;
    npc.race = race;
    npc.type = type;
    npc.alignment = alignment;
    npc.gender = gender;
    npc.attitude = attitude;
    npc.orientation = orientation;
    npc.relationship = relationship;
    npc.age = age;
    npc.height = height;
    npc.weight = weight;
    npc.eyes = eyes;
    npc.hair = hair;
    npc.skin = skin;
    npc.appearance = appearance;
    npc.talent = talent;
    npc.mannerism = mannerism;
    npc.interaction_trait = interaction_trait;
    npc.bond = bond;
    npc.flaw = flaw;
    npc.ideal = ideal;
    npc.saying = saying.saying;
    npc.ac = type.ac;
    npc.hp = hp;
    npc.speed = speed;
    npc.stats = stats;
    npc.cr = type.cr;
    npc.saves = type.saves;
    npc.skills = type.skills;
    npc.abilities = type.abilities;
    npc.actions = type.actions;
    npc.reactions = type.reactions;
    npc.description = type.description;
    npcs.push(npc);
    populateOutput(0, npcs[npcs.length-1]);
    refreshSelect(npcs.length-1);
}

function refreshSelect(sel) {
    page = "";
    $('#npc-select').empty();
    for (let i = 0; i < npcs.length; i++) {
	$('#npc-select').append('<option value="">' + npcs[i].name + ' (' + npcs[i].race.title + ' ' + npcs[i].type.title + ')</option>');
    }
    if (sel >= 0) {
	$('#npc-select option')[sel].selected = true;
    }
}

function changeSelect(el) {
    populateOutput(0, npcs[el.selectedIndex]);
}

function changeFormat(el) {
    var sel = $('#npc-select').prop('selectedIndex');
    if (sel >= 0) {
	populateOutput(el.selectedIndex, npcs[sel]);
    }
}

function removeNPC() {
    if ($('#npc-select').prop('selectedIndex') > -1) {
	npcs.splice($('#npc-select').prop('selectedIndex'), 1);
	refreshSelect();
    }
}

function exportNPC() {
    if ($('#npc-select').prop('selectedIndex') > -1) {
	var npc = npcs[$('#npc-select').prop('selectedIndex')];
	// Give status update, since Notion page creation can take some time.
	var sts_1 = "<p>Creating new Notion page for '" + npc.name + "'...</p>";
	$("#div-status").append(sts_1);
	// Create new Notion page
	var pageId = exportToNotion(npc);
	page = pageId;
	var sts_2 = "<p>Notion page created with id " + pageId + "</p>";
	$("#div-status").append(sts_2);
	// Format text and copy to clipboard so it can be pasted into Notion.
	// This won't be needed in the future when we can use the Notion API to add blocks to the new page, but there's an error in Pipedream.
	$("#npc-format").prop("selectedIndex", 2).change();
	notionAppendBlock(pageId, blocks);
	var sts_3 = "<p>Notion blocks appended.</p>";
	$("#div-status").append(sts_3);
	setTimeout( function() { $("#div-status").html(""); }, 10000);
    }
}

function outputLine(type, id, header, cell, suppl) {
    // type: 0 = table, 1 = markdown, 2 = notion blocks
    var header = header || "";
    if (type == 0) {
	var updated = false;
	$('#tbl-npc tr').each(function() {
	    if (id !== "" && id == this.id) {
		updated = true;
		if (header !== "") { $(this).find('th').text(header); }
		if (cell !== "") { $(this).find('td:eq(0)').text(cell); }
		$(this).find('td:eq(1)').html(replaceText($(this).find('td:eq(1)').attr("id"), cell));
	    }
	})
	if (!updated) {
	    var line = ""
	    if (typeof suppl == "undefined") { suppl = "" }
	    if (id == "") {
		line = '<tr><th>' + header +'</th><td>&nbsp;</td></tr>';
	    } else {
		line = '<tr id="' + id + '"><th>' + header + '</th><td id="' + id + '">' + cell + '</td><td id="' + suppl + '">' + replaceText(suppl, cell) + '</td></tr>';
	    }
	    $('#tbl-npc').append(line);
	}
    } else if (type == 1) {
    	var line = "" 
	if (id == "") {
	    if (header != "") { header = '**' + header + '**' }
	    line = header + '<br />';
	} else {
	    if (header != "") {
	    	line = '**' + header + '**: ' + cell + '<br />';
	    } else {
		line = cell + '</br />';
	    }
	}
	$('#div-npc').append(line);
    } else if (type == 2) {
	var block = new Object();
	var rtx = new Object();
	var rtx_array = []
	var text_bold = new Object();
	var text_reg = new Object();

	text_bold.type = 'text';
	text_bold.annotations = {};
	text_bold.annotations.bold = true;
	text_bold.text = '{ content: "' + header + ': " }, annotations: { bold: true }';
	text_bold_content = new Object();
	if (header != "") { header += ': ' }
	text_bold_content.content = header || "";
	text_bold.text = text_bold_content;

	text_reg.type = 'text';
	text_reg_content = new Object();
	var c = cell || "";
	text_reg_content.content = String(c);
	text_reg.text = text_reg_content;

	rtx_array.push(text_bold);
	rtx_array.push(text_reg);
	rtx.rich_text = rtx_array;

	block.object = 'block';
	block.type = 'paragraph';
	block.paragraph = rtx;

	blocks.push(block);
	$('#div-npc').append(JSON.stringify(block));
    }
}

function outputStats(type, stats) {
    var line = ""
    var stat_names = [ "Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma" ]
    var stat_abbr = [ "STR", "DEX", "CON", "INT", "WIS", "CHA" ]
    if (type == 0) {
	line += '<tr><th></th><td>';
	stats.forEach(function (item, index) {
	    line += "<iframe src='dice.htm?ability=" + item + "&pad=false&label=" + stat_names[index] + "' style='width:110px;height:130px;border:0px;'></iframe>";
	});
	line += '</td></tr>';
	$('#tbl-npc').append(line);
    } else if (type == 1) {
	line = stat_abbr[0] + ": " + stats[0] + ", " + stat_abbr[1] + ": " + stats[1] + ", " + stat_abbr[2] + ": " + stats[2] + ", " + stat_abbr[3] + ": " + stats[3] + ", " + stat_abbr[4] + ": " + stats[4] + ", " + stat_abbr[5] + ": " + stats[5] + "<br />"
	$('#div-npc').append(line);
    } else if (type == 2) {

    }
}

function replaceText(suppl, txt, char = "^") {
    var replaced = ""
    if (suppl.indexOf(char) >= 0) {
	replaced = suppl.replaceAll(char, txt);
    } else {
	replaced = suppl;
    }
    return replaced;
}

function populateOutput(type, npc) {
    if (type == 0) {
	$('#div-npc').html('<table id="tbl-npc"><tbody></tbody></table>');
    } else if (type >= 1) {
	$('#div-npc').html('');
    }
    if (type == 3) {
	document.getElementById("div-npc").innerHTML = JSON.stringify(npc);
    } else {
	outputLine(type, "name", "Name", npc.name);
	outputLine(type, "race", "Race", npc.race.title);
	outputLine(type, "type", "Type", npc.type.title);
	outputLine(type, "");
	outputLine(type, "alignment", "Alignment", npc.alignment.toUpperCase());
	outputLine(type, "attitude", "Initial Attitude", npc.attitude);
	outputLine(type, "gender", "Gender", npc.gender.title);
	outputLine(type, "relationship", "Relationship Status", npc.relationship);
	outputLine(type, "orientation", "Sexual Orientation", npc.orientation);
	outputLine(type, "");
	outputLine(type, "age.age", "Age", npc.age.age, "^ (" + npc.age.group + ")");
	outputLine(type, "height", "Height", npc.height, "^ in.");
	outputLine(type, "weight", "Weight", npc.weight, "^ lbs.");
	outputLine(type, "eyes", "Eyes", npc.eyes);
	outputLine(type, "hair", "Hair", npc.hair);
	outputLine(type, "skin", "Skin", npc.skin);
	outputLine(type, "");
	outputLine(type, "appearance", "Appearance", npc.appearance);
	outputLine(type, "talent", "Talents", npc.talent);
	outputLine(type, "bond", "Bonds", npc.bond);
	outputLine(type, "flaw", "Flaws", npc.flaw);
	outputLine(type, "ideal", "Ideals", npc.ideal);
	outputLine(type, "");
	outputLine(type, "interaction_trait", "Interaction Traits", npc.interaction_trait);
	outputLine(type, "mannerism", "Mannerisms", npc.mannerism);
	outputLine(type, "saying", "Saying", npc.saying);
	outputLine(type, "");
	outputLine(type, "ac", "AC", npc.ac);
	outputLine(type, "hp.value", "HP", npc.hp.value, "<iframe src='dice.htm?roll=" + encodeURIComponent(npc.hp.roll) + "&pad=false' style='width:110px;height:30px;border:0px;' scrolling='no'></iframe>");
	outputLine(type, "speed", "Speed", npc.speed, "^ ft.");
	outputLine(type, "");
	outputLine(type, "", "Stats");
	outputStats(type, npc.stats);
	outputLine(type, "");
	if (npc.type.saves !== undefined) {
	    outputLine(type, "saves", "Saving Throws", npc.type.saves);
	}
	if (npc.type.skills !== undefined) {
	    outputLine(type, "skills", "Skills", npc.type.skills);
	}
	outputLine(type, "cr", "CR", npc.type.cr);
	outputLine(type, "");
	if (npc.type.abilities !== undefined && npc.type.abilities.length > 0) {
	    outputLine(type, "", "Abilities");
	    for (let i = 0; i < npc.type.abilities.length; i++) {
		outputLine(type, "ability_" + i, "", npc.type.abilities[i]);
	    }
	}
	if (npc.type.actions !== undefined && npc.type.actions.length > 0) {
	    outputLine(type, "", "Actions");
	    for (let i = 0; i < npc.type.actions.length; i++) {
		outputLine(type, "action_" + i, "", npc.type.actions[i]);
	    }
	}
	if (npc.type.reactions !== undefined && npc.type.reactions.length > 0) {
	    outputLine(type, "", "Reactions");
	    for (let i = 0; i < npc.type.reactions.length; i++) {
		outputLine(type, "reaction_" + i, "", npc.type.reactions[i]);
	    }
	}
	outputLine(type, "");
	outputLine(type, "description", "Description", npc.type.description);
    }
}

function exportNPCs() {
    var title = prompt("Enter a filename (.json will be added)", "npcs");
    if (title !== null) {
	var blob = new Blob(npcs, {type: "text/plain;charset=utf-8"});
	saveAs(blob, title + ".json");
    }
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
});

$(document).on("dblclick", "#tbl-npc td", function() {
    if ($(this).attr("id") != undefined) {
	if ($(this).attr("id").indexOf(".") >= 0) {
	    var id = $(this).attr("id").substring(0,$(this).attr("id").indexOf("."));
	    var id_2 = $(this).attr("id").substring($(this).attr("id").indexOf(".")+1,$(this).attr("id").length);
	} else {
	    var id = $(this).attr("id");
	}
	if (typeof npcs[0][id] == "string" || typeof npcs[0][id] == "number" || typeof npcs[0][id][id_2] == "string" || typeof npcs[0][id][id_2] == "number") {
	    if (typeof npcs[0][id][id_2] !== "undefined") {
		var td_text = npcs[0][id][id_2];
	    } else {
		var td_text = npcs[0][id];
	    }
	    var td_text_new = prompt("Enter new value:", td_text);
	    if (td_text_new != null) {
		outputLine(0, $(this).attr("id"), "", td_text_new);
		if (typeof npcs[0][id][id_2] !== "undefined") {
		    npcs[0][id][id_2] = $(this).text();
		} else {
		    npcs[0][id] = $(this).text();
		}
	    }
	}
    }
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