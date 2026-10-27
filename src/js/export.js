import {svgns} from "./svgns";

// Helpers to turn the live SVG into a standalone file (SVG or PNG).
// The captured SVG has no stylesheet, and pattern fills (hatched uncertain
// boundaries) are not rendered by many SVG editors, so both are made explicit.

const BBOX_ATTR = "data-cv-export-bbox";

function getPatternFillId(fill) {
  const match = fill && fill.match(/^url\(['"]?#([^'")]+)['"]?\)$/);
  return match ? match[1] : null;
}

// Bounding boxes can only be measured on the live (rendered) SVG, so they are
// stored as attributes before capture and read back from the copy.
export function annotatePatternFillBBoxes(svgElement) {
  for (const el of svgElement.querySelectorAll("[fill]")) {
    if (!getPatternFillId(el.getAttribute("fill"))) continue;
    try {
      const bbox = el.getBBox();
      el.setAttribute(BBOX_ATTR, [bbox.x, bbox.y, bbox.width, bbox.height].join(" "));
    } catch (e) {
      // not every element exposes a bbox in every browser; it is exported without stripes
    }
  }
}

export function clearPatternFillBBoxAnnotations(svgElement) {
  for (const el of svgElement.querySelectorAll(`[${BBOX_ATTR}]`)) {
    el.removeAttribute(BBOX_ATTR);
  }
}

export function prepareSVGForExport(svgDoc) {
  inlineLinkStyles(svgDoc);
  expandPatternFills(svgDoc);
  normalizePatternReferences(svgDoc);
  convertRoundRectsToCircles(svgDoc);
}

// Copies the CSS defaults of links and complex outlines into attributes.
function inlineLinkStyles(svgDoc) {
  const setDefault = (el, attr, value) => el.setAttribute(attr, el.getAttribute(attr) || value);
  for (const link of svgDoc.querySelectorAll(".link, .link-line, .feature-link, .complex-outline, .linked-complex")) {
    const cl = link.classList;
    if (cl.contains("link")) {
      setDefault(link, "stroke", "black");
      setDefault(link, "fill", "none");
      setDefault(link, "stroke-linecap", "round");
    }
    if (cl.contains("link-line")) {
      setDefault(link, "stroke-width", "1");
    }
    if (cl.contains("link-highlight")) {
      link.setAttribute("stroke-opacity", "0");
    }
    if (cl.contains("certain-link")) {
      setDefault(link, "opacity", "0.6");
      setDefault(link, "stroke-opacity", "0.6");
    }
    if (cl.contains("uncertain-link")) {
      setDefault(link, "opacity", "0.2");
      setDefault(link, "stroke-opacity", "0.6");
    }
    if (cl.contains("feature-link")) {
      setDefault(link, "fill", "black");
    }
    if (cl.contains("complex-outline")) {
      setDefault(link, "stroke", "white");
      setDefault(link, "stroke-width", "7");
      setDefault(link, "stroke-linejoin", "round");
    }
    if (cl.contains("linked-complex")) {
      setDefault(link, "stroke", "black");
      setDefault(link, "stroke-width", "1");
      setDefault(link, "stroke-linejoin", "round");
    }
  }
}

function getPatternColor(svgDoc, patternId) {
  const pattern = [...svgDoc.querySelectorAll("pattern")].find(p => p.getAttribute("id") === patternId);
  const colored = pattern && pattern.querySelector("[fill]:not([fill='none']), [stroke]:not([stroke='none'])");
  if (!colored) return null;
  return {
    color: colored.getAttribute("fill") || colored.getAttribute("stroke"),
    opacity: colored.getAttribute("fill-opacity") || colored.getAttribute("stroke-opacity") || "1"
  };
}

