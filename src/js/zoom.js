import * as d3 from "d3";

/**
 * Pan & zoom for the viewer with d3.zoom: wheel / drag on the background with a
 * mouse, one-finger drag and two-finger pinch on touch screens. Gestures that
 * start on a protein or a link are left to them (drag, click), except that a
 * second finger turns a protein drag into a pinch.
 * Returns the d3.zoom behaviour (used by App.zoomToExtent).
 */
export function setupZoom(app) {
  const svgElement = app.svgElement;
  svgElement.style.touchAction = "none"; // the viewer, not the browser, handles touch gestures

  const zoomBehavior = d3.zoom()
    .scaleExtent([0.01, 40])
    .filter(evt => {
      if (evt.type === "wheel") return true;
      if (evt.type === "dblclick") return false; // clicks expand proteins
      if (evt.type === "touchstart") return true; // decided in "zoom": protein drag vs pan/pinch
      return !evt.button && !app.dragElement; // mouse / pen: primary button, background only
    })
    .on("start", evt => {
      if (evt.sourceEvent) { // a user gesture, not zoomToExtent
        app.d3cola.stop();
        app.hideTooltip();
        d3.select(".custom-menu-margin").style("display", "none");
      }
    })
    .on("zoom", evt => {
      const src = evt.sourceEvent;
      if (src && src.touches) {
        if (src.touches.length > 1) {
          app.dragElement = null;
        } else if (app.dragElement) {
          // one finger dragging a protein: keep the view still by undoing d3's pan
          svgElement.__zoom = app.lastZoomTransform || d3.zoomIdentity;
          return;
        }
      }
      app.lastZoomTransform = evt.transform;
      app.container.setAttribute("transform", evt.transform.toString());
      app.z = 1 / evt.transform.k; // used to keep line widths constant on screen
    })
    .on("end", evt => {
      if (evt.sourceEvent) { // d3.zoom swallows the mouseup, so reset the drag state here
        app.dragStart = null;
        app.state = app.constructor.STATES.MOUSE_UP;
      }
    });

  const svgSel = d3.select(svgElement);
  svgSel.call(zoomBehavior);
  svgSel.on("dblclick.zoom", null);

  // Proteins and links stop touchstart from bubbling (so they can be dragged),
  // which hides those fingers from d3.zoom and breaks pinch-zoom when a finger
  // lands on them. So touches on them are handed to d3.zoom in the capture
  // phase, and the normal bubbling listener skips them.
  const zoomTouchStart = svgSel.on("touchstart.zoom");
  if (zoomTouchStart) {
    svgSel.on("touchstart.zoom", function (evt, ...args) {
      if (!evt.cvZoomHandled) zoomTouchStart.call(this, evt, ...args);
    });
    svgElement.addEventListener("touchstart", evt => {
      if (evt.target === svgElement) return;
      evt.cvZoomHandled = true;
      // d3.zoom stops propagation of the events it handles, which here would keep
      // the touch from reaching the protein: give it a copy that can't.
      const proxy = new Proxy(evt, {
        get(target, key) {
          if (key === "stopPropagation" || key === "stopImmediatePropagation") return () => {};
          const value = target[key];
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
      zoomTouchStart.call(svgElement, proxy, svgElement.__data__);
    }, true);
  }

  // The tap halo behaves like hover: it goes when the last finger is lifted.
  // Capture phase, so d3.zoom can't swallow the event.
  const onTouchRelease = evt => {
    if (!evt.touches || evt.touches.length === 0) app.setTouchedParticipant(null);
  };
  svgElement.addEventListener("touchend", onTouchRelease, true);
  svgElement.addEventListener("touchcancel", onTouchRelease, true);

  return zoomBehavior;
}
