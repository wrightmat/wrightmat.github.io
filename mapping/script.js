const auth = "pk.eyJ1Ijoid3JpZ2h0bWF0IiwiYSI6ImNreDVpZ2t1NjJjcjUzMXBoM2Zsd3o1ZWgifQ.JiL_TzmasLVXSsR6DAghHA"
var map
var routes
var routes_info = {}
var route_stop_distance = 0
var route_stop_duration = 0
var route_distance = 0
var route_duration = 0
var route_duration_dt = 0
var route_stops = 0


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

function arrayMove(arr, from, to) {
    arr.splice(to, 0, arr.splice(from, 1)[0]);
    return arr
}


//--- On Ready
$(document).ready(function() {
    //
});

function updateMap(lonlat = [-92.33, 38.95], zoom = 13) {
    document.getElementById("map").innerHTML = ''
    window.map = new ol.Map({
	target: 'map',
	layers: [
	    new ol.layer.Tile({  source: new ol.source.OSM()  })
        ],
        view: new ol.View({
	    center: ol.proj.fromLonLat(lonlat),
	    zoom: zoom
        })
    });

    window.map.on('click', function(event) {
        var selected = false
	window.map.forEachFeatureAtPixel(event.pixel, function(feature,layer) {
	    if (layer.get('stop_name') !== undefined) {
		if (document.getElementById("route-select").value !== "") {
		    if (document.getElementById("route-select").value == layer.get('route')) {
			document.getElementById('stop-select').value = layer.get('index')
			selected = true
			selectStop()
		    }
		}
		if (selected !== true && document.getElementById("route-select").value == "") {
		    document.getElementById("route-select").value = layer.get('route')
		    selectRoute(layer.get('route'))
		    document.getElementById('stop-select').value = layer.get('index')
		    selected = true
		    selectStop()
		}
	    }
	});

	if (selected !== true) {
	    // Add a new stop based on clicked coordinate (lat/lng), if a route has been selected first
	    var route_sel = document.getElementById("route-select");
	    var stop_sel = document.getElementById("stop-select");
	    if (route_sel.value !== "") {
		document.getElementById('stop-select').value = ""
		var coords = ol.proj.transform(event.coordinate, 'EPSG:3857', 'EPSG:4326')
		document.getElementById('index').value = stop_sel.options.length
		document.getElementById('lat').value = coords[1]
		document.getElementById('lng').value = coords[0]
		document.getElementById('route').value = document.getElementById("route-select").value
		document.getElementById('stop').checked = true
		document.getElementById('name').value = "New Stop"
		document.getElementById('num').value = ""
		document.getElementById('updt-add-link').innerHTML = "Add Stop"
		document.getElementById('right-btm').style.display = "block"
		document.getElementById('right-info').style.display = "none"
		document.getElementById('name').focus(); document.getElementById('name').select();
	    }
	}
    });
}

function updateRoutes(route) {
    var select = document.getElementById("route-select");
    select.innerHTML = "";
    select.options[select.options.length] = new Option("", "");

    Object.keys(window.routes).forEach((route, index) => {
	window.routes_info[route] = []; window.route_stops = 0;
	for (var i = 1, l = Object.keys(window.routes[route]).length; i < l; i++)  {
	    var r = getDirections(window.routes[route][i-1][0], window.routes[route][i-1][1], window.routes[route][i][0], window.routes[route][i][1])
	    addRouteLine(map, r["geometry"], route, i-1, r["duration_typical"], r["distance_feet"])
	}
	select.options[select.options.length] = new Option(route, route);
    });
    
    if (route !== null) {
	select.value = route
	selectRoute(route)
    }
}

function updateCheckbox(chk) {
    if (chk.id == "stop") {
	if (chk.checked) {
	    document.getElementById("name").value = "New Stop"
	    document.getElementById("updt-add-link").innerHTML = "Add Stop"
	} else {
	    document.getElementById("name").value = ""
	    document.getElementById("updt-add-link").innerHTML = "Add Waypoint"
	}
    }
}

async function loadFile(file) {
    let text = await file.text();
    window.routes = JSON.parse(text);
    updateMap(); updateRoutes();
}


//---- Everything else
function getDirections(lat1, lng1, lat2, lng2) {
    var obj
    $.ajax({
        url: "https://api.mapbox.com/directions/v5/mapbox/driving-traffic/" + lng1 + "," + lat1 + ";" + lng2 + "," + lat2 + "?access_token=" + auth + "&geometries=geojson",
        type: "GET",
        success: function(result) {
	    obj = result["routes"]["0"]
	    obj["distance_feet"] = Math.round((obj["distance"] * 3.2808399) * 100) / 100
	    obj["distance_miles"] = Math.round((obj["distance_feet"] / 5280) * 100) / 100
	    obj["duration_mins"] = Math.round((obj["duration_typical"] / 60) * 100) / 100
        }, async: false
    })
    return obj
}

