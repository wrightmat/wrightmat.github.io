const groups = { 
    "Living Room" : ['ee64c4c4-545f-4093-a75e-88c05c0e5d81','be67888f-5129-4809-8c45-9685b0e3b298','8ef66a4d-a20d-422f-a84d-8bc14a90eab4'],
    "Office" : ['6eac9a89-3243-47e2-a053-590fec9e6179','a3551f94-785b-45d6-b993-4b70363155e9','a4745bcb-b120-4a49-9085-2c79ddb19a64'],
    "Front Door" : ['6301981d-407c-475c-869a-05dfe770ca86','3f9e9f5b-e44f-432f-9cb9-6b876560158d','5aa96cee-36eb-4f15-be8b-fea024e43b45','5848eccf-fca5-4c36-9d92-61e51624ba48'],
    "Back Door" : ['db915ce1-a431-4f3b-85a6-345a240f57dc','00355c73-2d06-46d8-a90b-db9e8a8e626b'],
    "Kitchen" : ['66c93b9c-4c3e-49c9-8b48-3cf80ae8fa7c','432f9d9f-03e8-4cad-9df7-8a5326d7f0ea','fe6be7c4-d1fb-4f8e-a2b8-9021a32918af','7651e84d-f72f-4b7c-84b0-ee76fbe9c3f7','3d5612ca-d8b6-412f-9d0d-39f4ea757bad'],
    "Bathroom" : ['fe984912-fe96-4428-a2b2-32e452ec1f55','e93d8f70-6a3c-4b6d-9409-167fd65dfafa','4ef55556-c9e4-4312-af0d-4e74f312ebad'],
    "Bedroom" : ['be6e94a3-fa52-47a9-869c-6f3c211781ee','0233e3b7-6ff4-4fac-89b7-adbc5cd1483d','6d7f8205-5a56-4130-94bd-76249073e0c9','72fd6018-77fd-45d1-bb2b-728c6a2c56fd'],
    "TV" : ['cb2b8413-1efb-48fc-b831-13341134ab82'],
    "Hubs" : ['ef676997-101f-43f1-a78a-1f00343c138a','340a2a7e-f4ed-42fa-88e6-8067f5779c9f'],
    "Presence" : ['872d2ca6-7c50-44e8-995c-f3e4f3722187','0638bae1-d55e-4630-89fa-fc4103ac550b'],
    "Doorbell" : ['5848eccf-fca5-4c36-9d92-61e51624ba48','5aa96cee-36eb-4f15-be8b-fea024e43b45']
}
const fav_menu_left = ['Hubs','5b7dd0c0-3053-42f1-a63f-b674d3370a6f','c047215e-c82d-4461-8167-da3455b47048','Presence','Doorbell']
const fav_menu_right = ['Living Room','Office','Front Door','Back Door','Kitchen','Bathroom','Bedroom']
const fav_scenes = ['57012c94-fa9b-45ff-a60d-8a51aaf98cb0','5aba48fd-e5b1-4a95-a89f-4037e283cb27','8842352f-8123-4728-a5ee-bf038f7f9b0f']
var auth;
var locationId;
var locations;
var devices;
var weather;
var alerts = [];

window.addEventListener("load", init, false);
function init() {  // if the auth token is saved, then go ahead and start loading
  if ( getCookie('smartthings-auth') ) {
    window.auth = getCookie('smartthings-auth');
  }
  if ( getCookie('smartthings-auth') || window.auth ) {
    getLocationId();
    getWeather();
    setInterval(refreshAll, 15000 ); // every 15 seconds
    setInterval(updateDevices, 30000); // every 30 seconds
    setInterval(getWeather, 7200000); // every 2 hours
    setInterval(getLocations, 43200000); // every 12 hours
  }
}

async function loadAuth(file) {
    let text = await file.text();
    window.auth = text;
    setCookie('smartthings-auth', text, 365);
    init();
}

function getLocationId() {
    updateLCARS("tan", "LCARS INITIALIZING...");
    $.ajax({
        url: "https://api.smartthings.com/v1/locations",
        type: "GET",
	headers: { 'Authorization': 'Bearer ' + window.auth },
        success: function(result) {
	    locationId = result.items[0].locationId;
	    getLocations();
        },
	error: function(xhr, error) {
            console.log(xhr);
	    updateLCARS("red-damask", "LCARS FAILURE " + xhr["status"]);
 	}
    });
}

