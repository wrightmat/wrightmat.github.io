/**********************************************************************
 * zoom.js
 *
 * Zooming and panning by resetting context transform each time displayed.
 * Viewing parameters are:
 *   xleftView: x coordinate of left side of view
 *   ytopView:  y coordinate of top side of view
 *   widthView:  width of view
 *   heightView: height of view
 * Used as follows before drawing:
 *   ctx.setTransform(1,0,0,1,0,0);
 *   ctx.scale(widthCanvas/widthView, heightCanvas/heightView);
 *   ctx.translate(-xleftView,-ytopView);
 *
 * Chuck Anderson, 2012, with lots of help from examples by others on the net.
 *
 * Licensed under a Creative Commons Attribution-NonCommercial 4.0 International License.
 * See http://creativecommons.org/licenses/by-nc/4.0/
 *
 * Example use in HTML file:
 *
 * <!doctype html>
 * <html lang="en">
 *   <head>
 *     <meta charset="utf-8">
 *     <title> Zoom </title>
 *     <script type="text/javascript" src="zoom.js"></script>
 *     <style> canvas {border: red 2px solid;
 *                     float: left;}
 *                     width: 200;
 *                     height: 200;}
 *     </style>
 *   </head>
 * 
 *   <body>
 *     <canvas id="canvas" width="200" height="200"></canvas>
 * 
 *     <div>
 *       Click left mouse button and hold down to pan.  <br>
 *       Double click left mouse button to zoom in to point. (With Shift to zoom out.) <br>
 *       Spin mouse wheel to zoom in and out of center of view. <br>
 *       <br>
 *       Circle stays at center of view.
 *     </div>
 * 
 *   </body>
 * </html>
 * **********************************************************************/

var canvas;
var ctx;
var widthCanvas;
var heightCanvas;

// View parameters
var xleftView = 0;
var ytopView = 0;
var widthViewOriginal = 1.0;           //actual width and height of zoomed and panned display
var heightViewOriginal = 1.0;
var widthView = widthViewOriginal;           //actual width and height of zoomed and panned display
var heightView = heightViewOriginal;

window.addEventListener("load",setup,false);

function setup() {
    canvas = document.getElementById("canvas");
    ctx = canvas.getContext("2d");

    widthCanvas = canvas.width;
    heightCanvas = canvas.height;

    canvas.addEventListener("dblclick", handleDblClick, false);  // dblclick to zoom in at point, shift dblclick to zoom out.
    canvas.addEventListener("mousedown", handleMouseDown, false); // click and hold to pan
    canvas.addEventListener("mousemove", handleMouseMove, false);
    canvas.addEventListener("mouseup", handleMouseUp, false);
    canvas.addEventListener("mousewheel", handleMouseWheel, false); // mousewheel duplicates dblclick function
    canvas.addEventListener("DOMMouseScroll", handleMouseWheel, false); // for Firefox

    draw();
}

function draw() {
    ctx.setTransform(1,0,0,1,0,0);
    ctx.scale(widthCanvas/widthView, heightCanvas/heightView);
    ctx.translate(-xleftView,-ytopView);

    ctx.fillStyle = "yellow";
    ctx.fillRect(xleftView,ytopView, widthView,heightView);
    ctx.fillStyle = "blue";
    ctx.fillRect(0.1,0.5,0.1,0.1);
    ctx.fillStyle = "red";
    ctx.fillRect(0.3,0.2,0.4,0.2);
    ctx.fillStyle="green";
    ctx.beginPath();
    ctx.arc(widthView/2+xleftView,heightView/2+ytopView,0.05,0,360,false);
    ctx.fill();
}

function handleDblClick(event) {
    var X = event.clientX - this.offsetLeft - this.clientLeft + this.scrollLeft; //Canvas coordinates
    var Y = event.clientY - this.offsetTop - this.clientTop + this.scrollTop;
    var x = X/widthCanvas * widthView + xleftView;  // View coordinates
    var y = Y/heightCanvas * heightView + ytopView;

    var scale = event.shiftKey == 1 ? 1.5 : 0.5; // shrink (1.5) if shift key pressed
    widthView *= scale;
    heightView *= scale;

    if (widthView > widthViewOriginal || heightView > heightViewOriginal) {
    widthView = widthViewOriginal;
    heightView = heightViewOriginal;
    x = widthView/2;
    y = heightView/2;
    }

    xleftView = x - widthView/2;
    ytopView = y - heightView/2;

    draw();
}

var mouseDown = false;

function handleMouseDown(event) {
    mouseDown = true;
}

function handleMouseUp(event) {
    mouseDown = false;
}

var lastX = 0;
var lastY = 0;
function handleMouseMove(event) {

    var X = event.clientX - this.offsetLeft - this.clientLeft + this.scrollLeft;
    var Y = event.clientY - this.offsetTop - this.clientTop + this.scrollTop;

    if (mouseDown) {
        var dx = (X - lastX) / widthCanvas * widthView;
        var dy = (Y - lastY)/ heightCanvas * heightView;
    xleftView -= dx;
    ytopView -= dy;
    }
    lastX = X;
    lastY = Y;

    draw();
}

function handleMouseWheel(event) {
    var x = widthView/2 + xleftView;  // View coordinates
    var y = heightView/2 + ytopView;

    var scale = (event.wheelDelta < 0 || event.detail > 0) ? 1.1 : 0.9;
    widthView *= scale;
    heightView *= scale;

    if (widthView > widthViewOriginal || heightView > heightViewOriginal) {
    widthView = widthViewOriginal;
    heightView = heightViewOriginal;
    x = widthView/2;
    y = heightView/2;
    }

    // scale about center of view, rather than mouse position. This is different than dblclick behavior.
    xleftView = x - widthView/2;
    ytopView = y - heightView/2;

    draw();
}