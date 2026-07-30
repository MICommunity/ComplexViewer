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
            getDisProtFeatures(prot, () => {
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

//const DISPROT_TYPE_TO_NAME = new Map([
//    ['D', 'Disorder'],
//    ['T', 'Transition'],
//    ['F', 'Function']
//]);

//function getDisProtFeatures(prot, callback) {
//    const url = `https://disprot.org/api/search?page_size=1&page=0&release=current&show_ambiguous=false&show_obsolete=false&acc=${prot.json.identifier.id.trim()}`;
//    d3.json(url).then(json => {
//        let annotations = prot.annotationSets.get("DisProt");
//        if (typeof annotations === "undefined") {
//            annotations = [];
//            prot.annotationSets.set("DisProt", annotations);
//        }
//        if (json) {
//            for (let feature of (json.data[0]?.['disprot_consensus']?.['Biological process'] || [])) {
//                const anno = new Annotation(DISPROT_TYPE_TO_NAME.get(feature.type), new SequenceDatum(null, `${feature.start}-${feature.end}`));
//                annotations.push(anno);
//            }
//        }
//        callback();
//    });
//}

function getDisProtFeatures(prot, callback) {
    const url = `https://disprot.org/api/search?page_size=1&page=0&release=current&show_ambiguous=false&show_obsolete=false&acc=${prot.json.identifier.id.trim()}`;

    d3.json(url).then(json => {
        let annotations = prot.annotationSets.get("DisProt");
        if (typeof annotations === "undefined") {
            annotations = [];
            prot.annotationSets.set("DisProt", annotations);
        }

        const data = json?.data?.[0];
        const consensus = data?.['disprot_consensus'];

        const regionNameMap = new Map(
            (data?.['regions'] || [])
                .map(region => [`${region.term_namespace}:${region.start}-${region.end}`, region.term_name])
        );

        const namespaceToRegions = {
            // Branch 1: Structural state
            'Structural state': [],

            // Branch 2: Structural transition
            'Structural transition': [],

            // Branch 3: Disorder function (we group all functions here)
            'Disorder function': [],
            'Biological process': [],
            'Molecular function': [],
            'Cellular component': []
        };
        data.regions.forEach(region => namespaceToRegions[region.term_namespace].push(region));

        function getDescription(namespace, feature) {
            return regionNameMap.get(`${namespace}:${feature.start}-${feature.end}`) // Direct region match to consensus
                || namespaceToRegions[namespace].find(region => region.start >= feature.start && region.end <= feature.end).term_name // Find consensus name for region
                || namespace;
        }

        // Dictionary to group the JSON keys into the 3 ontology branches

        // const FUNCTION_NAMESPACES = new Set(['Disorder function', 'Biological process', 'Molecular function', 'Cellular component']);

        if (consensus) {


            for (const [namespace, regions] of Object.entries(namespaceToRegions)) {
                const features = consensus[namespace] || [];

                for (let feature of features) {
                    // We use namespace so ComplexViewer assigns the same color to everything that is a function
                    const region = `${feature.start}-${feature.end}`;
                    // const groupedNamespace = FUNCTION_NAMESPACES.has(namespace) ? 'Function' : namespace;
                    const anno = new Annotation(namespace, new SequenceDatum(null, region), getDescription(namespace, feature));
                    annotations.push(anno);
                }
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
