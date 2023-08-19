import DiceBox from 'dice-box'

const diceBox = new DiceBox("#dice-box", {
  assetPath: 'assets/dice-box/' // include the trailing backslash
})

diceBox.init().then(async () => {
  diceBox.roll('2d20')
})