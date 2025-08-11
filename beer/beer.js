const urlParams = new URLSearchParams(window.location.search);
const loc = urlParams.get('location');
var beers = []; var venues = [];
var venue_ids = []; var locations = [];
var venue_beers_loaded = false;
var last_accordion;

function getUntappd(r_type, r_id, r_async) {
  var r_text, r_url;
  r_url = "http://wizzle.tplinkdns.com/cgi-bin/untappd.py?" + r_type + "=" + r_id;
  $.get({
    url: r_url,
    success: function(result) { r_text = result },
    error: function(xhr, error) { console.log(xhr) },
    async: r_async || false
  });
  return r_text;
}

function mergeIds(list) {
  const out = [];
  for ( entry of list ) {
    const existingEntry = out.find( o => o.id === entry.id );
    if ( existingEntry ) {
      existingEntry.venue = existingEntry.venue.concat(',' + entry.venue);
    } else { out.push(entry); }
  }
  return out;
}

function filterBy(el, by) {
  var c = $('#collapse' + last_accordion + '-links');
  var sel = el.options[el.selectedIndex].value.replace("'","");
  c.find('a').hide();
  if ( sel == "" ) { c.find('a').show(); }
  if ( by == "area" ) {
    var beer_buttons = c.find("a[data-venue-areas*='" + sel +"']").show();
    $('#sel_venues').val(' ').prop('selected', true);
    $('#sel_brewery').val(' ').prop('selected', true);
  } else if ( by == "venue" ) {
    var beer_buttons = c.find("a[data-venues*='" + sel +"']").show();
    $('#sel_areas').val(' ').prop('selected', true);
    $('#sel_brewery').val(' ').prop('selected', true);
  } else if ( by == "brewery" ) {
    var beer_buttons = c.find("a[data-brewery*='" + sel +"']").show();
    $('#sel_areas').val(' ').prop('selected', true);
    $('#sel_venues').val(' ').prop('selected', true);
  }
}

function sortBy(el) {
  var c = $('#collapse' + last_accordion + '-links');
  var sorted = c.find('a')
  var sel = el.options[el.selectedIndex].value;
  if ( sel == "Date" ) {
    sorted = $('#collapse' + last_accordion + '-links > a').sort( function (a, b) {
      var compA = $(a).attr("data-datetime");
      var compB = $(b).attr("data-datetime");
      return (compA > compB) ? -1 : 1;
    })
  } else if ( sel == "Name" ) {
    sorted = $('#collapse' + last_accordion + '-links > a').sort( function (a, b) {
      var compA = $(a).text().toUpperCase();
      var compB = $(b).text().toUpperCase();
      return (compA < compB) ? -1 : 1;
    })
  } else if ( sel == "Brewery" ) {
    sorted = $('#collapse' + last_accordion + '-links > a').sort( function (a, b) {
      var compA = $(a).attr("data-brewery").toUpperCase();
      var compB = $(b).attr("data-brewery").toUpperCase();
      return (compA < compB) ? -1 : 1;
    })
  }
  c.append(sorted);
}

