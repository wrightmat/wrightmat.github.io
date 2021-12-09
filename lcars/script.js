const auth = config.AUTH_KEY
const fav_menu_left = config.MENU_LEFT_IDS
const fav_menu_right = config.MENU_RIGHT_IDS
var loc
var rooms
var scenes
var devices
var devicePreferences


$(document).ready(function(){
    $.ajax({
        url: "https://api.smartthings.com/v1/locations",
        type: "GET",
	headers: { 'Authorization': 'Bearer ' + auth },
        success: function(result){
	    getDevices(result.items[0].locationId)
	    setTimeout(function(){
		refreshDisplay()
	    }, 3000); // Wait 3 seconds to refresh display so the devices are returned
        }
    })
})


function getDevices(locationId) {
    $.ajax({
        url: "https://api.smartthings.com/v1/locations/" + locationId,
        type: "GET",
	headers: { 'Authorization': 'Bearer ' + auth },
        success: function(result){
	    window.loc = result
	    console.log(window.loc)
        }
    })
    $.ajax({
        url: "https://api.smartthings.com/v1/locations/" + locationId + "/rooms",
        type: "GET",
	headers: { 'Authorization': 'Bearer ' + auth },
        success: function(result){
	    window.rooms = result["items"]
	    console.log(window.rooms)
        }
    })
    $.ajax({
        url: "https://api.smartthings.com/v1/scenes",
        type: "GET",
	headers: { 'Authorization': 'Bearer ' + auth },
        success: function(result){
	    window.scenes = result["items"]
	    console.log(window.scenes)
        },
	async:false
    })
    $.ajax({
        url: "https://api.smartthings.com/v1/devices",
        type: "GET",
	headers: { 'Authorization': 'Bearer ' + auth },
        success: function(result){
	    window.devices = result["items"]
	    console.log(window.devices)
        },
	async:false
    })
    $.ajax({
        url: "https://api.smartthings.com/v1/devicepreferences",
        type: "GET",
	headers: { 'Authorization': 'Bearer ' + auth },
        success: function(result){
	    window.devicePreferences = result["items"]
	    console.log(window.devicePreferences)
        }
    })
    console.log("Devices refreshed " + new Date())
    setTimeout(function(){
	getDevices(loc["locationId"])
    }, 600000);
}

function jsonConcat(o1, o2) {
    for (var key in o2) {
	o1[key] = o2[key];
    }
    return o1;
}

function right(str, chr) {
    return newstr = str.substr(str.length - chr, str.length)
}

function getDevice(id) {
    var returnResult = []

    for (var i = 0; i < window.devices.length; i++) {
	if (window.devices[i].deviceId == id) {
	    $.ajax({
	        url: "https://api.smartthings.com/v1/devices/" + window.devices[i].deviceId,
	        type: "GET",
		headers: { 'Authorization': 'Bearer ' + auth },
	        success: function(result){
		    returnResult = jsonConcat(returnResult, result)
	        },
		async:false
	    })

	    $.ajax({
	        url: "https://api.smartthings.com/v1/devices/" + window.devices[i].deviceId + "/status",
	        type: "GET",
		headers: { 'Authorization': 'Bearer ' + auth },
	        success: function(result){
		    returnResult = jsonConcat(returnResult, result)
	        },
		async:false
	    })
	    return returnResult

	}
    }
}

function getScene(id) {
    for (var i = 0; i < window.scenes.length; i++) {
	if (window.scenes[i].sceneId == id) {
	    return window.scenes[i]
	}
    }
}

function commandDevice(id) {
    for (var i = 0; i < window.devices.length; i++) {
	if (window.devices[i].deviceId == id) {
	    var deviceInfo = getDeviceInfo(window.devices[i].deviceId)
	    var capability = deviceInfo[7]
	    if (capability == "switch") {
		if (deviceInfo[6]) { var command = "off" } else { var command = "on" }
	    } else if (capability == "lock") {
		if (deviceInfo[6]) { var command = "lock" } else { var command = "unlock" }
	    }

	    if (capability && command) {
		console.log(id + ": executing " + capability + ", " + command + " (" + deviceInfo[6] + ")")
		$.ajax({
	            url: 'https://api.smartthings.com/v1/devices/' + window.devices[i].deviceId + '/commands',
	            type: 'POST',
		    data: '[{ "capability": "' + capability + '", "command": "' + command + '" }]',
		    headers: { 'Authorization': 'Bearer ' + auth },
	            success: function(result) {
			return result
	            }
		})
	    } else {
		console.log("can't execute command on " + id + ", no capability or command given")
	    }

	}
    }
}

