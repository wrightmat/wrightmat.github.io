import DiceBox from 'dice-box'

const diceBox = new DiceBox("#dice-box", {
  assetPath: '/dnd/assets/dice-box/',
  theme: "default",
  scale: 16
})

diceBox.init().then(() => {
  diceBox.roll('2d20')
})

diceBox.onRollComplete = function(rollResult) {
  var rolls = 0;
  console.log(rollResult);
  rollResult[0].rolls.forEach(function (item, index) {
    rolls += item.value;
  });
  var li = $('<li>', { class: 'list-group-item d-flex justify-content-between align-items-center', html: rollResult[0].qty + rollResult[0].sides }).appendTo('#results-list');
  //document.getElementById('pane-dice-results').innerHTML += rollResult[0].qty + rollResult[0].sides + ': ' + rolls + '<br />'
}