function getVenueBeers(el) {
  beers = [];
  // get all beers from selected venues
  for ( var v = 0; v < venue_ids.length; v++ ) {
    var result = getUntappd('venue', venue_ids[v]);
    result = JSON.parse(result);
    beers = beers.concat(result.beers);
    beers = beers.concat(result.activity);
    venues = venues.concat(result);
  }
  // loop back through the venues to find what area each is in
  for ( var v = 0; v < venues.length; v++ ) {
    for ( var a = 0; a < areas.length; a++ ) {
      if ( areas[a].venue_ids.includes(parseInt(venues[v].id)) ) { venues[v].area_name = areas[a].name; venues[v].location_name = areas[a].location; }
    }
  }

  // filter to only unique beers within each venue (needed because we added the activity beers, which likely has duplicates)
  var beers = beers.filter(function({id, datetime, name, brewery, venue}) {
    var key = `${id}${venue}`;
    return !this.has(key) && this.add(key);
  }, new Set);
  // then loop through again to combine beers that are at more than one venue, arriving at a list of unique beers
  beers = mergeIds(beers);

  // loop through all the beers and list them out
  const date = new Date();
  var sixMonthBeforeNow = new Date(date.setMonth(date.getMonth() - 6)).toISOString();
  for ( var b = 0; b < beers.length; b++ ) {
    beers[b].datetime = new Date(beers[b].datetime).toISOString();
    if ( beers[b].datetime >= sixMonthBeforeNow ) {	// only include beers checked in over the last 6 months
      var li_a_img = "";
      var beer_venue_areas = "";
      var beer_venue_names = "";
      // check and see if it's present at more than one venue, listing all of them out if so (or showing the single image if not)
      if ( beers[b].venue.includes(',') ) {
	var venue_list = beers[b].venue.split(',');
	for ( var v = 0; v < venue_list.length; v++ ) {
	  var venue = venues.find(x => x.id === venue_list[v]);
	  li_a_img += ' <img src="' + venue.image + '" style="height:24px;width:24px;" title="' + venue.name + '" />'
	  if ( !beer_venue_names.includes(venue.name) ) {
	    if ( beer_venue_names !== "" ) { beer_venue_names += ", " }
	    beer_venue_names += venue.name;
	  }
	  if ( !beer_venue_areas.includes(venue.area_name) ) {
	    if ( beer_venue_areas !== "" ) { beer_venue_areas += ", " }
	    beer_venue_areas += venue.area_name;
	  }
	}
      } else {
	var venue = venues.find(x => x.id === beers[b].venue);
	li_a_img += ' <img src="' + venue.image + '" style="height:24px;width:24px;" title="' + venue.name + '" />'
	if ( !beer_venue_names.includes(venue.name) ) {
	  beer_venue_names += venue.name.replace("'","");
	}
	if ( !beer_venue_areas.includes(venue.area_name) ) {
	  beer_venue_areas += venue.area_name;
	}
      }
      // build the button and append it
      $(el.replace('body','links')).append(
        $('<a>').attr('class','btn btn-outline-primary me-2 icon-link').attr('href','https://untappd.com/beer/' + beers[b].id).attr('target','_blank')
		.attr('data-venue-areas',beer_venue_areas).attr('data-venues',beer_venue_names).attr('data-beer-name',beers[b].name).attr('data-brewery',beers[b].brewery).attr('data-datetime',beers[b].datetime)
		.text(beers[b].name + ' - ' + beers[b].brewery).attr('title','Added ' + beers[b].datetime)
		.append( $('<span>')
		.append(li_a_img)
      ));
    }
  }
  venue_beers_loaded = true;
  $('#beers-untappd').html('<strong>All Beers from Untappd</strong>');

  // add dropdowns as user filter controls
  $(el.replace('body','list')).html('');
  var controls = '<div class="row"><div class="col-md-1 align-bottom"><strong> Filter: </strong></div>';
  controls += '<div class="col-md-2"><select class="form-control" id="sel_areas" title="Filter by Area" onChange="filterBy(this, &quot;area&quot;);"><option value=" ">- Areas -</option>';
  for (var a = 0; a < areas.length; a++) {
    if ( areas[a].location == loc ) {
      controls += '<option value="' + areas[a].name + '">' + areas[a].name + '</option>';
    }
  }; controls += '</select></div>';
  controls += '<div class="col-md-2"><select class="form-control" id="sel_venues" title="Filter by Venue" onChange="filterBy(this, &quot;venue&quot;);"><option value=" ">- Venues -</option>';
  for (var v = 0; v < venues.length; v++) {
    var ven = venues[v]['name'].replace("'","");
    controls += '<option value="' + ven + '">' + venues[v].name + '</option>';
  }; controls += '</select></div>';
  controls += '<div class="col-md-2"><select class="form-control" id="sel_brewery" title="Filter by Brewery" onChange="filterBy(this, &quot;brewery&quot;);"><option value=" ">- Breweries -</option>';
  const unique = [...new Set(beers.map(item => item.brewery.replace("'","")))].sort();
  for ( var b = 0; b < unique.length; b++ ) {
    controls += '<option value="' + unique[b] + '">' + unique[b] + '</option>';
  }; controls += '</select></div>';
  // and user sort controls
  controls += '<div class="col-md-1"></div><div class="col-md-1 align-bottom"><strong> Sort: </strong></div><div class="col-md-2"><select class="form-control" id="sel_sort" title="Sort" onChange="sortBy(this)"><option value=" "></option><option value="Date">Date</option><option value="Name">Name</option><option value="Brewery">Brewery</option></select></div></div>';
  $(el.replace('body','list')).append(controls);
}


