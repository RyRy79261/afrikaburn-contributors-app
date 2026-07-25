"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Mail } from "lucide-react";
import {
  PASSWORD_MIN_LENGTH,
  assessPassword,
  enumerationSafeMessage,
} from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { Checkbox } from "@quagga/ui/components/checkbox";
import { Field } from "@quagga/ui/components/field";
import { Input } from "@quagga/ui/components/input";
import { PasswordInput } from "@quagga/ui/components/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quagga/ui/components/select";

import { authClient } from "@/lib/auth-client";
import { registerSupplier } from "@/lib/actions/register";

// Supplier sign-up (canvas `K3zNk` desktop / `h83pUG` mobile), per
// docs/accounts-security-spec.md §"Supplier portal sign-up":
//
//   business name · contact person · email · ONE password field (show toggle,
//   15+, length strength) · service category · "I've read the supplier basics"
//   acknowledgement · email verification note.
//
// Deliberately absent: a confirm-password field (NIST SP 800-63B-4 forbids
// confirm-twice), composition rules, and any marketing/opt-in checkbox litter.
//
// Enumeration safety: an already-registered address and a fresh one produce the
// SAME outcome copy, pulled from @quagga/core's `enumerationSafeMessage` — this
// form never branches on whether the account existed.
//
// Account creation MUST happen on the client: our managed Neon Auth instance
// exposes no server-side sign-up endpoint (see the capability probe in the
// accounts-security spec). The supplier PROFILE is created by the existing
// `registerSupplier` server action, which is also what issues the supplier's
// `SUP-2027-0416` reference code.

/**
 * Service categories offered at sign-up. Values match the vocabulary the sheet
 * importer normalises to (`@quagga/core` `normalizeCategory`), so a
 * self-registered supplier and an imported one land in the same buckets.
 */
const SERVICE_CATEGORIES = [
  "Stretch Tents",
  "Transport",
  "Generators/Power Supply",
  "Firewood Delivery",
  "Sound & Lighting",
  "Water Delivery",
  "Ice Delivery",
  "Other",
] as const;

/** The corpus page the acknowledgement points at (Quaggapedia Supplier Depot). */
const SUPPLIER_BASICS_URL =
  "https://quaggapedia.afrikaburn.com/index.php?title=SUPPLIER%20DEPOT";

const GENERIC_PROBLEM = "Something went wrong. Please try again in a moment.";

export function SupplierSignUpForm() {
  const router = useRouter();

  const [businessName, setBusinessName] = React.useState("");
  const [contactPerson, setContactPerson] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [acknowledged, setAcknowledged] = React.useState(false);

  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const assessment = assessPassword(password);
  const canSubmit =
    businessName.trim().length > 0 &&
    contactPerson.trim().length > 0 &&
    email.trim().length > 0 &&
    category.length > 0 &&
    acknowledged &&
    !pending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!assessment.ok) {
      setError(assessment.error ?? `Use at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (!acknowledged) {
      setError("Please confirm you've read the supplier basics.");
      return;
    }

    setPending(true);
    try {
      const { error: signUpError } = await authClient.signUp.email({
        email: email.trim(),
        password,
        // The account's display name is the business — that is who signs in.
        name: businessName.trim(),
      });

      if (signUpError) {
        const message = (signUpError.message ?? "").toLowerCase();
        // Real, actionable password problems are surfaced; everything else —
        // including "user already exists" — stays enumeration-safe.
        if (message.includes("password")) {
          setError(
            `That password can't be used. Use at least ${PASSWORD_MIN_LENGTH} characters.`,
          );
        } else {
          setNotice(enumerationSafeMessage("sign_up"));
        }
        return;
      }

      // Create the supplier profile. This is the action that seeds onboarding
      // step 1 and issues the SUP-YYYY-NNNN code. If the provider is holding the
      // session back pending email verification it refuses — which is not an
      // error, so we say so plainly rather than inventing a half-made account.
      const registered = await registerSupplier({
        name: businessName.trim(),
        // Free-text "person · email" line — the same shape the sheet import
        // produces, and what email-overlap account linking matches against.
        contact: `${contactPerson.trim()} · ${email.trim()}`,
        category,
      });

      if (!registered.ok) {
        setNotice(
          "Account created. Confirm your email from the link we've sent, then sign in — we'll finish setting up your supplier profile.",
        );
        return;
      }

      router.push("/onboarding");
      router.refresh();
    } catch {
      setError(GENERIC_PROBLEM);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Create your supplier account
        </h1>
        <p className="text-sm text-muted-foreground">
          Register once, then work through onboarding to get depot-ready.
        </p>
      </div>

      <Field label="Business name" htmlFor="signup-business" required>
        <Input
          id="signup-business"
          name="business"
          autoComplete="organization"
          placeholder="e.g. Karoo Stretch Tents"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          disabled={pending}
          required
        />
      </Field>

      <Field label="Contact person" htmlFor="signup-contact" required>
        <Input
          id="signup-contact"
          name="contact"
          autoComplete="name"
          placeholder="Who we speak to about deliveries"
          value={contactPerson}
          onChange={(e) => setContactPerson(e.target.value)}
          disabled={pending}
          required
        />
      </Field>

      <Field label="Email" htmlFor="signup-email" required>
        <Input
          id="signup-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="bookings@yourbusiness.co.za"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
          required
        />
      </Field>

      <Field
        label="Password"
        htmlFor="signup-password"
        required
        help={`At least ${PASSWORD_MIN_LENGTH} characters — passphrases welcome, and you can paste from a password manager.`}
      >
        <PasswordInput
          id="signup-password"
          name="password"
          autoComplete="new-password"
          placeholder="A sentence you'll remember"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={PASSWORD_MIN_LENGTH}
          disabled={pending}
          required
        />
      </Field>

      <Field
        label="Service category"
        htmlFor="signup-category"
        required
        help="What you supply. AfrikaBurn uses this to route your onboarding and depot slot."
      >
        <Select
          value={category || undefined}
          onValueChange={setCategory}
          disabled={pending}
        >
          <SelectTrigger id="signup-category" aria-label="Service category">
            <SelectValue placeholder="Choose a category" />
          </SelectTrigger>
          <SelectContent>
            {SERVICE_CATEGORIES.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {/* The acknowledgement. The "supplier basics" link sits OUTSIDE the
          label: a link nested inside a <label> both toggles the checkbox and
          navigates, which is a genuine a11y trap. */}
      <div className="rounded-md border border-input bg-background p-3">
        <div className="flex items-start gap-3">
          <Checkbox
            id="signup-ack"
            name="acknowledge"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.currentTarget.checked)}
            disabled={pending}
            className="mt-0.5"
            required
          />
          <label
            htmlFor="signup-ack"
            className="cursor-pointer text-sm leading-snug"
          >
            I&apos;ve read the supplier basics — depot-only operations,
            deliveries by prior approval, and no Plug &amp; Play.
          </label>
        </div>
        <Link
          href={SUPPLIER_BASICS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-7 mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Read the supplier basics
          <ExternalLink className="h-3 w-3" aria-hidden />
        </Link>
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm font-medium text-primary">
          {notice}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={!canSubmit}>
        {pending ? "Creating account…" : "Create account"}
      </Button>

      <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Mail className="h-3.5 w-3.5" aria-hidden />
        We&apos;ll email you a verification link.
      </p>

      <p className="text-center text-sm text-muted-foreground">
        Already registered?{" "}
        <Link
          href="/signin"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
