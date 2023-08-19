import DiceBox from 'dice-box'

const diceBox = new DiceBox("#dice-box", {
  assetPath: '/dnd/assets/dice-box/',
  theme: "default",
  offscreen: true,
  scale: 6
})

diceBox.init().then(() => {
  diceBox.roll('2d20')
})
