$('#power').on("change", function() {
    if ( !$('#hearts').val() ) { $('#hearts').val($('#power').val()) }
});
$('#courage').on("change", function() {
    if ( !$('#stamina').val() ) { $('#stamina').val($('#courage').val()) }
});
$('#wisdom').on("change", function() {
    if ( !$('#items').val() ) {
	$('#items').val($('#wisdom').val());
        var itemslots = $('#items').val();
	populateItemSlots(itemslots);
    }
});
$('#items').on("change", function() {
    var itemslots = $('#items').val();
    populateItemSlots(itemslots);
});

function populateItemSlots(slots) {
    $('#pane-items').empty();
    for ( let j = 0; j < slots; j++ ) {
	$('<div>', { id: 'row-item-' + (j+1), class: 'row py-1' }).appendTo('#pane-items');
	$('<div>', { id: 'col-1-item-' + (j+1), class: 'col-4 px-1' }).appendTo('#row-item-' + (j+1));
	$('<div>', { id: 'col-2-item-' + (j+1), class: 'col-1 px-0' }).appendTo('#row-item-' + (j+1));
	$('<div>', { id: 'col-3-item-' + (j+1), class: 'col-1 px-1' }).appendTo('#row-item-' + (j+1));
	$('<div>', { id: 'col-4-item-' + (j+1), class: 'col-2 px-0' }).appendTo('#row-item-' + (j+1));
	$('<div>', { id: 'col-5-item-' + (j+1), class: 'col-2 px-1' }).appendTo('#row-item-' + (j+1));
	$('<input>', { type: 'text', id: 'item-' + (j+1) + '-name', class: 'form-control', title: 'Item Name' }).appendTo('#col-1-item-' + (j+1));
	$('<input>', { type: 'text', id: 'item-' + (j+1) + '-durability', class: 'form-control', title: 'Item Durability', placeholder: '☆' }).appendTo('#col-2-item-' + (j+1));
	$('<input>', { type: 'text', id: 'item-' + (j+1) + '-slots', class: 'form-control', title: 'Item Slots', placeholder: '#', onchange: 'calculateItemSlots()' }).appendTo('#col-3-item-' + (j+1));
    }
}

function calculateItemSlots() {
    var inventory = 0;
    $('[id^=item-]').each( function() {
	if ( this.id.includes('slots') && this.value ) {
	    inventory += parseInt(this.value);
	};
    });
    if ( inventory > $('#items').val() ) {
	console.log("too much inventory! " + inventory);
    } else {
	console.log("inventory: " + inventory);
    }
    return inventory;
}

