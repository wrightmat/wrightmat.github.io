function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function rollDice(dice, sum=true) {
  var arr = [];
  var d = dice.indexOf("d");
  var die = dice.substring(d+1, dice.length);
  var num = dice.substring(0, d) || 1;
  for (let i = 0; i < num; i++) {
    arr.push(getRandomInt(d+1, die));
  }
  if (sum) {
    return arr.reduce((a, b) => a + b);
  } else {
    return arr;
  }
}

function navbar() {
  var navbar = '<nav><ul> <li><a href="#"> Travel </a></li> <li><a href="#"> ??? </a></li> <li><a href="#"> ??? </a></li> </ul></nav><br /><br />';
  $('#header').html(navbar);
}
