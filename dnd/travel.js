var players = 0;
var player_selected;


function init() {
  calcDays();
  checkWeather();
  checkCosts();
  addPlayer("Astra", 4);
  addPlayer("Bystan", 4);
  addPlayer("Onme", 4);
  addPlayer("Windsor", 4);
  $('#div-players').draggable();
}

function calcDays() {
  $('#travel-speed').val(Math.round($('#travel-means').children(':selected').attr('id') * $('#travel-pace').val()));
  if ($('#travel-distance').val() != "") {
    var t_days = Math.floor($('#travel-distance').val() / ($('#travel-speed').val() * $('#travel-hours').val()));
    $('#travel-days').val(t_days);
  }
  if ($('#travel-pace').val() > 1) {
    $('#travel-pace-warning').html("A fast pace imposes a -5 penalty to passive Wisdom (Perception) scores");
  } else if ($('#travel-pace').val() < 1) {
    $('#travel-pace-warning').html("Able to use stealth");
  } else {
    $('#travel-pace-warning').html("");
  }
  if ($('#travel-hours').val() > 8 && $('#travel-means').val() == 8) {
    var t_dc = ($('#travel-hours').val() - 8) + 10;
    $('#travel-hours-warning').html("DC " + t_dc + " Constitution saving throw at the end of each hour to avoid exhaustion");
  } else {
    $('#travel-hours-warning').html("");
  }
  if ($('#travel-days').val() != "") {
    $('#generate-days').attr('disabled', false);
  } else {
    $('#generate-days').attr('disabled', true);
  }
  if ($('#travel-means').children(':selected').index() >= 5 && $('#travel-costs').is(":checked")) {
    $('#travel-class').attr('disabled', false);
    $('#travel-class').val("first");
    if ($('#travel-means').children(':selected').index() == $('#travel-means option:contains("Airship")').index()) {
      // Airships don't have a Steerage class
      document.getElementById('travel-class').options[3].disabled = true;
    } else {
      document.getElementById('travel-class').options[3].disabled = false;
    }
  } else {
    $('#travel-class').val("na");
    $('#travel-class').attr('disabled', true);
  }
}

function checkCosts() {
  var levels = getPlayersLevels();
  var pc_count = levels.length || 1;
  if ($('#travel-costs').is(":checked")) {
    $('#travel-cost-players').attr('disabled', false);
    $('#travel-cost-players').val(pc_count);
    if ($('#travel-means').children(':selected').index() >= 4) {
      $('#travel-class').attr('disabled', false);
      $('#travel-class').val("first");
    }
  } else {
    $('#travel-cost-players').attr('disabled', true);
    $('#travel-class').val("na");
    $('#travel-cost-players').val("");
    $('#travel-class').attr('disabled', true);
  }
}

function checkDays() {
  if ($('#travel-days').val() != "") {
    $('#generate-days').attr('disabled', false);
  } else {
    $('#generate-days').attr('disabled', true);
  }
}

function checkWeather() {
  if ($('#travel-weather').is(":checked")) {
    $('#travel-weather-days').attr('disabled', false);
    $('#travel-season').attr('disabled', false);
  } else {
    $('#travel-weather-days').attr('disabled', true);
    $('#travel-season').attr('disabled', true);
  }
}

