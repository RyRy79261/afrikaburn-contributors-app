import Link from "next/link";
import { redirect } from "next/navigation";
import { PackageOpen, Truck, ShieldCheck, MapPin } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { QuiltBand } from "@quagga/ui/components/quilt-band";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { isAuthConfigured } from "@/lib/config";
import { resolveSupplierSession } from "@/lib/session";
import { NotConfiguredBanner } from "@/components/not-configured-banner";
import { RegisterSupplierForm } from "@/components/register-supplier-form";
import { SignOutButton } from "@/components/sign-out-button";

// Reads the session cookie on every request; cannot be statically prerendered.
export const dynamic = "force-dynamic";

// Plain-language intro straight from the Supplier Depot rules
// (docs/sources/quaggapedia/supplier-depot.md).
const RULES = [
  {
    icon: MapPin,
    title: "Depot-only operations",
    body: "Every supplier operates from the Supplier Depot — never directly in camps. Each creative project gets a unique Supplier Code, which may not be shared.",
  },
  {
    icon: Truck,
    title: "Deliveries by the rules",
    body: "Deliveries need prior approval and a pre-submitted inventory, and a participant must accompany you during setup or drop-off. Deliveries run until the Sunday before gate; late or unregistered ones are turned away.",
  },
  {
    icon: ShieldCheck,
    title: "No Plug & Play",
    body: "Servicing Plug-and-Play camps (private hotels) is not allowed — it carries hefty penalties, including loss of your deposit and future access. Every person builds, cleans, and breaks down their own camp.",
  },
] as const;

export default async function LandingPage() {
  const state = await resolveSupplierSession();
  const authReady = isAuthConfigured();

  // A resolved supplier goes straight to the checklist.
  if (state.kind === "ok") redirect("/onboarding");

  const signedIn = state.kind !== "unauthenticated";

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-4xl flex-col gap-10 px-6 py-12">
      <NotConfiguredBanner />

      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <PackageOpen className="h-5 w-5" aria-hidden />
          </span>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">
            AfrikaBurn · Supplier Portal
          </p>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Supplier Portal
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          At AfrikaBurn, relying on suppliers is deliberately limited — it sits
          against Radical Self-Reliance. Some large creative projects still need
          controlled supplier help, and the Supplier Programme exists to make
          that work in line with the 11 Guiding Principles. This portal is where
          registered suppliers complete onboarding and track their standing.
        </p>

        {state.kind === "unlinked" ? (
          <div className="mt-1 flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              Signed in as{" "}
              <span className="text-foreground">
                {state.user.primaryEmail ?? "your account"}
              </span>
            </span>
            <SignOutButton variant="outline" />
          </div>
        ) : (
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" disabled={!authReady}>
              <Link href={authReady ? "/auth/sign-in" : "/"}>
                {authReady ? "Sign in to your portal" : "Sign-in coming soon"}
              </Link>
            </Button>
            {signedIn && <SignOutButton variant="outline" size="default" />}
          </div>
        )}
      </header>

      <QuiltBand opacity={0.55} className="rounded-full" />

      {state.kind === "unlinked" ? (
        <RegisterSupplierForm />
      ) : (
        <section className="grid gap-4 sm:grid-cols-3">
          {RULES.map(({ icon: Icon, title, body }) => (
            <Card key={title}>
              <CardHeader>
                <Icon className="h-5 w-5 text-primary" aria-hidden />
                <CardTitle className="text-base">{title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>{body}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      <footer className="mt-auto border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          Questions? The Supplier Team is at suppliers@afrikaburn.com. AfrikaBurn
          never processes or holds payments through this portal — deposits and
          fees are tracked here and settled with the Supplier Team directly.
        </p>
      </footer>
    </main>
  );
}
