var equipment = {};
var categories = {}
var groups = {};

function init() {
  var i = 0;
  var arr_cat = [];
  var json_equip;

  // Non-API (Eberron-specific, custom) content
  json_equip = getLocal("equipment.json");
console.log(json_equip);

  // Recursively call the API to loop through all the equipment categories, equipment, and details
  // WARNING: This is SLOW! Gotta figure out a better way to do this, probably will need to make it asynchronous
  groups = getAPI("equipment-categories")["results"];
  Object.keys(groups).forEach( (key) => {
    categories = getAPI("equipment-categories/" + groups[key]["index"])["equipment"];
    Object.keys(categories).forEach( (key) => {
      i += 1;
      $('#select-items').append('<option id="' + categories[key]["index"] + '" value="' + categories[key]["url"] +'">' + categories[key]["name"] +'</option>');
      var equip = getAPI(categories[key]["url"]);
      equipment[i] = equip;
      arr_cat.push(equip["equipment_category"]);
    });
  });

  // Populate the categories select list
  for (let cat in arr_cat) {
    var exists = $('#select-groups option').filter(function(){ return $(this).val() == arr_cat[cat]["url"]; }).length;
    if (!exists) {
      $('#select-groups').append('<option id="' + arr_cat[cat]["index"] + '" value="' + arr_cat[cat]["url"] +'">' + arr_cat[cat]["name"] +'</option>');
    }
  }
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

function rebuildSelect(group) {
  $('#select-items option').remove();
  Object.keys(equipment).forEach( (key) => {
    if (equipment[key]["equipment_category"]["index"] == group) {
      $('#select-items').append('<option id="' + equipment[key]["index"] + '" value="' + equipment[key]["url"] +'">' + equipment[key]["name"] +'</option>');
    }
  });
}

function selectItem(el) {
  var item = getEquipment(el.options[el.selectedIndex].id);
  //console.log(item);
  $("#info-name").val(item["name"]);
  $("#info-category-equip").val(item["equipment_category"]["name"]);
  if (item["equipment_category"]["index"] == "adventuring-gear") {
    $("#info-category-sub").val(item["gear_category"]["name"]);
  } else if (item["equipment_category"]["index"] == "mounts-and-vehicles") {
    $("#info-category-sub").val(item["vehicle_category"]);
  } else if (item["equipment_category"]["index"] == "armor") {
    $("#info-category-sub").val(item["armor_category"]);
  } else if (item["equipment_category"]["index"] == "weapon") {
    $("#info-category-sub").val(item["weapon_category"]);
  } else if (item["equipment_category"]["index"] == "tools") {
    $("#info-category-sub").val(item["tool_category"]);
  } else {
    $("#info-category-sub").val("");
  }
  if (item["cost"] != undefined) {
    $("#info-cost").val(item["cost"]["quantity"] + ' ' + item["cost"]["unit"]);
  }
  $("#info-weight").val(item["weight"]);
  $("#info-desc").val(item["desc"]);
}

function selectGroup(el) {
  var item = getGroup(el.options[el.selectedIndex].id);
  //console.log(item);
  $("#info-name").val(item["name"]);
  rebuildSelect(item["index"]);
}

$(document).on("click", "#players-table tr", function() {
  $("#players-table tr").removeClass('bg_grey');
  if ($(this).attr("id") != undefined) {
    $(this).addClass('bg_grey');
    player_selected = this
  }
});

$(document).on("dblclick", "#players-table td", function() {
  var td_text = $(this).text();
  var td_text_new = prompt("Enter new text for:", td_text);
  if (td_text_new != null) {
    $(this).text(td_text_new)
  }
});