function lookupWeather(season, roll) {
  var weather
  if (season == "winter") {
    if (roll == 1) { weather = "Blizzard" }
    else if (roll >= 2 && roll <= 20) { weather = "Snow" }
    else if (roll >= 21 && roll <= 30) { weather = "Freezing Cold" }
    else if (roll >= 31 && roll <= 40) { weather = "Heavy Clouds" }
    else if (roll >= 41 && roll <= 60) { weather = "Light Clouds" }
    else if (roll >= 61 && roll <= 99) { weather = "Clear Skies" }
    else if (roll == 100) { weather = lookupWeather("phenomenon", rollDice("d6")) }
  } else if (season == "spring") {
    if (roll >= 1 && roll <= 2) { weather = "Thunderstorm" }
    else if (roll >= 3 && roll <= 5) { weather = "Heavy Rain" }
    else if (roll >= 6 && roll <= 20) { weather = "Rain" }
    else if (roll >= 21 && roll <= 50) { weather = "Light Clouds" }
    else if (roll >= 51 && roll <= 80) { weather = "Clear Skies" }
    else if (roll >= 81 && roll <= 90) { weather = "High Winds" }
    else if (roll >= 91 && roll <= 99) { weather = "Scorching Heat" }
    else if (roll == 100) { weather = lookupWeather("phenomenon", rollDice("d6")) }
  } else if (season == "summer") {
    if (roll == 1) { weather = "Thunderstorm" }
    else if (roll >= 2 && roll <= 5) { weather = "Rain" }
    else if (roll >= 6 && roll <= 30) { weather = "Light Clouds" }
    else if (roll >= 31 && roll <= 80) { weather = "Clear Skies" }
    else if (roll >= 81 && roll <= 85) { weather = "High Winds" }
    else if (roll >= 86 && roll <= 99) { weather = "Scorching Heat" }
    else if (roll == 100) { weather = lookupWeather("phenomenon", rollDice("d6")) }
  } else if (season == "autumn") {
    if (roll >= 1 && roll <= 2) { weather = "Thunderstorm" }
    else if (roll >= 3 && roll <= 10) { weather = "Rain" }
    else if (roll >= 11 && roll <= 20) { weather = "Heavy Clouds" }
    else if (roll >= 21 && roll <= 50) { weather = "Light Clouds" }
    else if (roll >= 51 && roll <= 70) { weather = "Clear Skies" }
    else if (roll >= 71 && roll <= 90) { weather = "High Winds" }
    else if (roll >= 91 && roll <= 99) { weather = "Scorching Heat" }
    else if (roll == 100) { weather = lookupWeather("phenomenon", rollDice("d6")) }
  } else if (season == "phenomenon") {
    if (roll == 1) { weather = "Ashfall" }
    else if (roll == 2) { weather = "Solar Eclipse" }
    else if (roll == 3) { weather = "Strange Lights" }
    else if (roll == 4) { weather = "Meteor Shower" }
    else if (roll == 5) { weather = "Malevolent Storm" }
    else if (roll == 6) { weather = "Wild Magic Storm" }
  }
  return weather
}

function generateCosts(days) {
  var output = "";
  var miles = $('#travel-distance').val();
  var per_mileage
  var rate_sp

  if ([$('#travel-means option:contains("Lightning Rail")').index(),$('#travel-means option:contains("Galleon")').index()].includes($('#travel-means').children(':selected').index())) {
    per_mileage = 15;
    if ($('#travel-class').children(':selected').index() == 1) {
      rate_sp = 6;
    } else if ($('#travel-class').children(':selected').index() == 2) {
      rate_sp = 2;
    } else if ($('#travel-class').children(':selected').index() == 3) {
      rate_sp = 0.5;
    }
  } else if ($('#travel-means').children(':selected').index() == $('#travel-means option:contains("Airship")').index()) {
    per_mileage = 20;
    if ($('#travel-class').children(':selected').index() == 1) {
      rate_sp = 10;
    } else if ($('#travel-class').children(':selected').index() == 2) {
      rate_sp = 5;
    }
  } else if ($('#travel-means').children(':selected').index() == $('#travel-means option:contains("Sailing Ship")').index()) {
    per_mileage = 15;
    rate_sp = 1;
  } else if ($('#travel-means').children(':selected').index() == $('#travel-means option:contains("Coach")').index()) {
    per_mileage = 5;
    rate_sp = 0.4;
  }
  if ($('#travel-means').children(':selected').index() >= 3) {
    var money_spent_fares = Math.floor((rate_sp / per_mileage) * miles)
    output = output + "<b>Total money spent on fares</b>: " + money_spent_fares + " sp (" + Math.round(money_spent_fares / 10) + " gp) [" + rate_sp + " sp per " + per_mileage + " miles, over " + miles + " miles]"
    output = output + "<br /><br />"
  }

  if ($('#travel-means').children(':selected').index() == $('#travel-means option:contains("Horse")').index()) {
    var money_spent_rations = days * 5 * 2
  } else {
    var money_spent_rations = days * 5
  }
  output = output + "<b>Money per player to reimburse rations</b>: " + money_spent_rations + " sp (" + Math.round(money_spent_rations / 10) + " gp)"

  $('#costs-div').html(output);
}

