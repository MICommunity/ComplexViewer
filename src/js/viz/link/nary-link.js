import {polygonHull} from "d3-polygon";
import {Link} from "./link";
import {rotatePointAboutPoint} from "../../geom";
import {svgns} from "../../svgns";

export class NaryLink extends Link {
    constructor(id, app, sourceId) {
        super(id, app);
        if (sourceId) {
            this.sourceId = sourceId;
        }
        this.binaryLinks = new Map();
        this.unaryLinks = new Map();
    }

    get path () {
        if (!this._path) {
            this._path = this._createElement("path");
            if (this.app.stoichiometryExpanded) {
                this.color = NaryLink.naryColors(this.sourceId?this.sourceId:this.id);
                this._path.setAttribute("fill", this.color);
            } else {
                this._path.setAttribute("fill", "none");
                this._path.setAttribute("stroke", "black");
            }
            this._path.ontouchstart = evt => this.touchStart(evt);
        }
        return this._path;
    }

    get path2 () {
        if(!this._path2) {
            this._path2 = this._createElement("path");
            this._path2.setAttribute("fill", "none");
            this._path2.ontouchstart = evt => this.touchStart(evt);
        }
        return this._path2;
    }

    // yellow halo following the complex outline, drawn just behind it; shown on
    // hover and while the complex is pressed or dragged
    get haloPath () {
        if (!this._haloPath) {
            const halo = document.createElementNS(svgns, "path");
            halo.classList.add("highlight", "complex-highlight");
            halo.setAttribute("fill", "none");
            halo.setAttribute("stroke", "#ffff99");
            halo.setAttribute("stroke-width", "17"); // white outline is 7px wide; ~5px of yellow shows outside it
            halo.setAttribute("stroke-linejoin", "round");
            halo.setAttribute("stroke-opacity", "0");
            halo.setAttribute("pointer-events", "none");
            this._haloPath = halo;
        }
        return this._haloPath;
    }

    showHighlight (show) {
        this.haloPath.setAttribute("stroke-opacity", show ? "1" : "0");
    }

    mouseOver(evt) {
        super.mouseOver(evt);
        this.showHighlight(true);
        return false;
    }

    mouseOut(evt) {
        super.mouseOut(evt);
        this.showHighlight(this.app.isHighlightPinned(this)); // keep it while the complex is pressed
        return false;
    }

    mouseDown(evt) {
        super.mouseDown(evt);
        this.app.setTouchedParticipant(this);
        return false;
    }

    touchStart(evt) {
        super.touchStart(evt);
        this.app.setTouchedParticipant(this);
        return false;
    }

    check () {
        this.show();
        return true;
    }

    show() {
        // this.path.setAttribute("stroke-width", this.app.z);
        // this.setLinkCoordinates(); // having this here slows down start up. instead see getPosition in complex.js
        this.app.naryLinks.appendChild(this.haloPath);
        this.app.naryLinks.appendChild(this.path);
        this.app.naryLinks.appendChild(this.path2);
    }

    setLinkCoordinates(dontPropogate) {
        // Uses d3.geom.hull to calculate a bounding path around an array of vertices
        const calculateHullPath = values => {
            const hullPath = polygonHull(values);
            this.hull = hullPath;
            return `M${hullPath.join("L")}Z`;
        };
        this.mapped = this.orbitNodes(this.getMappedCoordinates());
        const hullValues = calculateHullPath(this.mapped);
        if (hullValues) {
            this.path.setAttribute("d", hullValues);
            this.path2.setAttribute("d", hullValues);
            this.haloPath.setAttribute("d", hullValues);
        }
        if (this.complex && !dontPropogate) {
            this.complex.setAllLinkCoordinates();
        }
    }

    getMappedCoordinates() {
        const participants = this.participants;
        let mapped = [];
        const ic = participants.length;
        for (let i = 0; i < ic; i++) {
            const participant = participants[i];
            if (participant.type === "complex") {
                //use some kind of caching?
                mapped = mapped.concat(this.orbitNodes(participant.naryLink.getMappedCoordinates(), 20));
            } else if (participant.expanded) {
                const start = participant.getResidueCoordinates(0);
                const end = participant.getResidueCoordinates(participant.size);
                if (!isNaN(start[0]) && !isNaN(start[1]) &&
                    !isNaN(end[0]) && !isNaN(end[1])) {
                    mapped.push(start);
                    mapped.push(end);
                } else {
                    mapped.push(participant.getPosition());
                }
            } else {
                mapped.push(participant.getPosition());
            }
        }
        return mapped;
    }

    //'orbit' nodes - several nodes around participant positions to give margin
    orbitNodes(mapped, orbitNodeCount = 20) { // add orbit node count as param? cut it down for subcomplexes?
        const orbitNodes = [];
        const mc = mapped.length;
        for (let mi = 0; mi < mc; mi++) {
            const m = mapped[mi];
            for (let o = 0; o < orbitNodeCount; o++) {
                const angle = (360 / orbitNodeCount) * o;
                const p = [m[0] + NaryLink.orbitRadius, m[1]];
                orbitNodes.push(rotatePointAboutPoint(p, m, angle));
            }
        }
        return orbitNodes;
    }
}

NaryLink.orbitRadius = 28;