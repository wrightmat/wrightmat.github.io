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

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function jsonConcat(o1, o2) {
  for (var key in o2) {
    o1[key] = o2[key];
  }
  return o1;
}

function rollDice(dice, sum=true) {
  var arr = [];
  var d = dice.indexOf("d");
  var die = dice.substring(d+1, dice.length);
  var num = dice.substring(0, d) || 1;
  if (parseInt(d) == 0) { d = 1; }
  for (let i = 0; i < num; i++) {
    arr.push(getRandomInt(d, die));
  }
  if (sum) {
    return arr.reduce((a, b) => a + b);
  } else {
    return arr;
  }
}

function navbar() {
  var navbar = '<nav><ul> <li><a href="https://5e.tools/dmscreen.html" target="_blank"> DM Screen </a></li> <li><a href="https://crobi.github.io/dnd5e-quickref/preview/quickref.html" target="_blank"> Quick Reference </a></li> <li> - </li> <li><a href="travel.htm"> Travel Calculator </a></li> <li><a href="locations.htm"> Location Builder </a></li> <li><a href="hex.htm?view=DM"> Hex Mapper </a></li> </ul></nav><br /><br />';
  $('#header').html(navbar);
}
