import "../css/xinet.css";
import packageInfo from "../../package.json";
import * as d3 from "d3";
import {scaleOrdinal} from "d3-scale";
import {schemePastel2, schemeTableau10} from "d3-scale-chromatic";
import * as cola from "./cola";
import Rgb_color from "rgb-color";

import {svgUtils} from "./svgexp";
import {readMijson} from "./read-mijson";
//import {fetchAnnotations} from "./annotation-utils";
import {fetchAnnotations} from "./annotation-utils";

import {NaryLink} from "./viz/link/nary-link";
import {svgns} from "./svgns";

import $ from "jquery";

const defaultMaxCountInitiallyExpanded = 4;
const defaultInitialAnnotations = ["MI Features"];
const ANNOTATION_SET_LABELS = {
  "InterPro": "InterPro Domains",
  "UniprotKB": "UniprotKB Domains"
};
const INTERNAL_ANNOTATION_SETS = [
  "Interactor",
  "MI Features"
];
const EXTERNAL_ANNOTATION_SETS = [
  "UniprotKB",
  "DisProt",
  "AlphaFold",
  "ELM",
  // "SuperFam",
  "InterPro"
];

const ALL_ANNOTATION_SETS = [
  ...INTERNAL_ANNOTATION_SETS,
  ...EXTERNAL_ANNOTATION_SETS,
];


// [MOVED]: fixed colors for DisProt and AlphaFold categories (module level so
// the palettes below can avoid them)
const DISPROT_COLORS = {
  "Structural state": "#B67637",
  "Structural transition": "#8B296F",
  "Disorder function": "#BA2327",
  //
  //
  // // Branch 3: Disorder function (we group all functions here)
  // 'Biological process': "#cb5c5c",
  // 'Molecular function': "#e64a4e",
  // 'Cellular component': "#971e22"
};
const ALPHAFOLD_COLORS = {
  "Very high confidence": "#0053d6",
  "High confidence": "#65cbf3",
  "Low confidence": "#ffe915",
  "Very low confidence": "#ff7d45"
};
const FIXED_COLORS = [...Object.values(DISPROT_COLORS), ...Object.values(ALPHAFOLD_COLORS)];

// [ADDED]: perceptual distance (CIE76 Delta E in Lab space). Below ~20-25 two
// colors are easy to confuse.
const MIN_DELTA_E_FIXED = 25; // vs DisProt / AlphaFold colors
const MIN_DELTA_E_OTHER = 15; // vs interactor colors and between generated colors

function deltaE(c1, c2) {
  const a = d3.lab(c1), b = d3.lab(c2);
  return Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b);
}

function isFarFrom(color, others, minDeltaE) {
  return others.every(o => deltaE(color, o) >= minDeltaE);
}

// [ADDED]: SVG id for the hatched pattern of a category/color. Only letters,
// digits, "_" and "-" so it works inside url('#...') (apostrophes in names
// used to break it) and in exported SVGs opened in Inkscape/Illustrator.
function hatchId(category, color) {
  const safe = s => String(s).replace(/[^A-Za-z0-9_-]/g, "_");
  return `hatched_${safe(category)}_${safe(color)}`;
}

// [ADDED]: pool of candidate colors: a fine grid over hue, lightness and
// chroma (HCL), keeping only displayable colors that are not close to the
// fixed DisProt/AlphaFold colors. Built once.
const COLOR_CANDIDATES = (() => {
  const out = [];
  const seen = new Set();
  for (let h = 0; h < 360; h += 3) {
    for (const l of [30, 40, 50, 60, 70, 80]) {
      for (const c of [30, 45, 60, 75, 90]) {
        const hcl = d3.hcl(h, c, l);
        if (!hcl.displayable()) continue; // skip out-of-gamut colors
        const hex = hcl.formatHex();
        if (!seen.has(hex) && isFarFrom(hex, FIXED_COLORS, MIN_DELTA_E_FIXED)) {
          seen.add(hex);
          out.push(hex);
        }
      }
    }
  }
  return out;
})();

// [ADDED]: returns n colors that are as different from each other as possible,
// none of them close to the fixed DisProt/AlphaFold colors, and kept away
// from the colors in `avoid` (e.g. the interactor colors when coloring features).
// Starts from the Tableau10 colors that pass those filters (nice defaults for
// small sets), then adds colors one by one from COLOR_CANDIDATES, each time
// taking the candidate farthest from everything already used ("farthest point"
// sampling). Deterministic: same arguments -> same palette.
function makePalette(n, avoid = []) {
  const palette = schemeTableau10.filter(c =>
    isFarFrom(c, FIXED_COLORS, MIN_DELTA_E_FIXED) && isFarFrom(c, avoid, MIN_DELTA_E_OTHER));
  if (palette.length >= n) return palette.slice(0, n);

  const used = new Set([...palette, ...avoid]);
  const candidates = COLOR_CANDIDATES.filter(c => !used.has(c));
  const labs = candidates.map(c => d3.lab(c));
  const usedLabs = [...used].map(c => d3.lab(c));
  // minDist[i] = distance from candidate i to the closest color already used
  const minDist = labs.map(a => usedLabs.reduce(
    (m, b) => Math.min(m, Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b)), Infinity));
  const taken = new Array(candidates.length).fill(false);

  let repeatIndex = 0;
  while (palette.length < n) {
    let best = -1;
    for (let i = 0; i < candidates.length; i++) {
      if (!taken[i] && (best === -1 || minDist[i] > minDist[best])) best = i;
    }
    if (best === -1) { // pool exhausted (thousands of categories): repeat colors
      palette.push(palette.length ? palette[repeatIndex++ % palette.length] : "#999999");
      continue;
    }
    taken[best] = true;
    palette.push(candidates[best]);
    const b = labs[best];
    for (let i = 0; i < candidates.length; i++) {
      if (!taken[i]) {
        const a = labs[i];
        minDist[i] = Math.min(minDist[i], Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b));
      }
    }
  }
  return palette;
}

export class App {

