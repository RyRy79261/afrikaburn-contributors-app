import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { schema } from "@quagga/db";
import { decrypt, encrypt } from "@quagga/db/crypto";
import { boundStrings, dbMock, uniqueViolation } from "@/test/db-mock";

vi.mock("../db", async () => (await import("@/test/db-mock")).dbModuleMock());

process.env.PGCRYPTO_KEY = "test-pgcrypto-key-16+";

const {
  getBio,
  getUsername,
  isUsernameAvailable,
  saveBio,
  savePrivacyFlags,
  ensureProfileKeypair,
  getKeyFingerprint,
} = await import("../bio-store");

const USER = "aaaaaaaa-0000-0000-0000-000000000001";
// A well-formed v4 uuid — the camp-history entry schema validates the shape.
const MAD_HATTERS = "11111111-1111-4111-8111-111111111111";
const EDITION = "eeeeeeee-0000-0000-0000-000000000000";

/** A `burner_bios` row as `select()` returns it — every column, most of them
 * null, which is the shape that actually comes back for a half-filled bio. */
function bioRow(overrides: Record<string, unknown> = {}) {
  return {
    userId: USER,
    editionId: EDITION,
    legalName: "Alice Hatter",
    homeCity: "Cape Town",
    bio: null,
    skills: [],
    attendedYears: [],
    firstTime: false,
    contactEmail: null,
    phone: null,
    onsiteContactName: null,
    onsiteContactPhone: null,
    offsiteContactName: null,
    offsiteContactPhone: null,
    medicalNotes: null,
    saIdEncrypted: null,
    passportEncrypted: null,
    about: null,
    campHistory: null,
    volunteeringInterests: null,
    rangerTraining: null,
    rangerCurious: null,
    greenDotTraining: null,
    privacyFlags: {},
    completedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  dbMock.reset();
  process.env.PGCRYPTO_KEY = "test-pgcrypto-key-16+";
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getBio — the owner's own projection", () => {
  it("is null when the user has no row for this edition", async () => {
    dbMock.queue([]);
    expect(await getBio(USER, EDITION)).toBeNull();
    // The username lookup never ran — there was nothing to project.
    expect(dbMock.queries).toHaveLength(1);
  });

  it("reports the FULL idType triad: sa_id, passport, and neither", async () => {
    const cases: Array<
      [Record<string, unknown>, string | null, string | null]
    > = [
      [{ saIdEncrypted: encrypt("8001015009087") }, "sa_id", "8001015009087"],
      [{ passportEncrypted: encrypt("A12345678") }, "passport", "A12345678"],
      [{}, null, null],
    ];

    for (const [row, expectedType, expectedNumber] of cases) {
      dbMock.reset();
      dbMock.queue([bioRow(row)], [{ username: "alice" }]);
      const view = await getBio(USER, EDITION);
      expect(view?.fields.idType).toBe(expectedType);
      expect(view?.fields.idNumber).toBe(expectedNumber);
    }
  });

  it("prefers the SA ID over the passport when a row carries both", async () => {
    dbMock.queue(
      [
        bioRow({
          saIdEncrypted: encrypt("8001015009087"),
          passportEncrypted: encrypt("A12345678"),
        }),
      ],
      [{ username: "alice" }],
    );

    const view = await getBio(USER, EDITION);
    expect(view?.fields.idType).toBe("sa_id");
    expect(view?.fields.idNumber).toBe("8001015009087");
  });

  it("degrades medical notes it cannot decrypt to null, never to ciphertext", async () => {
    // The owner's own edit form must not be shown a base64 blob in the box
    // labelled "medical notes" — they would save over it.
    dbMock.queue([bioRow({ medicalNotes: "zzzz" })], [{ username: null }]);

    const view = await getBio(USER, EDITION);
    expect(view?.fields.medicalNotes).toBeNull();
  });

  it("falls back to the empty/false default for every nullable v3 column", async () => {
    dbMock.queue([bioRow()], []);

    const view = await getBio(USER, EDITION);
    expect(view?.extras).toEqual({
      about: null,
      campHistory: [],
      volunteeringInterests: [],
      volunteeringOther: null,
      rangerTraining: false,
      rangerCurious: false,
      greenDotTraining: false,
    });
    expect(view?.username).toBeNull();
  });

  it("splits stored volunteering into known keys and the free-text other", async () => {
    dbMock.queue(
      [
        bioRow({
          volunteeringInterests: ["rangers", "Fixing broken things"],
          rangerTraining: true,
          campHistory: [{ kind: "freetext", label: "Camp 404" }],
        }),
      ],
      [{ username: "alice" }],
    );

    const view = await getBio(USER, EDITION);
    expect(view?.extras.volunteeringInterests).toEqual(["rangers"]);
    expect(view?.extras.volunteeringOther).toBe("Fixing broken things");
    expect(view?.extras.rangerTraining).toBe(true);
  });

  it("merges stored privacy flags OVER the defaults, so a partial map keeps them", async () => {
    // A stored object holding one key must not drop every other flag to
    // undefined — an undefined flag reads as "not public", which silently
    // un-publishes fields the burner chose to show.
    dbMock.queue([bioRow({ privacyFlags: { homeCity: true } })], []);

    const view = await getBio(USER, EDITION);
    expect(view?.privacyFlags.homeCity).toBe(true);
    expect(Object.keys(view!.privacyFlags).length).toBeGreaterThan(1);
    for (const value of Object.values(view!.privacyFlags)) {
      expect(typeof value).toBe("boolean");
    }
  });

  it("reports cryptoConfigured both ways", async () => {
    dbMock.queue([bioRow()], []);
    expect((await getBio(USER, EDITION))?.cryptoConfigured).toBe(true);

    dbMock.reset();
    vi.stubEnv("PGCRYPTO_KEY", "");
    dbMock.queue([bioRow()], []);
    expect((await getBio(USER, EDITION))?.cryptoConfigured).toBe(false);
  });
});

