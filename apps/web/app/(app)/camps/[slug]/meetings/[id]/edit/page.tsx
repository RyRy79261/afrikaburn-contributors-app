import { notFound } from "next/navigation";
import { PreviewNotice } from "@/components/preview-notice";
import { ShiftsHeader } from "@/components/shifts/shifts-header";
import { MeetingForm } from "@/components/meetings/meeting-form";
import { loadCampMeeting } from "@/lib/camp-meetings-store";
import { offeredAudienceRoleIds } from "@/lib/meeting-view";
import { loadSchedulerContext, meetingFormData } from "../../context";

export const dynamic = "force-dynamic";

// /camps/[slug]/meetings/[id]/edit (frame G3 state 2). A meeting the viewer
// cannot see is the 404 a missing one is; one they see but may not edit, and
// a cancelled one, are 404 too — there is no form for them to fill.

/** The edit form, filled with the stored meeting. */
export default async function EditMeetingPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const ctx = await loadSchedulerContext(slug);
  if (ctx.kind === "preview") return <PreviewNotice feature="Camp meetings" />;
  const { access, edition, meetingEdition, user } = ctx;
  const meeting = await loadCampMeeting(access, meetingEdition, id);
  if (!meeting || !meeting.canEdit || meeting.cancelledAt) notFound();
  const { roles, teams, members } = await meetingFormData(
    access,
    edition.id,
    user.id,
    meeting.audienceTeamIds,
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <ShiftsHeader
        backHref={`/camps/${access.camp.slug}/meetings/${meeting.id}`}
        backLabel={meeting.title}
        title="Edit meeting"
      />
      <MeetingForm
        slug={access.camp.slug}
        roles={roles}
        teams={teams}
        campWide={access.canScheduleCampWide}
        members={members}
        baselineRoleId={access.baselineRoleId}
        initial={{
          id: meeting.id,
          version: meeting.version,
          title: meeting.title,
          date: meeting.date,
          startMinute: meeting.startMinute,
          durationMinutes: meeting.durationMinutes,
          location: meeting.location,
          videoLink: meeting.videoLink,
          mode: meeting.audience.mode,
          roleIds: offeredAudienceRoleIds(meeting.audienceRoleIds, roles),
          teamIds: offeredAudienceRoleIds(meeting.audienceTeamIds, teams),
          agendaMd: meeting.agendaMd,
        }}
      />
    </div>
  );
}
