var groups = {};
var item_selected;

window.addEventListener("load", init, false);
function init() {
  navbar();
  populateGroups();
  populateEquipment();
  alphabetizeSelectList($('#select-items'));
  populateServices();
  alphabetizeSelectList($('#select-services'));
}

function populateGroups() {
  groups = getAPI("equipment-categories")['results']
  groups.forEach(function (item, index) {
    $('#select-groups').append('<option id="' + item.index + '" value="' + item.index +'">' + item.name +'</option>');
  });
}

function populateEquipment() {
  // SRD items (from API)
  groups.forEach(function (item, index) {
    var categories = getAPI("equipment-categories/" + item.index)['equipment']
    categories.forEach(function (it, ind) {
      $('#select-items').append('<option id="' + it.index + '" value="' + it.index +'">' + it.name +'</option>');
      $.ajax({   // asynchronously populate the equipment items (so the page doesn't hang while everything loads)
	url: "https://www.dnd5eapi.co" + it.url,
	success: function(result) { equipment.push(result); },
	error: function(xhr, error) { console.log(xhr) },
      });
    });
  });

  // Non-API (Eberron-specific, custom) content
  equipment.forEach(function (item, index) {
    $('#select-items').append('<option id="' + item.index + '" value="' + item.index +'">' + item.name +'</option>');
  });
}

function populateServices() {
  services.forEach(function (item, index) {
    $('#select-services').append('<option id="' + item.index + '" value="' + item.index +'">' + item.name +'</option>');
  });
}

function getAPI(r_type, r_async) {
  var r_text, r_url;
  if (r_type.substring(0, 4) !== "/api") {
    r_url = "/api/" + r_type;
  } else { r_url = r_type; }
  $.get({
    url: "https://www.dnd5eapi.co" + r_url,
    success: function(result) { r_text = result },
    error: function(xhr, error) { console.log(xhr) },
    async: r_async || false
  });
  return r_text;
}

function getGroup(index) {
  var r_group;
  Object.keys(groups).forEach( (key) => {
    if (groups[key]["index"] == index) {
      r_group = groups[key];
    }
  });
  return r_group;
}

function getEquipment(index) {
  var r_equip;
  Object.keys(equipment).forEach( (key) => {
    if (equipment[key]["index"] == index) {
      r_equip = equipment[key];
    }
  });
  return r_equip;
}

function getService(index) {
  var r_service;
  Object.keys(services).forEach( (key) => {
    if (services[key]["index"] == index) {
      r_service = services[key];
    }
  });
  return r_service;
}

function rebuildSelectByGroup(group) {
  $('#select-items option').remove();
  equipment.forEach(function (item, index) {
    if ( ( item.equipment_category && item.equipment_category.index == group.index ) || ( item.gear_category && item.gear_category.index == group.index ) || ( item.armor_category == group.name ) || ( item.armor_category+'s' == group.name ) || ( item.armor_category + ' Armor' == group.name ) || ( item.tool_category == group.name ) || ( item.tool_category && item.tool_category+'s' == group.name ) || ( item.vehicle_category == group.name ) || ( item.weapon_category + ' Weapons' == group.name ) || ( item.weapon_range + ' Weapons' == group.name ) || ( item.category_range + ' Weapons' == group.name ) ) {
      $('#select-items').append('<option id="' + item.index + '" value="' + item.index +'">' + item.name + '</option>');
    }
  });
  alphabetizeSelectList($('#select-items'))
}

function rebuildSelectByName(name) {
  $('#select-items option').remove();
  equipment.forEach(function (item, index) {
    if ( item.name.toLowerCase().includes(name.toLowerCase()) ) {
      $('#select-items').append('<option id="' + item.index + '" value="' + item.index +'">' + item.name + '</option>');
    }
  });
  alphabetizeSelectList($('#select-items'))
}

function selectItem(el) {
  var tooltip = "";
  var item = getEquipment(el.options[el.selectedIndex].id);
  tooltip += item["name"] + ', ' + item["equipment_category"]["name"];
  if (item["equipment_category"]["index"] == "adventuring-gear") {
    tooltip += ' (' + item["gear_category"]["name"] + ')';
  } else if (item["equipment_category"]["index"] == "mounts-and-vehicles") {
    tooltip += ' (' + item["vehicle_category"] + ')';
  } else if (item["equipment_category"]["index"] == "armor") {
    tooltip += ' (' + item["armor_category"] + ')';
  } else if (item["equipment_category"]["index"] == "weapon") {
    tooltip += ' (' + item["weapon_category"] + ')';
  } else if (item["equipment_category"]["index"] == "tools") {
    tooltip += ' (' + item["tool_category"] + ')';
  }
  if (item["cost"] != undefined) {
    tooltip += ', ' + item["cost"]["quantity"] + ' ' + item["cost"]["unit"];
  }
  if (item["weight"] != undefined) {
    tooltip += ', ' + item["weight"] + ' lbs';
  }
  $('#select-items').prop('title', tooltip);
}

