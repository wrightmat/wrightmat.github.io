import DiceBox from 'dice-box';

const diceBox = new DiceBox("#dice-box", {
  assetPath: '/dnd/assets/dice-box/',
  theme: "default",
  scale: 5
});

diceBox.init()

diceBox.onRollComplete = function(rollResult) {
  var arr = parseDice(rollResult);
  displayDiceResults(arr);
  $('#dice-box').css('z-index', -1);
  setInterval(function() {
    diceBox.clear();
  }, 5000);
}

window.rollDice3d = function (notation) {
  $('#dice-box').css('z-index', 1);
  diceBox.roll(notation);
}
