const groups = { 
    "Living Room" : ['ee64c4c4-545f-4093-a75e-88c05c0e5d81','be67888f-5129-4809-8c45-9685b0e3b298','8ef66a4d-a20d-422f-a84d-8bc14a90eab4'],
    "Office" : ['6eac9a89-3243-47e2-a053-590fec9e6179','a3551f94-785b-45d6-b993-4b70363155e9','a4745bcb-b120-4a49-9085-2c79ddb19a64'],
    "Front Door" : ['6301981d-407c-475c-869a-05dfe770ca86','3f9e9f5b-e44f-432f-9cb9-6b876560158d','5aa96cee-36eb-4f15-be8b-fea024e43b45','5848eccf-fca5-4c36-9d92-61e51624ba48'],
    "Back Door" : ['db915ce1-a431-4f3b-85a6-345a240f57dc','00355c73-2d06-46d8-a90b-db9e8a8e626b'],
    "Kitchen" : ['66c93b9c-4c3e-49c9-8b48-3cf80ae8fa7c','432f9d9f-03e8-4cad-9df7-8a5326d7f0ea','fe6be7c4-d1fb-4f8e-a2b8-9021a32918af','7651e84d-f72f-4b7c-84b0-ee76fbe9c3f7','3d5612ca-d8b6-412f-9d0d-39f4ea757bad'],
    "Bathroom" : ['fe984912-fe96-4428-a2b2-32e452ec1f55','e93d8f70-6a3c-4b6d-9409-167fd65dfafa','4ef55556-c9e4-4312-af0d-4e74f312ebad'],
    "Bedroom" : ['be6e94a3-fa52-47a9-869c-6f3c211781ee','0233e3b7-6ff4-4fac-89b7-adbc5cd1483d','6d7f8205-5a56-4130-94bd-76249073e0c9','72fd6018-77fd-45d1-bb2b-728c6a2c56fd'],
    "TV" : ['cb2b8413-1efb-48fc-b831-13341134ab82']
}
const fav_menu_left = ['340a2a7e-f4ed-42fa-88e6-8067f5779c9f','5b7dd0c0-3053-42f1-a63f-b674d3370a6f','c047215e-c82d-4461-8167-da3455b47048','57012c94-fa9b-45ff-a60d-8a51aaf98cb0','5aba48fd-e5b1-4a95-a89f-4037e283cb27','8842352f-8123-4728-a5ee-bf038f7f9b0f']
const fav_menu_right =  ['Living Room','Office','Front Door','Back Door','Kitchen','Bathroom','Bedroom','TV']
var auth
var loc
var rooms
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

