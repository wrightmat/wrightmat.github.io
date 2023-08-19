import DiceBox from 'dice-box';
//import DiceParser from 'dice-parser-interface';

const diceBox = new DiceBox("#dice-box", {
  assetPath: '/dnd/assets/dice-box/',
  theme: "default",
  scale: 5
});

diceBox.init()

//const DP = new DiceParser()

diceBox.onRollComplete = function(rollResult) {
  var arr = parseDice(rollResult);
  displayDiceResults(arr);
  $('#dice-box').css('z-index', -1);
}

window.rollDice3d = function (notation) {
  console.log(DP.parseNotation(notation));
  $('#dice-box').css('z-index', 1);
  diceBox.roll(notation);
  setInterval(function() {
    diceBox.clear();
  }, 10000);
}

window.parseNotation = function (notation) {
  return DP.parseNotation(notation);
}