  constructor(/*HTMLDivElement*/networkDiv, {
    maxCountInitiallyExpanded = defaultMaxCountInitiallyExpanded,
    initialAnnotations = defaultInitialAnnotations
  }) {
    maxCountInitiallyExpanded = maxCountInitiallyExpanded || defaultMaxCountInitiallyExpanded;
    initialAnnotations = initialAnnotations || defaultInitialAnnotations;

    this.debug = false;
    this.el = networkDiv;
    //avoids prob with 'save - web page complete'
    this.el.textContent = ""; //https://stackoverflow.com/questions/3955229/remove-all-child-elements-of-a-dom-node-in-javascript
    this.maxCountInitiallyExpanded = maxCountInitiallyExpanded || 4;
    this.d3cola = cola.d3adaptor(d3).groupCompactness(Number.MIN_VALUE).avoidOverlaps(true); //1e-5

    const customMenuSel = d3.select(this.el)
      .append("div").classed("custom-menu-margin", true)
      .append("div").classed("custom-menu", true)
      .append("ul");

    // External DB links


    // //-----> Uniprot

    this.annotationLinks = EXTERNAL_ANNOTATION_SETS.reduce((links, source) => ({
      ...links,
      [source]: customMenuSel.append("li")
        .classed(`external-link ${source.toLowerCase()}-link`, true)
        .style("display", "none")

    }), {});

    EXTERNAL_ANNOTATION_SETS.forEach(source =>
      this.annotationLinks[source].append("a")
        .attr("target", "_blank")
        .attr("rel", "noopener")
        .text(`Open in ${source}`)
    );


    const collapse = customMenuSel.append("li").classed("collapse", true); //.append("button");
    collapse.text("Collapse");
    collapse.node().onclick = evt => this.collapseProtein(evt);
    const scaleButtonsListItemSel = customMenuSel.append("li").text("Scale: ");
    const scaleButtons = scaleButtonsListItemSel.selectAll("ul.custom-menu")
      .data(App.barScales)
      .enter()
      .append("div")
      .attr("class", "bar-scale")
      .append("label");

    scaleButtons.append("span")
      .text(d => d === 8 ? "AA" : d);
    scaleButtons.append("input")
      // .attr ("id", function(d) { return d*100; })
      .attr("class", d => `scaleButton scaleButton_${d * 100}`)
      .attr("name", "scaleButtons")
      .attr("type", "radio")
      .on("change", (e, d) => {
        this.preventDefaultsAndStopPropagation(e); // [FIXED]: was (d), the scale value instead of the event
        this.contextMenuProt.setStickScale(d, this.contextMenuPoint);
      });
    const contextMenu = d3.select(".custom-menu-margin").node();

    const self = this;
    contextMenu.onmouseout = function (evt) {
      // [FIXED]: relatedTarget is null when the pointer leaves the window
      let e = evt.relatedTarget;
      while (e) {
        if (e === this) return;
        e = e.parentNode;
      }
      self.contextMenuProt = null;
      d3.select(this).style("display", "none");
    };


    //create SVG element
    this.svgElement = document.createElementNS(svgns, "svg");
    this.svgElement.classList.add("complexViewerSVG");

    //add listeners
    this.svgElement.onmousedown = evt => this.mouseDown(evt);
    this.svgElement.onmousemove = evt => this.move(evt);
    this.svgElement.onmouseup = evt => this.mouseUp(evt);
    this.svgElement.onmouseout = evt => this.mouseOut(evt);
    this.svgElement.ontouchstart = evt => this.touchStart(evt);
    this.svgElement.ontouchmove = evt => this.move(evt);
    this.svgElement.ontouchend = evt => this.mouseUp(evt);
    this.lastMouseUp = new Date().getTime();

    this.el.oncontextmenu = function (evt) {
      if (evt.preventDefault) { // necessary for addEventListener, works with traditional
        evt.preventDefault();
      }
      evt.returnValue = false; // necessary for attachEvent, works with traditional
      return false; // works with traditional, not with attachEvent or addEventListener
    };


    // [MODIFIED]: wheel zoom is now handled by d3.zoom (set up below, after the container exists)


    //functions that get interactor id of hover over thing
    this.hoverListeners = new Set();
    this.expandListeners = new Set();
    this.annotationListeners = new Set();

    this.el.appendChild(this.svgElement);

    // various groups needed
    this.container = document.createElementNS(svgns, "g");
    this.container.setAttribute("id", "container");

    const svg = d3.select(this.svgElement);
    this.defs = svg.append("defs");

    this.acknowledgement = document.createElementNS(svgns, "g");
    const ackText = document.createElementNS(svgns, "text");
    ackText.innerHTML = "<a href='https://academic.oup.com/bioinformatics/article/33/22/3673/4061280' target='_blank'><tspan x='0' dy='1.2em' style='text-decoration: underline'>ComplexViewer "
      + packageInfo.version + "</tspan></a><tspan x='0' dy='1.2em'>by <a href='https://rappsilberlab.org/' target='_blank'>Rappsilber Laboratory</a></tspan>";

    this.acknowledgement.appendChild(ackText);
    ackText.setAttribute("font-size", "8pt");
    this.svgElement.appendChild(this.acknowledgement);

    this.naryLinks = document.createElementNS(svgns, "g");
    this.naryLinks.setAttribute("id", "naryLinks");
    this.container.appendChild(this.naryLinks);

    this.p_pLinksWide = document.createElementNS(svgns, "g");
    this.p_pLinksWide.setAttribute("id", "p_pLinksWide");
    this.container.appendChild(this.p_pLinksWide);

    this.highlights = document.createElementNS(svgns, "g");
    this.highlights.setAttribute("class", "highlights"); //interactors also contain highlight groups
    this.container.appendChild(this.highlights);

    this.res_resLinks = document.createElementNS(svgns, "g");
    this.res_resLinks.setAttribute("id", "res_resLinks");
    this.container.appendChild(this.res_resLinks);

    this.p_pLinks = document.createElementNS(svgns, "g");
    this.p_pLinks.setAttribute("id", "p_pLinks");
    this.container.appendChild(this.p_pLinks);

    //todo - have links above interactors?
    this.proteinUpper = document.createElementNS(svgns, "g");
    this.proteinUpper.setAttribute("id", "proteinUpper");
    this.container.appendChild(this.proteinUpper);

    this.selfRes_resLinks = document.createElementNS(svgns, "g");
    this.selfRes_resLinks.setAttribute("id", "res_resLinks");
    this.container.appendChild(this.selfRes_resLinks);

    this.svgElement.appendChild(this.container);

    // [ADDED]: pan & zoom with d3.zoom - same gestures with mouse, finger and pen:
    // wheel / drag on the background with the mouse, one-finger drag and two-finger
    // pinch on touch screens. Gestures that start on a protein or a link are left
    // alone, so those can still be dragged and clicked as before.
    this.svgElement.style.touchAction = "none"; // let the viewer, not the browser, handle touch gestures
    this.zoomBehavior = d3.zoom()
      .scaleExtent([0.01, 40])
      .filter(evt => {
        if (evt.type === "wheel") return true;
        if (evt.type === "dblclick") return false; // no double-click zoom (clicks expand proteins)
        if (evt.type === "touchstart") return true; // the zoom handler decides: protein drag vs pan/pinch
        return !evt.button && !this.dragElement; // mouse / pen: primary button, background only
      })
      .on("start", evt => {
        if (evt.sourceEvent) { // a user gesture (not the automatic fit)
          this.d3cola.stop();
          this.hideTooltip();
          d3.select(".custom-menu-margin").style("display", "none");
        }
      })
      .on("zoom", evt => {
        const src = evt.sourceEvent;
        if (src && src.touches) {
          if (src.touches.length > 1) {
            this.dragElement = null; // a second finger turns a protein drag into a pinch
          } else if (this.dragElement) {
            // one finger dragging a protein: keep the view still (undo d3's pan)
            this.svgElement.__zoom = this.lastZoomTransform || d3.zoomIdentity;
            return;
          }
        }
        this.lastZoomTransform = evt.transform;
        this.container.setAttribute("transform", evt.transform.toString());
        this.z = 1 / evt.transform.k; // inverse scale, used for constant on-screen line widths
      })
      .on("end", evt => {
        if (evt.sourceEvent) { // d3.zoom swallows the mouseup, so reset the drag state here
          this.dragStart = null;
          this.state = App.STATES.MOUSE_UP;
        }
      });
    d3.select(this.svgElement).call(this.zoomBehavior);

    // [ADDED]: proteins and links stop touchstart from bubbling (so they can be
    // dragged), which would hide those fingers from d3.zoom and break pinch-zoom
    // when a finger lands on them. Hand those touches to d3.zoom in the capture
    // phase; single-finger moves on a protein are then ignored by the zoom
    // handler above, so dragging a protein still works.
    const svgSel = d3.select(this.svgElement);
    svgSel.on("dblclick.zoom", null); // no double-click / double-tap zoom: taps expand proteins
    const zoomTouchStart = svgSel.on("touchstart.zoom");
    if (zoomTouchStart) {
      // the normal (bubbling) d3 listener skips touches already handed over below
      svgSel.on("touchstart.zoom", function (evt, ...args) {
        if (!evt.cvZoomHandled) zoomTouchStart.call(this, evt, ...args);
      });
      this.svgElement.addEventListener("touchstart", evt => {
        if (evt.target === this.svgElement) return; // background: d3 gets it normally
        evt.cvZoomHandled = true;
        // d3.zoom stops propagation of the events it receives; here that would
        // keep the touch from reaching the protein, so give it a copy that can't
        const proxy = new Proxy(evt, {
          get(target, key) {
            if (key === "stopPropagation" || key === "stopImmediatePropagation") return () => {};
            const value = target[key];
            return typeof value === "function" ? value.bind(target) : value;
          }
        });
        zoomTouchStart.call(this.svgElement, proxy, this.svgElement.__data__);
      }, true);
    }

    //showing title as tooltips is NOT part of svg spec (even though some browsers do this)
    //also more responsive / more control if we do out own
    this.tooltip = document.createElementNS(svgns, "text");
    this.tooltip.setAttribute("x", "0");
    this.tooltip.setAttribute("y", "0");
    const tooltipTextNode = document.createTextNode("tooltip");
    this.tooltip.classList.add("label", "tooltip");

    this.tooltip.appendChild(tooltipTextNode);

    this.tooltip_bg = document.createElementNS(svgns, "rect");
    this.tooltip_bg.classList.add("tooltip-background");

    this.tooltip_subBg = document.createElementNS(svgns, "rect");
    this.tooltip_subBg.classList.add("tooltip-sub-background");

    this.svgElement.appendChild(this.tooltip_subBg);
    this.svgElement.appendChild(this.tooltip_bg);
    this.svgElement.appendChild(this.tooltip);

    // fade level for legend highlighting (kept across datasets; change with setHighlightOpacityLevel)
    this.highlightOpacityLevel = 0.15;

    this.annotationSetsShown = new Map();
    ALL_ANNOTATION_SETS.forEach(a => this.annotationSetsShown.set(a, initialAnnotations.includes(a)));
    this.annotationSetsLoaded = new Map();
    this.resetAnnotationSetLoadingState();

    this.clear();
  }

