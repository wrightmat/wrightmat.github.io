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
}

export function rollDice3d(notation) {
  diceBox.roll(notation);
}