function getLocations() {
    $.ajax({
        url: "https://api.smartthings.com/v1/locations/" + locationId,
        type: "GET",
	headers: { 'Authorization': 'Bearer ' + window.auth },
        success: function(result) { locations = result; },
	async: false
    });
    $.ajax({
        url: "https://api.smartthings.com/v1/locations/" + locationId + "/rooms",
        type: "GET",
	headers: { 'Authorization': 'Bearer ' + window.auth },
        success: function(result) { locations.rooms = result.items; },
	async: false
    });
    $.ajax({
        url: "https://api.smartthings.com/v1/locations/" + locationId + "/modes/current",
        type: "GET",
	headers: { 'Authorization': 'Bearer ' + window.auth },
        success: function(result) { locations.id = result.id; locations.mode = result.label; },
	async: false
    });
    $.ajax({
        url: "https://api.smartthings.com/v1/scenes",
        type: "GET",
	headers: { 'Authorization': 'Bearer ' + window.auth },
        success: function(result) { locations.scenes = result.items; }
    });
    $.ajax({
        url: "https://api.smartthings.com/v1/devicepreferences",
        type: "GET",
	headers: { 'Authorization': 'Bearer ' + window.auth },
        success: function(result) { locations.devicePreferences = result.items; }
    });
    console.log("Location retrieved " + new Date());
    getDevices();  // do a full update of devices, since they change sometimes
}

function getDevices() {
    devices = {};
    $.ajax({
        url: "https://api.smartthings.com/v1/devices",
        type: "GET",
	headers: { 'Authorization': 'Bearer ' + window.auth },
        success: function(result) { devices = result.items; },
	async: false
    });
    console.log("Devices retrieved " + new Date());
    updateDevices();
    refreshAll();
}

function updateDevices() {
    for (var i = 0; i < devices.length; i++) {
	    $.ajax({
	        url: "https://api.smartthings.com/v1/devices/" + devices[i].deviceId + "/health",
	        type: "GET",
		headers: { 'Authorization': 'Bearer ' + window.auth },
	        success: function(result) { devices[i] = jsonConcat(devices[i], result); },
		async: false
	    });
	    $.ajax({
	        url: "https://api.smartthings.com/v1/devices/" + devices[i].deviceId + "/status",
	        type: "GET",
		headers: { 'Authorization': 'Bearer ' + window.auth },
	        success: function(result) { devices[i] = jsonConcat(devices[i], result); },
		async: false
	    });
    }
    console.log("Devices updated " + new Date());
}

function getWeather() {
    $.ajax({
        url: "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/65203?unitGroup=us&key=W7PN4HJWF9ZFAXQMDNMARU6CB&contentType=json",
        type: "GET",
        success: function(result) { weather = result; },
	error: function(xhr, error) { console.log(xhr); }
    });
    console.log("Weather retrieved " + new Date());
}

function getDevice(id) {
  if ( devices ) {
    var returnResult = [];
    for (var i = 0; i < devices.length; i++) {
	if ( devices[i].deviceId == id ) {
	    return devices[i];
	}
    }
  }
}

function getScene(id) {
  if ( locations.scenes ) {
    for (var i = 0; i < locations.scenes.length; i++) {
	if ( locations.scenes[i].sceneId == id ) {
	    return locations.scenes[i];
	}
    }
  }
}

function commandDevice(id) {
    for (var i = 0; i < devices.length; i++) {
	if ( devices[i].deviceId == id ) {
	    var deviceInfo = getDeviceInfo(devices[i].deviceId);
	    var capability = deviceInfo[4];
	    if ( capability == "switch" ) {
		if ( deviceInfo[5] == 1 ) { var command = "off" } else { var command = "on" }
	    } else if (capability == "lock") {
		if ( deviceInfo[5] == 1 ) { var command = "lock" } else { var command = "unlock" }
	    }
	    if ( capability && command ) {
		$.ajax({
	            url: 'https://api.smartthings.com/v1/devices/' + devices[i].deviceId + '/commands',
	            type: 'POST',
		    data: '[{ "capability": "' + capability + '", "command": "' + command + '" }]',
		    headers: { 'Authorization': 'Bearer ' + window.auth },
	            success: function(result) { return result }
		})
	    } else { console.log("can't execute command on " + id + ", no capability or command given") }
	}
    }
}