  clear() {
    this.annotationLoadId = (this.annotationLoadId || 0) + 1;
    this.resetAnnotationSetLoadingState();
    this.d3cola.stop();
    this.naryLinks.textContent = "";
    this.p_pLinksWide.textContent = "";
    this.highlights.textContent = "";
    this.p_pLinks.textContent = "";
    this.res_resLinks.textContent = "";
    this.proteinUpper.textContent = "";
    this.selfRes_resLinks.textContent = "";

    // if we are dragging something at the moment - this will be the element that is dragged
    this.dragElement = null;
    // from where did we start dragging
    this.dragStart = null;//{};
    this.draggedElement = null;

    this.participants = new Map();
    this.allNaryLinks = new Map();
    this.allBinaryLinks = new Map();
    this.allUnaryLinks = new Map();
    this.allSequenceLinks = new Map();
    this.complexes = [];

    // [ADDED]: fixed interactor color scale, rebuilt for each new dataset
    this.interactorColors = null;
    // [ADDED]: annotation category highlighted from the legend ({annotationSet, category} or null)
    this.highlightedAnnotation = null;
    // [ADDED]: participant whose highlight halo is shown after a tap (touch screens have no hover)
    this.touchedParticipant = null;

    //lighten complex colors
    let complexColors = [];
    for (let c of schemePastel2) {//colorbrewer.Pastel2[8]) {
      const hsl = d3.hsl(c);
      hsl.l = 0.9;
      complexColors.push(`${hsl}`);
    }
    NaryLink.naryColors = scaleOrdinal().range(complexColors);

    this.z = 1;
    this.hideTooltip();
    this.state = App.STATES.MOUSE_UP;
  }

  collapseProtein() {
    d3.select(".custom-menu-margin").style("display", "none");
    this.contextMenuProt.setExpanded(false, this.contextMenuPoint);
    this.contextMenuProt = null;
    this.notifyExpandListeners();
  }

  init() {
    this.d3cola.stop();
    let maxSeqLength = 0;
    for (let participant of this.participants.values()) {
      if (participant.size > maxSeqLength) {
        maxSeqLength = participant.size;
      }
    }
    const width = this.svgElement.parentNode.clientWidth;
    const defaultPixPerRes = width * 0.8 / maxSeqLength;

    // https://stackoverflow.com/questions/12141150/from-list-of-integers-get-number-closest-to-a-given-value/12141511#12141511
    function takeClosest(myList, myNumber) {
      const bisect = d3.bisector(function (d) {
        return d;
      }).left;
      const pos = bisect(myList, myNumber);
      if (pos === 0 || pos === 1) {
        return myList[1]; // don't return smallest scale as default
      }
      if (pos === myList.length) {
        return myList[myList.length - 1];
      }
      return myList[pos - 1];
    }

    this.defaultBarScale = takeClosest(App.barScales, defaultPixPerRes);

    for (let participant of this.participants.values()) {
      participant.setPosition(-500, -500);
      this.proteinUpper.appendChild(participant.upperGroup);
    }
    for (let participant of this.participants.values()) {
      if (participant.type === "protein") {
        // participant.initSelfLinkSVG(); // todo - may not even do anything, not sure its working
        participant.stickZoom = this.defaultBarScale;
        if (this.participants.size < this.maxCountInitiallyExpanded) {
          participant.toStick(false);//param means don't animate change to circle
        }
      }
    }
    this.updateAnnotations(); //?
    const annotationLoadId = (this.annotationLoadId || 0) + 1;
    this.annotationLoadId = annotationLoadId;
    fetchAnnotations(this, annotationLoadId);
    this.checkLinks();
    this.autoLayout();
  }

