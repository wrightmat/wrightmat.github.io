function rollDice(notation, reason) {
    var diceBox = window.diceBox;

   if ( window.rollDice3d == undefined ) {
	// if the 3d dice aren't initialized (local or an error) then fall back on a basic roller. 
	var arr = [];
	var d = notation.indexOf("d");
	if ( notation.indexOf("x") >= 0 ) { var x = notation.indexOf("x") }
	if ( notation.indexOf("+") >= 0 || notation.indexOf("-") >= 0 ) { var p = notation.indexOf("+") + notation.indexOf("-") + 1 }
	var num = notation.substring(0, d) || 1;
	if ( x || p ) {
	    var die = notation.substring(d + 1, ( x || p ));
	    if ( x ) {
		var mult = notation.substring(x + 1, notation.length);
		var plus = 0;
	    } else if ( p ) {
		var plus = notation.substring(p + 1, notation.length);
		var mult = 1;
	    }
	} else {
	    var die = notation.substring(d + 1, notation.length);
	    var mult = 1;
	    var plus = 0;
	}

	if ( parseInt(d) == 0 ) { d = 1; }
	for ( let i = 0; i < num; i++ ) {
	    arr.push(getRandomInt(d, die) * mult);
	}

	var rolls_val = parseInt(plus);
	var rolls_str = "";
	arr.forEach(function (item, index) {
	    rolls_val += parseInt(item);
	    if ( rolls_str != "" ) { rolls_str += " + " }
	    rolls_str += item;
	});

	result = displayDiceResults([ notation, rolls_str, rolls_val, reason ]);

    } else {
	result = window.rollDice3d(notation, reason);
    }

    return result;
}

function parseDice(rollResult, reason) {
    var rolls_val = 0;
    var rolls_str = "";

    rollResult[0].rolls.forEach(function (item, index) {
	if ( rolls_str != "" ) { rolls_str += " + " }
	rolls_str += item.value;
    });
    rolls_val += rollResult[0].value

    var rolled = rollResult[0].qty + rollResult[0].sides;
    if ( rollResult[0].modifier > 0 ) { rolled += "+" + rollResult[0].modifier; }

    return [ rolled, rolls_str, rolls_val, reason ]
}

function displayDiceResults(resultsArr) {
    if ( resultsArr[3] ) { var reason = resultsArr[3] + '<br />' } else { var reason = "" }
    var li = $('<li>', { class: 'list-group-item d-flex justify-content-between align-items-center' }).prependTo('#results-list');
    $('<span>', { style: 'font-size: 10px;white-space: nowrap;', html: reason + '<b>' + resultsArr[0] + '</b>: ' + resultsArr[1]}).appendTo(li);
    $('<span>', { class: 'badge badge-primary badge-pill', html: resultsArr[2] }).appendTo(li);

    return resultsArr;
}