function executeScene(id) {
    for (var i = 0; i < window.scenes.length; i++) {
	if (window.scenes[i].sceneId == id) {

	    $.ajax({
	        url: "https://api.smartthings.com/v1/scenes/" + window.scenes[i].sceneId + "/execute",
	        type: "POST",
		headers: { 'Authorization': 'Bearer ' + auth },
	        success: function(result) {
		    return result
	        },
		async:false
	    })

	}
    }
}

function getDeviceInfo(deviceId) {
    var device = getDevice(deviceId)
    var capability
    var icon
    var text
    var value
    var color
    var color_battery
    var status = false

    if (device) {
	if (device["components"].hasOwnProperty('main')) {
	    if (device["components"]["main"].hasOwnProperty('stsmartweather.weatherSummary')) {
		switch(device["components"]["main"]["stsmartweather.weatherSummary"]["weather"]["value"]) {
		    case "Clear":
			var icon = "cloud"
			break;
		    case "Sunny":
			var icon = "sun"
			break;
		    case "Drizzle": // All values except Clear need confirmed!
			var icon = "cloud-drizzle"
			break;
		    case "Storm":
			var icon = "cloud-lightning"
			break;
		    case "Rain":
			var icon = "cloud-rain"
			break;
		    case "Snow":
			var icon = "cloud-snow"
			break;
		    default: var icon = "cloud-off"
		}
		var text = device["components"]["main"]["stsmartweather.weatherSummary"]["weather"]["value"] + ', humidity: ' + device["components"]["main"]["relativeHumidityMeasurement"]["humidity"]["value"] + device["components"]["main"]["relativeHumidityMeasurement"]["humidity"]["unit"]
		var value = device["components"]["main"]["temperatureMeasurement"]["temperature"]["value"] + '°' + device["components"]["main"]["temperatureMeasurement"]["temperature"]["unit"]
		var color = "lcars-periwinkle-bg"
	    } else if (device["components"]["main"].hasOwnProperty('thermostatMode')) {
		var icon = "thermometer"
		var text = device["components"]["main"]["thermostatMode"]["thermostatMode"]["value"] + ': ' + device["components"]["main"]["thermostatHeatingSetpoint"]["heatingSetpoint"]["value"] + '°' + device["components"]["main"]["thermostatHeatingSetpoint"]["heatingSetpoint"]["unit"]
		var value = device["components"]["main"]["temperatureMeasurement"]["temperature"]["value"] + '°' + device["components"]["main"]["temperatureMeasurement"]["temperature"]["unit"]
		var color = "lcars-dodger-blue-bg"
	    } else if (device["components"]["main"].hasOwnProperty('contactSensor')) {
		var icon = "sidebar"
		var text = device["components"]["main"]["contactSensor"]["contact"]["value"]
		if (device["components"]["main"].hasOwnProperty('temperatureMeasurment')) {
		    if (!!device["components"]["main"]["temperatureMeasurment"]["temperature"]["value"]) {
			var text = text + ', ' + device["components"]["main"]["temperatureMeasurment"]["temperature"]["value"] + device["components"]["main"]["temperatureMeasurment"]["temperature"]["unit"]
		    }
		}
		var value = device["type"]
		var color = "lcars-melrose-bg"
	    } else if (device["components"]["main"].hasOwnProperty('motionSensor')) {
		var icon = "navigation"
		var text = device["components"]["main"]["motionSensor"]["motion"]["value"]
		if (device["components"]["main"].hasOwnProperty('button')) {
		    if (!!device["components"]["main"]["button"]["button"]["value"]) {
			var text = text + ', button: ' + device["components"]["main"]["button"]["button"]["value"]
		    }
		}
		if (device["components"]["main"].hasOwnProperty('temperatureMeasurment')) {
		    if (!!device["components"]["main"]["temperatureMeasurment"]["temperature"]["value"]) {
			var text = text + ', ' + device["components"]["main"]["temperatureMeasurment"]["temperature"]["value"] + device["components"]["main"]["temperatureMeasurment"]["temperature"]["unit"]
		    }
		}
		var value = device["type"]
		var color = "lcars-anakiwa-bg"
		if (device["components"]["main"]["motionSensor"]["motion"]["value"] == "active") { var status = true }
	    } else if (device["components"]["main"].hasOwnProperty('lock')) {
		var capability = "lock"
		var icon = "lock"
		var text = device["components"]["main"]["lock"]["lock"]["value"]
		var value = device["type"]
		var color = "lcars-hopbush-bg"
		if (device["components"]["main"]["lock"]["lock"]["value"] == "unlocked") { var status = true }
	    } else if (device["components"]["main"].hasOwnProperty('light')) {
		var capability = "switch"
		var icon = "zap"
		var text = device["components"]["main"]["light"]["switch"]["value"]
		if (device["components"]["main"].hasOwnProperty('switchLevel')) {
		    if (!!device["components"]["main"]["switchLevel"]["level"]["value"]) {
			var text = text + ', ' + device["components"]["main"]["switchLevel"]["level"]["value"] + device["components"]["main"]["switchLevel"]["level"]["unit"]
		    }
		}
		if (device["components"]["main"].hasOwnProperty('colorControl')) {
		    if (!!device["components"]["main"]["colorControl"]["color"]["value"]) {
			var text = text + ', ' + device["components"]["main"]["colorControl"]["color"]["value"]
		    }
		} else if (device["components"]["main"].hasOwnProperty('colorTemperature')) {
		    if (!!device["components"]["main"]["colorTemperature"]["colorTemperature"]["value"]) {
			var text = text + ', ' + device["components"]["main"]["colorTemperature"]["colorTemperature"]["value"] + ' ' + device["components"]["main"]["colorTemperature"]["colorTemperature"]["unit"]
		    }
		}
		var value = device["type"]
		var color = "lcars-pale-canary-bg"
		if (device["components"]["main"]["light"]["switch"]["value"] == "on") { var status = true }
	    } else if (device["components"]["main"].hasOwnProperty('outlet')) {
		var capability = "switch"
		var icon = "trello"
		var text = device["components"]["main"]["outlet"]["switch"]["value"]
		if (device["components"]["main"].hasOwnProperty('powerMeter')) {
		    if (!!device["components"]["main"]["powerMeter"]["power"]["value"]) {
			var text = text + ', ' + device["components"]["main"]["powerMeter"]["power"]["value"] + device["components"]["main"]["powerMeter"]["power"]["unit"]
		    }
		}
		var value = device["type"]
		var color = "lcars-sandy-brown-bg"
		if (device["components"]["main"]["outlet"]["switch"]["value"] == "on") { var status = true }
	    } else if (device["components"]["main"].hasOwnProperty('switch')) {
		var capability = "switch"
		var icon = "sliders"
		var text = device["components"]["main"]["switch"]["switch"]["value"]
		var value = device["type"]
		var color = "lcars-bourbon-bg"
		if (device["components"]["main"]["switch"]["switch"]["value"] == "on") { var status = true }
	    } else if (device["components"]["main"].hasOwnProperty('smokeDetector') || device["components"]["main"].hasOwnProperty('waterSensor')) {
		var icon = "droplet"
		var text = ""
		var value = device["type"]
		var color = "lcars-mariner-bg"
	    } else if (device["components"]["main"].hasOwnProperty('presenceSensor')) {
		var icon = "smartphone"
		var text = ""
		var value = device["type"]
		var color = "lcars-husk-bg"
	    } else {  // Unknown
		var icon = "help-circle"
		var text = ""
		var value = device["type"]
		var color = "lcars-cosmic-bg"
	    }

	    if (device["components"]["main"].hasOwnProperty('battery')) {
		if (device["components"]["main"]["battery"]["battery"]["value"] <= 30) {
		    var color_battery = "lcars-red-alert-bg"
		} else if (device["components"]["main"]["battery"]["battery"]["value"] <= 60) {
		    var color_battery = "lcars-red-damask-bg"
		} else {
		    var color_battery = "lcars-tan-bg"
		}
		var battery = device["components"]["main"]["battery"]["battery"]["value"]
	    }

	} else {  // Hub doesn't have any components
	    var icon = "hard-drive"
	    var text = ""
	    var value = device["type"]
	    var color = "lcars-husk-bg"
	    var color_battery = "lcars-husk-bg"
	}
    }

    return [icon, text, value, color, color_battery, battery, status, capability]
}