  zoomToExtent() {
    const width = this.svgElement.parentNode.clientWidth;
    const height = this.svgElement.parentNode.clientHeight;
    const bbox = this.container.getBBox();
    const margin = {top: 20, right: 20, bottom: 55, left: 20};
    const availableWidth = Math.max(1, width - margin.left - margin.right);
    const availableHeight = Math.max(1, height - margin.top - margin.bottom);
    if (bbox.width > 0 && bbox.height > 0 && width > 0 && height > 0) {
      // [FIXED]: ratios are numbers now (toFixed() returned strings, so "10.0" < "9.5" was true)
      // [MODIFIED]: fits at 100% if possible, otherwise shrinks into the
      // drawable area. The bottom margin keeps the acknowledgement from
      // overlapping the graph in the viewer and in exported images.
      const k = Math.min(1, availableWidth / bbox.width, availableHeight / bbox.height);
      const fitsAtFullSize = bbox.width <= availableWidth && bbox.height <= availableHeight;
      const scale = fitsAtFullSize ? 1 : k;
      const tx = margin.left + (availableWidth - bbox.width * scale) / 2 - bbox.x * scale;
      const ty = margin.top + (availableHeight - bbox.height * scale) / 2 - bbox.y * scale;
      // apply through d3.zoom so later gestures start from this view (no jump)
      d3.select(this.svgElement).call(this.zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
    }

    //todo - following could be tided up by using acknowledgement bbox or positioning att's of text
    this.acknowledgement.setAttribute("transform", `translate(${width - 150}, ${height - 30})`);
  }

  autoLayout() {
    this.d3cola.stop();

    const pruned = [], allNodesExceptComplexes = [], self = this;
    for (let p of this.participants.values()) {
      if (p.type !== "complex") {
        allNodesExceptComplexes.push(p);
        if (p.binaryLinks.size > 2) {
          pruned.push(p);
        }
      }
      // needed to ensure consistent results
      delete p.x;
      delete p.y;
      delete p.px;
      delete p.py;
      delete p.bounds;
      p.fixed = 0;
    }

    const linkLength = (allNodesExceptComplexes.length < 30) ? 30 : 20;
    const width = this.svgElement.parentNode.clientWidth;
    const height = this.svgElement.parentNode.clientHeight;
    this.d3cola.size([height - 40, width - 40]).symmetricDiffLinkLengths(linkLength);


    function makeLinks(nodes) {
      const links = [];
      const molLookUp = {};
      let mi = 0;
      for (let mol of nodes) {
        molLookUp[mol.id] = mi;
        mi++;
      }
      for (let binaryLink of self.allBinaryLinks.values()) {
        const source = binaryLink.participants[0];
        const target = binaryLink.participants[1];
        if (source !== target && nodes.indexOf(source) !== -1 && nodes.indexOf(target) !== -1) { // todo - check what this is doing
          const linkObj = {};
          linkObj.source = molLookUp[source.id];
          linkObj.target = molLookUp[target.id];
          linkObj.id = binaryLink.id;
          links.push(linkObj);
        }
      }
      return links;
    }

    doLayout(pruned, makeLinks(pruned), true);
    const links = makeLinks(allNodesExceptComplexes);
    doLayout(allNodesExceptComplexes, links, true); //todo - some work is repeated (links array), refactor so more efficient
    doLayout(allNodesExceptComplexes, links, false);

    // function doLayout(nodes, links, preRun) {
    function doLayout(nodes, links, preRun) {
      //don't know how necessary these deletions are
      delete self.d3cola._lastStress;
      delete self.d3cola._alpha;
      delete self.d3cola._descent;
      delete self.d3cola._rootGroup;

      self.d3cola.nodes(nodes).links(links);

      let /*groupDebugSel,*/ participantDebugSel;
      if (self.debug) {
        // groupDebugSel = d3.select(self.container).selectAll(".group")
        //     .data(groups);
        //
        // groupDebugSel.enter().append("rect")
        //     .classed("group", true)
        //     .attr({
        //         rx: 5,
        //         ry: 5
        //     })
        //     .style("stroke", "blue")
        //     .style("fill", "none");
        //
        participantDebugSel = d3.select(self.container).selectAll(".node")
          .data(nodes);

        participantDebugSel.enter().append("rect")
          .classed("node", true)
          .attr({rx: 5, ry: 5})
          .style("stroke", "red")
          .style("fill", "none");

        // groupDebugSel.exit().remove();
        participantDebugSel.exit().remove();
      }

      if (preRun) {
        const initialUnconstrainedIterations = nodes.length < 10 ? 10 : 23;
        self.d3cola.groups([]).start(initialUnconstrainedIterations, 10, 1, 0, false);
      } else {
        const groups = [];
        if (self.complexes) {
          for (let g of self.complexes) {
            g.leaves = [];
            g.groups = [];
            for (let interactor of g.naryLink.participants) {
              if (interactor.type !== "complex") {
                g.leaves.push(nodes.indexOf(interactor));
              }
            }
            groups.push(g);
          }
          for (let g of self.complexes) {
            for (let interactor of g.naryLink.participants) {
              if (interactor.type === "complex") {
                g.groups.push(groups.indexOf(interactor));
              }
            }
          }
        }
        self.d3cola.groups(groups).start(0, 10, 1, 0, true)
          //     .on("end", function () {
          //     for (let node of nodes) {
          //         node.setPosition(node.x, node.y);
          //     }
          //     self.setAllLinkCoordinates();
          //     self.zoomToExtent();
          // })
          .on("tick", () => {
            const nodes = self.d3cola.nodes();
            for (let node of nodes) {
              node.setPositionFromCola(node.x, node.y);
            }
            self.setAllLinkCoordinates();
            self.zoomToExtent();

            if (self.debug) {
              // groupDebugSel.attr({
              //     x: function (d) {
              //         return d.bounds.x;// + (width / 2);
              //     },
              //     y: function (d) {
              //         return d.bounds.y;// + (height / 2);
              //     },
              //     width: function (d) {
              //         return d.bounds.width();
              //     },
              //     height: function (d) {
              //         return d.bounds.height();
              //     }
              // });

              participantDebugSel.attr({
                x: d => d.bounds.x, // + (width / 2);
                y: d => d.bounds.y, // + (height / 2);
                width: d => d.bounds.width(),
                height: d => d.bounds.height()
              });
            }
          });
      }
    }
  }

  getSVG() {
    this.setAllLinkCoordinates();
    this.annotatePatternFillBBoxes(this.svgElement);
    const svgSel = d3.select(this.el).selectAll("svg");
    const svgArr = [svgSel.node()];
    // [ADDED]: a tap halo (touch screens) stays on while the user taps Export; keep it out of the image
    const touched = this.touchedParticipant;
    if (touched) touched.showHighlight(false);
    let svgStrings;
    try {
      svgStrings = svgUtils.capture(svgArr);
    } finally {
      this.clearPatternFillBBoxAnnotations(this.svgElement);
      if (touched) touched.showHighlight(true);
    }
    this.prepareSVGForExport(svgStrings[0]);
    return svgUtils.makeXMLStr(new XMLSerializer(), svgStrings[0]);
  }

  annotatePatternFillBBoxes(svgElement) {
    const patternedElements = svgElement.querySelectorAll("[fill]");
    for (const el of patternedElements) {
      const fill = el.getAttribute("fill");
      if (!this.getPatternFillId(fill)) continue;
      try {
        const bbox = el.getBBox();
        el.setAttribute("data-cv-export-bbox", [bbox.x, bbox.y, bbox.width, bbox.height].join(" "));
      } catch (e) {
        // Some SVG elements do not expose a bbox in all browsers; they can still export without stripes.
      }
    }
  }

  clearPatternFillBBoxAnnotations(svgElement) {
    const annotated = svgElement.querySelectorAll("[data-cv-export-bbox]");
    for (const el of annotated) {
      el.removeAttribute("data-cv-export-bbox");
    }
  }

  prepareSVGForExport(svgDoc) {
    this.inlineExportLinkStyles(svgDoc);
    this.expandPatternFillsForExport(svgDoc);
    this.normalizePatternReferencesForExport(svgDoc);
    this.convertRoundRectsToCircles(svgDoc);
  }

  inlineExportLinkStyles(svgDoc) {
    const links = svgDoc.querySelectorAll(".link, .link-line, .feature-link, .complex-outline, .linked-complex");
    for (const link of links) {
      if (link.classList.contains("link")) {
        link.setAttribute("stroke", link.getAttribute("stroke") || "black");
        link.setAttribute("fill", link.getAttribute("fill") || "none");
        link.setAttribute("stroke-linecap", link.getAttribute("stroke-linecap") || "round");
      }
      if (link.classList.contains("link-line")) {
        link.setAttribute("stroke-width", link.getAttribute("stroke-width") || "1");
      }
      if (link.classList.contains("link-highlight")) {
        link.setAttribute("stroke-opacity", "0");
      }
      if (link.classList.contains("certain-link")) {
        link.setAttribute("opacity", link.getAttribute("opacity") || "0.6");
        link.setAttribute("stroke-opacity", link.getAttribute("stroke-opacity") || "0.6");
      }
      if (link.classList.contains("uncertain-link")) {
        link.setAttribute("opacity", link.getAttribute("opacity") || "0.2");
        link.setAttribute("stroke-opacity", link.getAttribute("stroke-opacity") || "0.6");
      }
      if (link.classList.contains("feature-link")) {
        link.setAttribute("fill", link.getAttribute("fill") || "black");
      }
      if (link.classList.contains("complex-outline")) {
        link.setAttribute("stroke", link.getAttribute("stroke") || "white");
        link.setAttribute("stroke-width", link.getAttribute("stroke-width") || "7");
        link.setAttribute("stroke-linejoin", link.getAttribute("stroke-linejoin") || "round");
      }
      if (link.classList.contains("linked-complex")) {
        link.setAttribute("stroke", link.getAttribute("stroke") || "black");
        link.setAttribute("stroke-width", link.getAttribute("stroke-width") || "1");
        link.setAttribute("stroke-linejoin", link.getAttribute("stroke-linejoin") || "round");
      }
    }
  }

  getPatternFillId(fill) {
    const match = fill && fill.match(/^url\(['"]?#([^'")]+)['"]?\)$/);
    return match ? match[1] : null;
  }

  findPatternById(svgDoc, id) {
    const patterns = svgDoc.querySelectorAll("pattern");
    for (const pattern of patterns) {
      if (pattern.getAttribute("id") === id) return pattern;
    }
    return null;
  }

  getPatternColor(pattern) {
    if (!pattern) return null;
    const colored = pattern.querySelector("[fill]:not([fill='none']), [stroke]:not([stroke='none'])");
    if (!colored) return null;
    return {
      color: colored.getAttribute("fill") || colored.getAttribute("stroke"),
      opacity: colored.getAttribute("fill-opacity") || colored.getAttribute("stroke-opacity") || "1"
    };
  }

  expandPatternFillsForExport(svgDoc) {
    const defs = svgDoc.querySelector("defs");
    if (!defs) return;

    let clipIndex = 0;
    const patternedElements = svgDoc.querySelectorAll("[fill]");
    for (const el of patternedElements) {
      const patternId = this.getPatternFillId(el.getAttribute("fill"));
      if (!patternId) continue;

      const bboxValue = el.getAttribute("data-cv-export-bbox");
      if (!bboxValue) continue;
      const [x, y, width, height] = bboxValue.split(/\s+/).map(Number);
      if (!width || !height) continue;

      const patternColor = this.getPatternColor(this.findPatternById(svgDoc, patternId));
      if (!patternColor || !patternColor.color) continue;

      const clipId = `cv_export_hatch_clip_${clipIndex++}`;
      const clipPath = document.createElementNS(svgns, "clipPath");
      clipPath.setAttribute("id", clipId);
      clipPath.setAttribute("clipPathUnits", "userSpaceOnUse");
      const clipShape = el.cloneNode(false);
      clipShape.removeAttribute("fill");
      clipShape.removeAttribute("stroke");
      clipShape.removeAttribute("class");
      clipShape.removeAttribute("id");
      clipShape.removeAttribute("data-cv-export-bbox");
      clipPath.appendChild(clipShape);
      defs.appendChild(clipPath);

      const stripeGroup = document.createElementNS(svgns, "g");
      stripeGroup.setAttribute("clip-path", `url(#${clipId})`);
      stripeGroup.setAttribute("class", "export-hatch");

      const spacing = 6;
      const strokeWidth = 2;
      const extent = width + height + (spacing * 2);
      const start = y - width - spacing;
      const end = y + height + width + spacing;
      for (let yy = start; yy <= end; yy += spacing) {
        const line = document.createElementNS(svgns, "line");
        line.setAttribute("x1", x - spacing);
        line.setAttribute("y1", yy);
        line.setAttribute("x2", x - spacing + extent);
        line.setAttribute("y2", yy + extent);
        line.setAttribute("stroke", patternColor.color);
        line.setAttribute("stroke-opacity", patternColor.opacity);
        line.setAttribute("stroke-width", strokeWidth);
        line.setAttribute("stroke-linecap", "butt");
        stripeGroup.appendChild(line);
      }

      el.setAttribute("fill", "none");
      el.removeAttribute("data-cv-export-bbox");
      el.parentNode.insertBefore(stripeGroup, el.nextSibling);
    }
  }

  normalizePatternReferencesForExport(svgDoc) {
    const patternedElements = svgDoc.querySelectorAll("[fill]");
    for (const el of patternedElements) {
      const fill = el.getAttribute("fill");
      const patternId = this.getPatternFillId(fill);
      if (patternId) {
        el.setAttribute("fill", `url(#${patternId})`);
      }
    }

    const patternRects = svgDoc.querySelectorAll("pattern rect[fill]");
    for (const rect of patternRects) {
      const fill = rect.getAttribute("fill");
      const match = fill && fill.match(/^rgba\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)$/);
      if (match) {
        rect.setAttribute("fill", `rgb(${match[1]}, ${match[2]}, ${match[3]})`);
        rect.setAttribute("fill-opacity", match[4]);
      }
    }
  }

