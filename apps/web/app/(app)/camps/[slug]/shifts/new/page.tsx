import { PreviewNotice } from "@/components/preview-notice";
import { ShiftForm } from "@/components/shifts/shift-form";
import { ShiftsHeader } from "@/components/shifts/shifts-header";
import { loadManagerContext } from "../context";
import { shiftFormRoles } from "../roles";

export const dynamic = "force-dynamic";

// /camps/[slug]/shifts/new (canvas S2). Leads and co-leads only; everyone
// else gets the camp's 404, and the action refuses them regardless.
export default async function NewShiftPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await loadManagerContext(slug);
  if (ctx.kind === "preview") return <PreviewNotice feature="Camp shifts" />;
  const { camp, board, days, edition } = ctx;
  const roles = await shiftFormRoles(camp.id, board);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <ShiftsHeader
        backHref={`/camps/${camp.slug}/shifts`}
        backLabel="Shifts"
        title="New shift"
        description={`Set it up once and repeat it across the days you need. ${edition.name}.`}
      />
      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This edition&apos;s dates aren&apos;t set, so there are no days to put
          shifts on yet.
        </p>
      ) : (
        <ShiftForm
          slug={camp.slug}
          days={days}
          teams={board.teams}
          roles={roles}
        />
      )}
    </div>
  );
}
