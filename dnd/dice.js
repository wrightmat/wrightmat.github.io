import DiceBox from 'dice-box'

const diceBox = new DiceBox("#dice-box", {
  assetPath: '/dnd/assets/dice-box/',
  theme: "default",
  scale: 20
})

diceBox.init().then(() => {
  diceBox.roll('2d20')
})