  convertRoundRectsToCircles(svgDoc) {
    const rects = svgDoc.querySelectorAll("rect");
    for (const rect of rects) {
      const width = Number(rect.getAttribute("width"));
      const height = Number(rect.getAttribute("height"));
      const rx = Number(rect.getAttribute("rx"));
      const ry = Number(rect.getAttribute("ry"));

      if (!width || !height || !rx || !ry) continue;
      if (Math.abs(width - height) > 0.01) continue;
      if (Math.abs(rx - width / 2) > 0.01 || Math.abs(ry - height / 2) > 0.01) continue;

      const x = Number(rect.getAttribute("x") || 0);
      const y = Number(rect.getAttribute("y") || 0);
      const circle = document.createElementNS(svgns, "circle");
      circle.setAttribute("cx", x + width / 2);
      circle.setAttribute("cy", y + height / 2);
      circle.setAttribute("r", width / 2);

      for (const attr of rect.attributes) {
        if (!["x", "y", "width", "height", "rx", "ry"].includes(attr.name)) {
          circle.setAttribute(attr.name, attr.value);
        }
      }

      rect.parentNode.replaceChild(circle, rect);
    }
  }

  // reads MI JSON format
  readMIJSON(miJson, expand = true) {
    readMijson(miJson, this, expand);
    this.init();
  }

  checkLinks() {
    for (let link of this.allNaryLinks.values()) {
      link.check();
    }
    for (let link of this.allBinaryLinks.values()) {
      link.check();
    }
    for (let link of this.allUnaryLinks.values()) {
      link.check();
    }
    for (let link of this.allSequenceLinks.values()) {
      link.check();
    }
  }

  setAllLinkCoordinates() {
    for (let link of this.allNaryLinks.values()) {
      link.setLinkCoordinates();
    }
    for (let link of this.allBinaryLinks.values()) {
      link.setLinkCoordinates();
    }
    for (let link of this.allUnaryLinks.values()) {
      link.setLinkCoordinates();
    }
    for (let link of this.allSequenceLinks.values()) {
      link.setLinkCoordinates();
    }
  }

  moveTooltip(p) {
    let ttX, ttY;
    const length = this.tooltip.getComputedTextLength() + 16;
    const width = this.svgElement.parentNode.clientWidth;
    const height = this.svgElement.parentNode.clientHeight;
    if (p.x + 20 + length < width) {
      ttX = p.x;
    } else {
      ttX = width - length - 20;
    }

    if (p.y + 60 < height) {
      ttY = p.y;
    } else {
      ttY = height - 60;
    }
    this.tooltip.setAttribute("x", ttX + 22);
    this.tooltip.setAttribute("y", ttY + 47);
    this.tooltip_bg.setAttribute("x", ttX + 16);
    this.tooltip_bg.setAttribute("y", ttY + 28);
    this.tooltip_subBg.setAttribute("x", ttX + 16);
    this.tooltip_subBg.setAttribute("y", ttY + 28);
  }

  setTooltip(text, color) {
    if (this.dragStart) return;

    if (text) {
      this.tooltip.firstChild.data = text.toString().replace(/&(quot);/g, "\"");
      this.tooltip.setAttribute("display", "block");
      const length = this.tooltip.getComputedTextLength();
      this.tooltip_bg.setAttribute("width", length + 16);
      this.tooltip_subBg.setAttribute("width", length + 16);
      if (typeof color !== "undefined" && color != null) {
        this.tooltip_bg.setAttribute("fill", color);
        this.tooltip_bg.setAttribute("stroke", color);
        this.tooltip_bg.setAttribute("fill-opacity", "0.0");
      } else {
        this.tooltip_bg.setAttribute("fill", "white");
        this.tooltip_bg.setAttribute("stroke", "grey");
      }
      // todo - whats this height for?
      this.tooltip_bg.setAttribute("height", "28");
      this.tooltip_subBg.setAttribute("height", "28");
      this.tooltip_bg.setAttribute("display", "block");
      this.tooltip_subBg.setAttribute("display", "block");
    } else {
      this.hideTooltip();
    }
  }

  showTooltip(p) {
    this.moveTooltip(p);
    this.tooltip.setAttribute("display", "block");
    this.tooltip_bg.setAttribute("display", "block");
    this.tooltip_subBg.setAttribute("display", "block");
  }

  hideTooltip() {
    this.tooltip.setAttribute("display", "none");
    this.tooltip_bg.setAttribute("display", "none");
    this.tooltip_subBg.setAttribute("display", "none");
  }

//for backwards compatibility (noe?)
  setAnnotations(annoChoice) {
    // [FIXED]: compare case-insensitively (keys are e.g. "MI Features", not "MI FEATURES")
    const choice = annoChoice.toUpperCase();
    for (let annoType of this.annotationSetsShown.keys()) {
      this.annotationSetsShown.set(annoType, annoType.toUpperCase() === choice);
    }
    this.updateAnnotations();
    return this.getColorKeyJson();
  }

