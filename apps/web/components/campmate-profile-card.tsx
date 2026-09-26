"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Camera, Trash2, Users } from "lucide-react";
import {
  AVATAR_CONTENT_TYPES,
  type CampmateSettings,
  type FieldVisibility,
} from "@quagga/core";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@quagga/ui/components/toggle-group";
import { toast } from "@quagga/ui/components/toast";
import { AvatarImage } from "./avatar-image";
import { CampmateSettingsFields } from "./campmate-settings-fields";

type SaveAction = (patch: {
  contactable?: CampmateSettings["contactable"];
  listedInCampPeople?: boolean;
  avatarVisibility?: FieldVisibility;
}) => Promise<{ ok: boolean; error?: string }>;

const PHOTO_LEVELS: { value: FieldVisibility; label: string }[] = [
  { value: "private", label: "Only me" },
  { value: "camp_mates", label: "Camp mates" },
  { value: "public", label: "Public" },
];

/**
 * Epic #68 — the member's photo and camp-mate settings on /profile. Every
 * control writes through a server route/action that re-validates and re-checks;
 * this component decides nothing about who sees what.
 *
 * NEEDS DESIGN REVIEW: built from existing components without a canvas frame.
 */
export function CampmateProfileCard({
  userId,
  name,
  hasPhoto,
  photoVisibility,
  settings,
  uploadsConfigured,
  save,
}: {
  userId: string;
  name: string | null;
  hasPhoto: boolean;
  photoVisibility: FieldVisibility;
  settings: CampmateSettings;
  uploadsConfigured: boolean;
  save: SaveAction;
}) {
  const router = useRouter();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [version, setVersion] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [level, setLevel] = React.useState<FieldVisibility>(photoVisibility);
  const [campmate, setCampmate] = React.useState<CampmateSettings>(settings);

  async function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      if (!result.ok) {
        setError(result.error ?? "That didn't save. Please try again.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("That didn't save. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    const body = new FormData();
    body.append("file", file);
    const ok = await run(async () => {
      const res = await fetch("/api/avatar", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return res.ok ? { ok: true } : { ok: false, error: json.error };
    });
    if (ok) {
      setVersion((v) => v + 1);
      toast.success("Photo updated.");
    }
  }

  async function remove() {
    const ok = await run(async () => {
      const res = await fetch("/api/avatar", { method: "DELETE" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return res.ok ? { ok: true } : { ok: false, error: json.error };
    });
    if (ok) toast.success("Photo removed.");
  }

  function changeLevel(next: FieldVisibility) {
    const prev = level;
    setLevel(next);
    void run(() => save({ avatarVisibility: next })).then((ok) => {
      if (!ok) setLevel(prev);
    });
  }

  function changeSettings(next: CampmateSettings) {
    const prev = campmate;
    setCampmate(next);
    void run(() =>
      save({
        contactable: next.contactable,
        listedInCampPeople: next.listedInCampPeople,
      }),
    ).then((ok) => {
      if (!ok) setCampmate(prev);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-accent" aria-hidden />
          Photo &amp; camp mates
        </CardTitle>
        <CardDescription>
          All of this starts private. Camp mates are the people in your theme
          camp.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <AvatarImage
            userId={userId}
            name={name}
            showPhoto={hasPhoto}
            version={version}
            className="h-16 w-16 text-lg"
          />
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={AVATAR_CONTENT_TYPES.join(",")}
              className="sr-only"
              aria-label="Choose a profile photo"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void upload(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 sm:min-h-9"
              disabled={busy || !uploadsConfigured}
              onClick={() => fileRef.current?.click()}
            >
              <Camera className="h-4 w-4" aria-hidden />
              {hasPhoto ? "Change photo" : "Add a photo"}
            </Button>
            {hasPhoto && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11 sm:min-h-9"
                disabled={busy}
                onClick={() => void remove()}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Remove photo
              </Button>
            )}
          </div>
        </div>
        {!uploadsConfigured && (
          <p className="text-xs text-muted-foreground">
            Photo uploads aren&apos;t configured on this deployment.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          PNG, JPEG or WebP, up to 2 MB. Removing it deletes the file.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <p id="photo-visibility-label" className="text-sm font-medium">
            Who can see your photo
          </p>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={level}
            disabled={busy}
            onValueChange={(v) => {
              const next = PHOTO_LEVELS.find((o) => o.value === v);
              if (next) changeLevel(next.value);
            }}
            aria-labelledby="photo-visibility-label"
          >
            {PHOTO_LEVELS.map((o) => (
              <ToggleGroupItem
                key={o.value}
                value={o.value}
                aria-label={`Who can see your photo: ${o.label}`}
                className="text-xs"
              >
                {o.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <CampmateSettingsFields
          value={campmate}
          onChange={changeSettings}
          disabled={busy}
        />

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