describe("getUsername / isUsernameAvailable", () => {
  it("getUsername is null for a row with no handle and for no row at all", async () => {
    dbMock.queue([{ username: null }]);
    expect(await getUsername(USER)).toBeNull();

    dbMock.reset();
    dbMock.queue([]);
    expect(await getUsername(USER)).toBeNull();
  });

  it("treats the caller's OWN current handle as available", async () => {
    // Re-saving a bio must not tell someone their own username is taken.
    dbMock.queue([{ id: USER }]);
    expect(await isUsernameAvailable(USER, "Alice")).toBe(true);
  });

  it("refuses a handle somebody else holds, and names nobody", async () => {
    dbMock.queue([{ id: "somebody-else" }]);
    expect(await isUsernameAvailable(USER, "alice")).toBe(false);
  });

  it("is available when nothing holds it", async () => {
    dbMock.queue([]);
    expect(await isUsernameAvailable(USER, "brand_new")).toBe(true);
  });
});

describe("saveBio", () => {
  /** The minimum valid response map for the Burner Bio questionnaire. */
  function responses(overrides: Record<string, unknown> = {}) {
    return { legalName: "Alice Hatter", ...overrides };
  }

  it("REFUSES an invalid username before writing anything", async () => {
    // A bad handle must never half-save a bio: the bio row and the account
    // handle are two writes, and the second one failing after the first
    // succeeded is how a form reports an error over saved data.
    const result = await saveBio({
      userId: USER,
      editionId: EDITION,
      rawResponses: responses({ username: "no spaces here" }),
      final: false,
    });

    expect(result).toEqual({
      ok: false,
      errors: {
        username: "Usernames can only use letters, numbers and underscores.",
      },
    });
    expect(dbMock.queriesOfKind("insert")).toHaveLength(0);
  });

  it("REFUSES a handle somebody else already holds", async () => {
    dbMock.queue([{ id: "somebody-else" }]);

    expect(
      await saveBio({
        userId: USER,
        editionId: EDITION,
        rawResponses: responses({ username: "alice" }),
        final: false,
      }),
    ).toEqual({
      ok: false,
      errors: { username: "That username is already taken. Try another." },
    });
    expect(dbMock.queriesOfKind("insert")).toHaveLength(0);
  });

  it("reports a LOST RACE on the unique index as the same 'taken' outcome", async () => {
    // The availability pre-check is a hint that races. The `lower(username)`
    // index is the only real guarantee, and losing to it is an ordinary
    // outcome, not a 500. The message is identical so nobody can tell which
    // check fired.
    dbMock.queue(
      /* isUsernameAvailable */ [],
      /* the prior-row probe */ [],
      /* the bio upsert */ [],
      /* the username write loses the race */ uniqueViolation(
        "users_username_lower_idx",
      ),
    );

    expect(
      await saveBio({
        userId: USER,
        editionId: EDITION,
        rawResponses: responses({ username: "alice" }),
        final: false,
      }),
    ).toEqual({
      ok: false,
      errors: { username: "That username is already taken. Try another." },
    });
  });

  it("rethrows a non-unique failure on the username write", async () => {
    dbMock.queue([], [], [], new Error("connection terminated unexpectedly"));

    await expect(
      saveBio({
        userId: USER,
        editionId: EDITION,
        rawResponses: responses({ username: "alice" }),
        final: false,
      }),
    ).rejects.toThrow("connection terminated");
  });

  it("clears the handle when the field comes back blank and one was set", async () => {
    // The handle is OPTIONAL, and clearing it frees it for someone else.
    dbMock.queue(
      /* getUsername */ [{ username: "alice" }],
      /* prior row probe */ [],
      /* upsert */ [],
      /* username write */ [],
      /* ensureProfileKeypair probe */ [{ userId: USER }],
    );

    expect(
      await saveBio({
        userId: USER,
        editionId: EDITION,
        rawResponses: responses(),
        final: false,
      }),
    ).toEqual({ ok: true });

    expect(dbMock.writesTo(schema.users)[0]!.arg("set")).toEqual({
      username: null,
    });
  });

  it("writes no username patch at all when there was no handle to clear", async () => {
    dbMock.queue([{ username: null }], [], [], [{ userId: USER }]);

    await saveBio({
      userId: USER,
      editionId: EDITION,
      rawResponses: responses(),
      final: false,
    });

    expect(dbMock.writesTo(schema.users)).toHaveLength(0);
  });

  // ── WHAT REACHES THE DATABASE, not just what the code decided ─────────────
  //
  // The rest of this file tests the READ side of encryption thoroughly — that
  // unreadable ciphertext degrades to null rather than being shown, that a save
  // carrying medical notes refuses loudly with no key, that a minted profile key
  // is not stored in the clear. None of it asserted the WRITE. Replacing
  // `medicalNotes: medicalNotesEncrypted` with `medicalNotes: fields.medicalNotes`
  // — storing the exact plaintext a burner typed into the box — left every test
  // in this workspace green, because the plaintext assignment executes the same
  // lines. Medical notes are the SAFETY_VISIBLE class and ID documents are
  // HARD_LOCKED; "encrypted at rest" is product law for both (AGENTS.md
  // §Privacy classes), so it is asserted against the statement itself.

  it("writes the medical note as CIPHERTEXT, never the plaintext that was typed", async () => {
    const NOTE = "Severe bee allergy — carries an EpiPen, left thigh pocket.";
    dbMock.queue(
      /* getUsername */ [{ username: null }],
      /* the prior-row probe */ [],
      /* the bio upsert */ [],
      /* ensureProfileKeypair probe */ [{ userId: USER }],
    );

    expect(
      await saveBio({
        userId: USER,
        editionId: EDITION,
        rawResponses: responses({ medicalNotes: NOTE }),
        final: false,
      }),
    ).toEqual({ ok: true });

    const write = dbMock.writesTo(schema.burnerBios)[0]!;
    // Nowhere in the statement — not in the INSERT values, and not in the
    // ON CONFLICT DO UPDATE set, which is the branch an existing bio takes.
    expect(boundStrings(write)).not.toContain(NOTE);

    // And it is real encryption rather than a mangled value: a medic has to be
    // able to read it back, so the round trip is part of the guarantee.
    const values = write.arg("values") as { medicalNotes: string };
    expect(values.medicalNotes).not.toBe(NOTE);
    expect(decrypt(values.medicalNotes)).toBe(NOTE);

    const conflict = write.arg("onConflictDoUpdate") as {
      set: { medicalNotes: string };
    };
    expect(decrypt(conflict.set.medicalNotes)).toBe(NOTE);
  });

  it("writes the SA ID as ciphertext too, and leaves the passport column null", async () => {
    // Same code path, same gap: `saIdEncrypted` and `passportEncrypted` are
    // HARD_LOCKED_PRIVATE_FIELDS with no reveal path of any kind. The second
    // half matters as much as the first — switching document type must not
    // leave the other column holding a readable identifier.
    const SA_ID = "8001015009087";
    dbMock.queue([{ username: null }], [], [], [{ userId: USER }]);

    await saveBio({
      userId: USER,
      editionId: EDITION,
      rawResponses: responses({ "id.type": "sa_id", "id.number": SA_ID }),
      final: false,
    });

    const write = dbMock.writesTo(schema.burnerBios)[0]!;
    expect(boundStrings(write)).not.toContain(SA_ID);

    const values = write.arg("values") as {
      saIdEncrypted: string | null;
      passportEncrypted: string | null;
    };
    expect(values.saIdEncrypted).not.toBe(SA_ID);
    expect(decrypt(values.saIdEncrypted!)).toBe(SA_ID);
    expect(values.passportEncrypted).toBeNull();
  });

  it("REFUSES LOUDLY rather than silently dropping medical notes with no key", async () => {
    // Silently discarding special personal information while the form reports
    // "Saved" is worse than either storing or refusing it: a burner who typed
    // an allergy and saw a success message is entitled to believe a medic can
    // read it back.
    vi.stubEnv("PGCRYPTO_KEY", "");
    dbMock.queue([{ username: null }]);

    await expect(
      saveBio({
        userId: USER,
        editionId: EDITION,
        rawResponses: responses({ medicalNotes: "Severe bee allergy." }),
        final: false,
      }),
    ).rejects.toThrow(/encryption key isn't configured/);

    expect(dbMock.queriesOfKind("insert")).toHaveLength(0);
  });

  it("still saves the rest of a bio with no key when it carries nothing sensitive", async () => {
    // The env-less boot law: a deployment without PGCRYPTO_KEY is degraded,
    // not broken.
    vi.stubEnv("PGCRYPTO_KEY", "");
    dbMock.queue([{ username: null }], [], []);

    expect(
      await saveBio({
        userId: USER,
        editionId: EDITION,
        rawResponses: responses({ homeCity: "Cape Town" }),
        final: false,
      }),
    ).toEqual({ ok: true });
    expect(dbMock.writesTo(schema.burnerBios)).toHaveLength(1);
    // And no keypair was minted, because there is no key to protect it with.
    expect(dbMock.writesTo(schema.profileKeys)).toHaveLength(0);
  });

  it("leaves the v3 columns untouched when the caller supplies no extras", async () => {
    dbMock.queue([{ username: null }], [], [], [{ userId: USER }]);

    await saveBio({
      userId: USER,
      editionId: EDITION,
      rawResponses: responses(),
      final: false,
    });

    const values = dbMock
      .writesTo(schema.burnerBios)[0]!
      .arg("values") as Record<string, unknown>;
    expect(values).not.toHaveProperty("about");
    expect(values).not.toHaveProperty("campHistory");
  });

  it("REFUSES malformed extras rather than writing a partial bio", async () => {
    dbMock.queue([{ username: null }]);

    expect(
      await saveBio({
        userId: USER,
        editionId: EDITION,
        rawResponses: responses(),
        rawExtras: { campHistory: "not an array" },
        final: false,
      }),
    ).toEqual({ ok: false, errors: { _form: "Invalid bio details." } });
    expect(dbMock.queriesOfKind("insert")).toHaveLength(0);
  });

  it("degrades a camp-history entry whose group has gone to free text, keeping the label", async () => {
    dbMock.queue(
      /* getUsername */ [{ username: null }],
      /* resolveCampHistoryForWrite */ [],
      /* prior row */ [],
      /* upsert */ [],
      /* keypair probe */ [{ userId: USER }],
    );

    await saveBio({
      userId: USER,
      editionId: EDITION,
      rawResponses: responses(),
      rawExtras: {
        campHistory: [
          { kind: "linked", groupId: MAD_HATTERS, label: "Mad Hatters" },
        ],
      },
      final: false,
    });

    const values = dbMock.writesTo(schema.burnerBios)[0]!.arg("values") as {
      campHistory: { kind: string; label: string }[];
    };
    expect(values.campHistory).toEqual([
      { kind: "freetext", label: "Mad Hatters" },
    ]);
  });

  it("refreshes a still-valid linked entry to the group's CURRENT name", async () => {
    dbMock.queue(
      [{ username: null }],
      [{ id: MAD_HATTERS, name: "Mad Hatters" }],
      [],
      [],
      [{ userId: USER }],
    );

    await saveBio({
      userId: USER,
      editionId: EDITION,
      rawResponses: responses(),
      rawExtras: {
        campHistory: [
          { kind: "linked", groupId: MAD_HATTERS, label: "the old name" },
        ],
      },
      final: false,
    });

    const values = dbMock.writesTo(schema.burnerBios)[0]!.arg("values") as {
      campHistory: { label: string }[];
    };
    expect(values.campHistory[0]!.label).toBe("Mad Hatters");
  });

  it("on a FINAL save stamps completedAt and clears the blocking required action", async () => {
    dbMock.queue(
      [{ username: null }],
      [],
      [],
      [{ userId: USER }],
      /* completeRequiredAction */ [],
    );

    expect(
      await saveBio({
        userId: USER,
        editionId: EDITION,
        rawResponses: responses(),
        final: true,
      }),
    ).toEqual({ ok: true });

    const values = dbMock.writesTo(schema.burnerBios)[0]!.arg("values") as {
      completedAt: Date | null;
    };
    expect(values.completedAt).toBeInstanceOf(Date);

    const action = dbMock.writesTo(schema.requiredActions)[0]!;
    expect(action.arg("set")).toMatchObject({ status: "completed" });
  });

  it("on a DRAFT save leaves the required action alone", async () => {
    dbMock.queue([{ username: null }], [], [], [{ userId: USER }]);

    await saveBio({
      userId: USER,
      editionId: EDITION,
      rawResponses: responses(),
      final: false,
    });

    expect(dbMock.writesTo(schema.requiredActions)).toHaveLength(0);
  });

  it("does not reset privacy flags on a save that omits them", async () => {
    // A plain bio-text save must not silently un-private a field the burner
    // deliberately hid.
    dbMock.queue([{ username: null }], [], [], [{ userId: USER }]);

    await saveBio({
      userId: USER,
      editionId: EDITION,
      rawResponses: responses(),
      final: false,
    });

    const upsert = dbMock.writesTo(schema.burnerBios)[0]!;
    const conflict = upsert.arg("onConflictDoUpdate") as {
      set: Record<string, unknown>;
    };
    expect(conflict.set).not.toHaveProperty("privacyFlags");
  });
});

describe("savePrivacyFlags", () => {
  it("writes only the flags and the timestamp", async () => {
    dbMock.queue([]);
    await savePrivacyFlags(USER, EDITION, { homeCity: true });

    const set = dbMock.onlyQuery("update").arg("set") as Record<
      string,
      unknown
    >;
    expect(Object.keys(set).sort()).toEqual(["privacyFlags", "updatedAt"]);
    // Hard-locked fields are forced private however the caller flagged them.
    expect((set.privacyFlags as Record<string, boolean>).phone).toBe(false);
  });
});

describe("ensureProfileKeypair / getKeyFingerprint", () => {
  it("mints NOTHING when there is no PGCRYPTO_KEY — a lock box in the clear is worse than none", async () => {
    // This once ended `safeEncrypt(private) ?? private`, writing the profile
    // private key verbatim into a column named `encrypted_private_key`. Nothing
    // downstream could tell the two apart.
    vi.stubEnv("PGCRYPTO_KEY", "");

    await ensureProfileKeypair(USER);
    expect(dbMock.queries).toHaveLength(0);
  });

  it("mints one keypair and leaves an existing one alone", async () => {
    dbMock.queue(/* no existing key */ [], /* the insert */ []);
    await ensureProfileKeypair(USER);

    const insert = dbMock.onlyQuery("insert").arg("values") as {
      publicKey: string;
      encryptedPrivateKey: string;
    };
    expect(insert.publicKey.length).toBeGreaterThan(0);
    // Stored ENCRYPTED — never the raw base64 the generator returned.
    expect(insert.encryptedPrivateKey).not.toBe(insert.publicKey);

    dbMock.reset();
    dbMock.queue([{ userId: USER }]);
    await ensureProfileKeypair(USER);
    expect(dbMock.queriesOfKind("insert")).toHaveLength(0);
  });

  it("getKeyFingerprint is null with no keypair and eight hex pairs with one", async () => {
    dbMock.queue([]);
    expect(await getKeyFingerprint(USER)).toBeNull();

    dbMock.reset();
    const publicKey = Buffer.from("a-fake-public-key").toString("base64");
    dbMock.queue([{ publicKey }]);
    const fingerprint = await getKeyFingerprint(USER);
    expect(fingerprint).toMatch(/^([0-9a-f]{2}:){7}[0-9a-f]{2}$/);

    // Deterministic — the profile shows the same fingerprint every render.
    dbMock.reset();
    dbMock.queue([{ publicKey }]);
    expect(await getKeyFingerprint(USER)).toBe(fingerprint);
  });
});
