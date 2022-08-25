function add_quickref_item(parent, data, type) {
    var icon = data.icon || "perspective-dice-six-faces-one";
    var subtitle = data.subtitle || "";
    var title = data.title || "[no title]";

    var item = document.createElement("div");
    item.className += "item itemsize"
    item.innerHTML =
    '\
    <div class="item-icon iconsize icon-' + icon + '"></div>\
    <div class="item-text-container text">\
        <div class="item-title">' + title + '</div>\
        <div class="item-desc">' + subtitle + '</div>\
    </div>\
    ';

    var style = window.getComputedStyle(parent.parentNode.parentNode);
    var color = style.backgroundColor;

    item.onclick = function () {
        show_modal(data, color, type);
    }

    parent.appendChild(item);
}

function show_modal(data, color, type) {
    var title = data.title || "[no title]";
    var subtitle = data.description || data.subtitle || "";
    var bullets = data.bullets || [];
    var actions = data.actions || [];
    var reference = data.reference || "";
    type = type || "";
    color = color || "black"

    $("body").addClass("modal-open");
    $("#modal").addClass("modal-visible");
    $("#modal-backdrop").css("height", window.innerHeight + "px");
    $("#modal-container").css("background-color", color).css("border-color", color);
    $("#modal-title").text(title).append("<span class=\"float-right\">" + type + "</span>");
    $("#modal-subtitle").text(subtitle);
    $("#modal-reference").text(reference);

    var bullets_html = bullets.map(function (item) { return "<p class=\"fonstsize\">" + item + "</p>"; }).join("<hr>");
    $("#modal-bullets").html(bullets_html);

    actions.forEach(function (action) {
	data_officer_action.forEach(function (item) {
	    if (item.title == action) { data = item; }
	});
	var line = document.createElement('p');
	line.innerHTML = "<b> • " + action + "</b><hr>";
	var tooltip = "";
	data.bullets.forEach(function (bullet) {
	    tooltip += '\n' + bullet + '\n';
	});
	line.setAttribute("data-tooltip", "");
	line.setAttribute("data-tooltip-label", data.subtitle);
	line.setAttribute("data-tooltip-message", tooltip);
	document.getElementById("modal-bullets").appendChild(line);
    });
}

function hide_modal() {
    $("body").removeClass("modal-open");
    $("#modal").removeClass("modal-visible");
}

function fill_section(data, parentname, type) {
    var parent = document.getElementById(parentname);
    data.forEach(function (item) {
        add_quickref_item(parent, item, type);
    });
}

function init_5e() {
    fill_section(data_movement, "basic-movement", "Movement");
    fill_section(data_action, "basic-actions", "Actions");
    fill_section(data_bonusaction, "basic-bonus-actions", "Bonus Actions");
    fill_section(data_reaction, "basic-reactions", "Reactions");
    fill_section(data_condition, "basic-conditions", "Conditions");
    fill_section(data_environment_obscurance, "environment-obscurance", "Environment");
    fill_section(data_environment_light, "environment-light", "Environment");
    fill_section(data_environment_vision, "environment-vision", "Environment");
    fill_section(data_environment_cover, "environment-cover", "Environment");

    var modal = document.getElementById("modal");
    modal.onclick = hide_modal;
}

function init_sj() {
    fill_section(data_ship_movement, "basic-movement", "Ship Movement");
    fill_section(data_ship_action, "basic-actions", "Ship Actions");
    fill_section(data_officer_action, "basic-bonus-actions", "Officer Actions");
    fill_section(data_officer_position, "basic-reactions", "Officer Positions");
    fill_section(data_critical_effect, "basic-conditions", "Ship Critical Effects");

    var modal = document.getElementById("modal");
    modal.onclick = hide_modal;
}