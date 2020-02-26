//    xiNET interaction viewer
//    Copyright 2013 Rappsilber Laboratory
//
//    This product includes software developed at
//    the Rappsilber Laboratory (http://www.rappsilberlab.org/).

"use strict";

var Link = require('./Link');
var SequenceFeature = require('../SequenceFeature');
//~ var BinaryLink = require('./BinaryLink');
//~ var UnaryLink = require('./UnaryLink');
var Config = require('../../controller/Config');

//todo: rename to SequenceFeatureLink
SequenceLink.prototype = new Link();

function SequenceLink(id, fromFeatPos, toFeatPos, xlvController) {
    this.id = id;
    this.controller = xlvController;
    this.fromSequenceData = fromFeatPos;
    this.toSequenceData = toFeatPos;
    this.interactors = [this.fromSequenceData[0].node, this.toSequenceData[0].node]; //*
    // *potentially, this over simplifies the situation,
    // but there is a workaround in way ReadMiJson init's links so OK for now

}

SequenceLink.prototype.getToolTip = function() {
    var tooltip = "";
    tooltip += this.interactors[0].labelText + " ";
    for (var i = 0; i < this.fromSequenceData.length; i++) {
        if (i > 0) tooltip += ",";
        tooltip += this.fromSequenceData[i].toString();
    }
    tooltip += " to ";
    tooltip += this.interactors[1].labelText + " ";
    for (var j = 0; j < this.toSequenceData.length; j++) {
        if (j > 0) tooltip += ",";
        tooltip += this.toSequenceData[j].toString();
    }
    return tooltip;
}

SequenceLink.prototype.initSVG = function() {
    if (typeof this.glyph === 'undefined') {
        this.glyph = document.createElementNS(Config.svgns, "path");
        this.uncertainGlyph = document.createElementNS(Config.svgns, "path");
        this.highlightGlyph = document.createElementNS(Config.svgns, "path");
        this.glyph.setAttribute("stroke-linecap", "round");
        this.uncertainGlyph.setAttribute("stroke-linecap", "round");
        this.highlightGlyph.setAttribute("stroke-linecap", "round");
        this.glyph.setAttribute("class", "link");
        this.glyph.setAttribute("fill", "black");//"#E08214");
        this.glyph.setAttribute("opacity", "0.6");
        this.glyph.setAttribute("stroke", "black");//""#A08214");// // TODO: will look better with this line partly removed
        this.glyph.setAttribute("stroke-opacity", "0.6");
        this.glyph.setAttribute("stroke-width", "1");
        this.uncertainGlyph.setAttribute("class", "link");
        this.uncertainGlyph.setAttribute("fill", "black");//url('#checkers_uncertain')");//"#A01284");
        this.uncertainGlyph.setAttribute("stroke", "black");//"none");//"#A01284");
        this.uncertainGlyph.setAttribute("stroke-opacity", "0.2");
        this.uncertainGlyph.setAttribute("fill-opacity", "0.2");
        this.highlightGlyph.setAttribute("class", "link");
        this.highlightGlyph.setAttribute("fill", "none");
        this.highlightGlyph.setAttribute("stroke", Config.highlightColour);
        this.highlightGlyph.setAttribute("stroke-width", "10");
        this.highlightGlyph.setAttribute("stroke-opacity", "0");
        if (typeof this.colour !== 'undefined') {
            this.glyph.setAttribute("fill", this.colour.toString());
        }

        //set the events for it
        var self = this;
        this.uncertainGlyph.onmousedown = function(evt) {
            self.mouseDown(evt);
        };
        this.uncertainGlyph.onmouseover = function(evt) {
            self.mouseOver(evt);
        };
        this.uncertainGlyph.onmouseout = function(evt) {
            self.mouseOut(evt);
        };
        this.glyph.onmousedown = function(evt) {
            self.mouseDown(evt);
        };
        this.glyph.onmouseover = function(evt) {
            self.mouseOver(evt);
        };
        this.glyph.onmouseout = function(evt) {
            self.mouseOut(evt);
        };
        this.highlightGlyph.onmousedown = function(evt) {
            self.mouseDown(evt);
        };
        this.highlightGlyph.onmouseover = function(evt) {
            self.mouseOver(evt);
        };
        this.highlightGlyph.onmouseout = function(evt) {
            self.mouseOut(evt);
        };
    }
};

//andAlternatives means highlight alternative links in case of site ambiguity
SequenceLink.prototype.showHighlight = function(show) {
    if (show) {
        this.highlightGlyph.setAttribute("stroke-opacity", "1");
    } else {
        this.highlightGlyph.setAttribute("stroke-opacity", "0");
    }
};

//used when filter changed
SequenceLink.prototype.check = function() {
    if (this.filteredEvidence().length > 0 && this.anyInteractorIsBar() === true) {
        this.show();
        return true;
    } else {
        this.hide();
        return false;
    }
};

