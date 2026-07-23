import Link from "next/link";
import { Tent, Flame, ShieldCheck } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { getAuthenticatedUser } from "@/lib/auth";
import { isAuthConfigured } from "@/lib/config";
import { NotConfiguredBanner } from "@/components/not-configured-banner";

// Reads the session cookie on every request; cannot be statically prerendered.
export const dynamic = "force-dynamic";

const FEATURES = [
  {
    icon: Tent,
    title: "Create a camp on the spot",
    body: "Start a theme camp, artwork, or mutant vehicle in seconds. It works immediately as a free camp — invite members, organise, no gatekeeping.",
  },
  {
    icon: Flame,
    title: "Register to earn entitlements",
    body: "Complete the six-section registration once. Approval unlocks placement, art grants, and the logistics workflows — the enemy is unfilled forms.",
  },
  {
    icon: ShieldCheck,
    title: "Your details, your call",
    body: "A privacy-flagged Burner Bio you carry year to year. ID, phone, medical, and emergency contacts stay locked private — always.",
  },
] as const;

export default async function HomePage() {
  const user = await getAuthenticatedUser();
  const authReady = isAuthConfigured();

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-10 px-6 py-12 sm:py-20">
      <NotConfiguredBanner />

      <header className="flex flex-col gap-4">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
          AfrikaBurn Contributors
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Organise anything.{" "}
          <span className="text-primary">Register what matters.</span>
        </h1>
        <p className="max-w-xl text-base text-muted-foreground">
          The home for theme camps, artworks, and mutant vehicles heading to the
          Tankwa. Anyone can organise; registration earns entitlements — and
          every screen asks for less than the thing it replaces.
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          {user ? (
            <Button asChild size="lg">
              <Link href="/directory">Go to your dashboard</Link>
            </Button>
          ) : (
            <Button asChild size="lg" disabled={!authReady}>
              <Link href={authReady ? "/auth/sign-in" : "/"}>
                {authReady ? "Sign in to get started" : "Sign-in coming soon"}
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" size="lg">
            <Link href="/directory">Browse the directory</Link>
          </Button>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <Card key={title}>
            <CardHeader>
              <Icon className="h-5 w-5 text-accent" aria-hidden />
              <CardTitle className="text-base">{title}</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>{body}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </section>

      <footer className="mt-auto border-t border-border pt-6 text-sm text-muted-foreground">
        The platform never holds funds — where money applies, we track a
        reference and AfrikaBurn collects.
      </footer>
    </main>
  );
}
