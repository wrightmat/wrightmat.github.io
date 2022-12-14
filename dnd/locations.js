var equipment = {};
var categories = {}
var groups = {};
var services = {};
var item_selected;

window.addEventListener("load", init, false);

function init() {
  navbar();
  var i = 0;
  var arr_cat = [];
  var json_equip;
  var json_service;

  // Recursively call the API to loop through all the equipment categories, equipment, and details
  // WARNING: This is SLOW! Gotta figure out a better way to do this, probably will need to make it asynchronous
  groups = getAPI("equipment-categories")["results"];
  Object.keys(groups).forEach( (key) => {
    categories = getAPI("equipment-categories/" + groups[key]["index"])["equipment"];
    Object.keys(categories).forEach( (key) => {
      i += 1;
      var equip = getAPI(categories[key]["url"]);
      equipment[i] = equip;
      arr_cat.push(equip["equipment_category"]);
      $('#select-items').append('<option id="' + categories[key]["index"] + '" value="' + categories[key]["url"] +'">' + categories[key]["name"] +'</option>');
    });
  });

  // Non-API (Eberron-specific, custom) content
  json_equip = getLocal("equipment.json");
  Object.keys(json_equip).forEach( (key) => {
    i += 1;
    $('#select-items').append('<option id="' + json_equip[key]["index"] + '" value="' + json_equip[key]["url"] +'">' + json_equip[key]["name"] +'</option>');
    equipment[i] = json_equip[key];
  });
  alphabetizeSelectList($('#select-items'))

  // Populate the categories select list
  for (let cat in arr_cat) {
    var exists = $('#select-groups option').filter(function(){ return $(this).val() == arr_cat[cat]["url"]; }).length;
    if (!exists) {
      $('#select-groups').append('<option id="' + arr_cat[cat]["index"] + '" value="' + arr_cat[cat]["url"] +'">' + arr_cat[cat]["name"] +'</option>');
    }
  }

  // Populate the services select list
  json_service = getLocal("services.json");
  Object.keys(json_service).forEach( (key) => {
    $('#select-services').append('<option id="' + json_service[key]["index"] + '" value="' + json_service[key]["index"] +'">' + json_service[key]["name"] +'</option>');
    services[key] = json_service[key];
  });
  alphabetizeSelectList($('#select-services'))
}

function getAPI(r_type) {
  var r_text, r_url;
  if (r_type.substring(0, 4) !== "/api") {
    r_url = "/api/" + r_type;
  } else { r_url = r_type; }
  $.get({
    url: "https://www.dnd5eapi.co" + r_url,
    success: function(result) { r_text = result },
    error: function(xhr, error) { console.log(xhr) },
    async: false
  });
  return r_text;
}

function getLocal(r_url) {
  var r_text;
  $.get({
    url: "https://wrightmat.github.io/dnd/" + r_url,
    success: function(result) { r_text = result },
    error: function(xhr, error) { console.log(xhr) },
    async: false
  });
  return r_text;
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

function getGroup(index) {
  var r_group;
  Object.keys(groups).forEach( (key) => {
    if (groups[key]["index"] == index) {
      r_group = groups[key];
    }
  });
  return r_group;
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

function rebuildSelect(group) {
  $('#select-items option').remove();
  Object.keys(equipment).forEach( (key) => {
    if (equipment[key]["equipment_category"]["index"] == group) {
      $('#select-items').append('<option id="' + equipment[key]["index"] + '" value="' + equipment[key]["url"] +'">' + equipment[key]["name"] +'</option>');
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
  rebuildSelect(item["index"]);
}

function selectService(el) {
  var item = getService(el.options[el.selectedIndex].id);
  $('#select-services').prop('title', item["name"]);
}

function filterEquipment(filters) {
  var i = 0;
  const newObj = {};
  for (const [key, value] of Object.entries(equipment)) {
    if (filters.includes(value["equipment_category"]["index"])) {
      newObj[i] = value;
      newObj[i]["key_prior"] = key;
      i = i + 1;
    }
  }
  return newObj;
}

function filterServices(filters, by = 'service') {
  var i = 0;
  const newObj = {};
  for (const [key, value] of Object.entries(services)) {
    if ((by == "house" && filters.includes(value["house"])) || (by == "service" && filters.includes(value["service_category"]["index"]))) {
      newObj[i] = value;
      newObj[i]["key_prior"] = key;
      i = i + 1;
    }
  }
  return newObj;
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
      var e_items = { ...filterEquipment(['armor']), ...filterEquipment(['armor']) }
    } else if (sel == "jorasco") {
      var e_items = { ...filterEquipment(['armor']), ...filterEquipment(['potion']) }
    } else if (sel == "cannith") {
      var e_items = { ...filterEquipment(['armor']), ...filterEquipment(['tools']) }
    }
    for (const [key, value] of Object.entries(s_items)) {
      items[i] = value;
      i += 1;  var cost = "";
      if (value["cost"] != undefined) { 
        cost = value["cost"]["quantity"] + ' ' + value["cost"]["unit"]
        if (value["cost"]["per"] != undefined) { cost += " per " + value["cost"]["per"] }
      }
      $('#items-table > tbody:last-child').append('<tr id="' + value["index"] + '"><td id="name">' + value["name"] +'</td><td id="category">' + value["service_category"]["name"] + ' (' + value["sub_category"] + ')</td><td id="cost">' + cost + '</td><td id="description">' + value["desc"] + '</td><td id="delete" style="visibility:hidden;"><a href"#" onClick="deleteItem(this);">[x]</a></td></tr>');
    }
    if (e_items != undefined) {
      for (let j = i; j < (10 - Object.keys(s_items).length + i); j++) {
        it = e_items[getRandomInt(0, Object.keys(e_items).length-1)];
        items[j] = it;  var cost = "";
        if (it["cost"] != undefined) { 
          cost = it["cost"]["quantity"] + ' ' + it["cost"]["unit"]
          if (it["cost"]["per"] != undefined) { cost += " per " + it["cost"]["per"] }
        }
        $('#items-table > tbody:last-child').append('<tr id="' + it["index"] + '"><td id="name">' + it["name"] +'</td><td id="category">' + it["equipment_category"]["name"] + '</td><td id="cost">' + cost + '</td><td id="description">' + it["desc"] + '</td><td id="delete" style="visibility:hidden;"><a href"#" onClick="deleteItem(this);">[x]</a></td></tr>');
      }
    }
  }
}

function addItem(el) {
  var cost = "";
  var item = getEquipment(el.options[el.selectedIndex].id);
  if (item["cost"] != undefined) { cost = item["cost"]["quantity"] + ' ' + item["cost"]["unit"]; }
  $('#items-table > tbody:last-child').append('<tr id="' + item["index"] + '"><td id="name">' + item["name"] +'</td><td id="category">' + item["equipment_category"]["name"] + '</td><td id="cost">' + cost + '</td><td id="description">' + item["desc"] + '</td><td id="delete" style="visibility:hidden;"><a href"#" onClick="deleteItem(this);">[x]</a></td></tr>');
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