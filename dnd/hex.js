var grid;
var hex_highlight;
var hex_selected;
var params;
var mode = 0;

var canvas;
var ctx;
var widthCanvas;
var heightCanvas;

// View parameters
var xleftView = 0;
var ytopView = 0;
var widthViewOriginal = widthCanvas;           // actual width and height of zoomed and panned display
var heightViewOriginal = heightCanvas;
var widthView = widthViewOriginal;	// actual width and height of zoomed and panned display
var heightView = heightViewOriginal;

window.addEventListener("load", setup, false);

function setup() {
    canvas = document.getElementById("hexCanvas");
    ctx = canvas.getContext("2d");

    widthCanvas = canvas.width;
    heightCanvas = canvas.height;

    params = new Proxy(new URLSearchParams(window.location.search), {
	get: (searchParams, prop) => searchParams.get(prop),
    });
    if (params.view == "DM") { mode = 1 }
    if (mode == 0) {
	$('#div-dm').remove();
	setTimeout("location.reload(true);", 10000);  // refresh every 10 seconds so any DM changes are displayed
    } else {
	canvas.addEventListener("click", handleClick, false);  // dblclick to zoom in at point, shift dblclick to zoom out.
	canvas.addEventListener("dblclick", handleDblClick, false);  // dblclick to zoom in at point, shift dblclick to zoom out.
	canvas.addEventListener("contextmenu", handleRightClick, false);  // right click
	canvas.addEventListener("mousedown", handleMouseDown, false); // click and hold to pan
	canvas.addEventListener("mousemove", handleMouseMove, false);
	canvas.addEventListener("mouseup", handleMouseUp, false);
	canvas.addEventListener("mousewheel", handleMouseWheel, false); // mousewheel duplicates dblclick function
	canvas.addEventListener("DOMMouseScroll", handleMouseWheel, false); // for Firefox
    }

    changeMode();
    findHexWithWidthAndHeight();
    drawHexGrid();
    $('#div-dm').draggable();
}


var HT = HT || {};
/**
 * A Point is simply x and y coordinates
 * @constructor
 */
HT.Point = function(x, y) {
    this.X = x;
    this.Y = y;
};

/**
 * A Rectangle is x and y origin and width and height
 * @constructor
 */
HT.Rectangle = function(x, y, width, height) {
    this.X = x;
    this.Y = y;
    this.Width = width;
    this.Height = height;
};

/**
 * A Line is x and y start and x and y end
 * @constructor
 */
HT.Line = function(x1, y1, x2, y2) {
    this.X1 = x1;
    this.Y1 = y1;
    this.X2 = x2;
    this.Y2 = y2;
};

/**
 * A Hexagon is a 6 sided polygon, our hexes don't have to be symmetrical, i.e. ratio of width to height could be 4 to 3
 * @constructor
 */
HT.Hexagon = function(id, x, y, PathCoOrdX = undefined, PathCoOrdY = undefined, visible, color = undefined, title = undefined) {
    this.Points = []; // Polygon Base
    var x1 = null;
    var y1 = null;
    if(HT.Hexagon.Static.ORIENTATION == HT.Hexagon.Orientation.Normal) {
	x1 = (HT.Hexagon.Static.WIDTH - HT.Hexagon.Static.SIDE)/2;
	y1 = (HT.Hexagon.Static.HEIGHT / 2);
	this.Points.push(new HT.Point(x1 + x, y));
	this.Points.push(new HT.Point(x1 + HT.Hexagon.Static.SIDE + x, y));
	this.Points.push(new HT.Point(HT.Hexagon.Static.WIDTH + x, y1 + y));
	this.Points.push(new HT.Point(x1 + HT.Hexagon.Static.SIDE + x, HT.Hexagon.Static.HEIGHT + y));
	this.Points.push(new HT.Point(x1 + x, HT.Hexagon.Static.HEIGHT + y));
	this.Points.push(new HT.Point(x, y1 + y));
    } else {
	x1 = (HT.Hexagon.Static.WIDTH / 2);
	y1 = (HT.Hexagon.Static.HEIGHT - HT.Hexagon.Static.SIDE)/2;
	this.Points.push(new HT.Point(x1 + x, y));
	this.Points.push(new HT.Point(HT.Hexagon.Static.WIDTH + x, y1 + y));
	this.Points.push(new HT.Point(HT.Hexagon.Static.WIDTH + x, y1 + HT.Hexagon.Static.SIDE + y));
	this.Points.push(new HT.Point(x1 + x, HT.Hexagon.Static.HEIGHT + y));
	this.Points.push(new HT.Point(x, y1 + HT.Hexagon.Static.SIDE + y));
	this.Points.push(new HT.Point(x, y1 + y));
    }

    this.Id = id;
    this.x = x;
    this.y = y;
    this.x1 = x1;
    this.y1 = y1;
	
    this.TopLeftPoint = new HT.Point(this.x, this.y);
    this.BottomRightPoint = new HT.Point(this.x + HT.Hexagon.Static.WIDTH, this.y + HT.Hexagon.Static.HEIGHT);
    this.MidPoint = new HT.Point(this.x + (HT.Hexagon.Static.WIDTH / 2), this.y + (HT.Hexagon.Static.HEIGHT / 2));
    this.P1 = new HT.Point(x + x1, y + y1);
    this.selected = false;

    if (PathCoOrdX !== undefined) { this.PathCoOrdX = PathCoOrdX }
    if (PathCoOrdY !== undefined) { this.PathCoOrdY = PathCoOrdY }
    if (color !== undefined) { this.color = color }
    if (title !== undefined) { this.title = title }
    this.visible = visible
};
	
