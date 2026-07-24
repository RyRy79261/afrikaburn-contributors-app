/**
 * Idempotent seed script (build-spec §Seeds). Populates:
 *   - org group "AfrikaBurn" (no seeded staff — the working group gets
 *     elevated live via GOD_EMAILS, mvp-proposal's own demo beat)
 *   - edition AfrikaBurn 2027 (2027-04-26 → 2027-05-02, active)
 *   - Mad Hatters (approved registration, realistic content grounded in
 *     docs/sources — a real AfrikaBurn village; containers are OUT of scope
 *     per build-spec, so no container data is seeded even though MAH-1..3
 *     exist in reality)
 *   - Camp 404 (under_review)
 *   - 6 fictional camps in varied states, including two free camps with no
 *     registration row at all
 *   - suppliers imported from data/suppliers.json (the AB public sheet
 *     snapshot)
 *   - payment references in mixed states (pending/reconciled/waived)
 *
 * No real people — every seed user is obviously fictional (@example.com).
 * Safe to run repeatedly: every write is an upsert keyed on the row's real
 * unique constraint (or, where none exists, a find-then-write lookup).
 *
 * Run via `pnpm --filter @quagga/db db:seed` once `DATABASE_URL` is set. This
 * script is NEVER part of any build step and must not run at import time.
 */
import { eq, and } from "drizzle-orm";
import {
  normalizeName,
  generatePaymentReference,
  deriveSubjectCode,
  completedSectionsFor,
  getPlacementZones,
  defaultPrivacyFlags,
  BURNER_BIO_VERSION,
} from "@quagga/core";
import { SupplierImportRow } from "@quagga/types";
import { createPooledDb } from "./index";
import * as schema from "./schema";
import suppliersDataRaw from "./data/suppliers.json" with { type: "json" };

// Validate the committed snapshot against the shared Zod schema at the
// boundary (build-spec: "Zod validation at every boundary") rather than
// trusting the JSON import's inferred `string` types.
const suppliersData = {
  ...suppliersDataRaw,
  suppliers: suppliersDataRaw.suppliers.map((row) => SupplierImportRow.parse(row)),
};

/** First row of a `.returning()` result, or throw — every insert here is a
 * single-row upsert, so an empty result means something is badly wrong. */
function firstOrThrow<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (!row) throw new Error(`[seed] expected a row after writing ${what}`);
  return row;
}

// --- Small local helpers (kept in-script — apps/web's slugify is a
// "server-only" module and not importable from a standalone db script). ----

function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "camp"
  );
}

const ZONES_2027 = getPlacementZones(2027);
function zone(label: string): string {
  const found = ZONES_2027.find((z) => z.value === label);
  if (!found) throw new Error(`Unknown 2027 placement zone: ${label}`);
  return found.value;
}

function daysBeforeEdition(days: number): Date {
  const editionStart = new Date("2027-04-26T00:00:00.000Z");
  return new Date(editionStart.getTime() - days * 24 * 60 * 60 * 1000);
}

