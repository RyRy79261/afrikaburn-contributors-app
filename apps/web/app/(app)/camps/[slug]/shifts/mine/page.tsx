import { PreviewNotice } from "@/components/preview-notice";
import { MemberShifts } from "@/components/shifts/member-shifts";
import { ShiftsHeader } from "@/components/shifts/shifts-header";
import { loadShiftsContext } from "../context";

export const dynamic = "force-dynamic";

// /camps/[slug]/shifts/mine — the member's own view (canvas S3), for every
// current member of the camp, leads included. Shift notifications link here.
export default async function MyShiftsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await loadShiftsContext(slug);
  if (ctx.kind === "preview") return <PreviewNotice feature="Camp shifts" />;
  const { camp, board, me, canManage } = ctx;
  const team = typeof query.team === "string" ? query.team : null;
  const teamFilter =
    team && board.teams.some((t) => t.id === team) ? team : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <ShiftsHeader
        backHref={canManage ? `/camps/${camp.slug}/shifts` : `/camps/${camp.slug}`}
        backLabel={canManage ? "All shifts" : camp.name}
        title="Shifts"
        description="Pick up a shift if you can — none of this is required. Every day of the burn is listed, build and strike included."
      />
      <MemberShifts
        slug={camp.slug}
        board={board}
        me={me}
        teamFilter={teamFilter}
        basePath={`/camps/${camp.slug}/shifts/mine`}
      />
    </div>
  );
}
