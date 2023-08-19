import DiceBox from 'dice-box'

const diceBox = new DiceBox("#dice-box", {
  assetPath: '/dnd/assets/dice-box/' // include the trailing backslash
})

diceBox.init().then(() => {
  diceBox.roll('2d20')
})