type Db = ReturnType<typeof createPooledDb>["db"];
type GroupRow = typeof schema.groups.$inferSelect;

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error(
      "[seed] DATABASE_URL is not set — nothing to seed. Set it in .env first.",
    );
    process.exitCode = 1;
    return;
  }

  const { db, pool } = createPooledDb();

  try {
    // --- Edition -------------------------------------------------------------
    const edition = firstOrThrow(
      await db
        .insert(schema.editions)
        .values({
          name: "AfrikaBurn 2027",
          year: 2027,
          startDate: "2027-04-26",
          endDate: "2027-05-02",
          isActive: true,
        })
        .onConflictDoUpdate({
          target: schema.editions.year,
          set: { isActive: true, name: "AfrikaBurn 2027" },
        })
        .returning(),
      "the 2027 edition",
    );
    console.log(`[seed] edition: ${edition.name} (${edition.id})`);

    // --- Org group -------------------------------------------------------------
    // No memberships seeded on purpose — per mvp-proposal, staff elevate live
    // via GOD_EMAILS at the kickoff meeting.
    const orgGroup = await ensureGroup(db, {
      kind: "org",
      name: "AfrikaBurn",
      description: "The organising body behind the AfrikaBurn event.",
      joinability: "invite_only",
    });
    console.log(`[seed] org group: ${orgGroup.name} (${orgGroup.id})`);

    // --- Users (all fictional, @example.com) ------------------------------------
    const users = {
      dusty: await ensureUser(db, "dusty.prototype@example.com"),
      alice: await ensureUser(db, "alice.hatter@example.com"),
      jabu: await ensureUser(db, "jabu.teatime@example.com"),
      ren: await ensureUser(db, "ren.notfound@example.com"),
      script: await ensureUser(db, "script.kiddie@example.com"),
      sizwe: await ensureUser(db, "sizwe.embers@example.com"),
      greta: await ensureUser(db, "greta.spanner@example.com"),
      luna: await ensureUser(db, "luna.mirage@example.com"),
      kabelo: await ensureUser(db, "kabelo.static@example.com"),
      priya: await ensureUser(db, "priya.horizon@example.com"),
      theo: await ensureUser(db, "theo.windrow@example.com"),
    };
    console.log(`[seed] users: ${Object.keys(users).length}`);

    // A couple of Burner Bios so the directory/profile demo has real faces
    // beyond the camp roster.
    await ensureBurnerBio(db, users.dusty.id, edition.id, {
      displayName: "Dusty Prototype",
      homeCity: "Cape Town",
      bio: "First-timer, arriving solo, happiest fixing things that beep. Looking for a camp that needs a spare pair of hands more than a spare tent.",
      skills: ["build", "electrical"],
      firstTime: true,
      attendedYears: [],
      contactEmail: "dusty.prototype@example.com",
    });
    await ensureBurnerBio(db, users.alice.id, edition.id, {
      displayName: "Alice Hatter",
      homeCity: "Johannesburg",
      bio: "Mad Hatters lead, six burns running. Keeper of the teapot rota and the sound rig's spare fuses.",
      skills: ["sound", "admin", "kitchen"],
      firstTime: false,
      attendedYears: [2016, 2017, 2018, 2019, 2023, 2024],
      contactEmail: "alice.hatter@example.com",
    });
    await ensureBurnerBio(db, users.ren.id, edition.id, {
      displayName: "Ren Notfound",
      homeCity: "Cape Town",
      bio: "Camp 404 lead. Debugs generators the same way as code — one wire at a time.",
      skills: ["electrical", "admin"],
      firstTime: false,
      attendedYears: [2019, 2023, 2024],
      contactEmail: "ren.notfound@example.com",
    });

    // --- Mad Hatters (approved) ------------------------------------------------
    const madHatters = await ensureGroup(db, {
      kind: "theme_camp",
      name: "Mad Hatters",
      description:
        "A sound and hospitality village bringing 'The Church' — stretch-tent stage, sound rig, and lighting — to the binnekring. We host the Mad Hatters Tea Party midweek, run nightly music till 22:00, and welcome wanderers in for a drink, a spanking, or absolution for confessed sins.",
      joinability: "open",
      createdByUserId: users.alice.id,
    });
    await ensureMembership(db, users.alice.id, madHatters.id, "lead");
    await ensureMembership(db, users.jabu.id, madHatters.id, "member");

    const madHattersReg = await ensureRegistration(db, madHatters, {
      groupId: madHatters.id,
      editionId: edition.id,
      status: "approved",
      s1ContactEmail: "alice.hatter@example.com",
      s1AltContactName: "Jabu Teatime",
      s1AltContactPhone: "+27 82 000 1001",
      s1AltContactEmail: "jabu.teatime@example.com",
      s2LntPlan:
        "MOOP walk every morning before Quiet Period; all grey water filtered through our sock-and-gravel trench and evaporated on our own containers' roof deck; separated waste streams (compost, recycling, landfill) collected nightly by the LNT lead.",
      s2LntLeadName: "Marike Koekemoer",
      s2LntLeadPhone: "+27 82 000 1002",
      s2LntLeadEmail: "lnt.madhatters@example.com",
      s3ParticipationPlan:
        "The Church runs as our stage and gathering point: nightly sets till 22:00, a midweek Mad Hatters Tea Party from 17:00–20:00 with gifted tea and something stronger, and an open-mic slot for camp neighbours who want the rig for an hour.",
      s3OperatingHours: ["night", "late_night"],
      s3ScheduleDetail:
        "Mad Hatters Tea Party — Wednesday 17:00–20:00. Nightly sets 20:00–22:00 daily.",
      s3GiftingFood: true,
      s4ExpectedPopulation: 45,
      s4FirstArrivalDate: "2027-04-24",
      s4WorkAccessPasses: 6,
      s4AreaDimensions: "40m x 30m",
      s4LayoutUploadUrls: [],
      s5AmplifiedMusic: "Level 2 — Party speakers",
      s5SoundPlan:
        "Speakers aimed away from family camping, volume checked against neighbours each night at 20:00, rig powered down hard at 22:00 by our sound lead.",
      s5PlacementFirstChoice: zone("Loud Zone (northwest binnekring)"),
      s5PlacementSecondChoice: zone("Binnekring — front line (12ish)"),
      s5NeighbourRequest: "Would love to camp near Root'd and Skollie Patrollie.",
      s5FamilyFriendly: "Yes — quieter daytime hours, tea party is all-ages",
      s6SuppliersNote:
        "Stretch tent for The Church structure; sound & lighting rig hire; local firewood for the fire circle.",
      s6PaidPerformers: false,
      s6FeeStructure:
        "Member dues cover shared infrastructure and supplier deposits; no fee charged to camp guests.",
      s6ExpectedBudgetZar: 85000,
      s6PlugAndPlayAck: true,
      submittedAt: daysBeforeEdition(60),
      decidedAt: daysBeforeEdition(40),
    });
    await ensureSupplierDeclarations(db, madHattersReg.id, [
      "Dimensions Bedouin Stretch Tent Hire (Pty) Ltd",
      "Aurras Group (Pty) Ltd",
      "Godfrey Family Farms",
    ]);
    await ensureAuditEvent(db, {
      action: "registration.approved",
      subject: `registration:${madHattersReg.id}`,
      meta: { camp: "Mad Hatters", edition: edition.year, seeded: true },
    });

    // --- Camp 404 (under_review) -----------------------------------------------
    const camp404 = await ensureGroup(db, {
      kind: "theme_camp",
      name: "Camp 404",
      description:
        "Camp 404: Page Not Found — a maker and geek camp for people who came here anyway. We run a Lost & Found Data Café, gift retro-tech repairs and terrible puns, and light up our dome with scavenged LED signage every night.",
      joinability: "invite_only",
      createdByUserId: users.ren.id,
    });
    await ensureMembership(db, users.ren.id, camp404.id, "lead");
    await ensureMembership(db, users.script.id, camp404.id, "member");

    const camp404Reg = await ensureRegistration(db, camp404, {
      groupId: camp404.id,
      editionId: edition.id,
      status: "under_review",
      s1ContactEmail: "ren.notfound@example.com",
      s1AltContactName: "Script Kiddie",
      s1AltContactPhone: "+27 82 000 2001",
      s1AltContactEmail: "script.kiddie@example.com",
      s2LntPlan:
        "All e-waste and packaging carried back out with us; grey water from the Data Café's dish station poured through a gravel sump; nightly MOOP sweep of the dome footprint.",
      s2LntLeadName: "Script Kiddie",
      s2LntLeadPhone: "+27 82 000 2002",
      s2LntLeadEmail: "lnt.camp404@example.com",
      s3ParticipationPlan:
        "The Lost & Found Data Café gifts free repairs on dead flashlights, headlamps, and small electronics, teaches basic soldering to anyone curious, and runs a nightly 'terminal poetry' open mic on a salvaged CRT.",
      s3OperatingHours: ["day", "night"],
      s3ScheduleDetail: "Repair café open daily 10:00–16:00; terminal poetry nightly at 21:00.",
      s3GiftingFood: false,
      s4ExpectedPopulation: 18,
      s4FirstArrivalDate: "2027-04-25",
      s4WorkAccessPasses: 2,
      s4AreaDimensions: "12m x 12m",
      s4LayoutUploadUrls: [],
      s5AmplifiedMusic: "No amplified sound",
      s5SoundPlan: null,
      s5PlacementFirstChoice: zone("Mid-city (3ish–9ish roads)"),
      s5PlacementSecondChoice: zone("Quiet Camping (behind the dunes)"),
      s5NeighbourRequest: null,
      s5FamilyFriendly: "Yes — repair café welcomes all ages",
      s6SuppliersNote: "Small trailer hire to bring the repair bench and spares in.",
      s6PaidPerformers: false,
      s6FeeStructure: "Self-funded by the crew; no camp fee.",
      s6ExpectedBudgetZar: 12000,
      s6PlugAndPlayAck: true,
      submittedAt: daysBeforeEdition(20),
    });
    await ensureSupplierDeclarations(db, camp404Reg.id, ["Jenquan Logistics"]);
    await ensureSectionReview(db, {
      registrationId: camp404Reg.id,
      sectionKey: "identity",
      status: "resolved",
      comment: "Thanks — camp description is clear and under the word limit.",
    });

    // --- 6 fictional camps in varied states --------------------------------------

    // Draft — partial sections only (identity + LNT done, nothing else yet).
    const saltEmber = await ensureGroup(db, {
      kind: "theme_camp",
      name: "Salt & Ember Kitchen",
      description:
        "Salt & Ember Kitchen is a communal cooking camp built around one big open fire. We gift slow-cooked meals most evenings, teach basic fire cookery to anyone who wanders past, and keep our footprint tiny: one fire pit, one grey-water trench, nothing left behind.",
      joinability: "open",
      createdByUserId: users.sizwe.id,
    });
    await ensureMembership(db, users.sizwe.id, saltEmber.id, "lead");
    await ensureRegistration(db, saltEmber, {
      groupId: saltEmber.id,
      editionId: edition.id,
      status: "draft",
      s1ContactEmail: "sizwe.embers@example.com",
      s2LntPlan:
        "Single fire pit dug and refilled per LNT guidance; grey water from dish-washing filtered through a gravel trench before evaporation.",
      s2LntLeadName: "Sizwe Embers",
      s2LntLeadPhone: "+27 82 000 3001",
      s2LntLeadEmail: "sizwe.embers@example.com",
    });

    // Submitted — all six sections complete, awaiting first review.
    const tinkerers = await ensureGroup(db, {
      kind: "theme_camp",
      name: "Tankwa Tinkerers",
      description:
        "Tankwa Tinkerers fixes things. Bring us a broken bike, a dead headlamp, or a sulking generator and we'll gift you our tools, our hands, and bad advice. Evenings are quiet — we're early risers who'd rather wrench at dawn than rage at midnight.",
      joinability: "open",
      createdByUserId: users.greta.id,
    });
    await ensureMembership(db, users.greta.id, tinkerers.id, "lead");
    const tinkerersReg = await ensureRegistration(db, tinkerers, {
      groupId: tinkerers.id,
      editionId: edition.id,
      status: "submitted",
      s1ContactEmail: "greta.spanner@example.com",
      s2LntPlan:
        "Spare parts and scrap metal packed out in labelled crates; no fluids drained on site — dead batteries and oil carried to the eco-depot.",
      s2LntLeadName: "Greta Spanner",
      s2LntLeadPhone: "+27 82 000 4001",
      s2LntLeadEmail: "greta.spanner@example.com",
      s3ParticipationPlan:
        "Daily bike and generator repair clinic, gifted freely, plus a spare-parts swap shelf anyone can take from or add to.",
      s3OperatingHours: ["morning", "day"],
      s3ScheduleDetail: "Repair clinic 08:00–12:00 daily.",
      s3GiftingFood: false,
      s4ExpectedPopulation: 14,
      s4FirstArrivalDate: "2027-04-25",
      s4WorkAccessPasses: 2,
      s4AreaDimensions: "10m x 10m",
      s5AmplifiedMusic: "No amplified sound",
      s5PlacementFirstChoice: zone("Quiet Camping (behind the dunes)"),
      s5FamilyFriendly: "Yes",
      s6PaidPerformers: false,
      s6FeeStructure: "Self-funded; no camp fee.",
      s6ExpectedBudgetZar: 9000,
      s6PlugAndPlayAck: true,
      submittedAt: daysBeforeEdition(5),
    });

    // Changes requested — complete submission, one open section review.
    const velvetMirage = await ensureGroup(db, {
      kind: "theme_camp",
      name: "The Velvet Mirage",
      description:
        "The Velvet Mirage is a desert cabaret — nightly burlesque, aerial silks, and a lounge bar pouring gifted cocktails till late. Expect glitter, expect heat, expect a rig loud enough to find us from the binnekring.",
      joinability: "invite_only",
      createdByUserId: users.luna.id,
    });
    await ensureMembership(db, users.luna.id, velvetMirage.id, "lead");
    const velvetMirageReg = await ensureRegistration(db, velvetMirage, {
      groupId: velvetMirage.id,
      editionId: edition.id,
      status: "changes_requested",
      s1ContactEmail: "luna.mirage@example.com",
      s2LntPlan:
        "Costume glitter is cosmetic-grade and biodegradable only; all sequins and set dressing packed out; grey water from the bar filtered before evaporation.",
      s2LntLeadName: "Luna Mirage",
      s2LntLeadPhone: "+27 82 000 5001",
      s2LntLeadEmail: "luna.mirage@example.com",
      s3ParticipationPlan:
        "Nightly cabaret sets — burlesque, aerial silks, a live band on weekends — plus a gifted cocktail lounge open till late.",
      s3OperatingHours: ["night", "late_night"],
      s3ScheduleDetail: "Doors 20:00, headline set 22:00, lounge open till 02:00.",
      s3GiftingFood: true,
      s4ExpectedPopulation: 32,
      s4FirstArrivalDate: "2027-04-24",
      s4WorkAccessPasses: 4,
      s4AreaDimensions: "25m x 20m",
      s5AmplifiedMusic: "Level 4 — Large rig",
      s5SoundPlan:
        "Full PA for live sets, front-of-house engineer nightly, rig aimed into the dancefloor and away from camping.",
      s5PlacementFirstChoice: zone("Quiet Camping (behind the dunes)"),
      s5PlacementSecondChoice: zone("Binnekring — front line (12ish)"),
      s5FamilyFriendly: "Maybe — adult content after 22:00, family hours before",
      s6PaidPerformers: true,
      s6FeeStructure: "Ticketed guest performer fees covered from camp dues; no charge at the door.",
      s6ExpectedBudgetZar: 60000,
      s6PlugAndPlayAck: true,
      submittedAt: daysBeforeEdition(15),
    });
    await ensureSectionReview(db, {
      registrationId: velvetMirageReg.id,
      sectionKey: "sound_placement",
      status: "open",
      comment:
        "A Level 4 rig needs the Loud Zone, not Quiet Camping — please pick a placement compatible with your sound level, or bring the rig down a level.",
    });

    // Withdrawn — was submitted, then pulled voluntarily.
    const quietStatic = await ensureGroup(db, {
      kind: "theme_camp",
      name: "Quiet Static Radio",
      description:
        "Quiet Static Radio broadcasts a low-power pirate station across the city after dark — ambient sets, found-sound collages, and a nightly bedtime story read by whoever's still awake. Acoustic only; headphones encouraged.",
      joinability: "open",
      createdByUserId: users.kabelo.id,
    });
    await ensureMembership(db, users.kabelo.id, quietStatic.id, "lead");
    await ensureRegistration(db, quietStatic, {
      groupId: quietStatic.id,
      editionId: edition.id,
      status: "withdrawn",
      s1ContactEmail: "kabelo.static@example.com",
      s2LntPlan: "All transmitter gear and cabling packed out nightly; no ground disturbance.",
      s2LntLeadName: "Kabelo Static",
      s2LntLeadPhone: "+27 82 000 6001",
      s2LntLeadEmail: "kabelo.static@example.com",
      s3ParticipationPlan: "Low-power FM broadcast of ambient sets and a nightly bedtime story.",
      s3OperatingHours: ["late_night"],
      s3GiftingFood: false,
      s4ExpectedPopulation: 6,
      s4FirstArrivalDate: "2027-04-25",
      s4AreaDimensions: "6m x 6m",
      s5AmplifiedMusic: "No amplified sound",
      s5PlacementFirstChoice: zone("Quiet Camping (behind the dunes)"),
      s5FamilyFriendly: "Yes",
      s6PaidPerformers: false,
      s6FeeStructure: "Self-funded; no camp fee.",
      s6PlugAndPlayAck: true,
      submittedAt: daysBeforeEdition(30),
      decidedAt: daysBeforeEdition(10),
    });

    // Free camps — organising on the spot, no registration row at all.
    const borrowedHorizon = await ensureGroup(db, {
      kind: "theme_camp",
      name: "Borrowed Horizon",
      description:
        "Borrowed Horizon is a small photography and stargazing camp — we gift telescope time, long-exposure tutorials, and a shared shade structure to anyone who needs to get out of the sun for an hour.",
      joinability: "open",
      createdByUserId: users.priya.id,
    });
    await ensureMembership(db, users.priya.id, borrowedHorizon.id, "lead");

    const windrowCollective = await ensureGroup(db, {
      kind: "theme_camp",
      name: "Windrow Collective",
      description:
        "Windrow Collective grows a pop-up desert garden from reclaimed grey water and shade cloth, gifting fresh herbs and a cool patch of green to whoever needs a break from the dust.",
      joinability: "open",
      createdByUserId: users.theo.id,
    });
    await ensureMembership(db, users.theo.id, windrowCollective.id, "lead");

    // --- Suppliers ---------------------------------------------------------------
    let supplierCount = 0;
    for (const row of suppliersData.suppliers) {
      await ensureSupplier(db, row);
      supplierCount++;
    }
    console.log(`[seed] suppliers: ${supplierCount} (source: ${suppliersData.source})`);

    // --- Payments (mixed states) ----------------------------------------------------
    await ensurePayment(db, {
      subjectType: "registration",
      subjectId: madHattersReg.id,
      reference: generatePaymentReference({
        year: 2027,
        code: deriveSubjectCode("Mad Hatters"),
        sequence: 1,
      }),
      amountCents: 850000,
      currency: "ZAR",
      status: "reconciled",
      details: { label: "Placement fee (2027 season)" },
      recordedByUserId: null,
    });
    await ensurePayment(db, {
      subjectType: "registration",
      subjectId: camp404Reg.id,
      reference: generatePaymentReference({
        year: 2027,
        code: deriveSubjectCode("Camp 404"),
        sequence: 1,
      }),
      amountCents: null,
      currency: "ZAR",
      status: "pending",
      details: { label: "Placement fee (indicative — awaiting AB confirmation)" },
      recordedByUserId: null,
    });
    await ensurePayment(db, {
      subjectType: "registration",
      subjectId: tinkerersReg.id,
      reference: generatePaymentReference({
        year: 2027,
        code: deriveSubjectCode("Tankwa Tinkerers"),
        sequence: 1,
      }),
      amountCents: null,
      currency: "ZAR",
      status: "pending",
      details: { label: "Placement fee (indicative)" },
      recordedByUserId: null,
    });
    const waivedPayment = await ensurePayment(db, {
      subjectType: "registration",
      subjectId: velvetMirageReg.id,
      reference: generatePaymentReference({
        year: 2027,
        code: deriveSubjectCode("The Velvet Mirage"),
        sequence: 1,
      }),
      amountCents: 400000,
      currency: "ZAR",
      status: "waived",
      details: { label: "Placement fee — waived pending resubmission" },
      recordedByUserId: null,
    });

    await ensureAuditEvent(db, {
      action: "payment.reconciled",
      subject: `registration:${madHattersReg.id}`,
      meta: { camp: "Mad Hatters", edition: edition.year, seeded: true },
    });
    await ensureAuditEvent(db, {
      action: "payment.waived",
      subject: `payment:${waivedPayment.id}`,
      meta: { camp: "The Velvet Mirage", edition: edition.year, seeded: true },
    });

    console.log("[seed] done.");
  } finally {
    await pool.end();
  }
}

