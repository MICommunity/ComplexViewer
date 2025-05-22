import "../css/xinet.css";
import packageInfo from "../../package.json";
import * as d3 from "d3";
import {scaleOrdinal} from "d3-scale";
import {schemePastel2, schemeTableau10} from "d3-scale-chromatic";
import * as cola from "./cola";
import Rgb_color from "rgb-color";

import {svgUtils} from "./svgexp";
import {readMijson} from "./read-mijson";
import {fetchAnnotations} from "./annotation-utils";

import {NaryLink} from "./viz/link/nary-link";
import {svgns} from "./svgns";

import $ from "jquery";

export class App {
    constructor(/*HTMLDivElement*/networkDiv, maxCountInitiallyExpanded = 4) {
        this.debug = false;
        this.el = networkDiv;
        //avoids prob with 'save - web page complete'
        this.el.textContent = ""; //https://stackoverflow.com/questions/3955229/remove-all-child-elements-of-a-dom-node-in-javascript
        this.maxCountInitiallyExpanded = maxCountInitiallyExpanded;
        this.d3cola = cola.d3adaptor(d3).groupCompactness(Number.MIN_VALUE).avoidOverlaps(true); //1e-5

        const customMenuSel = d3.select(this.el)
            .append("div").classed("custom-menu-margin", true)
            .append("div").classed("custom-menu", true)
            .append("ul");

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
                this.preventDefaultsAndStopPropagation(d);
                this.contextMenuProt.setStickScale(d, this.contextMenuPoint);
            });
        const contextMenu = d3.select(".custom-menu-margin").node();

        const self = this;
        contextMenu.onmouseout = function (evt) {
            let e = evt.relatedTarget;
            do {
                if (e === this) return;
                e = e.parentNode;
            } while (e);
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


        const mouseWheelEvt = (/Firefox/i.test(navigator.userAgent)) ? "DOMMouseScroll" : "mousewheel"; //FF doesn't recognize mousewheel as of FF3.x
        if (document.attachEvent) { //if IE (and Opera depending on user setting)
            this.svgElement.attachEvent(`on${mouseWheelEvt}`, evt => this.mouseWheel(evt));
        } else if (document.addEventListener) { //WC3 browsers
            this.svgElement.addEventListener(mouseWheelEvt, evt => this.mouseWheel(evt), false);
        }


        //functions that get interactor id of hover over thing
        this.hoverListeners = new Set();
        this.expandListeners = new Set();

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

        this.annotationSetsShown = new Map();
        this.annotationSetsShown.set("Interactor", false);
        this.annotationSetsShown.set("UniprotKB", false);
        this.annotationSetsShown.set("Superfamily", false);
        this.annotationSetsShown.set("MI Features", true);

        this.clear();
    }

    clear() {
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

        this.participants = new Map();
        this.allNaryLinks = new Map();
        this.allBinaryLinks = new Map();
        this.allUnaryLinks = new Map();
        this.allSequenceLinks = new Map();
        this.complexes = [];

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
        fetchAnnotations(this, () => this.updateAnnotations());
        this.checkLinks();
        this.autoLayout();
    }

    zoomToExtent() {
        const width = this.svgElement.parentNode.clientWidth;
        const height = this.svgElement.parentNode.clientHeight;
        const bbox = this.container.getBBox();
        let xr = (width / bbox.width).toFixed(4);
        let yr = (height / bbox.height).toFixed(4);
        let scaleFactor;
        if (yr < xr) {
            scaleFactor = yr;
        } else {
            scaleFactor = xr;
        }
        if (scaleFactor < 1) { ///didn't fit in div
            //console.log("no fit", scaleFactor);
            xr = (width - 40) / (bbox.width);
            yr = (height - 40) / (bbox.height);
            let scaleFactor;
            if (yr < xr) {
                scaleFactor = yr;
            } else {
                scaleFactor = xr;
            }

            if (scaleFactor > this.z) {
                scaleFactor = this.z;
            }

            //bbox.x + x = 0;
            let x = -bbox.x + (20 / scaleFactor);
            //box.y + y = 0
            let y = -bbox.y + (20 / scaleFactor);
            this.container.setAttribute("transform", `scale(${scaleFactor}) translate(${x} ${y}) `);
            this.z = this.container.getCTM().inverse().a;
        } else {
            //console.log("fit", scaleFactor);
            // this.container.setAttribute("transform", `scale(1) translate(${-(width / 2)} ${-bbox.y})`);
            const deltaWidth = width - bbox.width;
            const deltaHeight = height - bbox.height;
            //bbox.x + x = deltaWidth /2;
            let x = (deltaWidth / 2) - bbox.x;
            //box.y + y = deltaHeight / 2
            let y = (deltaHeight / 2) - bbox.y;
            this.container.setAttribute("transform", `scale(1) translate(${x} ${y})`);
            this.z = 1;
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
                                x: d =>  d.bounds.x, // + (width / 2);
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
        const svgSel = d3.select(this.el).selectAll("svg");
        const svgArr = [svgSel.node()];
        const svgStrings = svgUtils.capture(svgArr);
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
        annoChoice = annoChoice.toUpperCase();
        for (let annoType of this.annotationSetsShown.keys()) {
            this.annotationSetsShown.set(annoType, annoChoice === annoType);
        }
        this.updateAnnotations();
        return this.getColorKeyJson();
    }

    showAnnotations(annoChoice, show) {
        this.annotationSetsShown.set(annoChoice, show);
        this.updateAnnotations();
        return this.getColorKeyJson();
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
                if (this.annotationSetsShown.get(annotationType) === true) {
                    for (let annotation of annotationSet.values()) {
                        categories.add(annotation.description);
                    }
                }
            }
        }
        //choose appropriate color scheme
        let colorScheme;
        if (categories.size <= 10) {
            colorScheme = scaleOrdinal().range(schemeTableau10);
        } else {
            colorScheme = d3.scaleOrdinal().range([
                "#38cae3",
                "#d4582b",
                "#7d5fd7",
                "#7cd352",
                "#ce4bbb",
                "#5aa33c",
                "#93539d",
                "#d2c33b",
                "#5c83d4",
                "#e19a46",
                "#d891d7",
                "#65da9a",
                "#9d772f",
                "#d43f4c",
                "#4db186",
                "#cf4b7e",
                "#477c3a",
                "#c46d5c",
                "#b6c671",
                "#798126"
            ]); // Generated from https://medialab.github.io/iwanthue/
        }

        const self = this;

        function createHatchedFill(name, color) {
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
                .attr("fill", color);
            pattern.append("rect")
                .attr("x", 0)
                .attr("y", 8)
                .attr("width", 12)
                .attr("height", 4)
                .attr("fill", color);
        }

        for (let participant of this.participants.values()) {
            if (participant.type === "protein") {
                participant.clearPositionalFeatures();
                participant.updatePositionalFeatures();
                for (let [annotationType, annotations] of participant.annotationSets) {
                    if (this.annotationSetsShown.get(annotationType) === true) {
                        for (let anno of annotations) {
                            let color;
                            if (anno.description === "No annotations") {
                                color = "#eeeeee";
                            } else {
                                color = colorScheme(anno.description);
                            }
                            if (anno.certain) {
                                anno.certain.setAttribute("fill", color);
                                anno.certain.setAttribute("stroke", color);
                                this.certainCategories.add(anno.description);
                            }
                            if (anno.fuzzyStart || anno.fuzzyEnd) {
                                if (!this.uncertainCategories.has(name)) {
                                    // make transparent version of color
                                    const temp = new Rgb_color(color);
                                    const transpColor = `rgba(${temp.r},${temp.g},${temp.b}, 0.6)`;
                                    createHatchedFill(`hatched_${anno.description}_${color.toString()}`, transpColor);
                                    this.uncertainCategories.add(anno.description);
                                }
                                const checkedFill = `url('#hatched_${anno.description}_${color.toString()}')`;
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
        this.featureColors = colorScheme;
    }

    getColorKeyJson() {
        const json = {"Complex": []};
        for (let name of NaryLink.naryColors.domain()) {
            json.Complex.push({"name": name, "certain": {"color": NaryLink.naryColors(name)}});
        }
        if (this.featureColors) {
            for (let [annotationSet, shown] of this.annotationSetsShown) {
                if (shown) {
                    const featureTypes = [];
                    const dupCheck = new Set();
                    for (let p of this.participants.values()) {
                        if (p.type === "protein") {
                            const annos = p.annotationSets.get(annotationSet);
                            if (annos) {
                                for (let anno of annos) {
                                    const desc = anno.description;
                                    if (!dupCheck.has(desc)) {
                                        dupCheck.add(desc);
                                        const featureType = {
                                            "name": desc
                                        };
                                        if (this.certainCategories.has(desc)) {
                                            featureType.certain = {"color": this.featureColors(desc)};
                                        }
                                        if (this.uncertainCategories.has(desc)) {
                                            // make transparent version of color
                                            const temp = new Rgb_color(this.featureColors(desc));
                                            const transpColor = `rgba(${temp.r},${temp.g},${temp.b}, 0.6)`;
                                            featureType.uncertain = {"color": transpColor};
                                        }
                                        featureTypes.push(featureType);
                                    }
                                }
                            }
                        }
                    }
                    json[annotationSet] = featureTypes;
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

    addHoverListener(hoverListener) {
        this.hoverListeners.add(hoverListener);
    }

    removeHoverListener(hoverListener) {
        this.hoverListeners.remove(hoverListener);
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
        this.expandListeners.remove(expandListener);
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
        this.state = App.STATES.SELECT_PAN;
        d3.select(".custom-menu-margin").style("display", "none");
    }

    touchStart(evt) {
        evt.preventDefault();
        this.d3cola.stop();
        this.dragStart = evt;
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
                } else if (this.state === App.STATES.SELECT_PAN) { // mouse down on container svg element
                    // console.log("PAN!");
                    this.setCTM(this.container, this.container.getCTM().translate(c.x - ds.x, c.y - ds.y));
                    this.dragStart = evt;
                }
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

    mouseWheel(evt) {
        this.preventDefaultsAndStopPropagation(evt);
        this.d3cola.stop();
        let delta;
        //see http://stackoverflow.com/questions/5527601/normalizing-mousewheel-speed-across-browsers
        if (evt.wheelDelta) {
            delta = evt.wheelDelta / 3600; // Chrome/Safari
        } else {
            delta = evt.detail / -90; // Mozilla
        }
        const z = 1 + delta;
        const g = this.container;
        const p = this.getEventPoint(evt);
        const c = p.matrixTransform(g.getCTM().inverse());
        const k = this.svgElement.createSVGMatrix().translate(c.x, c.y).scale(z).translate(-c.x, -c.y);
        this.setCTM(g, g.getCTM().multiply(k));
        //this.scale();
        return false;
    }

    mouseOut() {
        this.hideTooltip();
    }

    getEventPoint(evt) {
        const p = this.svgElement.createSVGPoint();
        // *****!$$$ finally, cross-browser
        p.x = evt.pageX - $(this.el).offset().left;
        p.y = evt.pageY - $(this.el).offset().top;
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

}

//static values signifying Controller's status
App.STATES = {
    MOUSE_UP: 0, //start state, also set when mouse up on svgElement
    SELECT_PAN: 1, //set by mouse down on svgElement - //left button only?
    DRAGGING: 2 //set by mouse down on Protein or Link
};

App.barScales = [0.01, /*0.015,*/ 0.2, 1, 2, 4, 8];
