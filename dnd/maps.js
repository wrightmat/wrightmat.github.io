var map, locations;
var players, villages, towns, cities, capitals, forts, ruins, sites, areas, hexes;
var markerIcon0 = L.divIcon({ className: 'leaflet-icon0' })
var markerIcon1 = L.divIcon({ className: 'leaflet-icon1' })
var markerIcon2 = L.divIcon({ className: 'leaflet-icon2' })
var markerIcon3 = L.divIcon({ className: 'leaflet-icon3' })
var markerIcon4 = L.divIcon({ className: 'leaflet-icon4' })
var markerIcon5 = L.divIcon({ className: 'leaflet-icon5' })
var markerIconM1 = L.divIcon({ className: 'leaflet-icon-1' })
var markerIconM2 = L.divIcon({ className: 'leaflet-icon-2' })
var markerIconM3 = L.divIcon({ className: 'leaflet-icon-3' })
var markerIconM4 = L.divIcon({ className: 'leaflet-icon-4' })
var markerIconM5 = L.divIcon({ className: 'leaflet-icon-5' })
var markerIconNull = L.divIcon({ className: 'leaflet-icon-null' })

window.addEventListener("load", init, false);
function init() {
  //navbar();
  map = createMap();
  //locations = getNotionLocations();
  //markLocations();
  //drawGrid(50, 50);
}

