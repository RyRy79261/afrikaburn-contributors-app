// @quagga/geo — pure plane geometry in metres. No React, no database, no
// domain vocabulary (docs/gis-placement-spec.md §D.1): it knows rectangles,
// circles, rings and frames, and nothing about tents, camps or who may see
// them. Policy — what counts as a warning, who may edit — is @quagga/core.
//
//   types ──▶ geo ──▶ core ──▶ db · ui · auth ──▶ apps
export * from "./vec";
export * from "./snap";
export * from "./transform";
export * from "./polygon";
export * from "./shapes";
export * from "./clip";
export * from "./collide";
