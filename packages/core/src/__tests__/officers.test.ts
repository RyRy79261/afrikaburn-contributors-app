import { describe, it, expect } from "vitest";
import {
  OFFICER_CATALOG,
  officerCatalogEntry,
  officerRequirements,
  requiredOfficerKeys,
  outstandingOfficers,
  soundLevelFromValue,
  officerContactVisibleToOrg,
  officerConsentCopy,
  officerSlotFilled,
  OFFICER_CONSENT_INITIAL,
  type OfficerTriggerInput,
} from "../officers";
import type { OfficerKey } from "@quagga/types";

const NO_FIRE = { hasGenerators: false, hasOpenFlame: false, hasFuelStorage: false };

function triggers(partial: Partial<OfficerTriggerInput>): OfficerTriggerInput {
  return { soundLevel: 0, ...NO_FIRE, ...partial };
}

describe("OFFICER_CATALOG", () => {
  it("has the five org-defined officers with fixed identities", () => {
    expect(OFFICER_CATALOG.map((e) => e.key)).toEqual([
      "lnt_officer",
      "safety_officer",
      "fire_safety_officer",
      "sound_officer",
      "safety_monitor",
    ]);
    expect(officerCatalogEntry("fire_safety_officer")?.name).toBe("Safety Baron");
    expect(officerCatalogEntry("lnt_officer")?.emoji).toBe("♻️");
  });
});

describe("soundLevelFromValue", () => {
  it("maps stored sound labels to 0–4", () => {
    expect(soundLevelFromValue("No amplified sound")).toBe(0);
    expect(soundLevelFromValue(null)).toBe(0);
    expect(soundLevelFromValue("Level 1 — Car stereo")).toBe(1);
    expect(soundLevelFromValue("Level 2 — Party speakers")).toBe(2);
    expect(soundLevelFromValue("Level 4 — Large rig")).toBe(4);
  });
});

describe("officer trigger matrix", () => {
  it("LNT is always required; safety officer + monitor always recommended", () => {
    const reqs = officerRequirements(triggers({}));
    expect(reqs.get("lnt_officer")).toBe("required");
    expect(reqs.get("safety_officer")).toBe("recommended");
    expect(reqs.get("safety_monitor")).toBe("recommended");
  });

  it("sound officer required at level >= 2, recommended below", () => {
    expect(officerRequirements(triggers({ soundLevel: 1 })).get("sound_officer")).toBe(
      "recommended",
    );
    expect(officerRequirements(triggers({ soundLevel: 2 })).get("sound_officer")).toBe(
      "required",
    );
    expect(officerRequirements(triggers({ soundLevel: 4 })).get("sound_officer")).toBe(
      "required",
    );
  });

  it("fire safety officer required on generators, open flame, or fuel storage", () => {
    expect(
      officerRequirements(triggers({})).get("fire_safety_officer"),
    ).toBe("recommended");
    expect(
      officerRequirements(triggers({ hasGenerators: true })).get("fire_safety_officer"),
    ).toBe("required");
    expect(
      officerRequirements(triggers({ hasOpenFlame: true })).get("fire_safety_officer"),
    ).toBe("required");
    expect(
      officerRequirements(triggers({ hasFuelStorage: true })).get("fire_safety_officer"),
    ).toBe("required");
  });

  it("requiredOfficerKeys collects only the required ones", () => {
    expect(requiredOfficerKeys(triggers({}))).toEqual(["lnt_officer"]);
    expect(
      requiredOfficerKeys(triggers({ soundLevel: 3, hasGenerators: true })).sort(),
    ).toEqual(["fire_safety_officer", "lnt_officer", "sound_officer"].sort());
  });
});

describe("outstandingOfficers", () => {
  it("free/unregistered camps: no requirements at all", () => {
    const r = outstandingOfficers({
      isRegisteredOrInFlight: false,
      triggers: triggers({ soundLevel: 4, hasGenerators: true }),
      assignedKeys: [],
    });
    expect(r.applies).toBe(false);
    expect(r.outstanding).toEqual([]);
    expect(r.requiredCount).toBe(0);
  });

  it("registered camp counts unassigned required officers", () => {
    const r = outstandingOfficers({
      isRegisteredOrInFlight: true,
      triggers: triggers({ soundLevel: 2, hasGenerators: true }),
      assignedKeys: ["lnt_officer"],
    });
    // required: lnt, sound, fire → lnt assigned → sound + fire outstanding
    expect(r.applies).toBe(true);
    expect(r.requiredCount).toBe(3);
    expect(r.assignedCount).toBe(1);
    expect(r.outstanding.sort()).toEqual(
      ["fire_safety_officer", "sound_officer"].sort(),
    );
  });

  it("flips to complete when every required officer is assigned", () => {
    const assigned: OfficerKey[] = ["lnt_officer"];
    const r = outstandingOfficers({
      isRegisteredOrInFlight: true,
      triggers: triggers({}),
      assignedKeys: assigned,
    });
    expect(r.outstanding).toEqual([]);
    expect(r.requiredCount).toBe(1);
    expect(r.assignedCount).toBe(1);
  });
});

describe("officer consent + org visibility", () => {
  it("assignment starts pending", () => {
    expect(OFFICER_CONSENT_INITIAL).toBe("pending");
    expect(officerSlotFilled("pending")).toBe(true);
    expect(officerSlotFilled("accepted")).toBe(true);
    expect(officerSlotFilled("declined")).toBe(false);
  });

  it("consent copy names the role and mentions sharing contact with AfrikaBurn", () => {
    const copy = officerConsentCopy("Sound Officer");
    expect(copy).toContain("Sound Officer");
    expect(copy).toContain("AfrikaBurn");
    expect(copy.toLowerCase()).toContain("phone");
  });

  it("org contact visibility is ONLY an accepted officer assignment", () => {
    expect(
      officerContactVisibleToOrg({ isOfficer: true, consent: "accepted" }),
    ).toBe(true);
    // pending/declined never expose contact
    expect(
      officerContactVisibleToOrg({ isOfficer: true, consent: "pending" }),
    ).toBe(false);
    expect(
      officerContactVisibleToOrg({ isOfficer: true, consent: "declined" }),
    ).toBe(false);
    // a non-officer role, even accepted, never exposes contact
    expect(
      officerContactVisibleToOrg({ isOfficer: false, consent: "accepted" }),
    ).toBe(false);
  });
});
