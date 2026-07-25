import Link from "next/link";
import { redirect } from "next/navigation";
import { Flame, Compass, ClipboardCheck, Users } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { QuiltBand } from "@quagga/ui/components/quilt-band";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { getAuthenticatedUser } from "@/lib/auth";
import { getCurrentCampUser, pendingBlockingRoute } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getEditionLabel } from "@/lib/edition";
import { NotConfiguredBanner } from "@/components/not-configured-banner";

// Reads the session cookie on every request; cannot be statically prerendered.
export const dynamic = "force-dynamic";

// Feature cards — copy MUST match the design canvas (frame L82AQr). Icons echo
// the brand triad (teal · apricot · sage), mirroring the QuiltBand.
const FEATURES = [
  {
    icon: Compass,
    tint: "text-ab-teal",
    title: "Find your people",
    body: "Browse every theme camp in one directory. See who's registered, who's accepting members, and who's invite-only — no spreadsheets, no guessing.",
  },
  {
    icon: ClipboardCheck,
    tint: "text-ab-apricot",
    title: "Fewer forms, not more",
    body: "Registration is six sections in any order. Progress saves as you go, and honest indicators tell you exactly what's still needed before you submit.",
  },
  {
    icon: Users,
    tint: "text-ab-sage",
    title: "Everyone in one place",
    body: "Invite members with a link, manage roles, and keep your camp's story, roster and entitlements together all edition long.",
  },
] as const;

export default async function HomePage() {
  const user = await getAuthenticatedUser();

  // Signed-in + connected: route past the marketing page — to onboarding while
  // the Burner Bio is pending, otherwise into the directory.
  if (user && isDatabaseConfigured()) {
    const campUser = await getCurrentCampUser();
    if (campUser) {
      const gate = await pendingBlockingRoute(campUser.id);
      redirect(gate ?? "/directory");
    }
  }

  const editionLabel = await getEditionLabel();

  return (
    <div className="flex min-h-svh flex-col">
      {/* Full-width quilt edge (identity motif, edge-to-edge). */}
      <QuiltBand />

      <header className="border-b border-border">
        <nav className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Flame className="h-5 w-5 text-primary" aria-hidden />
            <span className="tracking-tight">Quagga Portal</span>
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/auth/sign-in">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/auth/sign-up">Sign up</Link>
            </Button>
          </div>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-14 px-6 py-12">
        <NotConfiguredBanner />

        {/* Hero */}
        <section className="flex flex-col gap-5">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
            {editionLabel}
          </p>
          <h1 className="max-w-3xl text-4xl tracking-tight sm:text-6xl">
            Your camp, one place.
          </h1>
          <p className="max-w-xl text-base text-muted-foreground sm:text-lg">
            Create your theme camp, invite your people, and earn your
            entitlements — all in one place. A camp exists the moment you make
            it; approval comes later.
          </p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild size="lg">
              <Link href="/camps/new">Create your camp</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/directory">Browse the directory</Link>
            </Button>
          </div>
        </section>

        {/* Quilt divider (identity motif) */}
        <QuiltBand opacity={0.55} className="rounded-full" />

        {/* Features */}
        <section className="flex flex-col gap-6">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
            Why Quagga Portal
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            {FEATURES.map(({ icon: Icon, tint, title, body }) => (
              <Card key={title}>
                <CardHeader>
                  <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-muted">
                    <Icon className={`h-5 w-5 ${tint}`} aria-hidden />
                  </span>
                  <CardTitle className="text-base">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>{body}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-6 py-6">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium text-foreground">
              Quagga Portal · AfrikaBurn Contributors
            </p>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              {editionLabel}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            The platform never holds funds — we track, AfrikaBurn collects. A
            volunteer-built tool for a decommodified desert.
          </p>
        </div>
      </footer>
    </div>
  );
}
