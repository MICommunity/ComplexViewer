import chroma from "chroma-js";
import {scaleOrdinal} from "d3-scale";
import {schemePastel2, schemeTableau10} from "d3-scale-chromatic";

// Colors used by DisProt and AlphaFold for their categories. Kept fixed so the
// viewer matches those resources; generated palettes stay away from them.
export const DISPROT_COLORS = {
  "Structural state": "#B67637",
  "Structural transition": "#8B296F",
  "Disorder function": "#BA2327",
};
export const ALPHAFOLD_COLORS = {
  "Very high confidence": "#0053d6",
  "High confidence": "#65cbf3",
  "Low confidence": "#ffe915",
  "Very low confidence": "#ff7d45"
};
const FIXED_COLORS = [...Object.values(DISPROT_COLORS), ...Object.values(ALPHAFOLD_COLORS)];

// Minimum perceptual distance (Euclidean distance in Lab, i.e. CIE76 Delta E).
// Below ~20-25 two colors are easy to confuse.
const MIN_DISTANCE_FIXED = 25; // vs DisProt / AlphaFold colors
const MIN_DISTANCE_OTHER = 15; // vs interactor colors and between generated colors

const distance = (a, b) => chroma.distance(a, b, "lab");
const isFarFrom = (color, others, min) => others.every(o => distance(color, o) >= min);

// Candidate pool for generated palettes: a grid over hue, chroma and lightness,
// keeping only colors inside the sRGB gamut and away from the fixed colors.
const COLOR_CANDIDATES = (() => {
  const out = new Set();
  for (let h = 0; h < 360; h += 3) {
    for (const l of [30, 40, 50, 60, 70, 80]) {
      for (const c of [30, 45, 60, 75, 90]) {
        const color = chroma.hcl(h, c, l);
        if (color.clipped()) continue;
        const hex = color.hex();
        if (isFarFrom(hex, FIXED_COLORS, MIN_DISTANCE_FIXED)) out.add(hex);
      }
    }
  }
  return [...out];
})();

/**
 * Returns n colors that are as different from each other as possible, away from
 * the fixed DisProt/AlphaFold colors and from the colors in `avoid`.
 * Starts with the usable Tableau10 colors, then repeatedly adds the candidate
 * farthest from every color already used (farthest-point sampling), so the
 * result is deterministic and never repeats until the candidate pool runs out.
 */
export function makePalette(n, avoid = []) {
  const palette = schemeTableau10.filter(c =>
    isFarFrom(c, FIXED_COLORS, MIN_DISTANCE_FIXED) && isFarFrom(c, avoid, MIN_DISTANCE_OTHER));
  if (palette.length >= n) return palette.slice(0, n);

  const used = new Set([...palette, ...avoid]);
  const candidates = COLOR_CANDIDATES.filter(c => !used.has(c));
  const labs = candidates.map(c => chroma(c).lab());
  const usedLabs = [...used].map(c => chroma(c).lab());
  const labDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // minDist[i]: distance from candidate i to the closest color already used
  const minDist = labs.map(a => usedLabs.reduce((m, b) => Math.min(m, labDistance(a, b)), Infinity));
  const taken = new Array(candidates.length).fill(false);

  let repeatIndex = 0;
  while (palette.length < n) {
    let best = -1;
    for (let i = 0; i < candidates.length; i++) {
      if (!taken[i] && (best === -1 || minDist[i] > minDist[best])) best = i;
    }
    if (best === -1) { // pool exhausted: reuse colors
      palette.push(palette.length ? palette[repeatIndex++ % palette.length] : "#999999");
      continue;
    }
    taken[best] = true;
    palette.push(candidates[best]);
    for (let i = 0; i < candidates.length; i++) {
      if (!taken[i]) minDist[i] = Math.min(minDist[i], labDistance(labs[i], labs[best]));
    }
  }
  return palette;
}

/**
 * Builds the function that gives the color of an annotation category.
 * Interactor colors come from `interactorColors` (built once per dataset, so they
 * don't change when annotation sets are toggled); DisProt/AlphaFold categories
 * keep their fixed colors; everything else gets a palette that avoids both.
 * The domain is sorted so the same categories always get the same colors.
 */
export function makeFeatureColorResolver(categories, interactorColors) {
  const interactorDomain = new Set(interactorColors.domain());
  const reserved = [...interactorDomain].map(c => interactorColors(c));
  const otherCats = [...categories]
    .filter(c => !interactorDomain.has(c) && !DISPROT_COLORS[c] && !ALPHAFOLD_COLORS[c])
    .sort();
  const otherColors = scaleOrdinal().domain(otherCats).range(makePalette(otherCats.length, reserved));

  return category => ALPHAFOLD_COLORS[category]
    || DISPROT_COLORS[category]
    || (interactorDomain.has(category) ? interactorColors(category) : otherColors(category));
}

export function makeInteractorColorScale(categories) {
  return scaleOrdinal().domain(categories).range(makePalette(categories.length));
}

// Very light pastel colors for complexes.
export function makeComplexColorScale() {
  return scaleOrdinal().range(schemePastel2.map(c => chroma(c).set("hsl.l", 0.9).hex()));
}

// rgba() string (not the newer "rgb(r g b / a)" syntax, which older SVG tools can't read).
export function withAlpha(color, alpha) {
  const [r, g, b] = chroma(color).rgb();
  return `rgba(${r},${g},${b},${alpha})`;
}

// SVG id for the hatched pattern of a category/color. Restricted to letters,
// digits, "_" and "-" so it is valid inside url(#...) (category names can
// contain apostrophes, spaces...) and in SVG editors.
export function hatchId(category, color) {
  const safe = s => String(s).replace(/[^A-Za-z0-9_-]/g, "_");
  return `hatched_${safe(category)}_${safe(color)}`;
}

// Adds to `defs` (a d3 selection) a diagonal-stripes pattern used for uncertain
// feature boundaries.
export function createHatchedFill(defs, id, color, opacity = 1) {
  const pattern = defs.append("pattern")
    .attr("id", id)
    .attr("patternUnits", "userSpaceOnUse")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", 12)
    .attr("height", 12)
    .attr("patternTransform", "rotate(45)");
  for (const y of [2, 8]) {
    pattern.append("rect")
      .attr("x", 0)
      .attr("y", y)
      .attr("width", 12)
      .attr("height", 4)
      .attr("fill", color)
      .attr("fill-opacity", opacity);
  }
}