function selectGroup(el) {
  var item = getGroup(el.options[el.selectedIndex].id);
  $('#select-groups').prop('title', item["name"]);
  rebuildSelectByGroup(item);
}

function selectService(el) {
  var item = getService(el.options[el.selectedIndex].id);
  $('#select-services').prop('title', item["name"]);
}

function filterEquipment(filters) {
  var e = [];
  equipment.forEach(function (item, index) {
    if (filters.includes(item.equipment_category.index)) {
      e.push(item);
    }
  });
  return e;
}

function filterServices(filters, by = 'service') {
  var s = [];
  services.forEach(function (item, index) {
    if ((by == "house" && filters.includes(item.house)) || (by == "service" && filters.includes(item.service_category.index))) {
      s.push(item);
    }
  });
  return s;
}

function generatePreset() {
  var i = 0;
  var items = {};
  var sel = $('#preset-location option:selected').attr('id');
  var sel_index = $('#preset-location').prop('selectedIndex');
  $('#div-output').html('<table id="items-table" class="table table-striped"><tbody><tr><th>Name</th><th>Category</th><th>Cost</th><th>Description</th><th></th></tr></tbody></table>');

  if (sel == "general-store") {
    var e_items = filterEquipment(['adventuring-gear','ammunition','tools','potion']);
  } else if (sel == "armor-shop") {
    var e_items = filterEquipment(['armor']);
  } else if (sel == "weapon-shop") {
    var e_items = filterEquipment(['weapon']);
  } else if (sel == "potion-shop") {
    var e_items = filterEquipment(['potion']);
  } else if (sel == "magic-shop") {
    var e_items = filterEquipment(['potion','ring','rod','scroll','staff','wand','wondrous-item']);
  } else if (sel == "tool-shop") {
    var e_items = filterEquipment(['tools']);
  } else if (sel_index >= 7)  {
    var s_items = filterServices([sel], 'house');
    if (sel == "cannith") {
      var e_items = [ ...filterEquipment(['armor']), ...filterEquipment(['armor']) ]
    } else if (sel == "jorasco") {
      var e_items = [ ...filterEquipment(['armor']), ...filterEquipment(['potion']) ]
    } else if (sel == "cannith") {
      var e_items = [ ...filterEquipment(['armor']), ...filterEquipment(['tools']) ]
    }
  }

  if (e_items != undefined) {
    var shuffled = e_items.sort(() => 0.5 - Math.random());  // create a random sub-set of equipment items
    var e_items = shuffled.slice(0, Math.floor(Math.random() * 21) + 5);  // grab 5 to 25 items for the inventory
    for (const [key, value] of Object.entries(e_items)) {
      items[i] = value;
      i += 1;  var cost = "";
      if (value["cost"] != undefined) { 
        cost = value["cost"]["quantity"] + ' ' + value["cost"]["unit"]
        if (value["cost"]["per"] != undefined) { cost += " per " + value["cost"]["per"] }
      }
      $('#items-table > tbody:last-child').append('<tr id="' + value["index"] + '"><td id="name">' + value["name"] + '</td><td id="category">' + value["equipment_category"]["name"] + '</td><td id="cost">' + cost + '</td><td id="description">' + value["desc"] + '</td><td id="delete" style="visibility:hidden;"><a href"#" onClick="deleteItem(this);">[x]</a></td></tr>');
    }
  }

  if (s_items != undefined) {
    for (const [key, value] of Object.entries(s_items)) {
      items[i] = value;
      i += 1;  var cost = "";
      if (value["cost"] != undefined) { 
        cost = value["cost"]["quantity"] + ' ' + value["cost"]["unit"]
        if (value["cost"]["per"] != undefined) { cost += " per " + value["cost"]["per"] }
      }
      $('#items-table > tbody:last-child').append('<tr id="' + value["index"] + '"><td id="name">' + value["name"] + '</td><td id="category">' + value["service_category"]["name"] + ' (' + value["sub_category"] + ')</td><td id="cost">' + cost + '</td><td id="description">' + value["desc"] + '</td><td id="delete" style="visibility:hidden;"><a href"#" onClick="deleteItem(this);">[x]</a></td></tr>');
    }
  }
}

