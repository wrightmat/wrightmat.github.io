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
	for ( let i = 0; i < slots; i++ ) {
	    if ( i > 0 ) { var st = 'padding-right:80px;padding-top:10px;' } else { var st = 'padding-right:80px;'; }
	    $('<div>', { id: 'row-item-' + (i+1), class: 'row', style: st }).appendTo('#pane-items');
	    $('<div>', { id: 'col-1-item-' + (i+1), class: 'col-7', style: 'padding-left:1px; padding-right:1px;' }).appendTo('#row-item-' + (i+1));
	    $('<div>', { id: 'col-2-item-' + (i+1), class: 'col-2', style: 'padding-left:1px; padding-right:12px;' }).appendTo('#row-item-' + (i+1));
	    $('<div>', { id: 'col-3-item-' + (i+1), class: 'col-1', style: 'padding-left:1px; padding-right:1px;' }).appendTo('#row-item-' + (i+1));
	    $('<div>', { id: 'col-4-item-' + (i+1), class: 'col-1', style: 'padding-left:1px; padding-right:1px;' }).appendTo('#row-item-' + (i+1));
	    $('<div>', { id: 'col-5-item-' + (i+1), class: 'col-1', style: 'padding-right:0px;' }).appendTo('#row-item-' + (i+1));
	    $('<input>', { type: 'text', id: 'item-' + (i+1) + '-name', class: 'form-control', title: 'Item Name' }).appendTo('#col-1-item-' + (i+1));
	    $('<input>', { type: 'text', id: 'item-' + (i+1) + '-stat', class: 'form-control', title: 'Item Stat' }).appendTo('#col-2-item-' + (i+1));
	    $('<input>', { type: 'text', id: 'item-' + (i+1) + '-durability', class: 'form-control', title: 'Item Durability', placeholder: '☆' }).appendTo('#col-3-item-' + (i+1));
	    $('<input>', { type: 'text', id: 'item-' + (i+1) + '-slots', class: 'form-control', title: 'Item Slots', placeholder: '#', onchange: 'calculateItemSlots()' }).appendTo('#col-4-item-' + (i+1));
	    $('<div>', { id: 'item-' + (i+1) + '-buttons', class: 'btn-group', role: 'group' }).appendTo('#col-5-item-' + (i+1));
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
	
	if ( !$('#hearts').val() ) { $('#hearts').val($('#power').val()) }
	if ( !$('#stamina').val() ) { $('#stamina').val($('#courage').val()) }
	if ( !$('#items').val() ) { $('#items').val($('#wisdom').val()); }
        var itemslots = $('#items').val();
	populateItemSlots(itemslots);

	for (var i = 0; i < sheet.itemslots.length; i++) {
	  $('#item-' + (i+1) + '-name').val(sheet.itemslots[i].item_name);
	  if (sheet.itemslots[i].armor ) {
	    $('#item-' + (i+1) + '-stat').val(sheet.itemslots[i].armor);
	  } else if ( sheet.itemslots[i].damage ) {
	    $('<button>', { type: 'button', class: 'btn btn-secondary', html: 'Atk' }).appendTo('#item-' + (i+1) + '-buttons');
	    $('<button>', { type: 'button', class: 'btn btn-secondary', html: 'Dmg' }).appendTo('#item-' + (i+1) + '-buttons');
	    $('#item-' + (i+1) + '-stat').val(sheet.itemslots[i].damage);
	    $('#item-' + (i+1) + '-buttons').children().first().on("click", function() {
	      if ( sheet.itemslots[i].attack == "power" ) {
		rollDice('1d20+' + sheet.power);
	      } else if ( sheet.itemslots[i].attack == "courage" ) {
		rollDice('1d20+' + sheet.courage);
	      } else if ( sheet.itemslots[i].attack == "wisdom" ) {
		rollDice('1d20+' + sheet.wisdom);
	      }
	    });
	    $('#item-' + (i+1) + '-buttons').children().last().on("click", function() {
	      if ( sheet.damage.charAt(0) == "d" ) {
		rollDice("1" + sheet.damage);
	      } else {
	        rollDice(sheet.damage);
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