// --- Upsert helpers ------------------------------------------------------------
// Idempotent by construction: each keys on the row's real unique constraint
// (schema.ts) except `suppliers`, which has none — that path does a
// find-then-write lookup by name + source instead.

async function ensureUser(db: Db, email: string) {
  const authUserId = `seed:${email}`;
  return firstOrThrow(
    await db
      .insert(schema.users)
      .values({ authUserId, email })
      .onConflictDoUpdate({
        target: schema.users.authUserId,
        set: { email },
      })
      .returning(),
    `user ${email}`,
  );
}

async function ensureBurnerBio(
  db: Db,
  userId: string,
  editionId: string,
  fields: {
    displayName: string;
    homeCity: string;
    bio: string;
    skills: string[];
    firstTime: boolean;
    attendedYears: number[];
    contactEmail: string;
  },
) {
  const existing = await db
    .select()
    .from(schema.burnerBios)
    .where(
      and(
        eq(schema.burnerBios.userId, userId),
        eq(schema.burnerBios.editionId, editionId),
      ),
    )
    .limit(1);
  const existingRow = existing[0];
  if (existingRow) return existingRow;

  return firstOrThrow(
    await db
      .insert(schema.burnerBios)
      .values({
        userId,
        editionId,
        displayName: fields.displayName,
        homeCity: fields.homeCity,
        bio: fields.bio,
        skills: fields.skills,
        firstTime: fields.firstTime,
        attendedYears: fields.attendedYears,
        contactEmail: fields.contactEmail,
        privacyFlags: defaultPrivacyFlags(),
        version: BURNER_BIO_VERSION,
        completedAt: new Date(),
      })
      .returning(),
    `burner bio for user ${userId}`,
  );
}

