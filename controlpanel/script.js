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
var auth
var loc
var rooms
var rooms_array = []
var scenes
var devices
var devicePreferences


//--- Helper Functions
function jsonConcat(o1, o2) {
    for (var key in o2) {
	o1[key] = o2[key];
    }
    return o1;
}

function right(str, chr) {
    return newstr = str.substr(str.length - chr, str.length)
}

function arrayContains(arr, val, ret = 'value') {
    var val = val.toLowerCase()
    for (i = 0; i < arr.length; ++i) {
        var arri = arr[i].toLowerCase()
	if (arri.indexOf(val) >= 0) {
	    if (ret == 'index') { return i; break; } else { return arr[i]; break; }
	}
    }
}

function stardate() {
    var StardateOrigin = new Date("July 15, 1987 00:00:00");
    var StardateToday = new Date();
    var stardate = StardateToday.getTime() - StardateOrigin.getTime();
    stardate = stardate / (1000 * 60 * 60 * 24 * 0.036525);
    stardate = Math.floor(stardate + 410000);
    stardate = stardate / 10
    return stardate;
}


//--- On Ready
$(document).ready(function() {
    //
});


//--- Called once the auth token is loaded
async function loadAuth(file) {
    $('#title-right').text("LCARS INITIALIZING...")
    let text = await file.text();
    window.auth = text;

    $.ajax({
        url: "https://api.smartthings.com/v1/locations",
        type: "GET",
	headers: { 'Authorization': 'Bearer ' + window.auth },
        success: function(result){
	    getDevices(result.items[0].locationId)
	    setTimeout(function(){
		refreshDisplay()
	    }, 3000); // Wait 3 seconds to refresh display so the devices are returned
        },
	error: function(xhr, error){
            console.log(xhr)
	    $('#title-right').text("LCARS FAILURE " + xhr["status"])
 	}
    })

}


