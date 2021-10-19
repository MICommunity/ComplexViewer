import {Interactor} from "./interactor";
import {svgns} from "../../svgns";

export class BioactiveEntity extends Interactor{
    constructor(id, app, json, name) {
        super();
        this.init(id, app, json, name);
        this.upperGroup = document.createElementNS(svgns, "g");
        this.initLabel();
        const points = "0, -10  8.66,5 -8.66,5";
        this.outline = document.createElementNS(svgns, "polygon");
        this.outline.setAttribute("points", points);
        this.initOutline();
        this.initListeners();
    }
}

/*
BioactiveEntity.prototype.showData = function() {
    const url = "https://www.ebi.ac.uk/chebi/searchId.do;?chebiId=" + this.json.identifier.id;
    window.open(url, '_blank');
}
*/