function addRouteLine(map, geom, route, index, dur, dist) {
    var label
    var offset = 15

    const lineLayer = new ol.layer.Vector({
	source: new ol.source.Vector({
	    format: new ol.format.GeoJSON(),
	    features: new ol.format.GeoJSON().readFeatures(geom, { featureProjection: 'EPSG:3857' })
	}),
	style: new ol.style.Style({                    
	    stroke : new ol.style.Stroke({  color: route, width: 3  }),
	})
    });
    lineLayer.setProperties({ 'route': route, 'index': index, 'dur': dur, 'dist': dist })
    map.addLayer(lineLayer)

    window.route_stop_distance = window.route_stop_distance + dist
    window.route_stop_duration = window.route_stop_duration + dur

    if (window.routes[route][index][2].toString() == "true") {
	var lng = geom["coordinates"][0][0]
	var lat = geom["coordinates"][0][1]
	window.route_stops = window.route_stops + 1
	var label = window.route_stop_duration + " s (" + window.route_stop_distance + " ft)"

	const pointLayer = new ol.layer.Vector({
	    source: new ol.source.Vector({
		features: [new ol.Feature({geometry: new ol.geom.Point(ol.proj.transform([parseFloat(lng), parseFloat(lat)], 'EPSG:4326', 'EPSG:3857'))})]
	    })
	});
	pointLayer.setProperties({ 'route': route, 'index': index, 'stop_name': window.routes[route][index][3], 'stop_num': window.routes[route][index][4] })
	map.addLayer(pointLayer);

	if (window.routes[route][index][4] !== undefined) {
	    if (window.routes[route][index][4].substring(window.routes[route][index][4].length - 1) == "6") {  var offset = -offset  }
	}
	const textLayer = new ol.layer.Vector({
	    source: new ol.source.Vector({
		features: [new ol.Feature({geometry: new ol.geom.Point(ol.proj.transform([parseFloat(lng), parseFloat(lat)], 'EPSG:4326', 'EPSG:3857'))})]
	    }),
	    style: new ol.style.Style({
		text: new ol.style.Text({
		    text: label,  offsetY: offset,  scale: 1,
		    fill: new ol.style.Fill({ color: "black" })
		})
	    })
	});
    	textLayer.setProperties({ 'route': route, 'index': index, 'route_stop_distance': window.route_stop_distance, 'route_stop_duration': window.route_stop_duration, 'route_distance': window.route_distance, 'route_duration': window.route_duration, 'route_duration_dt': window.route_duration_dt })
	map.addLayer(textLayer);
	map.on('moveend', function() {
	    zoom = map.getView().getZoom();
	    if (zoom >= 15.5) {
		textLayer.setVisible(true);
	    } else if (zoom < 15) {
		textLayer.setVisible(false);
	    }
	});  // showing the text labels when the map is too zoomed out just makes it unreadable

	window.route_stop_distance = 0; window.route_stop_duration = 0;
    }

    if (window.routes_info[route]["stops"] !== undefined) {
	window.routes_info[route]["distance"] = window.routes_info[route]["distance"] + dist
	window.routes_info[route]["duration"] = window.routes_info[route]["duration"] + dur
	window.routes_info[route]["duration_dt"] = window.routes_info[route]["duration_dt"] + dur + 12  // plus 2 seconds per average passenger (avg passengers per day at stop divided by 16 as the number of cycles in a day); 12 is the rough average national dwell time; could also include data about the type of stop (mid-block, near-section, far-section) and change the avg dwell time based on that that
    } else {
	window.routes_info[route]["distance"] = dist
	window.routes_info[route]["duration"] = dur
	window.routes_info[route]["duration_dt"] = dur + 12
    }

    window.routes_info[route]["stops"] = window.route_stops
}

function selectRoute(route) {
    var route = document.getElementById("route-select").value;
    var select = document.getElementById("stop-select");
    select.innerHTML = "";
    if (route !== "") {
	for (var i = 0, l = Object.keys(window.routes[route]).length; i < l; i++)  {
	    select.options[select.options.length] = new Option(route + ': ' + ((window.routes[route][i][3]) || ("Waypoint " + i)), i);
	}

	document.getElementById('right-btm').style.display = 'none'
	document.getElementById('right-info').style.display = 'block'
	if (window.routes_info[route]["stops"] !== undefined) {
	    document.getElementById('right-info').innerHTML = "<b>Stops:</b> " + window.routes_info[route]["stops"] + "<br /><b>Distance:</b> " + (Math.round((window.routes_info[route]["distance"]/5280)*100)/100) + " miles<br /><b>Duration:</b> " + (Math.round((window.routes_info[route]["duration"]/60)*100)/100) + " mins<br /><b>Duration (w/ dwell):</b> " + (Math.round((window.routes_info[route]["duration_dt"]/60)*100)/100) + " mins<br /><br /><b>Avg Distance b/w Stops:</b> " + Math.round(((window.routes_info[route]["distance"]/5280) / window.routes_info[route]["stops"])*100)/100 + " miles"
	}
    } else {
	document.getElementById('right-btm').style.display = 'none'
	document.getElementById('right-info').style.display = 'none'
    }
}

