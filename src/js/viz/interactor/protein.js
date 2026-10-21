import {Polymer} from "./polymer";
import {Annotation} from "./annotation";
import {SequenceDatum} from "../sequence-datum";
import {svgns} from "../../svgns";

export class Protein extends Polymer {
    constructor(id, /*App*/ app, json, name, sequence) {
        super();
        this.init(id, app, json, name);
        this.type = "protein"; // this isn't absolutely necessary, could do without it

        this.upperGroup = document.createElementNS(svgns, "g");
        this.rotation = 0;
        this.stickZoom = 1;
        // this.expanded = false; //done by init()
        //make highlight
        this.highlight = document.createElementNS(svgns, "rect");
        this.highlight.classList.add("highlight", "participant-highlight");
        // explicit styles so the exported SVG matches the screen (page CSS is not exported)
        this.highlight.setAttribute("fill", "none");
        this.highlight.setAttribute("stroke", "#ffff99");
        this.highlight.setAttribute("stroke-width", "5");
        this.upperGroup.appendChild(this.highlight);

        //make background
        //http://stackoverflow.com/questions/17437408/how-do-i-change-a-circle-to-a-square-using-d3
        this.background = document.createElementNS(svgns, "rect");
        this.background.setAttribute("fill", "#FFFFFF");
        this.background.setAttribute("stroke", "none");
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

        // this.annotationsSvgGroup.setAttribute("transform", "scale(1, 1)");

        this.highlight.setAttribute("width", (r * 2) + 5);
        this.highlight.setAttribute("height", (r * 2) + 5);
        this.highlight.setAttribute("x", -r - 2.5);
        this.highlight.setAttribute("y", -r - 2.5);
        this.highlight.setAttribute("rx", r + 2.5);
        this.highlight.setAttribute("ry", r + 2.5);
        this.highlight.setAttribute("stroke-opacity", "0");

        this.labelSVG.setAttribute("transform", `translate(${-(r + 5)},-5)`);

        this.initListeners();

        Object.defineProperty(this, "height", {
            get: () => this.expanded ? 120 : 40
        });

        this.showHighlight(false);

        //sequence = amino acids in UPPERCASE, digits or lowercase can be used for modification info
        if (!sequence) {
            sequence = "SEQUENCEMISSING";
        }
        this.sequence = sequence.replace(/[^A-Z]/g, "");//remove modification site info from sequence
        this.size = this.sequence.length;

        //annotations indexed by annotation set name ("MI Features", "Superfamily", etc)
        //this.annotationSets // = new Map(); is declared in Interactor, other types of interactor can have features from MIJSON

        this.annotationSets.set("Interactor", [new Annotation(this.json.label, new SequenceDatum(null, `1-${this.size}`))]);

    }
}

/*
Protein.prototype.showData = function(evt) {
    const url = "http://www.uniprot.org/uniprot/" + this.json.identifier.id;
    window.open(url, '_blank');
}
*/