  showAnnotations(annoChoice, show) {
    this.annotationSetsShown.set(annoChoice, show);
    this.updateAnnotations();
    return this.getColorKeyJson();
  }

  resetAnnotationSetLoadingState() {
    INTERNAL_ANNOTATION_SETS
      .forEach(annotationSet => this.annotationSetsLoaded.set(annotationSet, true));
    EXTERNAL_ANNOTATION_SETS
      .forEach(annotationSet => this.annotationSetsLoaded.set(annotationSet, false));
  }

  setAnnotationSetLoading(annotationSet) {
    this.annotationSetsLoaded.set(annotationSet, false);
  }

  setAnnotationSetLoaded(annotationSet) {
    this.annotationSetsLoaded.set(annotationSet, true);
    this.updateAnnotations(); // Update annotations after having loaded a set
  }

  isAnnotationSetRenderable(annotationSet) {
    return this.annotationSetsShown.get(annotationSet) === true
      && this.annotationSetsLoaded.get(annotationSet) !== false;
  }

  updateAnnotations() {
    //clear stuff
    this.defs.textContent = ""; // clears hatched fills
    this.uncertainCategories = new Set();
    this.certainCategories = new Set();
    delete this.featureColors; // a d3.scale.ordinal
    // figure out which categories are visible
    const categories = new Set();
    for (let participant of this.participants.values()) {
      for (let [annotationType, annotationSet] of participant.annotationSets) {
        if (this.isAnnotationSetRenderable(annotationType)) {
          for (let annotation of annotationSet.values()) {
            categories.add(annotation.category);
          }
        }
      }
    }

    // [ADDED]: fixed color scale for interactors.
    // Built once per dataset from ALL participants, regardless of which
    // annotation sets are currently shown, so interactor colors never change
    // when other features are toggled on/off.
    if (!this.interactorColors) {
      const interactorCats = [];
      for (const p of this.participants.values()) {
        const set = p.annotationSets.get("Interactor");
        if (set) {
          for (const a of set) {
            if (!interactorCats.includes(a.category)) {
              interactorCats.push(a.category);
            }
          }
        }
      }
      // [MODIFIED]: palette grows with the number of interactors (no repeats past 20)
      this.interactorColors = scaleOrdinal().domain(interactorCats).range(makePalette(interactorCats.length));
    }
    const interactorDomain = new Set(this.interactorColors.domain());
    const reservedColors = new Set([...interactorDomain].map(c => this.interactorColors(c)));

    // [MODIFIED]: color scale for all other features. Categories with a fixed
    // DisProt/AlphaFold color are left out; the palette avoids interactor colors
    // and anything close to them or to the fixed colors.
    // Sorted domain makes these colors stable too.
    const otherCats = [...categories]
      .filter(c => !interactorDomain.has(c) && !DISPROT_COLORS[c] && !ALPHAFOLD_COLORS[c])
      .sort();
    const featurePalette = makePalette(otherCats.length, [...reservedColors]);
    const colorScheme = scaleOrdinal()
      .domain(otherCats)
      .range(featurePalette);

    const self = this;

    // [MODIFIED]: fixed DisProt and AlphaFold colors now live at module level
    // (DISPROT_COLORS, ALPHAFOLD_COLORS) so the palettes can avoid them.
    const getCustomOrNormalColor = (category) =>
      ALPHAFOLD_COLORS[category]
      || DISPROT_COLORS[category]
      || (interactorDomain.has(category)
        ? this.interactorColors(category)
        : colorScheme(category));

    function createHatchedFill(name, color, opacity = 1) {
      const pattern = self.defs.append("pattern")
        .attr("id", name)
        .attr("patternUnits", "userSpaceOnUse")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", 12)
        .attr("height", 12)
        .attr("patternTransform", "rotate(45)");
      pattern.append("rect")
        .attr("x", 0)
        .attr("y", 2)
        .attr("width", 12)
        .attr("height", 4)
        .attr("fill", color)
        .attr("fill-opacity", opacity);
      pattern.append("rect")
        .attr("x", 0)
        .attr("y", 8)
        .attr("width", 12)
        .attr("height", 4)
        .attr("fill", color)
        .attr("fill-opacity", opacity);
    }

    for (let participant of this.participants.values()) {
      if (participant.type === "protein") {
        participant.clearPositionalFeatures();
        participant.updatePositionalFeatures();
        for (let [annotationType, annotations] of participant.annotationSets) {
          if (this.isAnnotationSetRenderable(annotationType)) {
            for (let anno of annotations) {
              let color;
              if (anno.description === "No annotations") {
                color = "#eeeeee";
              } else {
                //[MODIFIED]: Use the unified color selector instead of just DisProt
                color = getCustomOrNormalColor(anno.category);
              }
              if (anno.certain) {
                anno.certain.setAttribute("fill", color);
                anno.certain.setAttribute("stroke", color);
                this.certainCategories.add(anno.category);
              }
              if (anno.fuzzyStart || anno.fuzzyEnd) {
                if (!this.uncertainCategories.has(anno.category)) {
                  createHatchedFill(hatchId(anno.category, color), color, 0.6);
                  this.uncertainCategories.add(anno.category);
                }
                const checkedFill = `url(#${hatchId(anno.category, color)})`;
                if (anno.fuzzyStart) {
                  anno.fuzzyStart.setAttribute("fill", checkedFill);
                  anno.fuzzyStart.setAttribute("stroke", color);
                }
                if (anno.fuzzyEnd) {
                  anno.fuzzyEnd.setAttribute("fill", checkedFill);
                  anno.fuzzyEnd.setAttribute("stroke", color);
                }
              }
            }
          }
        }
      }
    }
    //[MODIFIED]: Assign the new unified color resolver to featureColors
    this.featureColors = getCustomOrNormalColor;

    // [ADDED]: annotation paths were just rebuilt, so re-apply any legend highlight
    this.applyAnnotationHighlight();
  }

  // [ADDED]: legend-driven highlighting ---------------------------------------

  // Accepts the annotation set id ("InterPro") or its legend label ("InterPro Domains").
  resolveAnnotationSet(setOrLabel) {
    if (this.annotationSetsShown.has(setOrLabel)) return setOrLabel;
    for (const [set, label] of Object.entries(ANNOTATION_SET_LABELS)) {
      if (label === setOrLabel) return set;
    }
    return null;
  }

  // Proteins that carry an annotation of `category` in `annotationSet`.
  getParticipantsWithAnnotation(annotationSet, category) {
    const set = this.resolveAnnotationSet(annotationSet);
    const matches = [];
    if (!set) return matches;
    for (const p of this.participants.values()) {
      const annos = p.annotationSets && p.annotationSets.get(set);
      if (annos && annos.some(a => a.category === category && a.description !== "No annotations")) {
        matches.push(p);
      }
    }
    return matches;
  }

  // Highlight the proteins that have this annotation category and, inside them,
  // the regions of that category; everything else is faded. Calling it again
  // with the same category (or with null) clears the highlight.
  // Returns {annotationSet, category, participants: [names]} or null when cleared.
  highlightAnnotationCategory(annotationSet, category, fadedOpacity) {
    const set = annotationSet ? this.resolveAnnotationSet(annotationSet) : null;
    if (fadedOpacity != null) this.highlightOpacityLevel = fadedOpacity; // only change it when given
    const current = this.highlightedAnnotation;
    if (!set || category == null || (current && current.annotationSet === set && current.category === category)) {
      this.highlightedAnnotation = null;
    } else {
      this.highlightedAnnotation = {annotationSet: set, category};
    }
    this.applyAnnotationHighlight();
    return this.getHighlightedAnnotation();
  }

  setHighlightOpacityLevel(opacity) {
    this.highlightOpacityLevel = opacity;
    this.applyAnnotationHighlight();
  }

  clearAnnotationHighlight() {
    this.highlightedAnnotation = null;
    this.applyAnnotationHighlight();
  }

  getHighlightedAnnotation() {
    const h = this.highlightedAnnotation;
    if (!h) return null;
    return {
      annotationSet: h.annotationSet,
      category: h.category,
      participants: this.getParticipantsWithAnnotation(h.annotationSet, h.category).map(p => p.name || p.id)
    };
  }

