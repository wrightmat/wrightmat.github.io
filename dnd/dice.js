import DiceBox from 'dice-box';

export const diceBox = new DiceBox("#dice-box", {
  assetPath: '/dnd/assets/dice-box/',
  theme: "default",
  scale: 5
});

window.diceBox = diceBox;