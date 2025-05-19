import {svgns} from "../../svgns";

export class Interactor {
    constructor() {
    }

    get width() {
        // todo - things not working quite right in firefox, work around...
        // console.log(this.upperGroup.getBBox().width);
        // const bbox = this.upperGroup.getBBox(); //firefox buggy?
        // return bbox.width;
        if (!this.expanded) {
            return (2 * this.getSymbolRadius()) + 15 + this.labelSVG.getComputedTextLength();
        } else {
            return (this.size * this.stickZoom) + 45 + this.labelSVG.getComputedTextLength();
        }
    }

    get height() {
        return 40;//this.upperGroup.getBBox().height;
    }

    get labelY() {
        return -5;
    }

    init(id, app, json, name) {
        this.id = id;
        this.app = app;
        this.json = json;
        this.name = name;

        // this.type = json.type.name;

        this.expanded = false;
        this.postAnimExpanded = false; // bit of a hack, used for updating listeners before anim complete, todo - is there better way

        //todo - think 'type' should be  a property here (except for complex, can just return json.type.name)

        //annotations indexed by annotation set name ("MI Features", "Superfamily", etc)
        this.annotationSets = new Map();
        //links
        this.naryLinks = new Map();
        this.binaryLinks = new Map();
        this.sequenceLinks = new Map();
    }

    initLabel() {
        this.labelSVG = document.createElementNS(svgns, "text");
        this.labelSVG.setAttribute("x", "0"); // css?
        this.labelSVG.setAttribute("y", "10");
        this.labelSVG.classList.add("label");
        //choose label text
        if (this.name) {
            this.labelText = this.name;
        } else {
            this.labelText = this.id;
        }
        if (this.labelText.length > 25) {
            this.labelText = `${this.labelText.substring(0, 16)}...`;
        }
        this.labelText = this.name;
        this.labelTextNode = document.createTextNode(this.labelText);
        this.labelSVG.appendChild(this.labelTextNode);
        this.labelSVG.setAttribute("transform",
            `translate( -${this.getSymbolRadius()} ${this.labelY})`);
        this.upperGroup.appendChild(this.labelSVG);
    }

    initOutline() {
        this.outline.classList.add("outline");
        this.upperGroup.appendChild(this.outline);
    }

    initListeners() {
        this.upperGroup.onmousedown = evt => this.mouseDown(evt);
        this.upperGroup.onmouseenter = evt => this.mouseOver(evt);
        this.upperGroup.onmouseleave = evt => this.mouseOut(evt);
        this.upperGroup.ontouchstart = evt => this.touchStart(evt);
    }

    addStoichiometryLabel(stoichiometry) {
        if (this.labelSVG) { //complexes don't have labels (yet?)
            // noinspection JSUndefinedPropertyAssignment
            this.labelSVG.childNodes[0].data = `${this.labelSVG.childNodes[0].data} [${stoichiometry}]`;
        }
    }

    mouseDown(evt) {
        this.app.preventDefaultsAndStopPropagation(evt);
        this.app.d3cola.stop();
        this.app.dragElement = this;
        this.app.dragStart = evt;
        return false;
    }

    touchStart(evt) {
        this.app.preventDefaultsAndStopPropagation(evt);
        this.app.d3cola.stop();
        this.app.dragElement = this;
        this.app.dragStart = evt;
        return false;
    }

    mouseOver(evt) {
        this.app.preventDefaultsAndStopPropagation(evt);
        this.showHighlight(true);
        this.app.notifyHoverListeners([this.json]);
        return false;
    }

    mouseOut(evt) {
        this.app.preventDefaultsAndStopPropagation(evt);
        this.showHighlight(false);
        this.app.hideTooltip();
        this.app.notifyHoverListeners([]);
        return false;
    }

    getSymbolRadius() {
        return 15;
    }

    showHighlight() {
    }

    getPosition() {
        return [this.ix, this.iy]; // todo - type of return is kind of inconsistent
    }

    /* leave this.x and this.y as they were set by cola (notice lack of parameters to function),
    calculate centre of interactor's glyph (i.e. centre of symbol excluding label),
    call setPosition with those
*/
    setPositionFromCola() {
        //remember previous position
        this.px = this.x;
        this.py = this.y;
        let xOffset = (this.width / 2 - (this.getSymbolRadius()));
        /*
        // let xOffset = (15 + this.labelSVG.getComputedTextLength()) / 2;
        // would also work because
        // width = (2 * this.getSymbolRadius()) + 15 + this.labelSVG.getComputedTextLength();
        */
        if (this.expanded) {
            xOffset = xOffset - (this.size / 2 * this.stickZoom);
        }

        this.setPosition(this.x + xOffset, this.y);
    }

    setPosition(x, y) {
        this.ix = x;
        this.iy = y;
        this.upperGroup.setAttribute("transform", `translate(${this.ix} ${this.iy})`);
    }

    changePosition(x, y) {
        // this.px = this.ix; //no need to remember previous position (?)
        // this.py = this.iy;
        this.ix -= x;
        this.iy -= y;
        this.upperGroup.setAttribute("transform", `translate(${this.ix} ${this.iy})`);
        // this.setAllLinkCoordinates(); // todo - look at calls
    }

    getAggregateSelfLinkPath() {
        const intraR = this.getSymbolRadius() + 7;
        const sectorSize = 45;
        const arcStart = trig(intraR, 25 + sectorSize);
        const arcEnd = trig(intraR, -25 + sectorSize);
        const cp1 = trig(intraR, 40 + sectorSize);
        const cp2 = trig(intraR, -40 + sectorSize);
        return "M 0,0 " +
            `Q ${cp1.x},${-cp1.y} ${arcStart.x},${-arcStart.y} ` +
            `A ${intraR} ${intraR} 0 0 1 ${arcEnd.x},${-arcEnd.y} ` +
            `Q ${cp2.x},${-cp2.y} 0,0`;
    }

    checkLinks() {
        function checkAll(linkMap) {
            for (let link of linkMap.values()) {
                link.check();
            }
        }

        // checkAll(this.naryLinks); // hacked out to fix ordering of nLinks
        checkAll(this.binaryLinks);
        checkAll(this.sequenceLinks);
        if (this.selfLink) {
            this.selfLink.check();
        }
    }

// update all lines (e.g after a move)
    setAllLinkCoordinates() {
        for (let link of this.naryLinks.values()) {
            link.setLinkCoordinates();
            if (link.complex){
                link.complex.setLabelPosition();
            }
        }
        for (let link of this.binaryLinks.values()) {
            link.setLinkCoordinates();
        }
        if (this.selfLink) {
            this.selfLink.setLinkCoordinates();
        }
        for (let link of this.sequenceLinks.values()) {
            link.setLinkCoordinates();
        }
    }
}

export function trig(radius, angleDegrees) {
    //x = rx + radius * cos(theta) and y = ry + radius * sin(theta)
    const radians = (angleDegrees / 360) * Math.PI * 2;
    return {
        x: (radius * Math.cos(radians)),
        y: (radius * Math.sin(radians))
    };
}