function arrayContains(arr, val) {
    var val = val.toLowerCase()
    for (i = 0; i < arr.length; ++i) {
        var arri = arr[i].toLowerCase()
	if (arri.indexOf(val) >= 0) {
	    return arr[i]; break;
	}
    }
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
	    console.log(window.loc)
        }
    })
    $.ajax({
        url: "https://api.smartthings.com/v1/locations/" + locationId + "/rooms",
        type: "GET",
	headers: { 'Authorization': 'Bearer ' + window.auth },
        success: function(result){
	    window.rooms = result["items"]
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
        },
	async:false
    })
    $.ajax({
        url: "https://api.smartthings.com/v1/devices",
        type: "GET",
	headers: { 'Authorization': 'Bearer ' + window.auth },
        success: function(result){
	    window.devices = result["items"]
	    console.log(window.devices)
        },
	async:false
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
	        },
		async:false
	    })

	    $.ajax({
	        url: "https://api.smartthings.com/v1/devices/" + window.devices[i].deviceId + "/status",
	        type: "GET",
		headers: { 'Authorization': 'Bearer ' + window.auth },
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
		console.log(id + ", " + capability + ": " + command)
		$.ajax({
	            url: 'https://api.smartthings.com/v1/devices/' + window.devices[i].deviceId + '/commands',
	            type: 'POST',
		    data: '[{ "capability": "' + capability + '", "command": "' + command + '" }]',
		    headers: { 'Authorization': 'Bearer ' + window.auth },
	            success: function(result) {
			return result
	            }
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
    var color
    if (colorType == "battery") {
	if (colorValue <= 30) {
	    var color = "lcars-red-alert-bg"
	} else if (colorValue <= 60) {
	    var color = "lcars-red-damask-bg"
	} else { var color = "lcars-tan-bg" }
    }
    return color
}

function getGroupInfo(group) {
    var icon
    var text
    var value
    var color
    var color_battery
    var battery = 100
    var status = false
    var capability
    var name
    var id

    for (var i = 0; i < groups[group].length; i++) {
	var deviceInfo = getDeviceInfo(groups[group][i])
	// Info associated with device control is derived from first device in group
	if (i == 0) {
	    var icon = deviceInfo[0]
	    var value = deviceInfo[2]
	    var color = deviceInfo[3]
	    var status = deviceInfo[6]
	    var capability = deviceInfo[7]
	    var name = group
	    var id = deviceInfo[9]
	}
	// Info associated with status is aggregated from all devices in group
	if (typeof deviceInfo[1] !== null && deviceInfo[1] !== undefined) {
	    if (typeof text !== null && text !== undefined) {
		var text = text + ', ' + deviceInfo[8] + ': ' + deviceInfo[1]
	    } else {
		var text = deviceInfo[8] + ': ' + deviceInfo[1]
	    }
	}
	if (typeof deviceInfo[5] === "number" && deviceInfo[5] !== null && deviceInfo[5] !== undefined) {
	    var battery = Math.min(battery, deviceInfo[5])
	}
	var color_battery = getColor("battery", battery)
    }

    return [icon, text, value, color, color_battery, battery, status, capability, name, id]
}

function getDeviceInfo(deviceId) {
    var device = getDevice(deviceId)
    var icon
    var text
    var value
    var color
    var color_battery
    var battery
    var status = false
    var capability
    var name
    var id

    if (device) {
	var name = device["label"]
	var id = device["deviceId"]
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
	    if (weather) {
		switch(main[weather]["weather"]["value"]) {
		    case "Clear":
			var icon = "cloud"; break;
		    case "Sunny":
			var icon = "sun"; break;
		    case "Drizzle": // All values except Clear need confirmed!
			var icon = "cloud-drizzle"; break;
		    case "Storm":
			var icon = "cloud-lightning"; break;
		    case "Rain":
			var icon = "cloud-rain"; break;
		    case "Snow":
			var icon = "cloud-snow"; break;
		    default: var icon = "cloud-off"
		}
		var text = main[weather]["weather"]["value"] + ', humidity: ' + main[humidity]["humidity"]["value"] + main[humidity]["humidity"]["unit"]
		var value = main[temperature]["temperature"]["value"] + '°' + main[temperature]["temperature"]["unit"]
		var color = "lcars-periwinkle-bg"
	    } else if (thermostat) {
		var icon = "thermometer"
		var text = main[thermostat]["thermostatMode"]["value"] + ': ' + main[setpoint]["heatingSetpoint"]["value"] + '°' + main[setpoint]["heatingSetpoint"]["unit"]
		var value = main[temperature]["temperature"]["value"] + '°' + main[temperature]["temperature"]["unit"]
		var color = "lcars-dodger-blue-bg"
	    } else if (contact) {
		var icon = "sidebar"
		var text = main[contact]["contact"]["value"]
		var value = device["type"]
		var color = "lcars-melrose-bg"
	    } else if (motion) {
		var icon = "navigation"
		var text = main[motion]["motion"]["value"]
		var value = device["type"]
		var color = "lcars-anakiwa-bg"
		if (main[motion]["motion"]["value"] == "active") { var status = true }
	    } else if (lock) {
		var capability = "lock"
		var icon = "lock"
		var text = main[lock]["lock"]["value"]
		var value = device["type"]
		var color = "lcars-hopbush-bg"
		if (main[lock]["lock"]["value"] == "unlocked") { var status = true }
	    } else if (light) {
		var capability = "switch"
		var icon = "zap"
		var text = main[light]["switch"]["value"]
		var value = device["type"]
		var color = "lcars-pale-canary-bg"
		if (main[light]["switch"]["value"] == "on") { var status = true }
	    } else if (outlet) {
		var capability = "switch"
		var icon = "trello"
		var text = main[outlet]["switch"]["value"]
		var value = device["type"]
		var color = "lcars-sandy-brown-bg"
		if (main[outlet]["switch"]["value"] == "on") { var status = true }
	    } else if (swtch) {
		var capability = "switch"
		var icon = "sliders"
		var text = main[swtch]["switch"]["value"]
		var value = device["type"]
		var color = "lcars-bourbon-bg"
		if (main[swtch]["switch"]["value"] == "on") { var status = true }
	    } else if (smoke || water) {
		var icon = "droplet"
		var text = main[smoke]["smoke"]["value"]
		var value = device["type"]
		var color = "lcars-mariner-bg"
	    } else if (presence) {
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
	    if (battery) {
		var color_battery = getColor("battery", main[battery]["battery"]["value"])
		var battery = main[battery]["battery"]["value"]
	    }
	} else {  // Hub doesn't have any components
	    var icon = "hard-drive"
	    var text = ""
	    var value = device["type"]
	    var color = "lcars-husk-bg"
	    var color_battery = "lcars-husk-bg"
	}
    }

    return [icon, text, value, color, color_battery, battery, status, capability, name, id]
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
    if (window.auth) {
	$('#title-right').text("LCARS ACCESS")
    } else {
	$('#title-right').text("LCARS UNINITIALIZED")
    }

    // left side - favorite devices and routines
    for (var i = 0; i < fav_menu_left.length; i++) {
	var device = getDevice(fav_menu_left[i])
	if (device) {
	    var deviceInfo = getDeviceInfo(fav_menu_left[i])
	    $('<div id="'+device["deviceId"]+'" title="'+device["label"]+'" class="lcars-row"><div id="left-menu-'+(i+1)+'-ind" class="lcars-element left-rounded button '+deviceInfo[3]+'"></div><div id="left-menu-'+(i+1)+'-icon" class="lcars-element button '+deviceInfo[3]+'"><img src="https://raw.githubusercontent.com/feathericons/feather/master/icons/'+deviceInfo[0]+'.svg" /></div><div id="left-menu-'+(i+1)+'-label" class="lcars-element button '+deviceInfo[3]+'"><div class="lcars-element-addition">'+deviceInfo[2]+'</div></div><div id="left-menu-'+(i+1)+'-text" class="lcars-text-box small full-centered lcars-u-3">'+deviceInfo[1]+'</div><div class="lcars-bar"></div></div>').appendTo("#left-menu")
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
	if (fav_menu_right[i].length == 36 && fav_menu_right[i].indexOf("-") == 8) {
	    var deviceInfo = getDeviceInfo(fav_menu_right[i])
	} else {
	    var deviceInfo = getGroupInfo(fav_menu_right[i])
	}
	if (deviceInfo) {
	    var indicator = ""
	    if (deviceInfo[6]) {
		var indicator = '<div class="lcars-element right-rounded button '+deviceInfo[3]+'"></div>'
	    } else {
		var indicator = '<div class="lcars-element right-rounded button lcars-gray-bg"></div>'
	    }
	    $('<div id="'+deviceInfo[9]+'" title="'+deviceInfo[8]+'" class="lcars-row"><div class="lcars-element button '+deviceInfo[4]+'" title="'+deviceInfo[5]+'"></div><div class="lcars-element button lcars-u-2 '+deviceInfo[3]+'">'+deviceInfo[8]+'</div><div class="lcars-text-box small full-centered lcars-u-3">'+deviceInfo[1]+'</div>'+indicator+'</div>').appendTo("#right-menu")
	    // If device is present more than once, then the onclick will be added more than once and cause devices to turn on and then off.
	    // TODO: Check if the onclick is already registered and don't add another?
	    $(document).on('click', '#'+deviceInfo[9], function() {
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