interface GroupSpec {
  kind: (typeof schema.groups.$inferInsert)["kind"];
  name: string;
  description?: string;
  joinability?: (typeof schema.groups.$inferInsert)["joinability"];
  createdByUserId?: string;
}

async function ensureGroup(db: Db, spec: GroupSpec): Promise<GroupRow> {
  const nameNormalized = normalizeName(spec.name);
  const existing = await db
    .select()
    .from(schema.groups)
    .where(
      and(
        eq(schema.groups.kind, spec.kind),
        eq(schema.groups.nameNormalized, nameNormalized),
      ),
    )
    .limit(1);
  const existingRow = existing[0];
  if (existingRow) return existingRow;

  const baseSlug = slugify(spec.name);
  let slug = baseSlug;
  let suffix = 2;
  // Extremely unlikely to collide (names are unique per kind already), but
  // slugs are globally unique across all kinds — guard anyway.
  for (;;) {
    const clash = await db
      .select({ id: schema.groups.id })
      .from(schema.groups)
      .where(eq(schema.groups.slug, slug))
      .limit(1);
    if (clash.length === 0) break;
    slug = `${baseSlug}-${suffix++}`;
  }

  return firstOrThrow(
    await db
      .insert(schema.groups)
      .values({
        kind: spec.kind,
        name: spec.name,
        nameNormalized,
        slug,
        description: spec.description ?? null,
        joinability: spec.joinability ?? "invite_only",
        createdByUserId: spec.createdByUserId ?? null,
      })
      .returning(),
    `group ${spec.name}`,
  );
}