function selectStop() {
    var route = document.getElementById("route-select").value;
    var stop_sel = document.getElementById('stop-select');
    document.getElementById('index').value = stop_sel.value

    if (route !== "") {
	for (var i = 0, l = Object.keys(window.routes[route]).length; i < l; i++)  {
	    if (i == stop_sel.value) {
		document.getElementById('lat').value = window.routes[route][i][0]
		document.getElementById('lng').value = window.routes[route][i][1]
		document.getElementById('route').value = route
		if (window.routes[route][i][2] === "true") { 
		    document.getElementById('stop').checked = true
		    document.getElementById('updt-add-link').innerHTML = "Update Stop"
		} else {
		    document.getElementById('stop').checked = false
		    document.getElementById('updt-add-link').innerHTML = "Update Waypoint"
		}
		document.getElementById('name').value = (window.routes[route][i][3] || "")
		document.getElementById('num').value = (window.routes[route][i][4] || "")
	    }
	}
    }
    document.getElementById('right-btm').style.display = "block"
    document.getElementById('right-info').style.display = "none"
}

function moveUpStop() {
    var route = document.getElementById("route-select").value;
    var stop_sel_ind = document.getElementById('stop-select').selectedIndex
    if (route !== "") {
	arrayMove(window.routes[route], stop_sel_ind, stop_sel_ind - 1)
	selectRoute(route)
	document.getElementById('stop-select').value = stop_sel_ind - 1
    }
}

function moveDownStop() {
    var route = document.getElementById("route-select").value;
    var stop_sel_ind = document.getElementById('stop-select').selectedIndex

    if (route !== "") {
	arrayMove(window.routes[route], stop_sel_ind, stop_sel_ind + 1)
	selectRoute(route)
	document.getElementById('stop-select').value = stop_sel_ind + 1
    }
}

function deleteStop() {
    var route = document.getElementById("route-select").value
    var stop_sel_ind = document.getElementById('stop-select').selectedIndex

    if (stop_sel_ind > 0 && route !== "") {
	var conf = confirm("Are you sure you want to delete the stop on " + route + " route at index " + stop_sel_ind + "?")
	if (conf) {
	    window.routes[route].splice(stop_sel_ind, 1)
	    selectRoute(route)
	}
    }
    var lat = window.routes[route][stop_sel_ind][0]
    var lng = window.routes[route][stop_sel_ind][1]
    updateMap([lng,lat], window.map.getView().getZoom())
    updateRoutes(route)
}

function addStop() {
    var route = document.getElementById("route-select").value
    var stop_sel = document.getElementById('stop-select')
    if (route !== "") {
	document.getElementById('stop-select').value = ""
	document.getElementById('index').value = stop_sel.options.length
	document.getElementById('lat').value = ""
	document.getElementById('lng').value = ""
	document.getElementById('route').value = document.getElementById("route-select").value
	document.getElementById('stop').checked = true
	document.getElementById('name').value = "New Stop"
	document.getElementById('num').value = ""
	document.getElementById('updt-add-link').innerHTML = "Add Stop"
	document.getElementById('right-btm').style.display = "block"
	document.getElementById('right-info').style.display = "none"
	document.getElementById('name').focus(); document.getElementById('name').select();
    }
}

function updateStop() {
    var route_sel = document.getElementById("route-select");
    var stop_sel = document.getElementById('stop-select');
    var lat = document.getElementById('lat').value;
    var lng = document.getElementById('lng').value;
    var stop = document.getElementById('stop').checked;
    var name = document.getElementById('name').value;
    var num = document.getElementById('num').value;
    var ind = document.getElementById('index').value

    if (ind == stop_sel.length) {
	// Add a new stop
	var arr = []
	arr.push(lat, lng, stop.toString(), name, num)
	window.routes[route_sel.value].push(arr)
	updateMap([lng,lat], window.map.getView().getZoom())
	updateRoutes(route_sel.value)
    } else {
	// Find and update selected stop
	for (var i = 0, l = Object.keys(window.routes[route_sel.value]).length; i < l; i++)  {
	    if (i == stop_sel.value) {
		window.routes[route_sel.value][i][0] = lat
		window.routes[route_sel.value][i][1] = lng
		if (stop) {
		    window.routes[route_sel.value][i][2] = "true"
		    window.routes[route_sel.value][i][3] = name
		    window.routes[route_sel.value][i][4] = num
		} else {
		    window.routes[route_sel.value][i][2] = "false"
		}
	    }
	}
    }
    selectRoute(route);  // refresh the stop list
}

function saveRoutes() {
    var routes = window.routes
    var tab = window.open('about:blank', '_blank');
    tab.document.write(JSON.stringify(routes))
    tab.document.close(); // to finish loading the page
}

function addRoute() {
    var arr = []
    var route = prompt("Enter route name", "");
    if (route != null) {
	window.routes[route] = arr
	updateRoutes(route)
	document.getElementById("route-select").value = route
    }
}
