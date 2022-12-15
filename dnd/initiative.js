var crs = [ '-', '0', '1/8', '1/4', '1/2', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30' ]
var letters = [ 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z' ];
var encounter = {};  var combatants = []; var view = 0;
if ( getCookie("show-monster-hp") == "true" ) { var opt_show_monster_hp = true } else { var opt_show_monster_hp = false }
if ( getCookie("show-monster-img") == "true" ) { var opt_show_monster_img = true } else { var opt_show_monster_img = false }
if ( getCookie("show-monster-name") == "true" ) { var opt_show_monster_name = true } else { var opt_show_monster_name = false }
if ( getCookie("show-monster-details") == "true" ) { var opt_show_monster_details = true } else { var opt_show_monster_details = false }
window.addEventListener("load", setup, false);

function setup() {
  params = new Proxy(new URLSearchParams(window.location.search), {
    get: (searchParams, prop) => searchParams.get(prop),
  });
  if ( params.view == "DM" ) { view = 1; }
  if ( view == 0 ) {
    $('#header').css({ visibility: 'hidden' })
    $('#div-settings').css({ visibility: 'hidden' })
  } else { navbar(); }
  if ( params.id ) {
    encounter = getFromDDB("encounter", params.id);
    combatants = buildCombatants();
    populateOutput();
    setInterval(refresh, 120000);  // start the refreshing after 2 minutes (120 seconds)
  } else {
    var d = $('#div-output').append('Pass encounter id from D&D Beyond as parameter (?id=) to show encounter information');
  }
}

function refresh() {
  combatants = buildCombatants();
  populateOutput();
  console.log("Display refreshed " + new Date());
  setInterval(refresh, 60000);  // refresh every 60 seconds routinely
}

function getFromDDB(type, id) {
  var r; var u;
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
  var i = 0; var c = [];
  encounter.players.forEach(function (item, index) {
    if (item.initiative > 0) {
      item.active = true
      char = getFromDDB("character", item.id);
      var ac = 0; var levels = 0;
      var speeds = char.race.weightSpeeds.normal;
      var dex_score = char.stats[1].value;
      var con_score = char.stats[2].value;
      char.classes.forEach(function (it, ind) { levels += it.level });
      char.modifiers.feat.forEach(function (it, ind) {
	if ( it.entityTypeId == 1472902489 && it.entityId == 2 ) { dex_score += it.fixedValue }
	if ( it.entityTypeId == 1472902489 && it.entityId == 3 ) { con_score += it.fixedValue }
      });
      char.modifiers.race.forEach(function (it, ind) {
	if ( it.entityTypeId == 1472902489 && it.entityId == 3 ) { con_score += it.fixedValue }
	if ( it.subType == 'innate-speed-flying' ) { speeds.fly = speeds.walk }
      });
      char.modifiers.class.forEach(function (it, ind) {
	if ( it.subType == 'speed' ) { speeds.walk += it.value }
      });
      char.classes.forEach(function (it, ind) {
	if ( it.entityTypeId == 12168134 && it.id == 52 ) { ac = 0; }
      });
      char.inventory.forEach(function (it, ind) {
	if ( it.definition.armorClass ) { ac += it.definition.armorClass; }
      });
      var dex_mod = Math.floor((dex_score - 10) / 2);
      var con_mod = Math.floor((con_score - 10) / 2);
      if (ac == 0) { item.ac = 10 + dex_mod + con_mod } else { item.ac = ac + dex_mod }
      item.speeds = speeds;
      item.maximumHitPoints = char.baseHitPoints + (levels * con_mod) + char.temporaryHitPoints;
      item.currentHitPoints = item.maximumHitPoints - char.removedHitPoints;
      item.removedHitPoints = char.removedHitPoints;
      item.overrideHitPoints = item.overrideHitPoints;
      item.baseHitPoints = char.baseHitPoints;
      item.currentXp = char.currentXp;
      item.conditions = char.conditions;
      item.deathSaves = char.deathSaves;
      item.inspiration = char.inspiration;
      item.avatarGenericUrl = char.classes[0].definition.portraitAvatarUrl;
      if (item.currentHitPoints < (item.maximumHitPoints / 2)) { item.bloodied = true } else { item.bloodied = false }
    } else {
      item.active = false
    }
    item.index = index;
    item.type = "Player";
    c[i] = item;
    i += 1;
  });
  encounter.monsters.forEach(function (item, index) {
    if (item.initiative > 0) {
      item.active = true;
      item.speeds = {}
      mons = getFromDDB("monster", item.id);
      mons.movements.forEach(function (it, ind) {
	if ( it.movementId == 1 ) { item.speeds.walk = it.speed; }
	if ( it.movementId == 2 ) { item.speeds.burrow = it.speed; }
	if ( it.movementId == 3 ) { item.speeds.climb = it.speed; }
	if ( it.movementId == 4 ) { item.speeds.fly = it.speed; }
	if ( it.movementId == 5 ) { item.speeds.swim = it.speed; }
      });
      item.ac = mons.armorClass;
      item.cr = crs[mons.challengeRatingId];
      item.avatarUrl = mons.avatarUrl;
      item.passivePerception = mons.passivePerception;
      if (item.currentHitPoints < ( item.maximumHitPoints / 2 )) { item.bloodied = true } else { item.bloodied = false }
    } else {
      item.active = false
    }
    item.index = index;
    item.type = "Monster";
    c[i] = item;
    i += 1;
  });
  return c.sort(({initiative:a}, {initiative:b}) => b-a);
}

function toggleFullscreen() {
  if (!window.screenTop && !window.screenY) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
}

function populateOutput() {
  var d = $('#div-output');
  var o = '<table class="table"><tr><th colspan="2">Initiative &nbsp; <a href="#" onclick="refresh();"><i class="bi-arrow-clockwise" style="font-size: 1.2rem;" title="Refresh"></i></a></th><th></th><th></th><th style="text-align:right;"><a href="#" onclick="toggleFullscreen();"><i class="bi-window-fullscreen" style="font-size: 1.2rem;" title="Fullscreen"></i></a></th></tr>';
  combatants.forEach(function (item, index) {
    if ( item.initiative == 0 ) { var vis = ' style="visibility:hidden"' } else { var vis = '' }
    if ( item.type == "Player" || opt_show_monster_name ) { var t = item.name } else { var t = item.type + ' ' + letters[item.index] }
    if ( item.type == "Player" || opt_show_monster_hp ) {
      if ( item.type == "Player" && item.currentHitPoints == 0 && item.deathSaves ) {   // Death saves
	var hp = ""
	for ( let i = 0; i < item.deathSaves.successCount; i++ ) {
	  hp += '<i class="bi-circle-fill" style="font-size: 1.5rem; color: green;"></i>';
	}
	for ( let i = 0; i < (3 - item.deathSaves.successCount); i++ ) {
	  hp += '<i class="bi-circle" style="font-size: 1.5rem; color: black;"></i>';
	}
	hp += '<br />';
	for ( let i = 0; i < item.deathSaves.failCount; i++ ) {
	  hp += '<i class="bi-circle-fill" style="font-size: 1.5rem; color: red;"></i>';
	}
	for ( let i = 0; i < (3 - item.deathSaves.failCount); i++ ) {
	  hp += '<i class="bi-circle" style="font-size: 1.5rem; color: black;"></i>';
	}
      } else {
	var hp = item.currentHitPoints + ' / ' + item.maximumHitPoints
      }
    } else { var hp = '' }
    if ( item.type == "Player" || opt_show_monster_img ) { var img = '<img src="' + (item.avatarUrl || item.avatarGenericUrl) + '" height="70" width="70" class="rounded" /> ' } else { var img = '' }
    if ( item.type == "Player" || opt_show_monster_details ) {
      var det = '<p class="text-muted">AC: ' + item.ac;
      if ( item.speeds !== undefined ) {
        det += ', Speed: ' + item.speeds.walk + ' ft.';
        if ( item.speeds.fly > 0 ) { det += ', Fly ' + item.speeds.fly + ' ft.' }
        if ( item.speeds.burrow > 0 ) { det += ', Burrow ' + item.speeds.burrow + ' ft.' }
        if ( item.speeds.swim > 0 ) { det += ', Swim ' + item.speeds.swim + ' ft.' }
        if ( item.speeds.climb > 0 ) { det += ', Climb ' + item.speeds.climb + ' ft.' }
      }
      if ( item.cr ) { det += ', CR ' + item.cr }
      det += '</p>';
    } else { var det = '' }
    var cond = ''
    if ( item.bloodied ) {
      cond += '<i class="bi-droplet-fill" style="font-size: 1.5rem; color: red;" title="Bloodied"></i>';
    }
    if ( item.conditions && item.conditions.length > 0 ) {
      item.conditions.forEach(function (it, ind) {
	if ( it.id == 1 ) { cond += '<i class="bi-eye-slash-fill" style="font-size: 1.5rem; color: black;" title="Blinded"></i>' }
	if ( it.id == 2 ) { cond += '<i class="bi-c-circle" style="font-size: 1.5rem; color: black;" title="Charmed"></i>' }
	if ( it.id == 3 ) { cond += '<i class="bi-ear" style="font-size: 1.5rem; color: black;" title="Deafened"></i>' }
	if ( it.id == 5 ) { cond += '<i class="bi-person-fill-exclamation" style="font-size: 1.5rem; color: black;" title="Frightened"></i>' }
	if ( it.id == 6 ) { cond += '<i class="bi-hurricane" style="font-size: 1.5rem; color: black;" title="Grappled"></i>' }
	if ( it.id == 7 ) { cond += '<i class="bi-person-fill-x" style="font-size: 1.5rem; color: black;" title="Incapacitated"></i>' }
	if ( it.id == 8 ) { cond += '<i class="bi-dash-square-dotted" style="font-size: 1.5rem; color: black;" title="Invisible"></i>' }
	if ( it.id == 13 ) { cond += '<i class="bi-r-square" style="font-size: 1.5rem; color: black;" title="Restrained"></i>' }
	if ( it.id == 15 ) { cond += '<i class="bi-emoji-dizzy" style="font-size: 1.5rem; color: black;" title="Unconscious"></i>' }
      });
    }
    if ( item.inspiration ) { var insp = '<i class="bi-stars" style="font-size: 2rem; color: blue;" title="Inspiration!"></i>' } else { var insp = '' }
    if ( encounter.turnNum == index + 1 ) { var cls = ' class="table-success"' } else { var cls = ' class="table"' }
    o += '<tr id="' + (index + 1) + '"' + cls + vis + '><td><h4> ' + item.initiative + ' </h4></td>';
    o += '<td>' + img + '</td>';
    o += '<td><h5> ' + t + insp + '</h5>' + det + '</td>';
    o += '<td>' + cond + '</td>';
    o += '<td><h5> ' + hp + ' </h5></td></tr>';
  });
  o += '</table>';
  d.html(''); d.append(o);
}

function updateOption(el) {
  opt_show_monster_name = document.getElementById('opt_show_monster_name').checked;
  opt_show_monster_hp = document.getElementById('opt_show_monster_hp').checked;
}
