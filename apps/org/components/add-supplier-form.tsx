"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { Input } from "@quagga/ui/components/input";
import { Textarea } from "@quagga/ui/components/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@quagga/ui/components/dialog";
import { toast } from "@quagga/ui/components/toast";
import { addSupplier } from "@/lib/actions/suppliers";

/** Manual supplier add — a dialog form. New suppliers start in good standing. */
export function AddSupplierForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
      const result = await addSupplier({
        name: form.name,
        services: form.services || undefined,
        contact: form.contact || undefined,
        website: form.website || undefined,
      });
      if (result.ok) {
        toast.success("Supplier added.");
        setForm({ name: "", services: "", contact: "", website: "" });
        setOpen(false);
        router.refresh();
      } else {
        toast.error("Could not add supplier", { description: result.error });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          Add supplier
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a supplier</DialogTitle>
          <DialogDescription>
            Hand-add a supplier that isn&apos;t in the imported list. It starts
            in good standing; set standing and onboarding from the table.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field label="Name" required>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Karoo Stretch Tents"
            />
          </Field>
          <Field label="Services">
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
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || form.name.trim().length === 0}
            onClick={submit}
          >
            {pending ? "Adding…" : "Add supplier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