function addItem(el) {
  var cost = "";
  var item = getEquipment(el.options[el.selectedIndex].id);
  if ( item.cost ) {
    if ( item.cost.quantity ) {
      cost = item.cost.quantity + ' ' + item.cost.unit;
    } else if ( item.cost.random ) {
      var roll = rollDice(item.cost.random);
      if ( roll > 100 ) {  // if price is greater than 100, then round to the nearest 10
	cost = (Math.ceil(roll / 10) * 10) + ' gp';
      } else if ( roll > 10 ) {  // if price is between 10 and 100, then round to the nearest 5
	cost = (Math.ceil(roll / 5) * 5) + ' gp';
      } else {
	cost = roll + ' gp';
      }
    }
  } else {
    if ( item.rarity ) {
      // random gold amounts based on rarity (from the DMG), rounded to the nearest 10 gp
      if ( item.rarity.name.toLowerCase() == "common" ) {
	cost = (Math.ceil(getRandomInt(50, 100) / 10) * 10) + ' gp';
      } else if ( item.rarity.name.toLowerCase() == "uncommon" ) {
	cost = (Math.ceil(getRandomInt(101, 500) / 10) * 10) + ' gp';
      } else if ( item.rarity.name.toLowerCase() == "rare" ) {
	cost = (Math.ceil(getRandomInt(501, 5000) / 10) * 10) + ' gp';
      } else if ( item.rarity.name.toLowerCase() == "very rare" ) {
	cost = (Math.ceil(getRandomInt(5001, 50000) / 10) * 10) + ' gp';
      } else if ( item.rarity.name.toLowerCase() == "legendary" ) {
	cost = (Math.ceil(getRandomInt(50000, 999999) / 10) * 10) + ' gp';
      }
    }
  }
  $('#items-table > tbody:last-child').append('<tr id="' + item.index + '"><td id="name">' + item.name +'</td><td id="category">' + item.equipment_category.name + '</td><td id="cost">' + cost + '</td><td id="description">' + item.desc + '</td><td id="delete" style="visibility:hidden;"><a href"#" onClick="deleteItem(this);">[x]</a></td></tr>');
}

function addGroup(el) {
  var cost = "";
  var group = el.options[el.selectedIndex].id;
  Object.keys(equipment).forEach( (key) => {
    if (equipment[key]["equipment_category"]["index"] == group) {
      var item = getEquipment(equipment[key]["index"]);
      if (item["cost"] != undefined) { cost = item["cost"]["quantity"] + ' ' + item["cost"]["unit"]; }
      $('#items-table > tbody:last-child').append('<tr id="' + item["index"] + '"><td id="name">' + item["name"] +'</td><td id="category">' + item["equipment_category"]["name"] + '</td><td id="cost">' + cost + '</td><td id="description">' + item["desc"] + '</td><td id="delete" style="visibility:hidden;"><a href"#" onClick="deleteItem(this);">[x]</a></td></tr>');
    }
  });
}

function addService(el) {
  var cost = "";
  var item = getService(el.options[el.selectedIndex].id);
  if (item["cost"] != undefined) { 
    cost = item["cost"]["quantity"] + ' ' + item["cost"]["unit"]
    if (item["cost"]["per"] != undefined) { cost += " per " + item["cost"]["per"] }
  }
  $('#items-table > tbody:last-child').append('<tr id="' + item["index"] + '"><td id="name">' + item["name"] +'</td><td id="category">' + item["service_category"]["name"] + ' (' + item["sub_category"] + ')</td><td id="cost">' + cost + '</td><td id="description">' + item["desc"] + '</td><td id="delete" style="visibility:hidden;"><a href"#" onClick="deleteItem(this);">[x]</a></td></tr>');
}

function deleteItem(el) {
  item_selected.remove();
}

$(document).on("click", "#items-table tr", function() {
  $("#items-table tr").removeClass('bg_grey');
  $("#items-table tr").find('td:last').css("visibility","hidden");
  if ($(this).attr("id") != undefined) {
    $(this).addClass('bg_grey');
    item_selected = this;
    $(this).find('td:last').css("visibility","visible");
  }
});

$(document).on("dblclick", "#items-table td", function() {
  var td_text = $(this).text();
  var td_text_new = prompt("Enter new text for:", td_text);
  if (td_text_new != null) {
    $(this).text(td_text_new);
  }
});