function rollDice(notation) {
  var diceBox = window.diceBox;

  if ( diceBox == undefined ) {
    var arr = [];
    var d = notation.indexOf("d");
    var x = notation.indexOf("x");
    var num = notation.substring(0, d) || 1;
    if ( x >= 0 ) { var die = notation.substring(d+1, x); } else { var die = notation.substring(d+1, notation.length); }
    if ( x >= 0 ) { var mult = notation.substring(x+1, notation.length) } else { var mult = 1 };
    if (parseInt(d) == 0 ) { d = 1; }
    for ( let i = 0; i < num; i++ ) {
      arr.push(getRandomInt(d, die) * mult);
    }
console.log(arr);
  } else {
    diceBox.init().then(() => {
      diceBox.roll(notation);
    });

    diceBox.onRollComplete = function(rollResult) {
      var rolls_val = 0;
      var rolls_str = "";
      console.log(rollResult);
      rollResult[0].rolls.forEach(function (item, index) {
        rolls_val += item.value;
        if ( rolls_str != "" ) { rolls_str += " + " }
        rolls_str += item.value;
      });
      rolls_str += ' = ';
      var rolled = rollResult[0].qty + rollResult[0].sides;
      if ( rollResult[0].modifier > 0 ) { rolled += " + " + rollResult[0].modifier; }
      var li = $('<li>', { class: 'list-group-item d-flex justify-content-between align-items-center', style: 'margin-left:-4px;padding-left:-4px;' }).appendTo('#results-list');
      $('<span>', { style: 'font-size: 10px;', html: rolled + ': ' + rolls_str}).appendTo(li);
      $('<span>', { class: 'badge badge-primary badge-pill', html: rolls_val }).appendTo(li);
    };
  }
}