function generateDays() {
  var days = 0;
  var levels = getPlayersLevels();
  var pc_count = levels.length || 1;
  if (levels.length >= 1) {
    var enc_level = (levels.reduce((a, b) => a + b) / players);
  } else { var enc_level = 1; }

  $('#days-div').html("<table id='days-table'><tbody><tr><th>Day</th><th>Miles</th><th>Combat</th><th>Weather</th></tr></tbody></table>");
  for (let i = 0; i < $('#travel-days').val(); i++) {
    var days = i + 1;
    var t_combat_val = rollDice("1d20");
    if ($('#travel-environ').val() == "grassland_xge") {
      if (enc_level <= 5 ) { t_combat_lvl = "1-5" }
      else if (enc_level >= 6 && enc_level <= 10) { t_combat_lvl = "6-10" }
      else if (enc_level >= 11 && enc_level <= 16) { t_combat_lvl = "11-16" }
      else if (enc_level >= 17 && enc_level <= 20) { t_combat_lvl = "17-20" }
    } else if ($('#travel-environ').val() == "open%20water_gos" || $('#travel-environ').val() == "swamp_xge" || $('#travel-environ').val() == "underwater_xge") {
      if (enc_level <= 4 ) { t_combat_lvl = "1-4" }
      else if (enc_level >= 5 && enc_level <= 10) { t_combat_lvl = "5-10" }
      else if (enc_level >= 11 && enc_level <= 20) { t_combat_lvl = "11-20" }
    } else {
      if (enc_level <= 4 ) { t_combat_lvl = "1-4" }
      else if (enc_level >= 5 && enc_level <= 10) { t_combat_lvl = "5-10" }
      else if (enc_level >= 11 && enc_level <= 16) { t_combat_lvl = "11-16" }
      else if (enc_level >= 17 && enc_level <= 20) { t_combat_lvl = "17-20" }
    }
    var t_combat_link = 'https://5e.tools/encountergen.html#' + $('#travel-environ').val() + '_' + t_combat_lvl;
    if (t_combat_val > 18) {
      var t_combat = '<a target="_blank" href="' + t_combat_link + '">' +  t_combat_val +': Random Encounter (d100: ' + rollDice("1d100") + ')</a>';
    } else {
      var t_combat = t_combat_val;
    }

    if ($('#travel-weather').is(":checked")) {
      if ((days % $('#travel-weather-days').val()) == 1) {
         var t_weather_val = rollDice("1d100");
         var t_weather = t_weather_val + ': ' + lookupWeather($('#travel-season').val(), t_weather_val)
      }
    } else {
      var t_weather = ''
    }
    var t_miles = $('#travel-speed').val() * $('#travel-hours').val() * days
    $('#days-table > tbody:last-child').append('<tr><td>' + days +'</td><td>' + t_miles +'</td><td>' + t_combat + '</td><td>' + t_weather +'</td></tr>');
  }
  var hours_into_day = Math.ceil(($('#travel-distance').val() - t_miles) / $('#travel-speed').val())
  $('#days-table > tbody:last-child').append('<tr><td>' + (days+1) +'</td><td>' + $('#travel-distance').val() +'</td><td>Arrived (' + hours_into_day + ' hours into day)</td><td></td></tr>');

  if ($('#travel-costs').is(":checked")) {
    generateCosts(days);
  }
}

function addPlayer(tr_player, tr_lvl) {
  if (tr_player == undefined) {
    var tr_player = prompt("Player name:", "");
  }
  if (tr_player != undefined) {
    $('#players-table > tbody:last-child').append('<tr id="player-' + players +'"><td id="name">' + tr_player +'</td><td id="level">' + (tr_lvl || 1) +'</td></tr>');
    players += 1;
  }
  checkCosts();
}

function removePlayer() {
  player_selected.remove();
  checkCosts();
}

function getPlayersLevels() {
  var levels = [];
  $('table td').each(function() {
    if ($(this).attr("id") == "level") {
      levels.push(parseFloat($(this).text()));
    }
  });
  return levels;
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