function populateSheet(sheet) {
    $('#name').val(sheet.name);
    $('#gender').val(sheet.gender);
    $('#ancestry').val(sheet.ancestry);
    $('#background').val(sheet.background);
    $('#statement').val(sheet.statement);
    $('#motivation').val(sheet.motivation);
    $('#power').val(sheet.power);
    $('#wisdom').val(sheet.wisdom);
    $('#courage').val(sheet.courage);
    $('#hearts').val(sheet.hearts);
    $('#items').val(sheet.items);
    $('#stamina').val(sheet.stamina);
    $('#armor').val(sheet.armor);
    $('#hero').val(sheet.hero);
    $('#rupees').val(sheet.rupees);
    $('#speed').val(sheet.speed);
    $('#languages').val(sheet.languages);
    $('#defenses').val(sheet.defenses);
    $('#appearance').val(sheet.appearance);
    $('#alignment').val(sheet.alignment);
    $('#allies').val(sheet.allies);
    $('#notes').val(sheet.notes);
    $('<img>', { src: sheet.image, style: 'height:300px; max-width:300px;' }).appendTo('#pane-picture');

    if ( !$('#hearts').val() ) { $('#hearts').val($('#power').val()) }
    if ( !$('#stamina').val() ) { $('#stamina').val($('#courage').val()) }
    if ( !$('#items').val() ) { $('#items').val($('#wisdom').val()); }
    var itemslots = $('#items').val();
    populateItemSlots(itemslots);

    for ( let i = 0; i < sheet.itemslots.length; i++ ) {
	$('#item-' + (i+1) + '-name').val(sheet.itemslots[i].item_name);
	if (sheet.itemslots[i].armor ) {
	    $('<div>', { id: 'col-4-item-' + (i+1) + '-group', class: 'input-group' }).appendTo('#col-4-item-' + (i+1));
	    $('<input>', { type: 'text', id: 'item-' + (i+1) + '-armor', class: 'form-control', title: 'Item Armor' }).appendTo('#col-4-item-' + (i+1) + '-group');
            $('<div>', { class: 'input-group-append', html: '<div class="input-group-text"><i class="bi bi-shield" style="font-size:16px;"></i></div>' }).appendTo('#col-4-item-' + (i+1) + '-group');
	    $('#item-' + (i+1) + '-armor').val(sheet.itemslots[i].armor);
	    $('#armor').val(parseInt($('#armor').val()) + parseInt(sheet.itemslots[i].armor));
	} else if ( sheet.itemslots[i].attack ) {
	    $('<div>', { id: 'col-4-item-' + (i+1) + '-group', class: 'input-group' }).appendTo('#col-4-item-' + (i+1));
	    $('<input>', { type: 'text', id: 'item-' + (i+1) + '-atk', class: 'form-control', title: 'Item Attack' }).appendTo('#col-4-item-' + (i+1) + '-group');
            $('<div>', { class: 'input-group-append', html: '<input type="button" class="input-group-text btn-secondary" id="item-' + (i+1) + '-button-1" value="Atk" />' }).appendTo('#col-4-item-' + (i+1) + '-group');
	    $('#item-' + (i+1) + '-atk').val(sheet.itemslots[i].attack);

	    $('#item-' + (i+1) + '-button-1').on("click", function() {
		if ( $('#item-' + (i+1) + '-atk').val() == "P" ) {
		    rollDice('1d20+' + sheet.power, sheet.itemslots[i].item_name);
		} else if ( $('#item-' + (i+1) + '-atk').val() == "C" ) {
		    rollDice('1d20+' + sheet.courage, sheet.itemslots[i].item_name);
		} else if ( $('#item-' + (i+1) + '-atk').val() == "W" ) {
		    rollDice('1d20+' + sheet.wisdom, sheet.itemslots[i].item_name);
		}
	    });
	}
	if ( sheet.itemslots[i].damage ) {
	    $('<div>', { id: 'col-5-item-' + (i+1) + '-group', class: 'input-group' }).appendTo('#col-5-item-' + (i+1));
	    $('<input>', { type: 'text', id: 'item-' + (i+1) + '-dmg', class: 'form-control', title: 'Item Damage' }).appendTo('#col-5-item-' + (i+1) + '-group');
            $('<div>', { class: 'input-group-append', html: '<input type="button" class="input-group-text btn-secondary" id="item-' + (i+1) + '-button-2" value="Dmg" />' }).appendTo('#col-5-item-' + (i+1) + '-group');
	    $('#item-' + (i+1) + '-dmg').val(sheet.itemslots[i].damage);

	    $('#item-' + (i+1) + '-button-2').on("click", function() {
		if ( $('#item-' + (i+1) + '-dmg').val().charAt(0) == "d" ) {
		    rollDice("1" + $('#item-' + (i+1) + '-dmg').val(), $('#item-' + (i+1) + '-name').val());
		} else {
	            rollDice($('#item-' + (i+1) + '-dmg').val(), $('#item-' + (i+1) + '-name').val());
		}
	    });
	}
	$('#item-' + (i+1) + '-durability').val(sheet.itemslots[i].item_durability);
	$('#item-' + (i+1) + '-slots').val(sheet.itemslots[i].item_slots);
    }
    calculateItemSlots();

    $('#level').html(sheet.level);
    $('#xp').html(sheet.xp);
    if ( sheet.xp && sheet.xp_needed ) { var progress = parseFloat(sheet.xp / sheet.xp_needed); } else { var progress = 0; }
    $('#level-progress').circleProgress({ value: progress, size: 40.0, fill: { gradient: ['#0681c4', '#07c6c1'] } });
}

populateSheet(sheets[0]);