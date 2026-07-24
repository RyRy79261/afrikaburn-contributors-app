"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackagePlus } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { Input } from "@quagga/ui/components/input";
import { Textarea } from "@quagga/ui/components/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import { toast } from "@quagga/ui/components/toast";
import { registerSupplier } from "@/lib/actions/register";

/**
 * Self-registration for a signed-in user with no matching supplier row. Creates
 * their supplier profile linked to their account and starts the onboarding
 * checklist (registration form step done). Only registered creative projects
 * may use suppliers — this is the supplier's side of that.
 */
export function RegisterSupplierForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: "",
    services: "",
    contact: "",
    website: "",
  });

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function submit() {
    startTransition(async () => {
      const result = await registerSupplier({
        name: form.name,
        services: form.services || undefined,
        contact: form.contact || undefined,
        website: form.website || undefined,
      });
      if (result.ok) {
        toast.success("You're registered — let's finish onboarding.");
        router.push("/onboarding");
        router.refresh();
      } else {
        toast.error("Could not register", { description: result.error });
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Register as a supplier</CardTitle>
        <CardDescription>
          We couldn&apos;t match your account to an existing supplier. Tell us
          about your business to start onboarding. Registering as a supplier
          isn&apos;t needed if you&apos;re transporting all your own materials —
          it&apos;s only for businesses servicing registered creative projects.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field label="Business name" required>
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Karoo Stretch Tents"
          />
        </Field>
        <Field label="Services you provide">
          <Textarea
            value={form.services}
            onChange={(e) => set("services", e.target.value)}
            rows={2}
            placeholder="e.g. Stretch tents, shade structures, rigging"
          />
        </Field>
        <Field label="Contact">
          <Input
            value={form.contact}
            onChange={(e) => set("contact", e.target.value)}
            placeholder="e.g. bookings@karootents.co.za · 021 555 0100"
          />
        </Field>
        <Field label="Website">
          <Input
            value={form.website}
            onChange={(e) => set("website", e.target.value)}
            placeholder="e.g. https://karootents.co.za"
          />
        </Field>
        <div className="flex justify-end pt-1">
          <Button
            disabled={pending || form.name.trim().length === 0}
            onClick={submit}
          >
            <PackagePlus aria-hidden />
            {pending ? "Registering…" : "Register & start onboarding"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </span>
      {children}
    </label>
  );
}
