//    	xiNET Interaction Viewer
//    	Copyright 2013 Rappsilber Laboratory
//
//    	This product includes software developed at
//    	the Rappsilber Laboratory (http://www.rappsilberlab.org/).
//
//		MoleculeSet.js
//
//		authors: Colin Combe

"use strict";

var Interactor = require('./Interactor');
var Config = require('../../controller/Config');

MoleculeSet.prototype = new Interactor();

function MoleculeSet(id, xlvController, json, name) {
    this.id = id; // id may not be accession (multiple Segments with same accesssion)
    this.controller = xlvController;
    this.json = json;
    //links
    this.naryLinks = d3.map();
    this.binaryLinks = d3.map();
    this.selfLink = null;
    this.sequenceLinks = d3.map();

    this.name = name;

    this.tooltip = this.id;

    // layout info
    this.cx = 40;
    this.cy = 40;

    /*
     * Upper group
     * svg group for elements that appear above links
     */

    this.upperGroup = document.createElementNS(Config.svgns, "g");
    this.upperGroup.setAttribute("class", "upperGroup");
    var points = "0, -10  8.66,5 -8.66,5";
    //make highlight
    this.highlight = document.createElementNS(Config.svgns, "polygon");
    this.highlight.setAttribute("points", points);
    this.highlight.setAttribute("stroke", Config.highlightColour);
    this.highlight.setAttribute("stroke-width", "5");
    this.highlight.setAttribute("fill", "none");
    //attributes that may change
    d3.select(this.highlight).attr("stroke-opacity", 0);
    this.upperGroup.appendChild(this.highlight);

    //svg groups for self links
    this.intraLinksHighlights = document.createElementNS(Config.svgns, "g");
    this.intraLinks = document.createElementNS(Config.svgns, "g");
    this.upperGroup.appendChild(this.intraLinksHighlights);
    this.upperGroup.appendChild(this.intraLinks);

    //create label - we will move this svg element around when protein form changes
    this.labelSVG = document.createElementNS(Config.svgns, "text");
    this.labelSVG.setAttribute("text-anchor", "end");
    this.labelSVG.setAttribute("fill", "black")
    this.labelSVG.setAttribute("x", 0);
    this.labelSVG.setAttribute("y", 10);
    this.labelSVG.setAttribute("class", "xlv_text proteinLabel");
    this.labelSVG.setAttribute('font-family', 'Arial');
    this.labelSVG.setAttribute('font-size', '16');

    this.labelText = this.name;
    this.labelTextNode = document.createTextNode(this.labelText);
    this.labelSVG.appendChild(this.labelTextNode);
    d3.select(this.labelSVG).attr("transform",
        "translate( -" + (25) + " " + Interactor.labelY + ")");
    this.upperGroup.appendChild(this.labelSVG);

    //make symbol
    this.outline = document.createElementNS(Config.svgns, "rect");
    d3.select(this.outline).attr("height", 20)
        .attr("width", 40)
        .attr("x", -20)
        .attr("y", -10)
        .attr("rx", 5)
        .attr("ry", 5)
        .attr("stroke", "black")
        .attr("stroke-width", "4")
        .attr("stroke-opacity", 1)
        .attr("fill-opacity", 1)
        .attr("fill", "#ffffff");
    //append outline
    this.upperGroup.appendChild(this.outline);

    this.upperLine = document.createElementNS(Config.svgns, "rect");
    d3.select(this.upperLine).attr("height", 20)
        .attr("width", 40)
        .attr("x", -20)
        .attr("y", -10)
        .attr("rx", 5)
        .attr("ry", 5)
        .attr("stroke", "white")
        .attr("stroke-width", "2")
        .attr("stroke-opacity", 1)
        .attr("fill-opacity", 0);
    //append outline
    this.upperGroup.appendChild(this.upperLine);

    // events
    var self = this;
    //    this.upperGroup.setAttribute('pointer-events','all');
    this.upperGroup.onmousedown = function(evt) {
        self.mouseDown(evt);
    };
    this.upperGroup.onmouseover = function(evt) {
        self.mouseOver(evt);
    };
    this.upperGroup.onmouseout = function(evt) {
        self.mouseOut(evt);
    };

    this.upperGroup.ontouchstart = function(evt) {
        self.touchStart(evt);
    };
    //~ this.upperGroup.ontouchmove = function(evt) {};
    //~ this.upperGroup.ontouchend = function(evt) {
    //~ self.ctrl.message("protein touch end");
    //~ self.mouseOut(evt);
    //~ };
    //~ this.upperGroup.ontouchenter = function(evt) {
    //~ self.message("protein touch enter");
    //~ self.touchStart(evt);
    //~ };
    //~ this.upperGroup.ontouchleave = function(evt) {
    //~ self.message("protein touch leave");
    //~ self.mouseOut(evt);
    //~ };
    //~ this.upperGroup.ontouchcancel = function(evt) {
    //~ self.message("protein touch cancel");
    //~ self.mouseOut(evt);
    //~ };

};

MoleculeSet.prototype.getBlobRadius = function() {
    return 20;
};

MoleculeSet.prototype.setForm = function(form, svgP) {};

module.exports = MoleculeSet;
