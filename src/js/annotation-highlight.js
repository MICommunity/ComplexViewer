// Highlighting of one annotation category (clicked in the legend): proteins that
// have it and their regions of that category stay opaque, everything else fades.

export function participantsWithAnnotation(participants, annotationSet, category) {
  const matches = [];
  for (const p of participants) {
    const annos = p.annotationSets && p.annotationSets.get(annotationSet);
    if (annos && annos.some(a => a.category === category && a.description !== "No annotations")) {
      matches.push(p);
    }
  }
  return matches;
}

/**
 * @param app the App
 * @param highlighted {annotationSet, category} or null to show everything
 * @param fadedOpacity opacity of what is not highlighted
 */
export function applyAnnotationHighlight(app, highlighted, fadedOpacity) {
  const h = highlighted;
  const matches = h
    ? new Set(participantsWithAnnotation(app.participants.values(), h.annotationSet, h.category))
    : null;
  const opacity = keep => keep ? 1 : fadedOpacity;

  for (const p of app.participants.values()) {
    if (!p.upperGroup) continue;
    p.upperGroup.setAttribute("opacity", opacity(!matches || matches.has(p)));
    if (!p.annotationSets) continue;
    for (const [annotationSet, annotations] of p.annotationSets) {
      for (const anno of annotations) {
        const keep = !h || (annotationSet === h.annotationSet && anno.category === h.category);
        for (const el of [anno.certain, anno.fuzzyStart, anno.fuzzyEnd]) {
          if (el) el.setAttribute("opacity", opacity(keep));
        }
      }
    }
  }
  // links stay opaque only if all their proteins are highlighted
  for (const links of [app.allBinaryLinks, app.allUnaryLinks, app.allSequenceLinks]) {
    for (const link of links.values()) {
      const keep = !matches || (link.participants || []).every(p => matches.has(p));
      for (const el of [link.line, link.highlightLine, link._glyph, link._uncertainGlyph]) {
        if (el && el.setAttribute) el.setAttribute("opacity", opacity(keep));
      }
    }
  }
}
