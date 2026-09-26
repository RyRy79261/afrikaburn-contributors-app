import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, MapPin, Users } from "lucide-react";
import { Badge } from "@quagga/ui/components/badge";
import { Button } from "@quagga/ui/components/button";
import { Card, CardContent } from "@quagga/ui/components/card";
import { EmptyState } from "@quagga/ui/components/empty-state";
import { getAuthenticatedUser } from "@/lib/auth";
import { enforceGate, getCurrentCampUser } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import { listCampPeople } from "@/lib/campmates-store";
import { PreviewNotice } from "@/components/preview-notice";
import { AvatarImage } from "@/components/avatar-image";

export const dynamic = "force-dynamic";

// "People in this camp" (epic #68). NEEDS DESIGN REVIEW — built from existing
// components without a canvas frame.
//
// THE BOUNDARY IS THE SERVER: `listCampPeople` → @quagga/core
// `buildCampPeopleView` returns null for anyone who is not a member of this
// theme camp, and this page turns that into a not-found — the SAME outcome as
// a slug that does not exist, so a free camp's people cannot be discovered by
// guessing. For a member it lists only the camp-mates who opted in this
// edition, each projected as a camp-mate sees them. The list shape has no slot
// for medical notes or any hard-locked field, so this page cannot render one.

const ParamsSchema = z.object({ slug: z.string().min(1).max(200) });

export default async function CampPeoplePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  if (!isDatabaseConfigured()) {
    return <PreviewNotice feature="Camp people" />;
  }

  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  const [viewer, edition] = await Promise.all([
    getCurrentCampUser(),
    getActiveEdition(),
  ]);
  if (!viewer) redirect("/auth/sign-in");
  if (!edition) return <PreviewNotice feature="Camp people" />;

  await enforceGate(viewer.id);

  const result = await listCampPeople({
    viewerUserId: viewer.id,
    slug: parsed.data.slug,
    editionId: edition.id,
  });
  if (!result) notFound();

  const viewerListed = result.people.some((p) => p.isViewer);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href={`/camps/${result.slug}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {result.name}
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">
          People in {result.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Camp mates who chose to be listed this edition, showing only what each
          of them shares with camp mates. Only members of this camp can see this
          page.
        </p>
      </div>

      {!viewerListed && (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          You&apos;re not listed here.{" "}
          <Link
            href="/profile"
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            Turn it on from your profile
          </Link>{" "}
          if you&apos;d like your camp mates to see you.
        </p>
      )}

      {result.people.length === 0 ? (
        <EmptyState
          icon={<Users className="h-5 w-5" aria-hidden />}
          title="Nobody's listed yet"
          description="Listing is off for everyone until they turn it on, so an empty page is normal."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {result.people.map((person) => {
            const f = person.fields;
            const about = f.about ?? f.bio;
            return (
              <li key={person.userId}>
                <Card className="h-full">
                  <CardContent className="flex flex-col gap-3 pt-5">
                    <div className="flex items-center gap-3">
                      <AvatarImage
                        userId={person.userId}
                        name={person.displayName}
                        showPhoto={person.showAvatar}
                        className="h-11 w-11 text-sm"
                      />
                      <div className="min-w-0">
                        <Link
                          href={`/burners/${person.userId}`}
                          className="block truncate font-medium underline-offset-2 hover:underline"
                        >
                          {person.displayName}
                        </Link>
                        {f.homeCity && (
                          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                            {f.homeCity}
                          </p>
                        )}
                      </div>
                      {person.isViewer && (
                        <Badge variant="secondary" className="ml-auto">
                          You
                        </Badge>
                      )}
                    </div>
                    {about && (
                      <p className="line-clamp-3 text-sm text-muted-foreground">
                        {about}
                      </p>
                    )}
                    {f.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {f.skills.map((skill) => (
                          <Badge key={skill} variant="outline">
                            {skill}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
