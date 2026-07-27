"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { BioPrivacyField } from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import { toast } from "@quagga/ui/components/toast";
import { PrivacyToggles } from "./privacy-toggles";

interface PrivacyFormProps {
  fields: readonly BioPrivacyField[];
  initialFlags: Record<string, boolean>;
  action: (
    flags: Record<string, boolean>,
  ) => Promise<{ ok: boolean; error?: string }>;
}

/** Editable privacy toggles with an explicit Save (build-spec §`/profile`). */
export function PrivacyForm({
  fields,
  initialFlags,
  action,
}: PrivacyFormProps) {
  const router = useRouter();
  const [flags, setFlags] = React.useState(initialFlags);
  const [isPending, startTransition] = React.useTransition();
  const dirty = React.useMemo(
    () => fields.some((f) => !f.locked && flags[f.key] !== initialFlags[f.key]),
    [fields, flags, initialFlags],
  );

  function save() {
    startTransition(async () => {
      const result = await action(flags);
      if (result.ok) {
        toast.success("Privacy settings saved");
        router.refresh();
      } else {
        toast.error(result.error ?? "Couldn't save privacy settings");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <PrivacyToggles
        fields={fields}
        flags={flags}
        onChange={(key, isPublic) =>
          setFlags((prev) => ({ ...prev, [key]: isPublic }))
        }
      />
      <div className="flex justify-end">
        <Button onClick={save} disabled={!dirty || isPending} size="sm">
          {isPending ? "Saving…" : "Save privacy settings"}
        </Button>
      </div>
    </div>
  );
}
