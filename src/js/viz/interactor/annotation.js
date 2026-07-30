export class Annotation {
    constructor(category, seqDatum, description = null) {
        this.category = category.trim();
        this.seqDatum = seqDatum;
        this.description = description;
    }

    toString() {
        return `${this.category} ${this.description ? ": " + this.description : ""} [${this.seqDatum ? this.seqDatum.toString() : `${this.seqDatum.begin} - ${this.seqDatum.end}`}]`;
    }
}