SequenceLink.prototype.anyInteractorIsBar = function() {
    var ic = this.interactors.length;
    for (var i = 0; i < ic; i++) {
        if (this.interactors[i].form === 1) {
            return true;
        }
    }
    return false;
};

SequenceLink.prototype.show = function() {
    if (!this.glyph) {
        this.initSVG();
    }
    //this.glyph.setAttribute("stroke-width", this.controller.z * xiNET.linkWidth);
    this.uncertainGlyph.setAttribute("stroke-width", this.controller.z * xiNET.linkWidth);
    this.highlightGlyph.setAttribute("stroke-width", this.controller.z * 10);
    this.setLinkCoordinates();
    var containingGroup = this.controller.res_resLinks;
    if (this.interactors[0] === this.interactors[1]) {
        containingGroup = this.controller.selfRes_resLinks;
    }
    containingGroup.appendChild(this.highlightGlyph);
    containingGroup.appendChild(this.glyph);
    containingGroup.appendChild(this.uncertainGlyph);
};

SequenceLink.prototype.hide = function() {
    // TODO: this looks wierd
    var containingGroup = this.controller.res_resLinks;
    if (this.interactors[0] === this.interactors[1]) {
        containingGroup = this.controller.selfRes_resLinks;
    }

    var groupChildren = []

    for (var i = 0; i < containingGroup.childNodes.length; i++) {
        groupChildren[i] = containingGroup.childNodes[i];
    }

    if (groupChildren.indexOf(this.glyph) > -1) {
        containingGroup.removeChild(this.glyph);
        containingGroup.removeChild(this.uncertainGlyph);
        containingGroup.removeChild(this.highlightGlyph);
    }
};