  applyAnnotationHighlight() {
    let h = this.highlightedAnnotation;
    // the highlighted set was switched off -> drop the highlight
    if (h && !this.isAnnotationSetRenderable(h.annotationSet)) {
      this.highlightedAnnotation = h = null;
    }
    const matches = h ? new Set(this.getParticipantsWithAnnotation(h.annotationSet, h.category)) : null;

    for (const p of this.participants.values()) {
      if (!p.upperGroup) continue;
      const isMatch = !matches || matches.has(p);
      p.upperGroup.setAttribute("opacity", isMatch ? 1 : this.highlightOpacityLevel);

      if (!p.annotationSets) continue;
      for (const [annotationType, annotations] of p.annotationSets) {
        for (const anno of annotations) {
          const keep = !h || (annotationType === h.annotationSet && anno.category === h.category);
          for (const el of [anno.certain, anno.fuzzyStart, anno.fuzzyEnd]) {
            if (el) el.setAttribute("opacity", keep ? 1 : this.highlightOpacityLevel);
          }
        }
      }
    }
    // fade links that don't connect two highlighted proteins
    for (const links of [this.allBinaryLinks, this.allUnaryLinks, this.allSequenceLinks]) {
      for (const link of links.values()) {
        const parts = link.participants || [];
        const keep = !matches || parts.every(pp => matches.has(pp));
        for (const el of [link.line, link.highlightLine, link._glyph, link._uncertainGlyph]) {
          if (el && el.setAttribute) el.setAttribute("opacity", keep ? 1 : this.highlightOpacityLevel);
        }
      }
    }
  }

  getColorKeyJson() {
    const json = {"Complex": []};
    for (let name of NaryLink.naryColors.domain()) {
      json.Complex.push({"name": name, "certain": {"color": NaryLink.naryColors(name)}});
    }
    if (this.featureColors) {
      for (let [annotationSet, shown] of this.annotationSetsShown) {
        if (shown && this.isAnnotationSetRenderable(annotationSet)) {
          const featureTypes = [];
          const dupCheck = new Set();
          const proteinsPerCategory = new Map(); // [ADDED]: category -> proteins that have it
          for (let p of this.participants.values()) {
            if (p.type === "protein") {
              const annos = p.annotationSets.get(annotationSet);
              if (annos) {
                for (let anno of annos) {
                  const category = anno.category;
                  if (!proteinsPerCategory.has(category)) proteinsPerCategory.set(category, new Set());
                  proteinsPerCategory.get(category).add(p);
                  if (!dupCheck.has(category)) {
                    dupCheck.add(category);
                    const featureType = {
                      "name": category
                    };
                    if (this.certainCategories.has(category)) {
                      featureType.certain = {"color": this.featureColors(category)};
                    }
                    if (this.uncertainCategories.has(category)) {
                      // make transparent version of color
                      const temp = new Rgb_color(this.featureColors(category));
                      const transpColor = `rgba(${temp.r},${temp.g},${temp.b}, 0.6)`;
                      featureType.uncertain = {"color": transpColor};
                    }
                    featureTypes.push(featureType);
                  }
                }
              }
            }
          }
          // [ADDED]: how many proteins carry each category, and whether it is highlighted
          const h = this.highlightedAnnotation;
          for (const ft of featureTypes) {
            ft.count = proteinsPerCategory.has(ft.name) ? proteinsPerCategory.get(ft.name).size : 0;
            ft.highlighted = !!(h && h.annotationSet === annotationSet && h.category === ft.name);
          }
          const label = ANNOTATION_SET_LABELS[annotationSet] || annotationSet;
          json[label] = featureTypes;
        }
      }
    }
    return json;
  }

  collapseAll() {
    for (let participant of this.participants.values()) {
      if (participant.expanded) {
        participant.toCircle(false);//param means don't animate change to circle
      }
    }
    this.autoLayout();
    this.notifyExpandListeners();
  }

  expandAll() {
    for (let participant of this.participants.values()) {
      if (participant.type === "protein" && !participant.expanded) {
        participant.toStick(false);//param means don't animate change to circle
      }
    }
    this.autoLayout();
    this.notifyExpandListeners();
  }

  // IntAct needs to select which att to use as id (idType param) but they require changes to JAMI json first
  // function from noe:
  expandAndCollapseSelection(moleculesSelected) { // , idType) {
    for (let participant of this.participants.values()) {
      const molecule_id = participant.json.identifier.id;
      if (moleculesSelected.includes(molecule_id)) {
        if (!participant.expanded) {
          participant.setExpanded(true);
        }
      } else if (participant.expanded) {
        participant.setExpanded(false);
      }
    }
    this.notifyExpandListeners();
  }

  // [ADDED]: on touch screens there is no hover, so a tap shows the same yellow
  // highlight halo as mouse-over on desktop. It stays until another participant
  // or the background is tapped. Hover listeners are notified as on desktop.
  setTouchedParticipant(participant) {
    const previous = this.touchedParticipant;
    if (previous && previous !== participant) {
      previous.showHighlight(false);
    }
    this.touchedParticipant = participant || null;
    if (participant) {
      participant.showHighlight(true);
      this.notifyHoverListeners([participant.json]);
    } else if (previous) {
      this.notifyHoverListeners([]);
    }
  }

  addHoverListener(hoverListener) {
    this.hoverListeners.add(hoverListener);
  }

  removeHoverListener(hoverListener) {
    this.hoverListeners.delete(hoverListener); // [FIXED]: Set has delete(), not remove()
  }

  notifyHoverListeners(interactorArr) {
    for (let hl of this.hoverListeners) {
      hl(interactorArr);
    }
  }

  addExpandListener(expandListener) {
    this.expandListeners.add(expandListener);
  }

  removeExpandListener(expandListener) {
    this.expandListeners.delete(expandListener);
  }

  addAnnotationListener(annotationListener) {
    this.annotationListeners.add(annotationListener);
  }

  removeAnnotationListener(annotationListener) {
    this.annotationListeners.delete(annotationListener);
  }

  notifyAnnotationListeners(annotationEvent) {
    for (let al of this.annotationListeners) {
      al(annotationEvent);
    }
  }

  notifyExpandListeners() {
    const expandedParticipants = this.getExpandedParticipants();
    for (let hl of this.expandListeners) {
      hl(expandedParticipants);
    }
  }

  getExpandedParticipants() {
    const expanded = [];
    for (let participant of this.participants.values()) {
      if (participant.postAnimExpanded) {
        expanded.push(participant.json);
      }
    }
    return expanded;
  }

  setCTM(element, matrix) {
    const s = `matrix(${matrix.a},${matrix.b},${matrix.c},${matrix.d},${matrix.e},${matrix.f})`;
    element.setAttribute("transform", s);
  }

  //listeners also attached to mouse events by Interactor (and Rotator) and Link, those consume their events
  //mouse down on svgElement must be allowed to propagate (to fire event on interactors/links)
  mouseDown(evt) {
    evt.preventDefault();
    this.d3cola.stop();
    this.dragStart = evt;
    this.draggedElement = null;
    this.state = App.STATES.SELECT_PAN;
    d3.select(".custom-menu-margin").style("display", "none");
  }

  touchStart(evt) {
    evt.preventDefault();
    this.setTouchedParticipant(null); // [ADDED]: tapping the background removes the halo
    this.d3cola.stop();
    this.dragStart = evt;
    this.draggedElement = null;
    this.state = App.STATES.SELECT_PAN;
    d3.select(".custom-menu-margin").style("display", "none");
  }