async function ensureMembership(
  db: Db,
  userId: string,
  groupId: string,
  role: (typeof schema.memberships.$inferInsert)["role"],
) {
  return firstOrThrow(
    await db
      .insert(schema.memberships)
      .values({ userId, groupId, role })
      .onConflictDoUpdate({
        target: [schema.memberships.userId, schema.memberships.groupId],
        set: { role },
      })
      .returning(),
    `membership ${userId}/${groupId}`,
  );
}

type RegistrationInput = Omit<
  typeof schema.registrations.$inferInsert,
  "id" | "createdAt" | "updatedAt" | "completedSections"
>;

async function ensureRegistration(
  db: Db,
  group: Pick<GroupRow, "name" | "description">,
  input: RegistrationInput,
) {
  const completedSections = completedSectionsFor({
    campName: group.name,
    campDescription: group.description,
    s1ContactEmail: input.s1ContactEmail,
    s2LntPlan: input.s2LntPlan,
    s2LntLeadName: input.s2LntLeadName,
    s2LntLeadPhone: input.s2LntLeadPhone,
    s2LntLeadEmail: input.s2LntLeadEmail,
    s3ParticipationPlan: input.s3ParticipationPlan,
    s3OperatingHours: input.s3OperatingHours as string[] | null | undefined,
    s3GiftingFood: input.s3GiftingFood,
    s4ExpectedPopulation: input.s4ExpectedPopulation,
    s4FirstArrivalDate: input.s4FirstArrivalDate,
    s4AreaDimensions: input.s4AreaDimensions,
    s5AmplifiedMusic: input.s5AmplifiedMusic,
    s5SoundPlan: input.s5SoundPlan,
    s5PlacementFirstChoice: input.s5PlacementFirstChoice,
    s5FamilyFriendly: input.s5FamilyFriendly,
    s6PaidPerformers: input.s6PaidPerformers,
    s6FeeStructure: input.s6FeeStructure,
    s6PlugAndPlayAck: input.s6PlugAndPlayAck,
  });

  return firstOrThrow(
    await db
      .insert(schema.registrations)
      .values({ ...input, completedSections })
      .onConflictDoUpdate({
        target: [schema.registrations.groupId, schema.registrations.editionId],
        set: { ...input, completedSections },
      })
      .returning(),
    `registration ${input.groupId}/${input.editionId}`,
  );
}

