import * as d3 from "d3";
import {Annotation} from "./viz/interactor/annotation";
import {SequenceDatum} from "./viz/sequence-datum";


//todo - cache annotations in memory
export function fetchAnnotations(/*App*/ app, callback) {
    // we only show annotations on proteins
    const proteins = Array.from(app.participants.values()).filter(function (value) {
        return value.type === "protein";
    });

    let protsAnnotated = 0;
    const molCount = proteins.length;

    for (let prot of proteins) {
        protsAnnotated++;
        const uniprotAccRegex = new RegExp("[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}![-]", "i");
        const match = uniprotAccRegex.exec(prot.json.identifier.id);
        if (match && match[0] === prot.json.identifier.id.trim()) {
            getSuperFamFeatures(prot, () => {
                if (protsAnnotated === molCount) callback();
            });
            getUniProtFeatures(prot, () => {
                if (protsAnnotated === molCount) callback();
            });
        }
    }
}

function getUniProtFeatures(prot, callback) {
    const url = `https://www.ebi.ac.uk/proteins/api/proteins/${prot.json.identifier.id.trim()}`;
    d3.json(url).then(json => {
        let annotations = prot.annotationSets.get("UniprotKB");
        if (typeof annotations === "undefined") {
            annotations = [];
            prot.annotationSets.set("UniprotKB", annotations);
        }
        if (json) {
            for (let feature of json.features.filter(ft => ft.type === "DOMAIN")) {
                const anno = new Annotation(feature.description, new SequenceDatum(null, `${feature.begin}-${feature.end}`));
                annotations.push(anno);
            }
        }
        callback();
    });
}


function getSuperFamFeatures(prot, callback) {
    const url = `https://supfam.org/SUPERFAMILY/cgi-bin/das/up/features?segment=${prot.json.identifier.id.trim()}`;
    d3.xml(url).then(xml => {
        let annotations = prot.annotationSets.get("Superfamily");
        if (typeof annotations === "undefined") {
            annotations = [];
            prot.annotationSets.set("Superfamily", annotations);
        }
        if (xml) {
            const xmlFeatures = xml.getElementsByTagName("FEATURE");
            for (let xmlFeature of xmlFeatures) {
                const type = xmlFeature.getElementsByTagName("TYPE")[0]; //might need to watch for text nodes getting mixed in here
                const category = type.getAttribute("category");
                if (category === "miscellaneous") {
                    const name = decodeHTML(type.getAttribute("id"));
                    const start = xmlFeature.getElementsByTagName("START")[0].textContent;
                    const end = xmlFeature.getElementsByTagName("END")[0].textContent;
                    annotations.push(new Annotation(name, new SequenceDatum(null, `${start}-${end}`)));
                }
            }
        }
        callback();
    });
}


function decodeHTML(text) {
    return text.replace(/&([^;]+);/gm, (match, entity) => entities[entity] || match);
}

const entities = {
    "amp": "&",
    "apos": "'",
    "#x27": "'",
    "#x2F": "/",
    "#39": "'",
    "#47": "/",
    "lt": "<",
    "gt": ">",
    "nbsp": " ",
    "quot": "\""
};
