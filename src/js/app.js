import "../css/xinet.css";
import packageInfo from "../../package.json";
import * as d3 from "d3";
import * as cola from "./cola";

import {svgUtils} from "./svgexp";
import {readMijson} from "./read-mijson";
import {fetchAnnotations} from "./annotation-utils";

import {NaryLink} from "./viz/link/nary-link";
import {svgns} from "./svgns";
import {
  createHatchedFill,
  hatchId,
  makeComplexColorScale,
  makeFeatureColorResolver,
  makeInteractorColorScale,
  withAlpha
} from "./color";
import {
  annotatePatternFillBBoxes,
  clearPatternFillBBoxAnnotations,
  downloadPNGFromSVGString,
  downloadSVGString,
  prepareSVGForExport
} from "./export";
import {setupZoom} from "./zoom";
import {applyAnnotationHighlight, participantsWithAnnotation} from "./annotation-highlight";

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
      .attr("class", d => `scaleButton scaleButton_${d * 100}`)
      .attr("name", "scaleButtons")
      .attr("type", "radio")
      .on("change", (e, d) => {
        this.preventDefaultsAndStopPropagation(e); 
        this.contextMenuProt.setStickScale(d, this.contextMenuPoint);
      });
    const contextMenu = d3.select(".custom-menu-margin").node();

    const self = this;
    contextMenu.onmouseout = function (evt) {
      // avoid relatedTarget being null when the pointer leaves the window
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

    this.zoomBehavior = setupZoom(this);

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

    this.interactorColors = null; // built once per dataset, see updateAnnotations()
    this.highlightedAnnotation = null; // {annotationSet, category} clicked in the legend
    this.touchedParticipant = null; // pressed participant/complex, shows the hover halo

    NaryLink.naryColors = makeComplexColorScale();

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
      // 100% if it fits, otherwise shrink into the drawable area. The bottom
      // margin keeps the acknowledgement from overlapping the graph.
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
    annotatePatternFillBBoxes(this.svgElement);
    const svgSel = d3.select(this.el).selectAll("svg");
    const svgArr = [svgSel.node()];
    // a tap halo is still on while the user taps Export: keep it out of the image
    const touched = this.touchedParticipant;
    if (touched) touched.showHighlight(false);
    let svgStrings;
    try {
      svgStrings = svgUtils.capture(svgArr);
    } finally {
      clearPatternFillBBoxAnnotations(this.svgElement);
      if (touched) touched.showHighlight(true);
    }
    prepareSVGForExport(svgStrings[0]);
    return svgUtils.makeXMLStr(new XMLSerializer(), svgStrings[0]);
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
    // keys are e.g. "MI Features", so compare case-insensitively
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
    delete this.featureColors; // category -> color function
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

    // Interactor colors are built from all participants, whatever annotation
    // sets are shown, so they don't change when sets are toggled.
    if (!this.interactorColors) {
      const interactorCats = new Set();
      for (const p of this.participants.values()) {
        for (const a of p.annotationSets.get("Interactor") || []) interactorCats.add(a.category);
      }
      this.interactorColors = makeInteractorColorScale([...interactorCats]);
    }
    const getColor = makeFeatureColorResolver(categories, this.interactorColors);

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
                color = getColor(anno.category);
              }
              if (anno.certain) {
                anno.certain.setAttribute("fill", color);
                anno.certain.setAttribute("stroke", color);
                this.certainCategories.add(anno.category);
              }
              if (anno.fuzzyStart || anno.fuzzyEnd) {
                if (!this.uncertainCategories.has(anno.category)) {
                  createHatchedFill(this.defs, hatchId(anno.category, color), color, 0.6);
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
    this.featureColors = getColor;

    // annotation paths were just rebuilt, so re-apply any legend highlight
    this.applyAnnotationHighlight();
  }

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
    return set ? participantsWithAnnotation(this.participants.values(), set, category) : [];
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
    // the highlighted set was switched off -> drop the highlight
    if (this.highlightedAnnotation && !this.isAnnotationSetRenderable(this.highlightedAnnotation.annotationSet)) {
      this.highlightedAnnotation = null;
    }
    applyAnnotationHighlight(this, this.highlightedAnnotation, this.highlightOpacityLevel);
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
          const proteinsPerCategory = new Map(); // category -> proteins that have it
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
                      featureType.uncertain = {"color": withAlpha(this.featureColors(category), 0.6)};
                    }
                    featureTypes.push(featureType);
                  }
                }
              }
            }
          }
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

  // Touch screens have no hover, so a pressed participant shows the hover halo
  // while the finger is down. A complex (its NaryLink) can be pressed too, by
  // finger or mouse. Hover listeners are notified as on desktop.
  setTouchedParticipant(participant) {
    const previous = this.touchedParticipant;
    this.touchedParticipant = participant || null;
    if (previous && previous !== participant) {
      previous.showHighlight(false);
    }
    if (participant) {
      participant.showHighlight(true);
      const members = participant.participants || [participant];
      this.notifyHoverListeners(members.map(p => p.json).filter(Boolean));
    } else if (previous) {
      this.notifyHoverListeners([]);
    }
  }

  // true when the halo is kept on by a press, so mouseout must not hide it
  isHighlightPinned(participant) {
    return !!participant && this.touchedParticipant === participant;
  }

  addHoverListener(hoverListener) {
    this.hoverListeners.add(hoverListener);
  }

  removeHoverListener(hoverListener) {
    this.hoverListeners.delete(hoverListener);
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
    this.setTouchedParticipant(null);
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
        // panning the background is done by d3.zoom (see zoom.js)
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
    if (this.touchedParticipant) this.setTouchedParticipant(null);
    return false;
  }

  mouseOut() {
    this.hideTooltip();
  }

  getEventPoint(evt) {
    const p = this.svgElement.createSVGPoint();
    // touch events have no pageX/pageY: use the first touch (changedTouches on touchend)
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
    downloadSVGString(this.getSVG(), fileName || "complexViewer.svg");
  }

  downloadPNG(fileName, scale = 2) {
    const width = this.svgElement.parentNode.clientWidth || this.svgElement.clientWidth;
    const height = this.svgElement.parentNode.clientHeight || this.svgElement.clientHeight;
    downloadPNGFromSVGString(this.getSVG(), fileName || "complexViewer.png", width, height, scale);
  }

}

//static values signifying Controller's status
App.STATES = {
  MOUSE_UP: 0, //start state, also set when mouse up on svgElement
  SELECT_PAN: 1, //set by mouse down on svgElement - //left button only?
  DRAGGING: 2 //set by mouse down on Protein or Link
};

App.barScales = [0.01, /*0.015,*/ 0.2, 1, 2, 4, 8];