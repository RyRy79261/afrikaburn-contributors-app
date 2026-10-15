"use client";

import { useState } from "react";
import Link from "next/link";
import { ImageDown, Printer } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";

// Download PNG and Print plan (docs/camp-layout-spec.md decision 16; every
// current member may do both — 14 Oct decision). The PNG is made in the
// browser from the plan's own <svg>: nothing is uploaded and nothing talks
// to a server, so it works env-less and on a flaky connection.

/** The presentation properties a drawn plan uses. Computed styles are copied
 * onto the clone because an <svg> drawn as an image has no stylesheet: its
 * Tailwind classes and theme variables would otherwise vanish. */
const INLINE_PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
] as const;

/**
 * Copies the computed drawing styles onto the clone, element by element, and
 * drops its classes: an SVG drawn as an image cannot see the page's CSS.
 */
function inlineStyles(source: Element, target: Element) {
  const cs = getComputedStyle(source);
  const style = INLINE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(
    ";",
  );
  target.setAttribute("style", style);
  target.removeAttribute("class");
  const s = source.children;
  const t = target.children;
  for (let i = 0; i < s.length && i < t.length; i++) {
    inlineStyles(s[i]!, t[i]!);
  }
}

/**
 * The plan SVG as a PNG data URL at 2×, on the card's background colour.
 * Null when no 2D canvas is available; throws when the SVG will not load.
 */
async function svgToPngUrl(svg: SVGSVGElement): Promise<string | null> {
  const vb = svg.viewBox.baseVal;
  const scale = 2;
  const width = Math.round(vb.width * scale);
  const height = Math.round(vb.height * scale);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  const xml = new XMLSerializer().serializeToString(clone);
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  const img = new Image();
  img.decoding = "sync";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("The plan could not be drawn."));
    img.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // The card behind the plan, so the picture is not transparent.
  const card = svg.closest("[data-plan-surface]") ?? document.body;
  ctx.fillStyle = getComputedStyle(card).backgroundColor || "#1f2326";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

/** Saves the plan SVG with this id as a PNG; a toast when it fails. */
export function DownloadPlanButton({
  svgId,
  fileName,
  className,
}: {
  svgId: string;
  fileName: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  /** Draws the PNG and clicks a download link for it. */
  const onClick = async () => {
    const svg = document.getElementById(svgId);
    if (!(svg instanceof SVGSVGElement)) return;
    setBusy(true);
    try {
      const url = await svgToPngUrl(svg);
      if (!url) throw new Error("no canvas");
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
    } catch {
      toast.error("The picture couldn't be made. Try Print plan instead.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={() => void onClick()}
      disabled={busy}
    >
      <ImageDown className="h-4 w-4" aria-hidden />
      Download PNG
    </Button>
  );
}

/** Opens the printable plan in a new tab. */
export function PrintPlanLink({
  href,
  className,
}: {
  href: string;
  className?: string;
}) {
  return (
    <Button asChild variant="outline" size="sm" className={className}>
      <Link href={href} target="_blank">
        <Printer className="h-4 w-4" aria-hidden />
        Print plan
      </Link>
    </Button>
  );
}

/** On the print page: the browser's own print dialog. */
export function PrintNowButton() {
  return (
    <Button type="button" size="sm" onClick={() => window.print()}>
      <Printer className="h-4 w-4" aria-hidden />
      Print
    </Button>
  );
}
