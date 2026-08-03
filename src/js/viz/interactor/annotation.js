export class Annotation {
    constructor(category, seqDatum, description = null) {
        this.category = category ? String(category).trim() : "";
        this.seqDatum = seqDatum;
        this.description = description;

        this.certain = null; // SVG Path set by Polymer.updatePositionalFeatures
        this.fuzzyStart = null; // SVG Path set by Polymer.updatePositionalFeatures
        this.fuzzyEnd = null; // SVG Path set by Polymer.updatePositionalFeatures
    }

    toString() {
        const seqStr = this.seqDatum ? this.seqDatum.toString() : "N/A";
        const descStr = this.description ? `: ${this.description}` : "";

        return `${this.category}${descStr} [${seqStr}]`;
    }
}