  move(evt) {
    const p = this.getEventPoint(evt);
    const c = p.matrixTransform(this.container.getCTM().inverse());
    if (c.x) { // if mouse is off screen then !c.x
      if (this.dragStart) { //initially set by mouse down on container svg element, participant or link
        this.hideTooltip();
        const ds = this.getEventPoint(this.dragStart).matrixTransform(this.container.getCTM().inverse());
        if (this.dragElement != null) { // mouse down on participant or link
          // console.log("DRAG!");
          const dx = ds.x - c.x;
          const dy = ds.y - c.y;
          if (this.state === App.STATES.DRAGGING) { // if mouse moved sufficiently to start dragging
            // console.log("DRAG ACTIVE!");
            this.draggedElement = this.dragElement;
            if (!this.dragElement.ix) { //if is link or complex
              for (let participant of this.dragElement.participants) {
                participant.changePosition(dx, dy);
              }
              this.setAllLinkCoordinates();
            } else { // else its an individual biomolecule
              this.dragElement.changePosition(dx, dy);
              this.dragElement.setAllLinkCoordinates();
            }
            this.dragStart = evt;
          } else if (Math.sqrt(dx * dx + dy * dy) > (5 * this.z)) {//not dragging or rotating yet, maybe we should start
            // console.log("MAKING DRAG ACTIVE!");
            this.state = App.STATES.DRAGGING;
          }
        }
        // [MODIFIED]: panning the background is now done by d3.zoom
      } else { // !this.dragStart
        // console.log("TOOLTIP POSITION!");
        this.moveTooltip(p);
      }
    }
  }

  // this ends all dragging and rotating
  mouseUp(evt) { //could be tidied up
    this.preventDefaultsAndStopPropagation(evt);
    const time = new Date().getTime();
    //eliminate some spurious mouse up events - a simple version of debouncing but it seems to work better than for e.g. _.debounce
    const p = this.getEventPoint(evt);
    if ((time - this.lastMouseUp) > 150) {
      if (this.dragElement && this.dragElement.type === "protein" && this.state !== App.STATES.DRAGGING && !this.dragElement.busy) {
        if (!this.dragElement.expanded) {
          this.dragElement.setExpanded(true);
          this.notifyExpandListeners();
        } else {
          this.contextMenuProt = this.dragElement;
          // if (isNaN(p.x)) { //?
          //     // alert("isNaN", p);
          //     // alert(p.x);
          //     p = this.getEventPoint(this.dragStart);
          // }
          this.contextMenuPoint = p.matrixTransform(this.container.getCTM().inverse());

          // ADD annotation links in the menu based on their display

          EXTERNAL_ANNOTATION_SETS.forEach(annotationSet => {
            const anno = this.isAnnotationSetRenderable(annotationSet)
              ? (this.dragElement.annotationSets.get(annotationSet) || []).find(a => a.url)
              : null;
            this.annotationLinks[annotationSet]
              .style("display", anno ? null : "none")
              .select("a").attr("href", anno?.url);
          });


          const menu = d3.select(".custom-menu-margin");
          let pageX, pageY;
          if (evt.pageX) {
            pageX = evt.pageX;
            pageY = evt.pageY;
          } else {
            pageX = this.dragStart.touches[0].pageX;
            pageY = this.dragStart.touches[0].pageY;
          }
          menu.style("top", `${pageY - 20}px`).style("left", `${pageX - 20}px`).style("display", "block");
          d3.select(`.scaleButton_${this.dragElement.stickZoom * 100}`).property("checked", true);
        }
      }
    }
    // this.showTooltip(p);
    this.dragElement = null;
    this.dragStart = null;//{};// should prob make that null here and use it as a check in move()
    this.state = App.STATES.MOUSE_UP;
    this.lastMouseUp = time;
    return false;
  }

  mouseOut() {
    this.hideTooltip();
  }

  getEventPoint(evt) {
    const p = this.svgElement.createSVGPoint();
    // [FIXED]: touch events have no pageX/pageY; read them from the first touch
    // (touchend only has changedTouches)
    let src = evt;
    if (evt.touches && evt.touches.length) {
      src = evt.touches[0];
    } else if (evt.changedTouches && evt.changedTouches.length) {
      src = evt.changedTouches[0];
    }
    const offset = $(this.el).offset();
    p.x = src.pageX - offset.left;
    p.y = src.pageY - offset.top;
    return p;
  }

  //stop event propagation and defaults; only do what we ask
  preventDefaultsAndStopPropagation(evt) {
    if (evt.stopPropagation)
      evt.stopPropagation();
    if (evt.cancelBubble != null)
      evt.cancelBubble = true;
    if (evt.preventDefault)
      evt.preventDefault();
  }

  downloadSVG(fileName) {
    if (!fileName) {
      fileName = "complexViewer";
    }

    const content = this.getSVG();
    const newContentType = "image/svg+xml;charset=utf-8";

    function dataURItoBlob(binary) {
      let array = [];
      let te;

      try {
        te = new TextEncoder("utf-8");
      } catch (e) {
        te = undefined;
      }

      if (te) {
        array = te.encode(binary); // html5 encoding api way
      } else {
        // https://stackoverflow.com/a/18729931/368214
        // fixes unicode bug
        for (let i = 0; i < binary.length; i++) {
          let charCode = binary.charCodeAt(i);
          if (charCode < 0x80) array.push(charCode);
          else if (charCode < 0x800) {
            array.push(0xc0 | (charCode >> 6),
              0x80 | (charCode & 0x3f));
          } else if (charCode < 0xd800 || charCode >= 0xe000) {
            array.push(0xe0 | (charCode >> 12),
              0x80 | ((charCode >> 6) & 0x3f),
              0x80 | (charCode & 0x3f));
          } else { // surrogate pair
            i++;
            // UTF-16 encodes 0x10000-0x10FFFF by
            // subtracting 0x10000 and splitting the
            // 20 bits of 0x0-0xFFFFF into two halves
            charCode = 0x10000 + (((charCode & 0x3ff) << 10) |
              (binary.charCodeAt(i) & 0x3ff));
            array.push(0xf0 | (charCode >> 18),
              0x80 | ((charCode >> 12) & 0x3f),
              0x80 | ((charCode >> 6) & 0x3f),
              0x80 | (charCode & 0x3f));
          }
        }
      }

      return new Blob([new Uint8Array(array)], {
        type: newContentType
      });
    }

    let blob = dataURItoBlob(content);

    if (navigator.msSaveOrOpenBlob) {
      navigator.msSaveOrOpenBlob(blob, fileName);
    } else {
      const a = document.createElement("a");
      a.href = window.URL.createObjectURL(blob);
      // Give filename you wish to download
      a.download = fileName;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(a.href); // clear up url reference to blob so it can be g.c.'ed
    }

    blob = null;
  }

  downloadPNG(fileName, scale = 2) {
    if (!fileName) {
      fileName = "complexViewer.png";
    }

    const svgContent = this.getSVG();
    const svgBlob = new Blob([svgContent], {type: "image/svg+xml;charset=utf-8"});
    const svgUrl = window.URL.createObjectURL(svgBlob);
    const image = new Image();

    image.onload = () => {
      const width = Math.max(1, this.svgElement.parentNode.clientWidth || this.svgElement.clientWidth || image.width);
      const height = Math.max(1, this.svgElement.parentNode.clientHeight || this.svgElement.clientHeight || image.height);
      const pixelRatio = Math.max(1, scale);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);

      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      window.URL.revokeObjectURL(svgUrl);
      canvas.toBlob(blob => {
        if (!blob) return;
        if (navigator.msSaveOrOpenBlob) {
          navigator.msSaveOrOpenBlob(blob, fileName);
        } else {
          const a = document.createElement("a");
          a.href = window.URL.createObjectURL(blob);
          a.download = fileName;
          a.style.display = "none";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(a.href);
        }
      }, "image/png");
    };

    image.onerror = () => {
      window.URL.revokeObjectURL(svgUrl);
      console.error("Could not render SVG export as PNG.");
    };

    image.src = svgUrl;
  }

}

//static values signifying Controller's status
App.STATES = {
  MOUSE_UP: 0, //start state, also set when mouse up on svgElement
  SELECT_PAN: 1, //set by mouse down on svgElement - //left button only?
  DRAGGING: 2 //set by mouse down on Protein or Link
};

App.barScales = [0.01, /*0.015,*/ 0.2, 1, 2, 4, 8];