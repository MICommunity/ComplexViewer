import {polygonHull} from "d3-polygon";
import {Link} from "./link";
import {rotatePointAboutPoint} from "../../geom";

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
            this._path.ontouchstart = evt => self.touchStart(evt);
        }
        return this._path;
    }

    get path2 () {
        if(!this._path2) {
            this._path2 = this._createElement("path");
            this._path2.setAttribute("fill", "none");
            this._path2.ontouchstart = evt => self.touchStart(evt);
        }
        return this._path2;
    }

    showHighlight (show) {
        this.highlightParticipants(show);
    }

    check () {
        this.show();
        return true;
    }

    show() {
        // this.path.setAttribute("stroke-width", this.app.z);
        // this.setLinkCoordinates(); // having this here slows down start up. instead see getPosition in complex.js
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