function findCenter(arr) {
  var minX, maxX, minY, maxY;
  for (var i = 0; i < arr.length; i++) {
    minX = (arr[i][0] < minX || minX == null) ? arr[i][0] : minX;
    maxX = (arr[i][0] > maxX || maxX == null) ? arr[i][0] : maxX;
    minY = (arr[i][1] < minY || minY == null) ? arr[i][1] : minY;
    maxY = (arr[i][1] > maxY || maxY == null) ? arr[i][1] : maxY;
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

function changeMap(el) {
  var sel = el.value;
  $('#map').html('');
  map.remove();
  map = createMap(sel);
  //markLocations();
}

function getNotionLocations(r_async) {
  var r_text;
  $.get({
    url: 'https://eo9gyc65odntxm6.m.pipedream.net',
    success: function(result) { r_text = result },
    error: function(xhr, error) { console.log(xhr) },
    async: r_async || false
  });
  return r_text;
}

function getPropertyById(id, prop) {
  var result;
  locations.forEach(function (item, index) {
    if ( item.id == id ) {
      if ( prop == "LatLng" ) { result = item.properties.LatLng.rich_text[0].plain_text; }
    }
  });
  return result;
}

function markLocations() {
  var sharnId = 'a163218b-68f5-4114-a5b7-2a5274ac53f7';
  //console.log(locations);
  locations.forEach(function (item, index) {
    var latlng = JSON.parse(item.properties.LatLng.rich_text[0].plain_text);
    if ( item.properties.Current.checkbox && latlng ) {  // Mark the players' location on the map
	if ( ( $('#map-type').val() == 'eberron' ) || ( $('#map-type').val() == 'sharn' && item.properties.Location.relation[0].id == sharnId ) ) {
	  if ( $('#map-type').val() == 'eberron' && item.properties.Location.relation[0].id == sharnId ) {
	    var platlng = JSON.parse(getPropertyById(sharnId, "LatLng"));
	  } else if ( latlng.length > 2 ) { platlng = findCenter(latlng);
	  } else { var platlng = latlng; }
	  var playersMarker = L.marker(platlng).addTo(players);
	}
    }
    if ( latlng.length > 2 ) {	// for areas or districts - use a polygon
      if ( ( $('#map-type').val() == 'eberron' && item.properties.Location.relation[0].id != "a163218b-68f5-4114-a5b7-2a5274ac53f7" ) || ( $('#map-type').val() == 'sharn' && item.properties.Location.relation[0].id == "a163218b-68f5-4114-a5b7-2a5274ac53f7" ) ) {
        var content = '<b>' + item.properties.Name.title[0].plain_text + '</b> (' + item.properties.Type.select.name + ')<br/><br />';
        content += '<a href="' + item.url + '" target="_blank">Link to Notion</a>';
        var polygon = L.polygon(latlng);
        polygon.bindPopup(content);
        polygon.addTo(areas);
      }
    } else {	// for sites - use a marker
      var content = '<b>' + item.properties.Name.title[0].plain_text + '</b> (' + item.properties.Type.select.name + ')<br/>';
      if ( item.properties.Renown.number == null ) { content += 'Unvisited<br /><br />'; } else { content += 'Renown: ' + item.properties.Renown.number + '<br /><br />'; }
      content += '<a href="' + item.url + '" target="_blank">Link to Notion</a>';
      var marker = L.marker(latlng);
      marker.bindPopup(content);
      if ( item.properties.Type.select.name == "City" ) { marker.addTo(cities); }
      else if ( item.properties.Type.select.name == "Village" ) { marker.addTo(villages); }
      else if ( item.properties.Type.select.name == "Town" ) { marker.addTo(towns); }
      else if ( item.properties.Type.select.name == "Capital" ) { marker.addTo(capitals); }
      else if ( item.properties.Type.select.name == "Castle/Fort" ) { marker.addTo(forts); }
      else if ( item.properties.Type.select.name == "Ruin" ) { marker.addTo(ruins); }
      else if ( item.properties.Type.select.name == "Site" ) { marker.addTo(sites); }
      if ( item.properties.Renown.number == null ) { marker.setIcon(markerIconNull); }
      else if ( item.properties.Renown.number == 0 ) { marker.setIcon(markerIcon0); }
      else if ( item.properties.Renown.number == 1 ) { marker.setIcon(markerIcon1); }
      else if ( item.properties.Renown.number == -1 ) { marker.setIcon(markerIconM1); }
      else if ( item.properties.Renown.number == 2 ) { marker.setIcon(markerIcon2); }
      else if ( item.properties.Renown.number == -2 ) { marker.setIcon(markerIconM2); }
      else if ( item.properties.Renown.number == 3 ) { marker.setIcon(markerIcon3); }
      else if ( item.properties.Renown.number == -3 ) { marker.setIcon(markerIconM3); }
      else if ( item.properties.Renown.number == 4 ) { marker.setIcon(markerIcon4); }
      else if ( item.properties.Renown.number == -4 ) { marker.setIcon(markerIconM4); }
      else if ( item.properties.Renown.number == 5 ) { marker.setIcon(markerIcon5); }
      else if ( item.properties.Renown.number == -5 ) { marker.setIcon(markerIconM5); }
    }
  });
}

const r = 0.6;
const a = 2 * Math.PI / 6;
function drawGrid(width, height) {
  for (let y = r, j = 0; y + r * Math.sin(a) < height; y += 2 ** ((j + 1) % 2) * r * Math.sin(a), j = 0) {
    for (let x = r; x + r * (1 + Math.cos(a)) < width; x += r * (1 + Math.cos(a)), y += (-1) ** j++ * r * Math.sin(a)) {
      drawHexagon(x, y);
    }
  }
}

function drawHexagon(lat, lng) {
  var latlngs = [];
  for (var i = 0; i < 6; i++) {
    latlngs.push([lat + r * Math.cos(a * i), lng + r * Math.sin(a * i)]);
  }
  var polygon = L.polygon(latlngs, { color: '#ccc', opacity: 0.2 }).addTo(hexes);
  polygon.on('click', function(e) {
    //console.log([e.latlng.lat, e.latlng.lng]);  // actual click location
    console.log([e.target.getCenter().lat, e.target.getCenter().lng]);  // center of polygon clicked in
  });
}

function createMap(type = 'eberron') {
  if ( type == "mournland" ) {

  } else if (type == "hyrule") {
    var fullmap = L.tileLayer("\map/{z}-{x}-{y}.png", {
      maxZoom: 5, continuousWorld: !1, noWrap: !0
    }),
    map = L.map("map", { layers: [fullmap], zoomControl: !1, attributionControl: !1 }).setView([9.44906182688142, -18.105468750000004], 3);
    var zoomControl = L.control.zoom({ position: "topright" }).addTo(map);
    var rulerControl = L.control.ruler({
      position: "topright",
      lengthUnit: { factor: 92.6574, display: "feet", decimal: 0 }
    }).addTo(map);
    var arr_latlng = [];
    map.on('click', function(e) {
      arr_latlng.push([e.latlng.lat, e.latlng.lng]);
      console.log(JSON.stringify(arr_latlng));
    });
    map.on('contextmenu', function(e) { arr_latlng = []; console.log("cleared"); });
    players = L.layerGroup();
    map.addLayer(players);
    areas = L.layerGroup();
    baseMaps = {
        "Hyrule": fullmap
    };
    var overlayMaps = {
      "Players Location": players,
      "Areas": areas
    }
    var layerControl = L.control.layers(baseMaps, overlayMaps).addTo(map);
    return map;
  } else if ( type == "sharn" ) {
    var fullmap = L.tileLayer("https://eberronmap.johnarcadian.com/worldbin/sharncityoftowers/{z}/{x}/{y}.jpg", {
      maxZoom: 6, continuousWorld: !1, noWrap: !0
    }),
    sharnmap = L.map("map", { layers: [fullmap], zoomControl: !1, attributionControl: !1 }).setView([9.44906182688142, -18.105468750000004], 3);
    var zoomControl = L.control.zoom({ position: "topright" }).addTo(sharnmap);
    var rulerControl = L.control.ruler({
      position: "topright",
      lengthUnit: { factor: 92.6574, display: "feet", decimal: 0 }
    }).addTo(sharnmap);
    var arr_latlng = [];
    sharnmap.on('click', function(e) {
      arr_latlng.push([e.latlng.lat, e.latlng.lng]);
      console.log(JSON.stringify(arr_latlng));
    });
    sharnmap.on('contextmenu', function(e) { arr_latlng = []; console.log("cleared"); });
    players = L.layerGroup();
    sharnmap.addLayer(players);
    areas = L.layerGroup();
    baseMaps = {
        "Sharn": fullmap
    };
    var overlayMaps = {
      "Players Location": players,
      "Districts": areas
    }
    var layerControl = L.control.layers(baseMaps, overlayMaps).addTo(sharnmap);
    return sharnmap;
  } else {
    var fullmap = L.tileLayer("https://eberronmap.johnarcadian.com/worldbin/eberron/{z}/{x}/{y}.jpg", {
      //maxZoom: 7, continuousWorld: !1, noWrap: !0
      minZoom: 3, maxZoom: 4, continuousWorld: !1, noWrap: !0
    }),
    eberronmap = L.map("map", { layers: [fullmap], zoomControl: !1, attributionControl: !1 }).setView([20.009428770699756, .07578125], 3.5);
    //var zoomControl = L.control.zoom({ position: "topright" }).addTo(eberronmap);
    //var rulerControl = L.control.ruler({ position: "topright", lengthUnit: { factor: 3.233, display: "miles", decimal: 0 } }).addTo(eberronmap);
    var arr_latlng = [];
    eberronmap.on('click', function(e) {
      arr_latlng.push([e.latlng.lat, e.latlng.lng]);
      console.log(JSON.stringify(arr_latlng));
    });
    eberronmap.on('contextmenu', function(e) { arr_latlng = []; console.log("cleared"); });

    players = L.layerGroup();
    eberronmap.addLayer(players);
    villages = L.layerGroup();
    eberronmap.addLayer(villages);
    towns = L.layerGroup();
    eberronmap.addLayer(towns);
    cities = L.layerGroup();
    eberronmap.addLayer(cities);
    capitals = L.layerGroup();
    eberronmap.addLayer(capitals);
    forts = L.layerGroup();
    eberronmap.addLayer(forts);
    ruins = L.layerGroup();
    eberronmap.addLayer(ruins);
    sites = L.layerGroup();
    eberronmap.addLayer(sites);
    areas = L.layerGroup();
    hexes = L.layerGroup();

    var baseMaps = {
      "Full Map": fullmap
    };
    var overlayMaps = {
      "Players Location": players,
      "Villages": villages,
      "Towns": towns,
      "Cities": cities,
      "Capitals": capitals,
      "Castles/Forts": forts,
      "Ruins": ruins,
      "Sites": sites,
      "Areas": areas,
      "Hexes": hexes
    };
    //var layerControl = L.control.layers(baseMaps, overlayMaps).addTo(eberronmap);
    for (var m = 0; m < map_markers.length; m++) {
      if ( map_markers[m].type == "circle" ) {
        var circle = L.circle(map_markers[m].latlng, parseInt(map_markers[m].radius)).addTo(eberronmap);
	if ( map_markers[m].color ) { circle.setStyle({color: map_markers[m].color}); }
      }
    }
    return eberronmap;
  }
}