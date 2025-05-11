import {HideableLink} from "./hideable-link";

export class UnaryLink extends HideableLink {
    constructor(id, app, participant) {
        super(id, app);
        this.participants = [participant];
        participant.selfLink = this;
    }

    get line() {
        if (!this._line) {
            this._line = this._createElement("path", ["link", "link-line"]);
        }
        return this._line;
    }

    get highlightLine() {
        if (!this._highlightLine) {
            this._highlightLine = this._createElement("path", ["link", "highlight", "link-highlight"]);
        }
        return this._highlightLine;
    }

    initSelfLinkSVG() {
        const path = this.participants[0].getAggregateSelfLinkPath();
        this.line.setAttribute("d", path);
        this.highlightLine.setAttribute("d", path);
    }

    check() {
        if (!this.participants[0].expanded) {
            this.show();
            return true;
        } else {
            this.hide();
            return false;
        }
    }

    show() {
        this.initSelfLinkSVG();
        this.line.setAttribute(
            "transform",
            `translate(${this.participants[0].ix} ${this.participants[0].iy}) scale(${this.app.z})`
        );
        this.highlightLine.setAttribute(
            "transform",
            `translate(${this.participants[0].ix} ${this.participants[0].iy}) scale(${this.app.z})`
        );
        this.app.highlights.appendChild(this.highlightLine);
        this.app.p_pLinks.appendChild(this.line);
    }

    setLinkCoordinates() {
        const participant = this.participants[0];
        this.line.setAttribute(
            "transform",
            `translate(${participant.ix} ${participant.iy}) scale(${this.app.z})`
        );
        this.highlightLine.setAttribute(
            "transform",
            `translate(${participant.ix} ${participant.iy}) scale(${this.app.z})`
        );
    }
}