function executeScene(id) {
    for (var i = 0; i < locations.scenes.length; i++) {
	if ( locations.scenes[i].sceneId == id ) {
	    $.ajax({
	        url: "https://api.smartthings.com/v1/scenes/" + locations.scenes[i].sceneId + "/execute",
	        type: "POST",
		headers: { 'Authorization': 'Bearer ' + window.auth },
	        success: function(result) { return result; }
	    });
	}
    }
}

function getColor(colorType, colorValue) {
    var color;
    if ( colorType == "battery" ) {
	if ( colorValue <= 30 ) { color = "lcars-red-alert-bg";
	} else if ( colorValue <= 60 ) { color = "lcars-red-damask-bg";
	} else { color = "lcars-tan-bg"; }
    } else if ( colorType == "type" ) {
	switch ( colorValue ) {
	    case "weather":    color = "lcars-periwinkle-bg"; break;
	    case "thermostat": color = "lcars-dodger-blue-bg"; break;
	    case "contact":    color = "lcars-melrose-bg"; break;
	    case "motion":     color = "lcars-anakiwa-bg"; break;
	    case "lock":       color = "lcars-hopbush-bg"; break;
	    case "light":      color = "lcars-pale-canary-bg"; break;
	    case "outlet":     color = "lcars-sandy-brown-bg"; break;
	    case "switch":     color = "lcars-bourbon-bg"; break;
	    case "smoke":      color = "lcars-mariner-bg"; break;
	    case "water":      color = "lcars-mariner-bg"; break;
	    case "presence":   color = "lcars-husk-bg"; break;
	    case "device":     color = "lcars-husk-bg"; break;
	    case "location":   color = "lcars-husk-bg"; break;
	    default:           color = "lcars-neon-carrot-bg";
	}
    }
    return color;
}

function getIcon(iconType, iconValue) {
    var icon;
    if ( iconType == "weather" ) {
	switch ( iconValue ) {
	    case 1:   icon = "cloud"; break;
	    case 2:   icon = "sun"; break;
	    case 3:   icon = "cloud-drizzle"; break;
	    case 4:   icon = "cloud-lightning"; break;
	    case 5:   icon = "cloud-rain"; break;
	    case 6:   icon = "cloud-snow"; break;
	    default:  icon = "cloud-off";
	}
    } else if ( iconType == "type" ) {
	switch( iconValue ) {
	    case "thermostat": icon = "thermometer"; break;
	    case "contact":    icon = "sidebar"; break;
	    case "motion":     icon = "navigation"; break;
	    case "lock":       icon = "lock"; break;
	    case "light":      icon = "zap"; break;
	    case "outlet":     icon = "trello"; break;
	    case "switch":     icon = "sliders"; break
	    case "smoke":      icon = "droplet"; break;
	    case "water":      icon = "droplet"; break;
	    case "presence":   icon = "smartphone"; break;
	    case "device":     icon = "hard-drive"; break;
	    case "location":   icon = "map-pin"; break;
	    default:           icon = "help-circle";
	}
    }
    return icon;
}

function getGroupInfo(group) {
    var info = {}; info.state = 1;

    for ( var i = 0; i < groups[group].length; i++ ) {
	var deviceInfo = getDeviceInfo(groups[group][i])
	info.label = group;
	if ( i == 0 ) {
	    info.text = deviceInfo.label + ': ' + deviceInfo.text;
	    info.id = deviceInfo.id;
	    info.type = deviceInfo.type;
	    info.capability = deviceInfo.capability;
	    info.status = deviceInfo.status;
	    info.value = deviceInfo.value;
	    info.room = deviceInfo.room;
	} else {
	    if ( deviceInfo.text ) {
		info.text += ', ' + deviceInfo.label + ': ' + deviceInfo.text;
	    }
	    if ( deviceInfo.battery && deviceInfo.state && deviceInfo.state == 1 ) {
		if ( info.battery ) { info.battery = Math.min(info.battery, deviceInfo.battery); }
		else { info.battery = deviceInfo.battery; }
	    }
	    if ( deviceInfo.state ) {
		info.state = Math.min(info.state, deviceInfo.state);  // If anything is down, the whole group is down
	    }
	}
    }
    return info;
}

