import DiceBox from 'dice-box'

const diceBox = new DiceBox("#dice-box", {
  assetPath: '/dnd/assets/dice-box/',
  theme: "default",
  scale: 16
})

diceBox.init().then(() => {
  diceBox.roll('2d20')
})

diceBox.onRollComplete => function(rollResult) {
  console.log('roll results', rollResult)
}