/**
 * draws this Hexagon to the canvas
 * @this {HT.Hexagon}
 */
HT.Hexagon.prototype.draw = function(ctx) {
    if (this.hover) {
	ctx.strokeStyle = "black";
	ctx.lineWidth = 2;
    } else if (this.selected) {
	ctx.strokeStyle = "black";
	ctx.lineWidth = 4;
    } else {
	ctx.strokeStyle = "grey";
	ctx.lineWidth = 1;
    }
    ctx.beginPath();
    ctx.moveTo(this.Points[0].X, this.Points[0].Y);
    for(var i = 1; i < this.Points.length; i++) {
	var p = this.Points[i];
	ctx.lineTo(p.X, p.Y);
    }
    ctx.closePath();
    ctx.stroke();
	
    if (!this.visible) {
	if (mode == 1) { ctx.globalAlpha = 0.5; } else { ctx.globalAlpha = 0; }
    } else {
	ctx.globalAlpha = 1;
    }
    if (this.color !== undefined) {
	ctx.fillStyle = this.color;
	ctx.fill();
    }
	
    if(this.Id && mode == 1) {
	// draw id text
	ctx.fillStyle = "black";
	ctx.font = "bolder 8pt Trebuchet MS,Tahoma,Verdana,Arial,sans-serif";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(this.Id, this.MidPoint.X, this.MidPoint.Y);
    }

    if(this.PathCoOrdX !== null && this.PathCoOrdY !== null && typeof(this.PathCoOrdX) != "undefined" && typeof(this.PathCoOrdY) != "undefined" && mode == 1) {
	// draw co-ordinates text
	ctx.fillStyle = "black";
	ctx.font = "bolder 8pt Trebuchet MS,Tahoma,Verdana,Arial,sans-serif";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText("("+this.PathCoOrdX+","+this.PathCoOrdY+")", this.MidPoint.X, this.MidPoint.Y + 10);
    }

    if (this.title !== undefined) {
	ctx.fillStyle = "black";
	ctx.font = "bolder 10pt Trebuchet MS,Tahoma,Verdana,Arial,sans-serif";
	ctx.fillText(this.title, this.MidPoint.X, this.MidPoint.Y - 20);
	ctx.fillStyle = "white";
	ctx.fillText(this.title, this.MidPoint.X - 1, this.MidPoint.Y - 21);
    }

    if(HT.Hexagon.Static.DRAWSTATS) {
	ctx.strokeStyle = "black";
	ctx.lineWidth = 2;
	// draw our x1, y1, and z
	ctx.beginPath();
	ctx.moveTo(this.P1.X, this.y);
	ctx.lineTo(this.P1.X, this.P1.Y);
	ctx.lineTo(this.x, this.P1.Y);
	ctx.closePath();
	ctx.stroke();
	
	ctx.fillStyle = "black"
	ctx.font = "bolder 8pt Trebuchet MS,Tahoma,Verdana,Arial,sans-serif";
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	//var textWidth = ctx.measureText(this.Planet.BoundingHex.Id);
	ctx.fillText("z", this.x + this.x1/2 - 8, this.y + this.y1/2);
	ctx.fillText("x", this.x + this.x1/2, this.P1.Y + 10);
	ctx.fillText("y", this.P1.X + 2, this.y + this.y1/2);
	ctx.fillText("z = " + HT.Hexagon.Static.SIDE, this.P1.X, this.P1.Y + this.y1 + 10);
	ctx.fillText("(" + this.x1.toFixed(2) + "," + this.y1.toFixed(2) + ")", this.P1.X, this.P1.Y + 10);
    }
};