function refreshDisplay() {
    clearDisplay()
    rebuildDisplay()
}

function clearDisplay() {
    // Clear existing content - jquery selector doesn't work for some reason
    document.getElementById('title-left').innerHTML = ""
    document.getElementById('left-menu').innerHTML = ""
    document.getElementById('right-menu').innerHTML = ""
    $(document).off('click')  // Unregister click events so we don't get multiple
}

function rebuildDisplay() {
    // Top bars
    var now = new Date()
    var now_formatted = now.getFullYear() + "-" + right("00"+(now.getMonth() + 1),2) + "-" + right("00"+now.getDate(),2) + " " + now.toTimeString().substr(0,5)
    $('#title-left').text(now_formatted)

    // left side - favorite devices and routines
    for (var i = 0; i < fav_menu_left.length; i++) {
	var device = getDevice(fav_menu_left[i])
	if (device) {
	    var deviceInfo = getDeviceInfo(fav_menu_left[i])
	    $('<div id="'+device["deviceId"]+'" title="'+device["label"]+'" class="lcars-row"><div id="left-menu-'+(i+1)+'-ind" class="lcars-element left-rounded button '+deviceInfo[3]+'"></div><div id="left-menu-'+(i+1)+'-icon" class="lcars-element button '+deviceInfo[3]+'"><img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/'+deviceInfo[0]+'.svg" /></div><div id="left-menu-'+(i+1)+'-label" class="lcars-element button '+deviceInfo[3]+'"><div class="lcars-element-addition">'+deviceInfo[2]+'</div></div><div id="left-menu-'+(i+1)+'-text" class="lcars-text-box full-centered lcars-u-3">'+deviceInfo[1]+'</div><div class="lcars-bar"></div></div>').appendTo("#left-menu")
	    $(document).on('click', '#'+device["deviceId"], function() {
		console.log(getDevice(this.id))
	    })
	}
    }
    $('<div id="left-menu-spacer-1" class="lcars-row lcars-vu-2"></div><div id="left-menu-scenes" class="lcars-row"></div>').appendTo("#left-menu")
    for (var i = 0; i < fav_menu_left.length; i++) {
	var scene = getScene(fav_menu_left[i])
	if (scene) {
	    $('<div id="'+scene["sceneId"]+'" class="lcars-element rounded button">'+scene["sceneName"]+'</div>').appendTo("#left-menu-scenes")
	    $(document).on('click', '#'+scene["sceneId"], function() {
		executeScene(this.id)
		refreshDisplay()
	    })
	}
    }
    $('<div id="left-menu-spacer-2" class="lcars-row lcars-vu-1"></div><div id="left-menu-scenes" class="lcars-row"></div>').appendTo("#left-menu")

    // right side - only devices
    for (var i = 0; i < fav_menu_right.length; i++) {
	var device = getDevice(fav_menu_right[i])
	if (device) {
	    var indicator = ""
	    var deviceInfo = getDeviceInfo(fav_menu_right[i])
	    if (deviceInfo[6]) { var indicator = '<div class="lcars-element right-rounded button '+deviceInfo[3]+'"></div>' }
	    $('<div id="'+device["deviceId"]+'" title="'+device["label"]+'" class="lcars-row"><div class="lcars-element button '+deviceInfo[4]+'" title="'+deviceInfo[5]+'"></div><div class="lcars-element button lcars-u-2 '+deviceInfo[3]+'">'+device["label"]+'</div><div class="lcars-text-box full-centered lcars-u-3">'+deviceInfo[1]+'</div>'+indicator+'</div>').appendTo("#right-menu")
	    $(document).on('click', '#'+device["deviceId"], function() {
		commandDevice(this.id)
		refreshDisplay()
	    })
	}
    }

    console.log("Display refreshed " + new Date())
    setTimeout(function(){
	refreshDisplay()
    }, 30000); // Every 30 seconds
}