function getDeviceInfo(deviceId) {
    var device = getDevice(deviceId);
    var info = {}; info.state = 0; info.status = 0; info.room = 0;

    if ( device ) {
	info.id = device.deviceId;
	info.label = device.label;
	if ( device.state ) {
	    if ( device.state == "ONLINE" ) { info.state = 1 }
	} else { info.state = 9 }  // Unknown state

	if ( device.components.main ) {
	    var main = device.components.main;
	    if ( main['stsmartweather.weatherSummary'] ) {
		info.type = "weather";
		switch( main['stsmartweather.weatherSummary'].weather.value ) {
		    case "Clear":   info.status = 1; break;
		    case "Sunny":   info.status = 2; break;
		    case "Drizzle": info.status = 3; break;
		    case "Storm":   info.status = 4; break;
		    case "Rain":    info.status = 5; break;
		    case "Snow":    info.status = 6; break;
		    default:        info.status = 0;
		}
		info.text = main['stsmartweather.weatherSummary'].weather.value;
		info.value = Math.round(main.temperatureMeasurement.temperature.value) + '°' + main.temperatureMeasurement.temperature.unit;
	    } else if ( main.thermostatMode ) {
		info.type = "thermostat";
		info.text = main.thermostatMode.thermostatMode.value + ': ' + main.thermostatHeatingSetpoint.heatingSetpoint.value + '°' + main.thermostatHeatingSetpoint.heatingSetpoint.unit;
		info.value = Math.round(main.temperatureMeasurement.temperature.value) + '°' + main.temperatureMeasurement.temperature.unit;
	    } else if ( main.contactSensor ) {
		info.type = "contact";
		info.text = main.contactSensor.contact.value;
	    } else if ( main.motionSensor ) {
		info.type = "motion";
		info.text = main.motionSensor.motion.value;
		if ( main.motionSensor.motion.value == "active" ) { info.status = 1 }
	    } else if ( main.lock ) {
		info.type = "lock";
		info.capability = "lock";
		info.text = main.lock.lock.value;
		if ( main.lock.lock.value == "unlocked" ) { info.status = 1 }
	    } else if ( main.light ) {
		info.type = "light";
		info.capability = "switch";
		info.text = main.light.switch.value;
		if ( main.light.switch.value == "on" ) { info.status = 1 }
	    } else if ( main.outlet ) {
		info.type = "outlet";
		info.capability = "switch";
		info.text = main.outlet.switch.value;
		if ( main.outlet.switch.value == "on" ) { info.status = 1 }
	    } else if ( main.switch && main.switch.switch ) {
		info.type = "switch";
		info.capability = "switch";
		info.text = main.switch.switch.value;
		if ( main.switch.switch.value == "on" ) { info.status = 1 }
	    } else if ( main.smokeDetector ) {
		info.type = "smoke";
		info.text = main.smokeDetector.smoke.value;
	    } else if ( main.waterSensor ) {
		info.type = "water";
		info.text = main.waterSensor.water.value;
	    } else if ( main.presenceSensor ) {
		info.type = "presence";
		info.text = main.presenceSensor.presence.value;
		if ( main.presenceSensor.presence.value == "present" ) { info.status = 1 }
	    } else if ( main.bridge ) {
		info.type = "device";
		info.text = device.state;
	    } else {  // Unknown
		info.type = device.type;
		info.text = device.name;
	    }
	    if ( main.button && main.button.button.value ) {
		info.text += ', button ' + main.button.button.value;
	    }
	    if ( main.switchLevel && main.switchLevel.level.value ) {
		info.text += ', ' + main.switchLevel.level.value + main.switchLevel.level.unit;
	    }
	    if ( main.colorControl && main.colorControl.color.value ) {
		info.text += ', ' + main.colorControl.color.value;
	    }
	    if ( main.colorTemperature && main.colorTemperature.colorTemperature.value ) {
		info.text += ', ' + main.colorTemperature.colorTemperature.value + ' ' + main.colorTemperature.colorTemperature.unit;
	    }
	    if ( main.powerMeter && main.powerMeter.power.value ) {
		info.text += ', ' + main.powerMeter.power.value + main.powerMeter.power.unit;
	    }
	    if ( main.temperatureMeasurement && main.temperatureMeasurement.temperature.value ) {
		info.text += ', ' + Math.round(main.temperatureMeasurement.temperature.value);
		if ( main.temperatureMeasurement.temperature.unit.indexOf("°") == -1 ) { info.text += '°'; }
 		if ( main.temperatureMeasurement.temperature.unit == "fahrenheit" ) { info.text += 'F'; } else { info.text += main.temperatureMeasurement.temperature.unit; }
	    }
	    if ( main.relativeHumidityMeasurement && main.relativeHumidityMeasurement.humidity.value ) {
		info.text += ', ' + Math.round(main.relativeHumidityMeasurement.humidity.value);
		info.text += main.relativeHumidityMeasurement.humidity.unit;
		if ( main.relativeHumidityMeasurement.humidity.unit.indexOf("RH") == -1 ) { info.text += 'RH'; }
	    }
	    if ( main.battery ) {
		info.battery = main.battery.battery.value;
	    }
	    if ( main['stsmartweather.weatherSummary'] ) {  // we want this at the end of the text, so we do a separate check
	      if ( weather ) {
		var forecastText = "";
		weather.days.forEach(function (item, index) {
		    if ( item.tempmin <= 15 && index <= 3 ) {
			forecastText += 'Freeze warning on ' + item.datetime + ' with temperature of ' + item.tempmin + '°F';
			updateLCARS('bahama-blue', 'Blue Alert');
			alerts.push('blue');
		    }
		    // look into other helpful forecast things that could be added (extreme heat, storms, etc.)
		});
		if ( forecastText == "" ) { forecastText = weather.description; }
		info.text += '. ' + forecastText;
	      } else {
		// weather being null means no response sent, so the weather service is down
		info.text += '.&nbsp;<span style="color:#d64;"> Weather forecast unavailable.</span>';
	      }
	    }
	} else {  // Hub (no components)
	    info.type = "device";
	    info.text = device.state;
	    if ( device.state == 0 ) {  // Hub is down! Red alert!
		updateLCARS('red-alert', 'Red Alert');
		alerts.push('red');
	    }
	}
	if ( device.roomId && locations.rooms ) {
	    info.room = locations.rooms.findIndex(el => el.roomId === device.roomId) + 1;
	}
    } else if ( locationId == deviceId ) {  // Location (no device)
	info.type = "location";
	info.id = locationId;
	info.label = locations.name;
	info.text = locations.mode;
	info.state = 1;
    }

    return info;
}