/**
 * Returns true if the x,y coordinates are inside this hexagon
 * @this {HT.Hexagon}
 * @return {boolean}
 */
HT.Hexagon.prototype.isInBounds = function(x, y) {
    return this.Contains(new HT.Point(x, y));
};
	

/**
 * Returns true if the point is inside this hexagon, it is a quick contains
 * @this {HT.Hexagon}
 * @param {HT.Point} p the test point
 * @return {boolean}
 */
HT.Hexagon.prototype.isInHexBounds = function(/*Point*/ p) {
    if(this.TopLeftPoint.X < p.X && this.TopLeftPoint.Y < p.Y && p.X < this.BottomRightPoint.X && p.Y < this.BottomRightPoint.Y)
	return true;
    return false;
};

// grabbed from:
// http://www.developingfor.net/c-20/testing-to-see-if-a-point-is-within-a-polygon.html
// http://www.ecse.rpi.edu/Homepages/wrf/Research/Short_Notes/pnpoly.html#The%20C%20Code
/**
 * Returns true if the point is inside this hexagon, it first uses the quick isInHexBounds contains, then check the boundaries
 * @this {HT.Hexagon}
 * @param {HT.Point} p the test point
 * @return {boolean}
 */
HT.Hexagon.prototype.Contains = function(/*Point*/ p) {
    var isIn = false;
    if (this.isInHexBounds(p)) {
	// turn our absolute point into a relative point for comparing with the polygon's points
	var i, j = 0;
	for (i = 0, j = this.Points.length - 1; i < this.Points.length; j = i++) {
	    var iP = this.Points[i];
	    var jP = this.Points[j];
	    if (
		(
		 ((iP.Y <= p.Y) && (p.Y < jP.Y)) ||
		 ((jP.Y <= p.Y) && (p.Y < iP.Y))
		//((iP.Y > p.Y) != (jP.Y > p.Y))
		) &&
		(p.X < (jP.X - iP.X) * (p.Y - iP.Y) / (jP.Y - iP.Y) + iP.X)
	    ) {
		isIn = !isIn;
	    }
	}
    }
    return isIn;
};

/**
* Returns absolute distance in pixels from the mid point of this hex to the given point
* Provided by: Ian (Disqus user: boingy)
* @this {HT.Hexagon}
* @param {HT.Point} p the test point
* @return {number} the distance in pixels
*/
HT.Hexagon.prototype.distanceFromMidPoint = function(/*Point*/ p) {
    // Pythagoras' Theorem: Square of hypotenuse = sum of squares of other two sides
    var deltaX = this.MidPoint.X - p.X;
    var deltaY = this.MidPoint.Y - p.Y;

    // squaring so don't need to worry about square-rooting a negative number 
    return Math.sqrt( (deltaX * deltaX) + (deltaY * deltaY) );
};

HT.Hexagon.Orientation = { Normal: 0, Rotated: 1 };
HT.Hexagon.Static = {HEIGHT:91.14378277661477, WIDTH:91.14378277661477
			, SIDE:50.0, ORIENTATION:HT.Hexagon.Orientation.Normal
			, DRAWSTATS: false}; // hexagons will have 25 unit sides for now


/**
 * A Grid is the model of the playfield containing hexes
 * @constructor
 */