// Replaces each pattern fill by real diagonal lines clipped to the element's shape.
function expandPatternFills(svgDoc) {
  const defs = svgDoc.querySelector("defs");
  if (!defs) return;

  const spacing = 6;
  const strokeWidth = 2;
  let clipIndex = 0;
  for (const el of svgDoc.querySelectorAll("[fill]")) {
    const patternId = getPatternFillId(el.getAttribute("fill"));
    const bboxValue = el.getAttribute(BBOX_ATTR);
    if (!patternId || !bboxValue) continue;
    const [x, y, width, height] = bboxValue.split(/\s+/).map(Number);
    if (!width || !height) continue;
    const patternColor = getPatternColor(svgDoc, patternId);
    if (!patternColor || !patternColor.color) continue;

    const clipId = `cv_export_hatch_clip_${clipIndex++}`;
    const clipPath = document.createElementNS(svgns, "clipPath");
    clipPath.setAttribute("id", clipId);
    clipPath.setAttribute("clipPathUnits", "userSpaceOnUse");
    const clipShape = el.cloneNode(false);
    for (const attr of ["fill", "stroke", "class", "id", BBOX_ATTR]) clipShape.removeAttribute(attr);
    clipPath.appendChild(clipShape);
    defs.appendChild(clipPath);

    const stripeGroup = document.createElementNS(svgns, "g");
    stripeGroup.setAttribute("clip-path", `url(#${clipId})`);
    stripeGroup.setAttribute("class", "export-hatch");

    const extent = width + height + (spacing * 2);
    for (let yy = y - width - spacing; yy <= y + height + width + spacing; yy += spacing) {
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
    el.removeAttribute(BBOX_ATTR);
    el.parentNode.insertBefore(stripeGroup, el.nextSibling);
  }
}

// Uses plain url(#id) references and splits rgba() fills inside patterns into
// rgb + fill-opacity, which more SVG editors understand.
function normalizePatternReferences(svgDoc) {
  for (const el of svgDoc.querySelectorAll("[fill]")) {
    const patternId = getPatternFillId(el.getAttribute("fill"));
    if (patternId) el.setAttribute("fill", `url(#${patternId})`);
  }
  for (const rect of svgDoc.querySelectorAll("pattern rect[fill]")) {
    const fill = rect.getAttribute("fill");
    const match = fill && fill.match(/^rgba\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)$/);
    if (match) {
      rect.setAttribute("fill", `rgb(${match[1]}, ${match[2]}, ${match[3]})`);
      rect.setAttribute("fill-opacity", match[4]);
    }
  }
}

// Collapsed proteins are drawn as fully rounded rects; export them as circles.
function convertRoundRectsToCircles(svgDoc) {
  for (const rect of svgDoc.querySelectorAll("rect")) {
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

function saveBlob(blob, fileName) {
  if (navigator.msSaveOrOpenBlob) {
    navigator.msSaveOrOpenBlob(blob, fileName);
    return;
  }
  const a = document.createElement("a");
  a.href = window.URL.createObjectURL(blob);
  a.download = fileName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(a.href);
}

export function downloadSVGString(svgString, fileName) {
  const bytes = new TextEncoder().encode(svgString);
  saveBlob(new Blob([bytes], {type: "image/svg+xml;charset=utf-8"}), fileName);
}

// Draws the SVG on a white canvas of width x height CSS pixels, `scale` times
// the resolution, and saves it as PNG.
export function downloadPNGFromSVGString(svgString, fileName, width, height, scale = 2) {
  const svgUrl = window.URL.createObjectURL(new Blob([svgString], {type: "image/svg+xml;charset=utf-8"}));
  const image = new Image();
  image.onload = () => {
    const w = Math.max(1, width || image.width);
    const h = Math.max(1, height || image.height);
    const pixelRatio = Math.max(1, scale);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * pixelRatio);
    canvas.height = Math.round(h * pixelRatio);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    window.URL.revokeObjectURL(svgUrl);
    canvas.toBlob(blob => {
      if (blob) saveBlob(blob, fileName);
    }, "image/png");
  };
  image.onerror = () => {
    window.URL.revokeObjectURL(svgUrl);
    console.error("Could not render SVG export as PNG.");
  };
  image.src = svgUrl;
}
