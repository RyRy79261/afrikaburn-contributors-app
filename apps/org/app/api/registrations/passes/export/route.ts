import { NextResponse } from "next/server";

import { buildWapCsv, wapCsvFilename, type WapExportInput } from "@quagga/core";

import { getDb } from "@/lib/db";
import { getActiveEdition } from "@/lib/queries";
import { requireOrgSession } from "@/lib/session";
import { readWapExportProjects, readWapPasses } from "@/lib/wap";

// The Work Access Pass export (WAP-009): every named pass holder in the active
// edition, one row each — the hand-off to AfrikaBurn's gate until it says what
// its systems can ingest (docs/wap-spec.md, "Not built").
//
// AUTHORISED AS `personal_information` ON `registrations`, not `read`: the file
// holds each holder's EMAIL, which is how AfrikaBurn matches a pass to a person.
// That is personal information, and a file is the easiest container to lose.
//
// WHAT IS NOT IN IT is enforced one layer down: @quagga/core `WapExportRow` has
// no slot for a phone number, an emergency contact, an ID or passport number or
// a medical note, and a test pins it. The only person-level reads below are the
// username and email; the bio is read for its completion stamp only.
//
// The flags column carries "Also has a pass from {project}" — the same note the
// reviewer sees, the decided exception to free-camp undiscoverability.

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await requireOrgSession({
      capability: "personal_information",
      domain: "registrations",
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Not authorised.",
      },
      { status: 403 },
    );
  }

  const edition = await getActiveEdition();
  if (!edition) {
    return NextResponse.json(
      { ok: false, error: "No active edition is seeded." },
      { status: 503 },
    );
  }

  const db = getDb();
  const [projects, passes] = await Promise.all([
    readWapExportProjects(edition.id),
    readWapPasses(db, edition.id, { withEmail: true }),
  ]);

  const rows: WapExportInput[] = [];
  for (const p of passes) {
    const project = projects.get(p.registrationId);
    if (!project) continue;
    rows.push({
      projectName: project.projectName,
      projectKind: project.projectKind,
      listStatus: project.listStatus,
      name: p.displayName,
      username: p.username,
      email: p.email,
      pass: p.effective,
      flags: p.flags,
    });
  }
  rows.sort(
    (a, b) =>
      a.projectName.localeCompare(b.projectName) ||
      a.name.localeCompare(b.name),
  );

  return new NextResponse(buildWapCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${wapCsvFilename(edition.year, new Date())}"`,
      "Cache-Control": "no-store",
    },
  });
}