HT.Grid = function(/*double*/ width, /*double*/ height) {
    this.Hexes = [];

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(widthCanvas/widthView, heightCanvas/heightView);
    ctx.translate(-xleftView, -ytopView);

    // setup a dictionary for use later for assigning the X or Y CoOrd (depending on Orientation)
    var HexagonsByXOrYCoOrd = {}; //Dictionary<int, List<Hexagon>>

    var row = 0;
    var y = 0.0;
    while (y + HT.Hexagon.Static.HEIGHT <= height) {
	var col = 0;
	var offset = 0.0;
	if (row % 2 == 1) {
	    if(HT.Hexagon.Static.ORIENTATION == HT.Hexagon.Orientation.Normal)
		offset = (HT.Hexagon.Static.WIDTH - HT.Hexagon.Static.SIDE)/2 + HT.Hexagon.Static.SIDE;
	    else
		offset = HT.Hexagon.Static.WIDTH / 2;
	    col = 1;
	}
		
	var x = offset;
	while (x + HT.Hexagon.Static.WIDTH <= width) {
	    var hexId = this.GetHexId(row, col);
		var h = new HT.Hexagon(hexId, x, y);
		
		var pathCoOrd = col;
		if(HT.Hexagon.Static.ORIENTATION == HT.Hexagon.Orientation.Normal)
		    h.PathCoOrdX = col; // the column is the x coordinate of the hex, for the y coordinate we need to get more fancy
		else {
		    h.PathCoOrdY = row;
		    pathCoOrd = row;
		}
		this.Hexes.push(h);
		
		if (!HexagonsByXOrYCoOrd[pathCoOrd])
		    HexagonsByXOrYCoOrd[pathCoOrd] = [];
		HexagonsByXOrYCoOrd[pathCoOrd].push(h);

		col += 2;
		if(HT.Hexagon.Static.ORIENTATION == HT.Hexagon.Orientation.Normal)
		    x += HT.Hexagon.Static.WIDTH + HT.Hexagon.Static.SIDE;
		else
		    x += HT.Hexagon.Static.WIDTH;
	}
	row++;
	if(HT.Hexagon.Static.ORIENTATION == HT.Hexagon.Orientation.Normal)
	    y += HT.Hexagon.Static.HEIGHT / 2;
	else
	    y += (HT.Hexagon.Static.HEIGHT - HT.Hexagon.Static.SIDE)/2 + HT.Hexagon.Static.SIDE;
    }

    // finally go through our list of hexagons by their x co-ordinate to assign the y co-ordinate
    for (var coOrd1 in HexagonsByXOrYCoOrd) {
	var hexagonsByXOrY = HexagonsByXOrYCoOrd[coOrd1];
	var coOrd2 = Math.floor(coOrd1 / 2) + (coOrd1 % 2);
	for (var i in hexagonsByXOrY) {
	    var h = hexagonsByXOrY[i];
	    if(HT.Hexagon.Static.ORIENTATION == HT.Hexagon.Orientation.Normal)
		h.PathCoOrdY = coOrd2++;
	    else
		h.PathCoOrdX = coOrd2++;
	}
    }
};