function updateLCARS(color = "tan", text = "LCARS ACCESS") {
    $('div[class*="-bg"]').each(function() {
	$(this).removeClass('div[class*="-bg"]').addClass('lcars-' + color + '-bg');
    });
    if ( text ) { $('#title-right').text(text); }
}

function refreshAll() {
    clearDisplay();
    rebuildDisplay();
    //console.log("Display refreshed " + new Date());
}

function clearDisplay() {
    // Clear existing content - jquery selector doesn't work for some reason
    $('#title-left').html('');
    $('#left-menu').html('');
    $('#right-menu').html('');
    $(document).off('click')  // Unregister click events so we don't get multiple
}

function rebuildDisplay() {
    // Top bars
    var now = new Date();
    var now_formatted = now.getFullYear() + "-" + right("00"+(now.getMonth() + 1),2) + "-" + right("00"+now.getDate(),2) + " " + now.toTimeString().substr(0,5);
    $('#title-left').text(now_formatted);
    $('#title-left-btm').text(stardate());
    if ( window.auth ) {
	updateLCARS("tan", "LCARS ACCESS")
    } else {
	updateLCARS("tan", "LCARS UNINITIALIZED")
    }

    // left side - favorite devices and scenes/routines
    for ( var i = 0; i < fav_menu_left.length; i++ ) {
	if ( fav_menu_left[i].length == 36 && fav_menu_left[i].indexOf("-") == 8 ) {
	    var deviceInfo = getDeviceInfo(fav_menu_left[i])
	} else { var deviceInfo = getGroupInfo(fav_menu_left[i]) }
	if ( deviceInfo ) {
	    if ( deviceInfo.type == "weather" ) { var icon = getIcon("weather", deviceInfo.type) } else { var icon = getIcon("type", deviceInfo.status) }
	    var color = getColor("type", deviceInfo.type)
	    if ( deviceInfo.state ) {
		if ( deviceInfo.state == 0 ) { var element = ' lcars-red-alert-bg">' } else { var element = '">' }
	    } else { element = '">' }
	    if (deviceInfo.value) { var element = element + deviceInfo.value } else { var element = element + deviceInfo.state + deviceInfo.room + deviceInfo.status }
	    $('<div id="' + deviceInfo.id + '" title="' + deviceInfo.label + '" class="lcars-row"><div class="lcars-element left-rounded button ' + color + '"></div><div class="lcars-element button lcars-u-2 ' + color + '">' + deviceInfo.label + '</div><div class="lcars-element button ' + color + '"><div class="lcars-element-addition' + element + '</div></div><div class="lcars-text-box small full-centered lcars-u-3">' + deviceInfo.text + '</div><div class="lcars-element lcars-black-bg"></div></div>').appendTo("#left-menu")
	    $(document).on('click', '#'+deviceInfo.id, function() {
		commandDevice(this.id);
		refreshAll();
	    })
	}
    }
    $('<div id="left-menu-spacer" class="lcars-row lcars-vu-1"></div><div id="left-menu-scenes" class="lcars-row"></div>').appendTo("#left-menu");
    for (var i = 0; i < fav_scenes.length; i++) {
	var scene = getScene(fav_scenes[i]);
	if ( scene ) {
	    $('<div id="' + scene.sceneId + '" class="lcars-element rounded button">' + scene.sceneName + '</div>').appendTo("#left-menu-scenes");
	    $(document).on('click', '#'+scene.sceneId, function() {
		executeScene(this.id);
		refreshAll();
	    })
	}
    }

    // right side - only devices
    for (var i = 0; i < fav_menu_right.length; i++) {
	if (fav_menu_right[i].length == 36 && fav_menu_right[i].indexOf("-") == 8) {
	    var deviceInfo = getDeviceInfo(fav_menu_right[i]);
	} else { var deviceInfo = getGroupInfo(fav_menu_right[i]) }
	if ( deviceInfo ) {
	    if ( deviceInfo.type == "weather" ) { var icon = getIcon("weather", deviceInfo.type) } else { var icon = getIcon("type", deviceInfo.type) }
	    var color = getColor("type", deviceInfo.type)
	    var color_battery = getColor("battery", deviceInfo.battery)
	    if ( deviceInfo.state ) {
		if ( deviceInfo.state == 0 ) { var element = ' lcars-red-alert-bg">' } else { var element = '">' }
	    } else { element = '">' }
	    if ( deviceInfo.value ) { var element = element + deviceInfo.value } else { var element = element + deviceInfo.state + deviceInfo.room + deviceInfo.status }
	    if ( deviceInfo.status == 1 ) {
		var indicator = '<div class="lcars-element right-rounded button ' + getColor("type", deviceInfo.type) + '"></div>'
	    } else { var indicator = '<div class="lcars-element right-rounded button lcars-gray-bg"></div>' }
	    $('<div id="' + deviceInfo.id + '" title="' + deviceInfo.label + '" class="lcars-row"><div class="lcars-element button ' + color_battery + '" title="' + deviceInfo.battery + '"></div><div class="lcars-element button ' + color + '"><div class="lcars-element-addition' + element + '</div></div><div class="lcars-element button lcars-u-2 ' + color + '">' + deviceInfo.label + '</div><div class="lcars-text-box small full-centered lcars-u-3">' + deviceInfo.text + '</div>' + indicator + '</div>').appendTo("#right-menu")
	    // If device is present more than once, then the onclick will be added more than once and cause devices to turn on and then off.
	    // TODO: Check if the onclick is already registered and don't add another?
	    $(document).on('click', '#'+deviceInfo.id, function() {
		commandDevice(this.id);
		refreshAll();
	    })
	}
    }
}