// Build areas in accordions, with venues underneath
for ( var a = 0; a < areas.length; a++ ) {
  locations.push(areas[a].location);
  if ( ( loc && areas[a].location == loc ) || ( loc == undefined ) ) {
    if ( loc == undefined ) { var na = areas[a].location + ': ' + areas[a].name } else { var na = areas[a].name }
    var div_accordion = "<div class='accordion-item'><h2 class='accordion-header'><button class='accordion-button collapsed' type='button' data-bs-toggle='collapse' data-bs-target='#collapse" + a + "' aria-expanded='false' aria-controls='collapse" + a + "'><strong>" + na + "</strong></button></h2><div id='collapse" + a + "' class='accordion-collapse collapse' data-bs-parent='#beerList'><div class='accordion-body' id='collapse" + a + "-body'><nav class='navbar bg-body-tertiary'><div class='container-fluid justify-content-start' id='collapse" + a + "-list'></div></nav><br /></div></div></div>";
    $('#beerList').append(div_accordion);
    var venue_ids = venue_ids.concat(areas[a].venue_ids);
    for ( var i in areas[a].venue_ids ) {
      // button for each venue
      if ( areas[a].venue_details[i] == "" ) {
	$('#collapse' + a + '-list').append(
          $('<a>').attr('class','btn btn-outline-primary me-2 icon-link').attr('href','https://untappd.com/venue/' + areas[a].venue_ids[i]).attr('target','_blank')
	          .append('<img src="https://untappd.com/assets/favicon-16x16-v2.png" /> ' + areas[a].venue_names[i]
        ));
      } else {
	$('#collapse' + a + '-list').append(
          $('<a>').attr('class','btn btn-outline-primary me-2').attr('href','#detail-container-' + areas[a].venue_ids[i])
		  .append(areas[a].venue_names[i]
        ));
      }
      // div for each venue that has a detail indicated (image, frame, or embed)
      var div_detail = "";
      var detail = areas[a].venue_details[i].substring(0, areas[a].venue_details[i].indexOf("|"));
      if ( detail == "image" ) {
	var div_detail = '<div id="detail-container-' + areas[a].venue_ids[i] + '"><img style="width:100%;height:1080px;" src="' + areas[a]['venue_details'][i].replace('image|','') + '" /></div>';
      } else if ( detail == "images" ) {
	var images = areas[a].venue_details[i].replace('images|','').split('|');
	var div_detail = '<div id="detail-container-' + areas[a].venue_ids[i] + '"><img style="width:45%;padding:5px;" src="' + images[0] + '" /><img style="width:45%;padding:5px;" src="' + images[1] + '" /></div>';
      } else if ( detail == "frame" ) {
	var div_detail = '<div id="detail-container-' + areas[a].venue_ids[i] + '"><iframe src="' + areas[a].venue_details[i].replace('frame|','') + '" width="100%" height="1080"></iframe></div>';
      } else if ( detail == "embed" ) {
	var div_id = areas[a].venue_ids[i];
	var div_embed = areas[a].venue_details[i].replace('embed|','');
	var div_detail = '<div id="detail-container-' + div_id + '"><script type="text/javascript">!function getScript(e,t){var a=document.createElement("script"),n=document.getElementsByTagName("script")[0];a.async=1,n.parentNode.insertBefore(a,n),a.onload=a.onreadystatechange=function(e,n){(n||!a.readyState||/loaded|complete/.test(a.readyState))&&(a.onload=a.onreadystatechange=null,a=undefined,n||t&&t())},a.src=e}("https://embed-menu-preloader.untappdapi.com/embed-menu-preloader.min.js",function(){PreloadEmbedMenu("detail-container-' + div_id + '",' + div_embed + ')})';
      }
      if ( div_detail !== "" ) { $('#beerList').find('#collapse' + a + '-body').append(div_detail); }
    }
  }
}

// Add final accordion for special case of "All Beers from Untappd" (as long as we're looking at a single location, so we don't overwhelm the scraper)
if ( loc ) {
  var div_accordion = "<div class='accordion-item'><h2 class='accordion-header'><button class='accordion-button collapsed' id='beers-untappd' type='button' data-bs-toggle='collapse' data-bs-target='#collapse" + a + "' aria-expanded='false' aria-controls='collapse" + a + "'><strong>All Beers from Untappd (several minutes to load!)</strong></button></h2><div id='collapse" + a + "' class='accordion-collapse collapse' data-bs-parent='#beerList'><div class='accordion-body' id='collapse" + a + "-body'><nav class='navbar bg-body-tertiary'><div class='container-fluid justify-content-start' id='collapse" + a + "-list'>Loading, please wait... This can take several minutes...</div></nav><br /><div id='collapse" + a + "-links'></div></div></div></div>";
  $('#beerList').append(div_accordion);
  last_accordion = a;
  // Get and display a list of Untappd beers (if not already loaded) when that accordion is expanded.
  $('#beerList').find('#collapse' + a).on('shown.bs.collapse', function () {
    if ( !venue_beers_loaded ) { getVenueBeers('#collapse' + a + '-body'); }
  })
}

// Generate and display a random quote.
var obj_keys = Object.keys(beer_quotes);
var rand_key = obj_keys[Math.floor(Math.random() * obj_keys.length)];
$('#beer_quote').html(beer_quotes[rand_key].replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;'));

// Update heading and add navigation
var h = 'Beer List'; var li = '';
if ( loc ) { h += ' (' + loc + ')'; }
$('#heading').html(h);
locations = locations.filter((value, index, array) => array.indexOf(value) === index);
for ( var l = 0; l < locations.length; l++ ) {
  var cl = 'nav-item';
  if ( locations[l] == loc ) { cl += ' active"'; }
  li += '<li class=' + cl + '>'
  if ( locations[l] !== loc ) { li += '<a class="nav-link" href="?location=' + locations[l] + '">' + locations[l] + '</a></li>'; } else { li += '</li>'; }
}
$('#navbar-nav').append('<ul class="navbar-nav">' + li + '</ul>')