HT.Grid.Static = { Letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' };
HT.Grid.prototype.GetHexId = function(row, col) {
    var letterIndex = row;
    var letters = "";
    while(letterIndex > 25) {
	letters = HT.Grid.Static.Letters[letterIndex % 26] + letters;
	letterIndex -= 26;
    }
    return HT.Grid.Static.Letters[letterIndex] + letters + (col + 1);
};

/**
 * Returns a hex at a given point
 * @this {HT.Grid}
 * @return {HT.Hexagon}
 */
HT.Grid.prototype.GetHexAt = function(/*Point*/ p) {
    // find the hex that contains this point
    for (var h in this.Hexes) {
	if (this.Hexes[h].Contains(p)) {
	    return this.Hexes[h];
	}
    }
    return null;
};

/**
 * Returns a distance between two hexes
 * @this {HT.Grid}
 * @return {number}
 */
HT.Grid.prototype.GetHexDistance = function(/*Hexagon*/ h1, /*Hexagon*/ h2) {
    // a good explanation of this calc can be found here:
    // http://playtechs.blogspot.com/2007/04/hex-grids.html
    var deltaX = h1.PathCoOrdX - h2.PathCoOrdX;
    var deltaY = h1.PathCoOrdY - h2.PathCoOrdY;
    return ((Math.abs(deltaX) + Math.abs(deltaY) + Math.abs(deltaX - deltaY)) / 2);
};

/**
 * Returns a hex based on Id
 * @this {HT.Grid}
 * @return {HT.Hexagon}
 */
HT.Grid.prototype.GetHexById = function(id) {
    for(var i in this.Hexes) {
	if(this.Hexes[i].Id == id) {
	    return this.Hexes[i];
	}
    }
    return null;
};

/**
* Returns the nearest hex to a given point
* Provided by: Ian (Disqus user: boingy)
* @this {HT.Grid}
* @param {HT.Point} p the test point 
* @return {HT.Hexagon}
*/
HT.Grid.prototype.GetNearestHex = function(/*Point*/ p) {
    var distance;
    var minDistance = Number.MAX_VALUE;
    var hx = null;

    // iterate through each hex in the grid
    for (var h in this.Hexes) {
	distance = this.Hexes[h].distanceFromMidPoint(p);
	// if this is the nearest thus far
	if (distance < minDistance) {
	    minDistance = distance;
	    hx = this.Hexes[h];
	}
    }
    return hx;
};

function findHexWithWidthAndHeight() {
    var width = parseFloat(100.0);
    var height = parseFloat(86.60254037844388);
    var y = height / 2.0;

    // solve quadratic
    var a = -3.0;
    var b = (-2.0 * width);
    var c = (Math.pow(width, 2)) + (Math.pow(height, 2));
    var z = (-b - Math.sqrt(Math.pow(b,2)-(4.0*a*c)))/(2.0*a);
    var x = (width - z) / 2.0;

    var contentDiv = document.getElementById("hexStatus");
    contentDiv.innerHTML = "Values for Hex: <br /><b>Width:</b> " + width + "<br /><b>Height: </b>" + height + "<br /><b>Side Length, z:</b> " + z + "<br /><b>x:</b> " + x + "<br /><b>y:</b> " + y;
	
    HT.Hexagon.Static.WIDTH = width;
    HT.Hexagon.Static.HEIGHT = height;
    HT.Hexagon.Static.SIDE = z;
}

function drawHexGrid() {
    // load a grid if one has been previously saved, otherwise create a new blank one
    if (localStorage.getItem("dnd_hex_grid") !== null) {
	grid = new HT.Grid(widthCanvas, heightCanvas);
	grid.Hexes = JSON.parse(localStorage.getItem("dnd_hex_grid"));
	for(var h in grid.Hexes) {
	    grid.Hexes[h] = new HT.Hexagon(grid.Hexes[h].Id, grid.Hexes[h].x, grid.Hexes[h].y, grid.Hexes[h].PathCoOrdX, grid.Hexes[h].PathCoOrdY, grid.Hexes[h].visible, grid.Hexes[h].color, grid.Hexes[h].title);
	}
    } else {
	grid = new HT.Grid(widthCanvas, heightCanvas);
    }
    if (mode == 0) { ctx.scale(0.4, 0.4); }
    ctx.clearRect(0, 0, widthCanvas, heightCanvas);
    for(var h in grid.Hexes) {
	grid.Hexes[h].draw(ctx);
    }
}

function resetHexGrid() {
    if (confirm("Are you sure you want to reset the grid?")) {
	localStorage.removeItem("dnd_hex_grid");
	findHexWithWidthAndHeight();
	drawHexGrid();
    }
}

async function loadHexGrid(file) {
    let text = await file.text();
    localStorage.setItem("dnd_hex_grid", text);
    findHexWithWidthAndHeight();
    drawHexGrid();
}

function saveHexGrid() {
    var title = prompt("Enter a filename", "hex_grid.txt");
    if (title !== null) {
	var blob = new Blob([localStorage.getItem("dnd_hex_grid")], {type: "text/plain;charset=utf-8"});
	saveAs(blob, title);
    }
}

function refreshHexGrid() {
    ctx.clearRect(0, 0, widthCanvas, heightCanvas);
    for(var h in grid.Hexes) {
	grid.Hexes[h].draw(ctx);
    }
    var hex_grid = JSON.stringify(grid.Hexes);
    localStorage.setItem("dnd_hex_grid", hex_grid);
}

function changeMode() {
    var sel = $('#select-mode :selected').attr("id");
    $("#select-mode > option").each(function() {
	$('#mode-' + this.id).hide();
    });
    $('#mode-' + sel).show();
}

function changeOrientation() {
    if(document.getElementById("hexOrientationNormal").checked) {
	HT.Hexagon.Static.ORIENTATION = HT.Hexagon.Orientation.Normal;
    } else {
	HT.Hexagon.Static.ORIENTATION = HT.Hexagon.Orientation.Rotated;
    }
    drawHexGrid();
}

function visibleHexGrid(v) {
    for(var h in grid.Hexes) {
	grid.Hexes[h].visible = v;
    }
    refreshHexGrid();
}


function handleClick(e) {
    const rect = this.getBoundingClientRect()
    var point = new HT.Point(e.x - rect.left, e.y - rect.top)
    var hex = grid.GetHexAt(point);
    for(var h in grid.Hexes) {
	grid.Hexes[h].selected = false;
    }
    if (hex !== null) {
	hex.selected = true;
	var sel = $('#select-mode :selected').attr("id");
	if (sel == "color") {
	    if ($('#color-picker').val() !== "")
		hex.color = $('#color-picker').val();
	    else
		hex.color = undefined;
	} else if (sel == "visible") {
	    hex.visible = !hex.visible;
	} else if (sel == "title") {
	    var title = prompt("Enter a title for this hex", hex.title);
	    if (title !== null) { hex.title = title; }
	}
    }
    refreshHexGrid();
}

function handleDblClick(e) {
    var X = e.clientX - this.offsetLeft - this.clientLeft + this.scrollLeft; // canvas coordinates
    var Y = e.clientY - this.offsetTop - this.clientTop + this.scrollTop;
    var x = X / widthCanvas * widthView + xleftView;  // view coordinates
    var y = Y / heightCanvas * heightView + ytopView;

    var scale = e.shiftKey == 1 ? 1.5 : 0.5; // shrink (1.5) if shift key pressed
    widthView *= scale;
    heightView *= scale;

    if (widthView > widthViewOriginal || heightView > heightViewOriginal) {
	widthView = widthViewOriginal;
	heightView = heightViewOriginal;
	x = widthView / 2;
	y = heightView / 2;
    }

    xleftView = x - widthView / 2;
    ytopView = y - heightView / 2;

    refreshHexGrid();
}

function handleRightClick(e) {
    e.preventDefault();

    const rect = this.getBoundingClientRect()
    var point = new HT.Point(e.x - rect.left, e.y - rect.top)
    var hex = grid.GetHexAt(point);
    if (hex !== null) {
	$('#color-picker').val(hex.color);
	document.querySelector('#color-picker').dispatchEvent(new Event('input', { bubbles: true }));
    }
}

var mouseDown = false;
function handleMouseDown(event) {
    mouseDown = true;
}
function handleMouseUp(event) {
    mouseDown = false;
}

var lastX = 0; var lastY = 0;
function handleMouseMove(e) {
    var X = e.clientX - this.offsetLeft - this.clientLeft + this.scrollLeft;
    var Y = e.clientY - this.offsetTop - this.clientTop + this.scrollTop;
    if (mouseDown) {
        var dx = (X - lastX) / widthCanvas * widthView;
        var dy = (Y - lastY)/ heightCanvas * heightView;
	xleftView -= dx;
	ytopView -= dy;
    }
    lastX = X;
    lastY = Y;

    const rect = this.getBoundingClientRect()
    var point = new HT.Point(e.x - rect.left, e.y - rect.top)
    var hex = grid.GetHexAt(point);
    if (hex !== null) {
	for(var h in grid.Hexes) {
	    grid.Hexes[h].hover = false;
	}
	hex.hover = true;
    }

    refreshHexGrid();
}

function handleMouseWheel(e) {
    var x = widthView / 2 + xleftView;  // view coordinates
    var y = heightView / 2 + ytopView;

    var scale = (e.wheelDelta < 0 || e.detail > 0) ? 1.2 : 0.8;
    widthView *= scale;
    heightView *= scale;

    if (widthView > widthViewOriginal || heightView > heightViewOriginal) {
	widthView = widthViewOriginal;
	heightView = heightViewOriginal;
	x = widthView / 2;
	y = heightView / 2;
    }

    // scale about center of view, rather than mouse position. This is different than dblclick behavior.
    xleftView = x - widthView / 2;
    ytopView = y - heightView / 2;

    refreshHexGrid();
}