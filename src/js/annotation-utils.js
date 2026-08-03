import * as d3 from "d3";
import {Annotation} from "./viz/interactor/annotation";
import {SequenceDatum} from "./viz/sequence-datum";

// General and dynamic function to resolve UniProt IDs if they are not standard format
async function resolveUniProtId(rawId) {
    const uniprotAccRegex = new RegExp("^[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$", "i");
    if (uniprotAccRegex.test(rawId)) return rawId;

    const searchUrl = `https://rest.uniprot.org/uniprotkb/search?query=gene:${rawId}&size=1`;
    try {
        const response = await d3.json(searchUrl);
        const bestMatch = response?.results?.[0];
        if (bestMatch && bestMatch.primaryAccession) {
            return bestMatch.primaryAccession;
        }
    } catch (err) {
        console.warn(`Could not resolve ID for gene ${rawId}:`, err);
    }

    return rawId;
}

//todo - cache annotations in memory
export async function fetchAnnotations(/*App*/ app, callback) {
    // we only show annotations on proteins
    const proteins = Array.from(app.participants.values()).filter(function (value) {
        return value.type === "protein";
    });

    const uniprotAccRegex = new RegExp("[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}![-]", "i");
    const promises = [];

    // Process all proteins concurrently using parallel promise handling
    for (let prot of proteins) {
        const rawId = prot.json?.identifier?.id?.trim();
        if (!rawId) continue;

        promises.push(
            resolveUniProtId(rawId).then(mappedId => {
                const match = uniprotAccRegex.exec(mappedId);
                if (match && match[0] === mappedId) {
                    return Promise.all([
                        getSuperFamFeatures(prot, mappedId),
                        getUniProtFeatures(prot, mappedId),
                        getDisProtFeatures(prot, mappedId),
                        getAlphaFoldFeatures(prot, mappedId)
                    ]);
                }
            })
        );
    }

    Promise.allSettled(promises).then(() => {
        if (callback) callback();
    });
}

function getUniProtFeatures(prot, id) {
    const url = `https://www.ebi.ac.uk/proteins/api/proteins/${id}`;
    return d3.json(url).then(json => {
        let annotations = prot.annotationSets.get("UniprotKB");
        if (typeof annotations === "undefined") {
            annotations = [];
            prot.annotationSets.set("UniprotKB", annotations);
        }
        if (json && json.features) {
            for (let feature of json.features.filter(ft => ft.type === "DOMAIN")) {
                const anno = new Annotation(feature.description, new SequenceDatum(null, `${feature.begin}-${feature.end}`));
                annotations.push(anno);
            }
        }
    });
}

async function getDisProtFeatures(prot, id) {
    const url = `https://disprot.org/api/search?page_size=1&page=0&release=current&show_ambiguous=false&show_obsolete=false&acc=${id}`;

    return d3.json(url).then(json => {
        let annotations = prot.annotationSets.get("DisProt");
        if (typeof annotations === "undefined") {
            annotations = [];
            prot.annotationSets.set("DisProt", annotations);
        }

        const data = json?.data?.[0];
        // Defensive validation (Null Safety) to prevent errors if regions are missing
        if (!data || !data.regions) return;

        const consensus = data?.['disprot_consensus'];
        const regions = data['regions'] || [];

        const regionNameMap = new Map(
            regions.map(region => [`${region.term_namespace}:${region.start}-${region.end}`, region.term_name])
        );

        const namespaceToRegions = {
            'Structural state': [],
            'Structural transition': [],
            'Disorder function': [],
            'Biological process': [],
            'Molecular function': [],
            'Cellular component': []
        };
        regions.forEach(region => {
            if (namespaceToRegions[region.term_namespace]) {
                namespaceToRegions[region.term_namespace].push(region);
            }
        });

        function getDescription(namespace, feature) {
            return regionNameMap.get(`${namespace}:${feature.start}-${feature.end}`)
                || namespaceToRegions[namespace].find(region => region.start >= feature.start && region.end <= feature.end)?.term_name
                || namespace;
        }

        if (consensus) {
            for (const [namespace] of Object.entries(namespaceToRegions)) {
                const features = consensus[namespace] || [];

                for (let feature of features) {
                    const region = `${feature.start}-${feature.end}`;
                    const anno = new Annotation(namespace, new SequenceDatum(null, region), getDescription(namespace, feature));
                    annotations.push(anno);
                }
            }
        }
    });
}

async function getSuperFamFeatures(prot, id) {
    const url = `https://supfam.org/SUPERFAMILY/cgi-bin/das/up/features?segment=${id}`;
    return d3.xml(url).then(xml => {
        let annotations = prot.annotationSets.get("Superfamily");
        if (typeof annotations === "undefined") {
            annotations = [];
            prot.annotationSets.set("Superfamily", annotations);
        }
        if (xml) {
            const xmlFeatures = xml.getElementsByTagName("FEATURE");
            for (let xmlFeature of xmlFeatures) {
                const type = xmlFeature.getElementsByTagName("TYPE")[0];
                const category = type.getAttribute("category");
                if (category === "miscellaneous") {
                    const name = decodeHTML(type.getAttribute("id"));
                    const start = xmlFeature.getElementsByTagName("START")[0].textContent;
                    const end = xmlFeature.getElementsByTagName("END")[0].textContent;
                    annotations.push(new Annotation(name, new SequenceDatum(null, `${start}-${end}`)));
                }
            }
        }
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