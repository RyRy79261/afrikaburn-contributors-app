import { describe, it, expect } from "vitest";
import {
  normalizeName,
  isExactNormalizedMatch,
  trigramSimilarity,
  isSimilarName,
  SIMILARITY_WARN_THRESHOLD,
} from "../name-dedupe";

// Integration of the `/camps/new` name-dedupe decision (build-spec §apps/web):
// reject an exact normalized collision; WARN (not block) on trigram similarity
// ≥ 0.55. This models the exact decision the create-camp server action makes
// against the existing group names for the same kind.

type Decision =
  | { kind: "ok" }
  | { kind: "reject"; conflict: string }
  | { kind: "warn"; similar: string[] };

function decideCampName(name: string, existing: readonly string[]): Decision {
  const exact = existing.find((e) => isExactNormalizedMatch(e, name));
  if (exact) return { kind: "reject", conflict: exact };
  const similar = existing.filter((e) => isSimilarName(e, name));
  if (similar.length > 0) return { kind: "warn", similar };
  return { kind: "ok" };
}

describe("camp name dedupe integration", () => {
  const existing = ["Mad Hatters", "Camp 404", "Dusty Boots"];

  it("rejects an exact normalized collision regardless of case/space/punct", () => {
    for (const variant of ["mad hatters", "  Mad  Hatters!! ", "MADHATTERS"]) {
      const d = decideCampName(variant, existing);
      expect(d.kind).toBe("reject");
      if (d.kind === "reject") expect(d.conflict).toBe("Mad Hatters");
    }
  });

  it("collapses names to the same normalized key when they collide", () => {
    expect(normalizeName("Mad Hatters!")).toBe(normalizeName("mad  hatters"));
  });

  it("warns on a near-duplicate above the threshold without rejecting", () => {
    const d = decideCampName("Madd Hatterz", existing);
    expect(d.kind).toBe("warn");
    if (d.kind === "warn") expect(d.similar).toContain("Mad Hatters");
    expect(trigramSimilarity("Madd Hatterz", "Mad Hatters")).toBeGreaterThanOrEqual(
      SIMILARITY_WARN_THRESHOLD,
    );
  });

  it("passes a clearly distinct name", () => {
    expect(decideCampName("Neon Cathedral", existing)).toEqual({ kind: "ok" });
  });

  it("exact match takes precedence over a similarity warning", () => {
    const d = decideCampName("camp 404", ["Camp 404", "Camp 405"]);
    expect(d.kind).toBe("reject");
  });
});
