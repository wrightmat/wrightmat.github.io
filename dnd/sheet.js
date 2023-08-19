require(dice.js);

if ( window.diceBox == undefined ) {

  console.log("no dice box");

} else {

  window.diceBox.init().then(() => {
    window.diceBox.roll('2d20')
  });

  window.diceBox.onRollComplete = function(rollResult) {
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