async function ensureSectionReview(
  db: Db,
  input: {
    registrationId: string;
    sectionKey: (typeof schema.sectionReviews.$inferInsert)["sectionKey"];
    status: (typeof schema.sectionReviews.$inferInsert)["status"];
    comment: string;
  },
) {
  const existing = await db
    .select()
    .from(schema.sectionReviews)
    .where(
      and(
        eq(schema.sectionReviews.registrationId, input.registrationId),
        eq(schema.sectionReviews.sectionKey, input.sectionKey),
      ),
    )
    .limit(1);
  const existingRow = existing[0];
  if (existingRow) {
    return firstOrThrow(
      await db
        .update(schema.sectionReviews)
        .set({ status: input.status, comment: input.comment })
        .where(eq(schema.sectionReviews.id, existingRow.id))
        .returning(),
      `section review ${input.registrationId}/${input.sectionKey}`,
    );
  }
  return firstOrThrow(
    await db.insert(schema.sectionReviews).values(input).returning(),
    `section review ${input.registrationId}/${input.sectionKey}`,
  );
}

async function ensureSupplier(
  db: Db,
  row: {
    name: string;
    services: string;
    contact: string;
    website: string;
    vettingStatus: (typeof schema.suppliers.$inferInsert)["vettingStatus"];
  },
) {
  const existing = await db
    .select()
    .from(schema.suppliers)
    .where(and(eq(schema.suppliers.name, row.name), eq(schema.suppliers.source, "ab_sheet")))
    .limit(1);
  const existingRow = existing[0];
  if (existingRow) {
    return firstOrThrow(
      await db
        .update(schema.suppliers)
        .set({
          services: row.services,
          contact: row.contact,
          website: row.website,
          vettingStatus: row.vettingStatus,
        })
        .where(eq(schema.suppliers.id, existingRow.id))
        .returning(),
      `supplier ${row.name}`,
    );
  }
  return firstOrThrow(
    await db
      .insert(schema.suppliers)
      .values({
        name: row.name,
        services: row.services,
        contact: row.contact,
        website: row.website,
        vettingStatus: row.vettingStatus,
        source: "ab_sheet",
        importedAt: new Date(suppliersData.importedAt),
      })
      .returning(),
    `supplier ${row.name}`,
  );
}

