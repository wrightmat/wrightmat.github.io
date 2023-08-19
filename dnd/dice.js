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

    var rolls_val = 0;
    var rolls_str = "";
    arr.forEach(function (item, index) {
console.log(item);
      rolls_val += item;
      if ( rolls_str != "" ) { rolls_str += " + " }
      rolls_str += item;
    });
    displayDiceResults([ notation, rolls_str, rolls_val ]);

  } else {

    diceBox.init().then(() => {
      diceBox.roll(notation);
    });
    diceBox.onRollComplete = function(rollResult) {
      var arr = parseDice(rollResult);
      displayDiceResults(arr);
    }
  }

}

function parseDice(rollResult) {
  var rolls_val = 0;
  var rolls_str = "";

  rollResult[0].rolls.forEach(function (item, index) {
    rolls_val += item.value;
    if ( rolls_str != "" ) { rolls_str += " + " }
    rolls_str += item.value;
  });
  rolls_str += ' = ';

  var rolled = rollResult[0].qty + rollResult[0].sides;
  if ( rollResult[0].modifier > 0 ) { rolled += " + " + rollResult[0].modifier; }

  return [ rolled, rolls_str, rolls_val ]
}

function displayDiceResults(resultsArr) {
console.log(resultsArr);
  var li = $('<li>', { class: 'list-group-item d-flex justify-content-between align-items-center', style: 'margin-left:-4px;padding-left:-4px;' }).appendTo('#results-list');
  $('<span>', { style: 'font-size: 10px;', html: resultsArr[0] + ': ' + resultsArr[1]}).appendTo(li);
  $('<span>', { class: 'badge badge-primary badge-pill', html: resultsArr[2] }).appendTo(li);
}