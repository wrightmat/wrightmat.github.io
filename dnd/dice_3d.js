import DiceBox from 'dice-box';
var roll_reason;

const diceBox = new DiceBox("#dice-box", {
    assetPath: '/dnd/assets/dice-box/',
    theme: "default",
    scale: 5
});

diceBox.init()

diceBox.onRollComplete = function(rollResult) {
    var arr = parseDice(rollResult, roll_reason);
    displayDiceResults(arr);
    $('#dice-box').css('z-index', -1);
}

window.rollDice3d = function (notation, reason) {
    roll_reason = reason;
    $('#dice-box').css('z-index', 1);
    diceBox.roll(notation);
    setInterval(function() {
	diceBox.clear();
    }, 8000);
}
