import * as d3 from "d3";
import {Annotation} from "./viz/interactor/annotation";
import {SequenceDatum} from "./viz/sequence-datum";

const featureLoaders = new Map([
    ["Superfamily", getSuperFamFeatures],
    ["UniprotKB", getUniProtFeatures],
    ["DisProt", getDisProtFeatures],
    ["AlphaFold", getAlphaFoldFeatures]
]);

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
/**
 * Main function to load annotations
 */
export async function fetchAnnotations(/*App*/ app, loadId) {
    const proteinIdPromises = resolveProteinIds(getProteins(app));
    const groupPromises = Array.from(featureLoaders, ([annotationSet, featureLoader]) =>
        loadAnnotationSet(app, loadId, annotationSet, featureLoader, proteinIdPromises)
    );

    return Promise.allSettled(groupPromises); // Update legend and rendering of proteins when everything is loaded
}

// INITIAL FILTERING QUERIES

function getProteins(app) {
    return Array.from(app.participants.values()).filter(value => value.type === "protein");
}

function resolveProteinIds(proteins) {
    const uniprotAccRegex = new RegExp("[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}![-]", "i");
    return proteins.map(prot => {
        const rawId = prot.json?.identifier?.id?.trim();
        if (!rawId) return Promise.resolve();

        return resolveUniProtId(rawId).then(mappedId => {
            const match = uniprotAccRegex.exec(mappedId);
            if (match && match[0] === mappedId) {
                return {prot, mappedId};
            }
        });
    });
}

// --- EVENT MANAGEMENT ---

function loadAnnotationSet(app, loadId, annotationSet, featureLoader, proteinIdPromises) {
    const progress = {
        total: proteinIdPromises.length,
        completed: 0,
        failed: 0
    };

    notifyAnnotationSetStarted(app, loadId, annotationSet, progress);

    const annotationPromises = proteinIdPromises.map(proteinIdPromise => {
        return loadProteinAnnotation(proteinIdPromise, featureLoader)
            .then(protein => {
                notifyProteinAnnotationLoaded(app, loadId, annotationSet, progress, protein);
                return protein;
            })
            .catch(error => {
                notifyProteinAnnotationFailed(app, loadId, annotationSet, progress, error);
                throw error;
            });
    });

    return Promise.allSettled(annotationPromises).then(results => {
        notifyAnnotationSetFinished(app, loadId, annotationSet, progress, results.length);
    });
}

function loadProteinAnnotation(proteinIdPromise, featureLoader) {
    return proteinIdPromise.then(protein => {
        if (!protein) {
            return {skipped: true};
        }
        return featureLoader(protein.prot, protein.mappedId).then(() => protein);
    });
}

function isCurrentAnnotationLoad(app, loadId) {
    return typeof loadId === "undefined" || app.annotationLoadId === loadId;
}

function notifyAnnotationLoadEvent(app, loadId, event) {
    if (isCurrentAnnotationLoad(app, loadId) && app.notifyAnnotationListeners) {
        app.notifyAnnotationListeners(event);
    }
}

function notifyAnnotationSetStarted(app, loadId, annotationSet, progress) {
    if (isCurrentAnnotationLoad(app, loadId) && app.setAnnotationSetLoading) {
        app.setAnnotationSetLoading(annotationSet);
    }
    notifyAnnotationLoadEvent(app, loadId, {
        type: "annotation-loading-start",
        annotationSet,
        loading: true,
        total: progress.total,
        completed: 0,
        failed: 0
    });
}

function notifyProteinAnnotationLoaded(app, loadId, annotationSet, progress, protein) {
    progress.completed++;
    notifyAnnotationLoadEvent(app, loadId, {
        type: "annotation-protein-loaded",
        annotationSet,
        loading: true,
        status: protein?.skipped ? "skipped" : "fulfilled",
        protein: protein?.prot?.json,
        participantId: protein?.prot?.id,
        mappedId: protein?.mappedId,
        total: progress.total,
        completed: progress.completed,
        failed: progress.failed
    });
}

function notifyProteinAnnotationFailed(app, loadId, annotationSet, progress, error) {
    progress.completed++;
    progress.failed++;
    notifyAnnotationLoadEvent(app, loadId, {
        type: "annotation-protein-loaded",
        annotationSet,
        loading: true,
        status: "rejected",
        error,
        total: progress.total,
        completed: progress.completed,
        failed: progress.failed
    });
}

function notifyAnnotationSetFinished(app, loadId, annotationSet, progress, total) {
    if (isCurrentAnnotationLoad(app, loadId) && app.setAnnotationSetLoaded) {
        app.setAnnotationSetLoaded(annotationSet);
    }
    notifyAnnotationLoadEvent(app, loadId, {
        type: "annotation-loading-finish",
        annotationSet,
        loading: false,
        total,
        completed: total - progress.failed,
        failed: progress.failed
    });
}

// FEATURE LOADING QUERIES

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

const confidenceToCategory = {
    "Very low": "Very low confidence",
    "Low": "Low confidence",
    "Confident": "High confidence",
    "Very high": "Very high confidence"
};

async function getAlphaFoldFeatures(prot, id) {
    const url = `https://disprot.org/api/alphafold/${id}`;
    return d3.json(url).then(json => {
        let annotations = prot.annotationSets.get("AlphaFold");
        if (typeof annotations === "undefined") {
            annotations = [];
            prot.annotationSets.set("AlphaFold", annotations);
        }

        for (let reg of json) {
            const anno = new Annotation(confidenceToCategory[reg.model_confidence], new SequenceDatum(null, `${reg.start}-${reg.end}`));
            annotations.push(anno);
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
