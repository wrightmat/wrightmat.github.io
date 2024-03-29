function alphabetizeSelectList(el) {
  var selected = el.val();
  var opts_list = el.find('option');
  opts_list.sort(function (a, b) {
    return $(a).text() > $(b).text() ? 1 : -1;
  });
  el.html('').append(opts_list);
  el.val(selected);

  var opts = [];
  opts_list.each(function() {
    if($.inArray(this.value, opts) > -1) {
      $(this).remove()
    } else {
      opts.push(this.value);
    }
  });
}

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

function numberWithCommas(x) {
    var parts = x.toString().split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function jsonConcat(o1, o2) {
  for (var key in o2) {
    o1[key] = o2[key];
  }
  return o1;
}

function rollRandom(dice, sum=true) {
  var arr = [];
  var d = dice.indexOf("d");
  var x = dice.indexOf("x");
  var num = dice.substring(0, d) || 1;
  if ( x >= 0 ) { var die = dice.substring(d+1, x); } else { var die = dice.substring(d+1, dice.length); }
  if ( x >= 0 ) { var mult = dice.substring(x+1, dice.length) } else { var mult = 1 };
  if (parseInt(d) == 0) { d = 1; }
  for (let i = 0; i < num; i++) {
    arr.push(getRandomInt(d, die) * mult);
  }
  if (sum) {
    return arr.reduce((a, b) => a + b);
  } else {
    return arr;
  }
}

function setCookie(name, value) {
  var cookie = [name, '=', JSON.stringify(value), '; domain=.', window.location.host.toString(), '; path=/;'].join('');
  document.cookie = cookie;
}

function getCookie(name) {
  var result = document.cookie.match(new RegExp(name + '=([^;]+)'));
  result && (result = JSON.parse(result[1]));
  return result;
}

function deleteCookie(name) {
  document.cookie = [name, '=; expires=Thu, 01-Jan-1970 00:00:01 GMT; path=/; domain=.', window.location.host.toString()].join('');
}

function getTableResult(table) {
    // returns a table result based on random roll as denoted in the table
    // either a string or array depending on the table
    if (typeof table[0] == "string") {
	// simple table, without ranges
	return table[rollRandom(table[0])];
    } else if (typeof table[0] == "object") {
	// complex table, with ranges
	var ind;
	var roll = rollRandom(table[0][0]);
	table[0].forEach(function (item, index) {
	    if (typeof item == "object") {
		if (item.length == 2 && roll >= item[0] && roll <= item[1]) {
		    ind = index;
		} else if (item.length == 1 && roll == item[0]) {
		    ind = index;
		}
	    }
	});
	return table[ind];
    }
}

const markdownParser = (text) => {
	const toHTML = text
		.replace(/^### (.*$)/gim, '<h3>$1</h3>') // h3 tag
		.replace(/^## (.*$)/gim, '<h2>$1</h2>') // h2 tag
		.replace(/^# (.*$)/gim, '<h1>$1</h1>') // h1 tag
		.replace(/\*\*(.*)\*\*/gim, '<b>$1</b>') // bold text
		.replace(/\*(.*)\*/gim, '<i>$1</i>'); // italic text
	return toHTML.trim(); // using trim method to remove whitespace
}

function navbar() {
  var navbar = '<nav><ul>'
  navbar += ' <li><a href="settings.htm"> <i class="bi-gear-fill" style="font-size: 1.2rem;" title="Settings"></i> </a></li> ';
  navbar += ' <li><a href="https://5e.tools/dmscreen.html" target="_blank"> DM Screen </a></li> ';
  navbar += ' <li><a href="quickref.htm" target="_blank"> Quick Reference </a></li> ';
  navbar += ' <li><a href="quickref_sj.htm" target="_blank"> Quick Reference (Spelljammer) </a></li> ';
  navbar += ' <li> &#9679; </li> ';
  navbar += ' <li><a href="maps.htm"> Maps </a></li> ';
  navbar += ' <li><a href="travel.htm"> Travel Calculator </a></li> ';
  navbar += ' <li><a href="npcs.htm"> NPC Generator </a></li> ';
  navbar += ' <li><a href="initiative.htm?view=DM"> Initiative Tracker </a></li> ';
  navbar += ' <li><a href="locations.htm"> Location Builder </a></li> ';
  navbar += '</ul></nav><br /><br />';
  if( window.location.pathname.includes("settings.htm") ) {
    navbar += ' <div style="position:absolute;left:10px;top:-4px;"><a href="#" onclick="history.back()"> <i class="bi-caret-left-fill" style="font-size: 1.5rem;color:black;" title="Back"></i> </a></div> ';
  }
  $('#header').html(navbar);
  $('body').css('padding-top','50px');
}