async function ensureSupplierDeclarations(
  db: Db,
  registrationId: string,
  supplierNames: string[],
) {
  for (const name of supplierNames) {
    const found = await db
      .select({ id: schema.suppliers.id })
      .from(schema.suppliers)
      .where(eq(schema.suppliers.name, name))
      .limit(1);
    const supplier = found[0];
    if (!supplier) {
      console.warn(`[seed] supplier declaration skipped — not found: ${name}`);
      continue;
    }
    await db
      .insert(schema.supplierDeclarations)
      .values({ registrationId, supplierId: supplier.id })
      .onConflictDoNothing();
  }
}

async function ensurePayment(
  db: Db,
  input: Omit<typeof schema.payments.$inferInsert, "id" | "createdAt" | "updatedAt">,
) {
  return firstOrThrow(
    await db
      .insert(schema.payments)
      .values(input)
      .onConflictDoUpdate({
        target: schema.payments.reference,
        set: {
          amountCents: input.amountCents,
          status: input.status,
          details: input.details,
        },
      })
      .returning(),
    `payment ${input.reference}`,
  );
}

async function ensureAuditEvent(
  db: Db,
  input: { action: string; subject: string; meta: Record<string, unknown> },
) {
  // Audit events have no natural unique key; guard idempotency by (action,
  // subject) — good enough for a seed script run repeatedly.
  const existing = await db
    .select({ id: schema.auditEvents.id })
    .from(schema.auditEvents)
    .where(
      and(
        eq(schema.auditEvents.action, input.action),
        eq(schema.auditEvents.subject, input.subject),
      ),
    )
    .limit(1);
  const existingRow = existing[0];
  if (existingRow) return existingRow;
  return firstOrThrow(
    await db
      .insert(schema.auditEvents)
      .values({ actorId: null, action: input.action, subject: input.subject, meta: input.meta })
      .returning(),
    `audit event ${input.action}/${input.subject}`,
  );
}

main().catch((err) => {
  console.error("[seed] Failed:", err);
  process.exitCode = 1;
});
