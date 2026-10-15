"use client";

import { useState, type ReactNode } from "react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";

// Pinch to zoom, drag to pan (docs/camp-layout-spec.md decision 13: the
// phone gets the plan with pan and pinch-zoom). The plan inside stays the
// server-rendered SVG; this only transforms it.
//
// THE PAGE STILL SCROLLS. Panning is switched OFF until the plan is zoomed
// in: at 1× a finger dragging over the plan scrolls the page, as anywhere
// else. The mouse wheel never zooms (it scrolls the page); a trackpad pinch
// and a double-tap do.

/** Pinch-zoom and pan for the plan; panning only once zoomed in, so the page
 * still scrolls. */
export function PlanViewport({ children }: { children: ReactNode }) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <TransformWrapper
      minScale={1}
      maxScale={6}
      wheel={{ wheelDisabled: true }}
      panning={{ disabled: !zoomed, velocityDisabled: true }}
      doubleClick={{ mode: zoomed ? "reset" : "zoomIn", step: 1 }}
      onTransform={(_ref, state) => setZoomed(state.scale > 1.01)}
    >
      <TransformComponent
        wrapperClass="!w-full overflow-hidden rounded-md"
        contentClass="!w-full"
      >
        {children}
      </TransformComponent>
    </TransformWrapper>
  );
}
