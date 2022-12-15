function jsonConcat(o1, o2) {
  for (var key in o2) {
    o1[key] = o2[key];
  }
  return o1;
}

function right(str, chr) {
  return newstr = str.substr(str.length - chr, str.length);
}

function arrayContains(arr, val, ret = 'value') {
  var val = val.toLowerCase();
  for (i = 0; i < arr.length; ++i) {
    var arri = arr[i].toLowerCase();
    if (arri.indexOf(val) >= 0) {
      if (ret == 'index') { return i; break; } else { return arr[i]; break; }
    }
  }
}

Array.prototype.pull = function(val) {
  var index = this.indexOf(val);
  if (index !== -1) {
    this.splice(index, 1);
  }
}

function setCookie(cname, cvalue, exdays) {
  const d = new Date();
  d.setTime(d.getTime() + (exdays*24*60*60*1000));
  let expires = "expires="+ d.toUTCString();
  document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
}

function getCookie(cname) {
  let name = cname + "=";
  let decodedCookie = decodeURIComponent(document.cookie);
  let ca = decodedCookie.split(';');
  for(let i = 0; i <ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) == ' ') {
      c = c.substring(1);
    }
    if (c.indexOf(name) == 0) {
      return c.substring(name.length, c.length);
    }
  }
  return "";
}


function stardate() {
    var StardateOrigin = new Date("July 15, 1987 00:00:00");
    var StardateToday = new Date();
    var stardate = StardateToday.getTime() - StardateOrigin.getTime();
    stardate = stardate / (1000 * 60 * 60 * 24 * 0.036525);
    stardate = Math.floor(stardate + 410000);
    stardate = stardate / 10;
    return stardate;
}