// Look up character death saves if hp = 0 (in character json as deathSaves)
// Could look up conditions for each character (conditions array in json) - but this might also be too taxing on the endpoint. Maybe have a toggle or something.
// Have option to show monster and character (separately) images. Character image in decorations.avatarUrl. Monster image in avatarUrl (with an extra .com for some reason), but need to do more digging for the generic creature type version (typeId is creature type?)

var letters = [ 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M' ];
var encounter = {};
var combatants = [];
var opt_show_monster_name = getCookie("show-monster-name")
var opt_show_monster_hp = getCookie("show-monster-hp");
var view = 0;

window.addEventListener("load", setup, false);

function setup() {
console.log(opt_show_monster_name);
console.log(opt_show_monster_hp);
  params = new Proxy(new URLSearchParams(window.location.search), {
    get: (searchParams, prop) => searchParams.get(prop),
  });
  if (params.view == "DM") { view = 1; }
  if (view == 0) {
    $('#header').css({ visibility: 'hidden' })
    $('#div-settings').css({ visibility: 'hidden' })
  } else {
    navbar();
  }

  encounter = getFromDDB("encounter", "54d34b6e-393a-4791-9ece-593b9c5745b1");
console.log(encounter);
  combatants = buildCombatants();
console.log(combatants);
  populateOutput();
}

function getFromDDB(type, id) {
  var r;
  var u;
  var d = new Object();
  d.id = id;

  if (type == "monster") {
    u = "https://eogz05cvn9wh74f.m.pipedream.net"
  } else if (type == "character") {
    u = "https://eo3ofofdoqq9rgh.m.pipedream.net"
  } else { // encounter
    u = "https://eozorsz5jeuanh9.m.pipedream.net"
  }

  $.get({
    url: u,
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
  return r;
}

function buildCombatants() {
  var i = 0;
  var c = [];
  encounter.players.forEach(function (item, index) {
    if (item.initiative > 0) {
      item.active = true
      char = getFromDDB("character", item.id);
      var levels = 0;
      var con_score = char.stats[2].value;
      char.classes.forEach(function (it, ind) { levels += it.level });
      char.modifiers.feat.forEach(function (it, ind) {
	if (it.entityTypeId == 1472902489 && it.entityId == 3) { con_score += it.fixedValue }
      });
      char.modifiers.race.forEach(function (it, ind) {
	if (it.entityTypeId == 1472902489 && it.entityId == 3) { con_score += it.fixedValue }
      });
      var con_mod = Math.floor((con_score - 10) / 2);
      item.maximumHitPoints = char.baseHitPoints + (levels * con_mod) + char.temporaryHitPoints;
      item.currentHitPoints = item.maximumHitPoints - char.removedHitPoints;
      item.removedHitPoints = char.removedHitPoints;
      item.overrideHitPoints = item.overrideHitPoints;
      item.baseHitPoints = char.baseHitPoints;
      item.currentXp = char.currentXp;
      item.conditions = char.conditions;
      item.deathSaves = char.deathSaves;
      item.inspiration = char.inspiration;
      item.portraitAvatarUrl = char.classes[0].definition.portraitAvatarUrl;
    } else {
      item.active = false
    }
    item.index = index;
    item.type = "Player";
    c[i] = item;
    i += 1;
  });
  encounter.monsters.forEach(function (item, index) {
    if (item.initiative > 0) { item.active = true } else { item.active = false }
    item.index = index;
    item.type = "Monster";
    c[i] = item;
    i += 1;
  });
  return c.sort(({initiative:a}, {initiative:b}) => b-a);
}

function populateOutput() {
  var vis = "";
  var o = $('#div-output');
  combatants.forEach(function (item, index) {
    var hp = "";
    if (item.type == "Player" || opt_show_monster_name) { var t = item.name; } else { var t = item.type + ' ' + letters[item.index]; }
    if (item.type == "Player" || opt_show_monster_hp) { hp = ' (' + item.currentHitPoints + '/' + item.maximumHitPoints + ')' }
    if (item.initiative == 0) { vis = ' style="visibility:hidden;"' }
    if (encounter.turnNum == index + 1) { var cls = ' class="combatant-current"' } else { var cls = ' class="combatant"' }
    o.append('<div id="' + (index + 1) + '"' + vis + cls + '>' + item.initiative + ': ' + t + hp + '</div>');
  });
}

function updateOption(el) {
  opt_show_monster_name = document.getElementById('opt_show_monster_name').checked;
  opt_show_monster_hp = document.getElementById('opt_show_monster_hp').checked;
}
