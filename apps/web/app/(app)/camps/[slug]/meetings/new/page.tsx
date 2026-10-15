import { PreviewNotice } from "@/components/preview-notice";
import { ShiftsHeader } from "@/components/shifts/shifts-header";
import { MeetingForm } from "@/components/meetings/meeting-form";
import { loadSchedulerContext, meetingFormData } from "../context";

export const dynamic = "force-dynamic";

// /camps/[slug]/meetings/new (frame G3 TqtC2 / Cf5Jm). Leads, co-leads and
// `schedule_meetings` holders only; everyone else gets the camp's 404, and
// the store refuses them regardless.

/** The schedule form. */
export default async function NewMeetingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await loadSchedulerContext(slug);
  if (ctx.kind === "preview") return <PreviewNotice feature="Camp meetings" />;
  const { access, edition, user } = ctx;
  const { roles, members } = await meetingFormData(access, edition.id, user.id);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <ShiftsHeader
        backHref={`/camps/${access.camp.slug}/meetings`}
        backLabel="Meetings"
        title="Schedule a meeting"
      />
      <MeetingForm
        slug={access.camp.slug}
        roles={roles}
        members={members}
        baselineRoleId={access.baselineRoleId}
      />
    </div>
  );
}
