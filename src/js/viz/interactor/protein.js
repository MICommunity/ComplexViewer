import {Polymer} from "./polymer";
import {svgns} from "../../config";

export function Protein(id, /*App*/ app, json, name) {
    this.init(id, app, json, name);
    this.type = "protein"; // this isn't absolutely necessary, could do without it

    this.upperGroup = document.createElementNS(svgns, "g");
    this.rotation = 0;
    this.stickZoom = 1;
    this.form = 0; // 0 = blob, 1 = stick

    //make highlight
    this.highlight = document.createElementNS(svgns, "rect");
    this.highlight.classList.add("highlight", "participant-highlight");
    this.upperGroup.appendChild(this.highlight);

    //make background
    //http://stackoverflow.com/questions/17437408/how-do-i-change-a-circle-to-a-square-using-d3
    this.background = document.createElementNS(svgns, "rect");
    this.background.setAttribute("fill", "#FFFFFF");
    this.upperGroup.appendChild(this.background);
    //create label - we will move this svg element around when protein form changes
    this.initLabel();
    //ticks (and amino acid letters)
    this.ticks = document.createElementNS(svgns, "g");
    //svg group for annotations
    this.annotationsSvgGroup = document.createElementNS(svgns, "g");
    this.annotationsSvgGroup.setAttribute("opacity", "1");
    this.upperGroup.appendChild(this.annotationsSvgGroup);

    //make outline
    this.outline = document.createElementNS(svgns, "rect");
    // css...
    this.outline.setAttribute("stroke", "black");
    this.outline.setAttribute("stroke-width", "1");
    this.outline.setAttribute("fill", "none");
    this.upperGroup.appendChild(this.outline);

    this.scaleLabels = [];

    //since form is set to 0, make this a circle, this stuff is equivalent to
    // end result of toCircle but without transition
    const r = this.getSymbolRadius();

    this.outline.setAttribute("x", -r);
    this.outline.setAttribute("y", -r);
    this.outline.setAttribute("width", r * 2);
    this.outline.setAttribute("height", r * 2);
    this.outline.setAttribute("rx", r);
    this.outline.setAttribute("ry", r);

    this.background.setAttribute("x", -r);
    this.background.setAttribute("y", -r);
    this.background.setAttribute("width", r * 2);
    this.background.setAttribute("height", r * 2);
    this.background.setAttribute("rx", r);
    this.background.setAttribute("ry", r);

    this.annotationsSvgGroup.setAttribute("transform", "scale(1, 1)");

    this.highlight.setAttribute("width", (r * 2) + 5);
    this.highlight.setAttribute("height", (r * 2) + 5);
    this.highlight.setAttribute("x", -r - 2.5);
    this.highlight.setAttribute("y", -r - 2.5);
    this.highlight.setAttribute("rx", r + 2.5);
    this.highlight.setAttribute("ry", r + 2.5);
    this.highlight.setAttribute("stroke-opacity", "0");

    this.labelSVG.setAttribute("transform", "translate(" + (-(r + 5)) + "," + "-5)");

    this.initListeners();

    const self = this;
    Object.defineProperty(this, "height", {
        get: function height() {
            return self.form == 1? 120:40;
            //return 160;
        }
    });

    this.showHighlight(false);
}

Protein.prototype = new Polymer();

/*
Protein.prototype.showData = function(evt) {
    const url = "http://www.uniprot.org/uniprot/" + this.json.identifier.id;
    window.open(url, '_blank');
}
*/