// update the links(polygons/lines) to fit to the protein
SequenceLink.prototype.setLinkCoordinates = function(interactor) {
    function isNumber(thing) {
        return (!isNaN(parseFloat(thing)) && isFinite(thing));
    }

    function getPathSegments(midPoint, controlPoint, startRes, endRes, interactor, yOffset) {
        var startPoint, endPoint;
        if (!interactor.form) { // tests if form = undefined or 0 //TODO: maybe change this, its confusing
            startPoint = interactor.getPosition();
            endPoint = startPoint;
        } else {
            startPoint = interactor.getResidueCoordinates(startRes, yOffset);
            endPoint = interactor.getResidueCoordinates(endRes, yOffset);

        }
        return ' Q' + controlPoint[0] + ',' + controlPoint[1] + ' ' + startPoint[0] + ',' + startPoint[1] +
            ' L' + endPoint[0] + ',' + endPoint[1] +
            ' Q' + controlPoint[0] + ',' + controlPoint[1] + ' ' + midPoint[0] + ',' + midPoint[1];
    }

    function sequenceDataMidPoint(sequenceData, interactor) {
        //get the smallest start and the biggest end
        var lowestLinkedRes = null,
            highestLinkedRes = null;
        var sdCount = sequenceData.length;
        for (var s = 0; s < sdCount; s++) {
            var seqDatum = sequenceData[s];
            if (!isNaN(parseFloat(seqDatum.begin)) && isFinite(seqDatum.begin)) {
                var start = seqDatum.begin * 1;
                if (lowestLinkedRes === null || start < lowestLinkedRes) {
                    lowestLinkedRes = start;
                }
            }
            if (!isNaN(parseFloat(seqDatum.uncertainBegin)) && isFinite(seqDatum.uncertainBegin)) {
                var uncertainBegin = seqDatum.uncertainBegin * 1;
                if (lowestLinkedRes === null || uncertainBegin < lowestLinkedRes) {
                    lowestLinkedRes = uncertainBegin;
                }
            }
            if (!isNaN(parseFloat(seqDatum.end)) && isFinite(seqDatum.end)) {
                var end = seqDatum.end * 1;
                if (highestLinkedRes === null || end > highestLinkedRes) {
                    highestLinkedRes = end;
                }
            }
            if (!isNaN(parseFloat(seqDatum.uncertainEnd)) && isFinite(seqDatum.uncertainEnd)) {
                var uncertainEnd = seqDatum.uncertainEnd * 1;
                if (highestLinkedRes === null || uncertainEnd > highestLinkedRes) {
                    highestLinkedRes = uncertainEnd;
                }
            }
        }
        return interactor.getResidueCoordinates((lowestLinkedRes + highestLinkedRes) / 2, 0);
    }
    var fromInteractor = this.fromSequenceData[0].node;
    var toInteractor = this.toSequenceData[0].node;
    //calculate mid points of from and to sequence data
    var fMid, tMid;
    if (!fromInteractor.form) { // if not (undefined or 0)
        fMid = fromInteractor.getPosition();
    } else {
        fMid = sequenceDataMidPoint(this.fromSequenceData, fromInteractor);
    }
    if (!toInteractor.form) {// if not (undefined or 0)
        tMid = toInteractor.getPosition();
    } else {
        tMid = sequenceDataMidPoint(this.toSequenceData, toInteractor);
    }

    //calculate angle from fromInteractor mid point to toInteractor mid point
    var deltaX = fMid[0] - tMid[0];
    var deltaY = fMid[1] - tMid[1];
    var angleBetweenMidPoints = Math.atan2(deltaY, deltaX);
    //todo: tidy up trig code so eveything is always in radian
    var abmpDeg = angleBetweenMidPoints / (2 * Math.PI) * 360;
    if (abmpDeg < 0) {
        abmpDeg += 360;
    }

    //out is value we use to decide which side of bar the link glyph is drawn
    //first for 'from' interactor
    var out = (abmpDeg - fromInteractor.rotation);
    if (out < 0) {
        out += 360;
    }
    var fyOffset = 10;
    if (out < 180) {
        fyOffset = -10;
    }
    var fRotRad = (fromInteractor.rotation / 360) * Math.PI * 2;
    if (out > 180) {
        fRotRad = fRotRad - Math.PI;
    }
    //now for 'to' interactor
    out = (abmpDeg - toInteractor.rotation);
    if (out < 0) {
        out += 360;
    }
    var tyOffset = 10;
    if (out > 180) {
        tyOffset = -10;
    }
    var tRotRad = (toInteractor.rotation / 360) * Math.PI * 2;
    if (out < 180) {
        tRotRad = tRotRad - Math.PI;
    }

    var ftMid = [fMid[0] + (30 * Math.sin(fRotRad) * this.controller.z),
        fMid[1] - (30 * Math.cos(fRotRad) * this.controller.z)
    ];
    if (!fromInteractor.form) { // if not (undefined or 0)
        ftMid = fMid;
    }

    var ttMid = [tMid[0] + (30 * Math.sin(tRotRad) * this.controller.z),
        tMid[1] - (30 * Math.cos(tRotRad) * this.controller.z)
    ];
    if (!toInteractor.form) { // if not (undefined or 0)
        ttMid = tMid;
    }

    var triPointMid = [(ftMid[0] + ttMid[0]) / 2, (ftMid[1] + ttMid[1]) / 2];
    var fSDCount = this.fromSequenceData.length;
    var tSDCount = this.toSequenceData.length;
    var seqDatum, highlightStartRes, highlightEndRes;
    var glyphPath = 'M' + triPointMid[0] + ',' + triPointMid[1];
    var uncertainGlyphPath = 'M' + triPointMid[0] + ',' + triPointMid[1];
    var highlightGlyphPath = 'M' + triPointMid[0] + ',' + triPointMid[1];
    for (var f = 0; f < fSDCount; f++) {
        seqDatum = this.fromSequenceData[f];
        glyphPath += getPathSegments(triPointMid, ftMid, seqDatum.begin, seqDatum.end, fromInteractor, fyOffset);
        highlightStartRes = seqDatum.begin;
        highlightEndRes = seqDatum.end;
        if (isNumber(seqDatum.uncertainBegin)) {
            uncertainGlyphPath += getPathSegments(triPointMid, ftMid,
                seqDatum.uncertainBegin, seqDatum.begin, fromInteractor, fyOffset);
            highlightStartRes = seqDatum.uncertainBegin;
        }
        if (isNumber(seqDatum.uncertainEnd)) {
            uncertainGlyphPath += getPathSegments(triPointMid, ftMid,
                seqDatum.end, seqDatum.uncertainEnd, fromInteractor, fyOffset);
            highlightEndRes = seqDatum.uncertainEnd;
        }
        highlightGlyphPath += getPathSegments(triPointMid, ftMid,
            highlightStartRes, highlightEndRes, fromInteractor, fyOffset);
    }
    for (var t = 0; t < tSDCount; t++) {
        seqDatum = this.toSequenceData[t];
        glyphPath += getPathSegments(triPointMid, ttMid, seqDatum.begin, seqDatum.end, toInteractor, tyOffset);
        highlightStartRes = seqDatum.begin;
        highlightEndRes = seqDatum.end;
        if (isNumber(seqDatum.uncertainBegin)) {
            uncertainGlyphPath += getPathSegments(triPointMid, ttMid,
                seqDatum.uncertainBegin, seqDatum.begin, toInteractor, tyOffset);
            highlightStartRes = seqDatum.uncertainBegin;
        }
        if (isNumber(seqDatum.uncertainEnd)) {
            uncertainGlyphPath += getPathSegments(triPointMid, ttMid,
                seqDatum.end, seqDatum.uncertainEnd, toInteractor, tyOffset);
            highlightEndRes = seqDatum.uncertainEnd;
        }
        highlightGlyphPath += getPathSegments(triPointMid, ttMid,
            highlightStartRes, highlightEndRes, toInteractor, tyOffset);
    }

    if (!this.glyph) {
        this.initSVG();
    }

    this.glyph.setAttribute("d", glyphPath);
    this.uncertainGlyph.setAttribute("d", uncertainGlyphPath);
    this.highlightGlyph.setAttribute("d", highlightGlyphPath);
};

module.exports = SequenceLink;