//---- Everything else
function getDevices(locationId) {
    $.ajax({
        url: "https://api.smartthings.com/v1/locations/" + locationId,
        type: "GET",
	headers: { 'Authorization': 'Bearer ' + window.auth },
        success: function(result){
	    window.loc = result
        }
    })
    // Current mode (and all modes) is apparently available, but not documented
    $.ajax({
        url: "https://api.smartthings.com/v1/locations/" + locationId + "/modes/current",
        type: "GET",
	headers: { 'Authorization': 'Bearer ' + window.auth },
        success: function(result){
	    delete result["name"]  // conflicting key
	    window.loc = jsonConcat(window.loc, result)
	    console.log(window.loc)  // loc object now contains both location name and current mode (label)
        }
    })
    $.ajax({
        url: "https://api.smartthings.com/v1/locations/" + locationId + "/rooms",
        type: "GET",
	headers: { 'Authorization': 'Bearer ' + window.auth },
        success: function(result){
	    window.rooms = result["items"]
	    Object.keys(window.rooms).forEach(function(key) {
		var value = window.rooms[key];
		rooms_array.push(value["roomId"])
	    });
	    console.log(window.rooms)
        }
    })
    $.ajax({
        url: "https://api.smartthings.com/v1/scenes",
        type: "GET",
	headers: { 'Authorization': 'Bearer ' + window.auth },
        success: function(result){
	    window.scenes = result["items"]
	    console.log(window.scenes)
        }, async:false
    })
    $.ajax({
        url: "https://api.smartthings.com/v1/devices",
        type: "GET",
	headers: { 'Authorization': 'Bearer ' + window.auth },
        success: function(result){
	    window.devices = result["items"]
	    console.log(window.devices)
        }, async:false
    })
    $.ajax({
        url: "https://api.smartthings.com/v1/devicepreferences",
        type: "GET",
	headers: { 'Authorization': 'Bearer ' + window.auth },
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

function getDevice(id) {
    var returnResult = []

    for (var i = 0; i < window.devices.length; i++) {
	if (window.devices[i].deviceId == id) {
	    $.ajax({
	        url: "https://api.smartthings.com/v1/devices/" + window.devices[i].deviceId,
	        type: "GET",
		headers: { 'Authorization': 'Bearer ' + window.auth },
	        success: function(result){
		    returnResult = jsonConcat(returnResult, result)
	        }, async:false
	    })

	    $.ajax({
	        url: "https://api.smartthings.com/v1/devices/" + window.devices[i].deviceId + "/status",
	        type: "GET",
		headers: { 'Authorization': 'Bearer ' + window.auth },
	        success: function(result){
		    returnResult = jsonConcat(returnResult, result)
	        }, async:false
	    })

	    $.ajax({
	        url: "https://api.smartthings.com/v1/devices/" + window.devices[i].deviceId + "/health",
	        type: "GET",
		headers: { 'Authorization': 'Bearer ' + window.auth },
	        success: function(result){
		    returnResult = jsonConcat(returnResult, result)
	        }, async:false
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
	    var capability = deviceInfo[4]
	    if (capability == "switch") {
		if (deviceInfo[5] == 1) { var command = "off" } else { var command = "on" }
	    } else if (capability == "lock") {
		if (deviceInfo[5] == 1) { var command = "lock" } else { var command = "unlock" }
	    }

	    if (capability && command) {
		$.ajax({
	            url: 'https://api.smartthings.com/v1/devices/' + window.devices[i].deviceId + '/commands',
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
    for (var i = 0; i < window.scenes.length; i++) {
	if (window.scenes[i].sceneId == id) {

	    $.ajax({
	        url: "https://api.smartthings.com/v1/scenes/" + window.scenes[i].sceneId + "/execute",
	        type: "POST",
		headers: { 'Authorization': 'Bearer ' + window.auth },
	        success: function(result) {
		    return result
	        }
	    })

	}
    }
}

function getColor(colorType, colorValue) {
    if (colorType == "battery") {
	if (colorValue <= 30) {
	    var color = "lcars-red-alert-bg"
	} else if (colorValue <= 60) {
	    var color = "lcars-red-damask-bg"
	} else { var color = "lcars-tan-bg" }
    } else if (colorType == "type") {
	switch(colorValue) {
	    case "weather": var color = "lcars-periwinkle-bg"; break;
	    case "thermostat": var color = "lcars-dodger-blue-bg"; break;
	    case "contact": var color = "lcars-melrose-bg"; break;
	    case "motion": var color = "lcars-anakiwa-bg"; break;
	    case "lock": var color = "lcars-hopbush-bg"; break;
	    case "light": var color = "lcars-pale-canary-bg"; break;
	    case "outlet": var color = "lcars-sandy-brown-bg"; break;
	    case "switch": var color = "lcars-bourbon-bg"; break;
	    case "smoke": var color = "lcars-mariner-bg"; break;
	    case "water": var color = "lcars-mariner-bg"; break;
	    case "presence": var color = "lcars-husk-bg"; break;
	    case "device": var color = "lcars-husk-bg"; break;
	    case "location": var color = "lcars-husk-bg"; break;
	    default: var color = "lcars-cosmic-bg"
	}
    }
    return color
}

function getIcon(iconType, iconValue) {
    if (iconType == "weather") {
	switch(iconValue) {
	    case 1:  var icon = "cloud"; break;
	    case 2:  var icon = "sun"; break;
	    case 3:  var icon = "cloud-drizzle"; break;
	    case 4:  var icon = "cloud-lightning"; break;
	    case 5:  var icon = "cloud-rain"; break;
	    case 6:  var icon = "cloud-snow"; break;
	    default: var icon = "cloud-off"
	}
    } else if (iconType == "type") {
	switch(iconValue) {
	    case "thermostat": var icon = "thermometer"; break;
	    case "contact": var icon = "sidebar"; break;
	    case "motion": var icon = "navigation"; break;
	    case "lock": var icon = "lock"; break;
	    case "light": var icon = "zap"; break;
	    case "outlet": var icon = "trello"; break;
	    case "switch": var icon = "sliders"; break
	    case "smoke": var icon = "droplet"; break;
	    case "water": var icon = "droplet"; break;
	    case "presence": var icon = "smartphone"; break;
	    case "device": var icon = "hard-drive"; break;
	    case "location": var icon = "map-pin"; break;
	    default: var icon = "help-circle"
	}
    }
    return icon
}

function getGroupInfo(group) {
    var id
    var label
    var state = 1
    var type
    var capability
    var status
    var level = 100
    var value
    var text
    var room

    for (var i = 0; i < groups[group].length; i++) {
	var deviceInfo = getDeviceInfo(groups[group][i])
	// Info associated with device control is derived from first device in group
	if (i == 0) {
	    var id = deviceInfo[0]
	    var label = group
	    var type = deviceInfo[3]
	    var capability = deviceInfo[4]
	    var status = deviceInfo[5]
	    var value = deviceInfo[7]
	    var room = deviceInfo[9]
	}
	// Info associated with status is aggregated from all devices in group
	if (typeof deviceInfo[8] !== null && deviceInfo[8] !== undefined) {
	    if (typeof text !== null && text !== undefined) {
		var text = text + ', ' + deviceInfo[1] + ': ' + deviceInfo[8]
	    } else {
		var text = deviceInfo[1] + ': ' + deviceInfo[8]
	    }
	}
	if (typeof deviceInfo[6] === "number" && deviceInfo[6] !== null && deviceInfo[6] !== undefined) {
	    var level = Math.min(level, deviceInfo[6])
	}
	if (typeof deviceInfo[2] === "number" && deviceInfo[2] !== null && deviceInfo[2] !== undefined) {
	    var state = Math.min(state, deviceInfo[2]) // If anything is down, the whole group is down
	}
    }

    return [id, label, state, type, capability, status, level, value, text, room]
}

function getDeviceInfo(deviceId) {
    var id
    var label
    var state = 0
    var type
    var capability
    var status = 0
    var level = 0
    var value
    var text
    var room = 0
    var device = getDevice(deviceId)

    if (device) {
	var id = device["deviceId"]
	var label = device["label"]
	if (device.hasOwnProperty('state')) {
	     if (device["state"] == "ONLINE") { var state = 1 }
	} else { var state = 9 }  // Unknown state

	if (device["components"].hasOwnProperty('main')) {
	    var main = device["components"]["main"]
	    var components = Object.keys(device["components"]["main"])
	    var weather = arrayContains(components, "weatherSummary")
	    var humidity = arrayContains(components, "relativeHumidityMeasurement")
	    var temperature = arrayContains(components, "temperatureMeasurement")
	    var thermostat = arrayContains(components, "thermostatMode")
	    var setpoint = arrayContains(components, "thermostatHeatingSetpoint")
	    var contact = arrayContains(components, "contactSensor")
	    var motion = arrayContains(components, "motionSensor")
	    var button = arrayContains(components, "button")
	    var lock = arrayContains(components, "lock")
	    var light = arrayContains(components, "light")
	    var level = arrayContains(components, "switchLevel")
	    var colorctrl = arrayContains(components, "colorControl")
	    var colortemp = arrayContains(components, "colorTemperature")
	    var outlet = arrayContains(components, "outlet")
	    var power = arrayContains(components, "powerMeter")
	    var swtch = arrayContains(components, "switch")
	    var smoke = arrayContains(components, "smokeDetector")
	    var water = arrayContains(components, "waterSensor")
	    var presence = arrayContains(components, "presenceSensor")
	    var battery = arrayContains(components, "battery")
	    var bridge = arrayContains(components, "bridge")
	    if (weather) {
		var type = "weather"
		switch(main[weather]["weather"]["value"]) {
		    case "Clear":   var status = 1; break;
		    case "Sunny":   var status = 2; break;
		    case "Drizzle": var status = 3; break;
		    case "Storm":   var status = 4; break;
		    case "Rain":    var status = 5; break;
		    case "Snow":    var status = 6; break;
		    default:        var status = 0
		}
		var text = main[weather]["weather"]["value"]
		var value = Math.round(main[temperature]["temperature"]["value"]) + '°' + main[temperature]["temperature"]["unit"]
	    } else if (thermostat) {
		var type = "thermostat"
		var text = main[thermostat]["thermostatMode"]["value"] + ': ' + main[setpoint]["heatingSetpoint"]["value"] + '°' + main[setpoint]["heatingSetpoint"]["unit"]
		var value = Math.round(main[temperature]["temperature"]["value"]) + '°' + main[temperature]["temperature"]["unit"]
	    } else if (contact) {
		var type = "contact"
		var text = main[contact]["contact"]["value"]
	    } else if (motion) {
		var type = "motion"
		var text = main[motion]["motion"]["value"]
		if (main[motion]["motion"]["value"] == "active") { var status = 1 }
	    } else if (lock) {
		var type = "lock"
		var capability = "lock"
		var text = main[lock]["lock"]["value"]
		if (main[lock]["lock"]["value"] == "unlocked") { var status = 1 }
	    } else if (light) {
		var type = "light"
		var capability = "switch"
		var text = main[light]["switch"]["value"]
		if (main[light]["switch"]["value"] == "on") { var status = 1 }
	    } else if (outlet) {
		var type = "outlet"
		var capability = "switch"
		var text = main[outlet]["switch"]["value"]
		if (main[outlet]["switch"]["value"] == "on") { var status = 1 }
	    } else if (swtch) {
		var type = "switch"
		var capability = "switch"
		var text = main[swtch]["switch"]["value"]
		if (main[swtch]["switch"]["value"] == "on") { var status = 1 }
	    } else if (smoke || water) {
		var type = "smoke"
		var text = main[smoke]["smoke"]["value"]
	    } else if (water) {
		var type = "water"
		//var text = main[water]["water"]["value"]
	    } else if (presence) {
		var type = "presence"
		var text = main[presence]["presence"]["value"]
		if (main[presence]["presence"]["value"] == "present") { var status = 1 }
	    } else if (bridge) {
		var type = "device"
		var text = device["state"]
	    } else {  // Unknown
		var type = device["type"]
		var text = device["name"]
	    }
	    if (button) {
		if (!!main[button]["button"]["value"]) {
		    var text = text + ', button ' + main[button]["button"]["value"]
		}
	    }
	    if (level) {
		if (!!main[level]["level"]["value"]) {
		    var text = text + ', ' + main[level]["level"]["value"] + main[level]["level"]["unit"]
		}
	    }
	    if (colorctrl) {
		if (!!main[colorctrl]["color"]["value"]) {
		    var text = text + ', ' + main[colorctrl]["color"]["value"]
		}
	    }
	    if (colortemp) {
		if (!!main[colortemp]["colorTemperature"]["value"]) {
		    var text = text + ', ' + main[colortemp]["colorTemperature"]["value"] + ' ' + main[colortemp]["colorTemperature"]["unit"]
		}
	    }
	    if (power) {
		if (!!main[power]["power"]["value"]) {
		    var text = text + ', ' + main[power]["power"]["value"] + main[power]["power"]["unit"]
		}
	    }
	    if (temperature) {
		if (!!main[temperature]["temperature"]["value"]) {
		    var text = text + ', ' + main[temperature]["temperature"]["value"] + '°' + main[temperature]["temperature"]["unit"]
		}
	    }
	    if (humidity) {
		if (!!main[humidity]["humidity"]["value"]) {
		    var text = text + ', ' + main[humidity]["humidity"]["value"] + main[humidity]["humidity"]["unit"] + 'RH'
		}
	    }
	    if (level) {
		var level = main[level]["level"]["value"]
	    } else if (power) {
		var level = main[power]["power"]["value"]
	    } else if (battery) {
		var level = main[battery]["battery"]["value"]
	    }
	} else {  // Hub (no components)
	    var type = "device"
	    var text = device["state"]
	}

	if (device.hasOwnProperty('roomId')) { 
	    var room = arrayContains(window.rooms_array, device["roomId"], 'index') + 1
	}
    } else if (window.loc["locationId"] === deviceId) {  // Location (no device)
	var type = "location"
	var id = window.loc["locationId"]
	var label = window.loc["label"]
	var value = window.loc["name"]
	var text = window.loc["label"]
	var state = 1
    }

    return [id, label, state, type, capability, status, level, value, text, room]
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
    $('#title-left-btm').text(stardate())
    if (window.auth) { $('#title-right').text("LCARS ACCESS") } else { $('#title-right').text("LCARS UNINITIALIZED") }

    // left side - favorite devices and scenes/routines
    for (var i = 0; i < fav_menu_left.length; i++) {
	if (fav_menu_left[i].length == 36 && fav_menu_left[i].indexOf("-") == 8) {
	    var deviceInfo = getDeviceInfo(fav_menu_left[i])
	} else { var deviceInfo = getGroupInfo(fav_menu_left[i]) }
	if (deviceInfo) {
	    if (deviceInfo[3] == "weather") { var icon = getIcon("weather", deviceInfo[3]) } else { var icon = getIcon("type", deviceInfo[5]) }
	    var color = getColor("type", deviceInfo[3])
	    if (deviceInfo[2] !== null && deviceInfo[2] !== undefined) {
		if (deviceInfo[2] == 0) { var element = ' lcars-red-alert-bg">' } else { var element = '">' }
	    } else { element = '">' }
	    if (deviceInfo[7]) { var element = element + deviceInfo[7] } else { var element = element + deviceInfo[2] + deviceInfo[9] + deviceInfo[5] }
	    $('<div id="' + deviceInfo[0] + '" title="' + deviceInfo[1] + '" class="lcars-row"><div class="lcars-element left-rounded button ' + color + '"></div><div class="lcars-element button lcars-u-2 ' + color + '">' + deviceInfo[1] + '</div><div class="lcars-element button ' + color + '"><div class="lcars-element-addition' + element + '</div></div><div class="lcars-text-box small full-centered lcars-u-3">' + deviceInfo[8] + '</div><div class="lcars-element lcars-black-bg"></div></div>').appendTo("#left-menu")
	    $(document).on('click', '#'+deviceInfo[0], function() {
		console.log(getDevice(this.id))
		commandDevice(this.id)
		refreshDisplay()
	    })
	}
    }
    $('<div id="left-menu-spacer" class="lcars-row lcars-vu-1"></div><div id="left-menu-scenes" class="lcars-row"></div>').appendTo("#left-menu")
    for (var i = 0; i < fav_scenes.length; i++) {
	var scene = getScene(fav_scenes[i])
	if (scene) {
	    $('<div id="'+scene["sceneId"]+'" class="lcars-element rounded button">'+scene["sceneName"]+'</div>').appendTo("#left-menu-scenes")
	    $(document).on('click', '#'+scene["sceneId"], function() {
		command.log(scene)
		executeScene(this.id)
		refreshDisplay()
	    })
	}
    }

    // right side - only devices
    for (var i = 0; i < fav_menu_right.length; i++) {
	if (fav_menu_right[i].length == 36 && fav_menu_right[i].indexOf("-") == 8) {
	    var deviceInfo = getDeviceInfo(fav_menu_right[i])
	} else { var deviceInfo = getGroupInfo(fav_menu_right[i]) }
	if (deviceInfo) {
	    if (deviceInfo[3] == "weather") { var icon = getIcon("weather", deviceInfo[3]) } else { var icon = getIcon("type", deviceInfo[3]) }
	    var color = getColor("type", deviceInfo[3])
	    var color_battery = getColor("battery", deviceInfo[6])
	    if (deviceInfo[2] !== null && deviceInfo[2] !== undefined) {
		if (deviceInfo[2] == 0) { var element = ' lcars-red-alert-bg">' } else { var element = '">' }
	    } else { element = '">' }
	    if (deviceInfo[7]) { var element = element + deviceInfo[7] } else { var element = element + deviceInfo[2] + deviceInfo[9] + deviceInfo[5] }
	    if (deviceInfo[5] == 1) {
		var indicator = '<div class="lcars-element right-rounded button ' + getColor("type", deviceInfo[3]) + '"></div>'
	    } else { var indicator = '<div class="lcars-element right-rounded button lcars-gray-bg"></div>' }
	    $('<div id="' + deviceInfo[0] + '" title="' + deviceInfo[1] + '" class="lcars-row"><div class="lcars-element button ' + color_battery + '" title="' + deviceInfo[6] + '"></div><div class="lcars-element button ' + color + '"><div class="lcars-element-addition' + element + '</div></div><div class="lcars-element button lcars-u-2 ' + color + '">' + deviceInfo[1] + '</div><div class="lcars-text-box small full-centered lcars-u-3">' + deviceInfo[8] + '</div>' + indicator + '</div>').appendTo("#right-menu")
	    // If device is present more than once, then the onclick will be added more than once and cause devices to turn on and then off.
	    // TODO: Check if the onclick is already registered and don't add another?
	    $(document).on('click', '#'+deviceInfo[0], function() {
		console.log(getDevice(this.id))
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