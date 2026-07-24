"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { Badge } from "@quagga/ui/components/badge";
import { Textarea } from "@quagga/ui/components/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@quagga/ui/components/dialog";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@quagga/ui/components/toggle-group";
import { toast } from "@quagga/ui/components/toast";
import { SupplierNoteKind, type SupplierNoteKind as NoteKind } from "@quagga/types";
import {
  addSupplierNote,
  fetchSupplierNotes,
} from "@/lib/actions/suppliers";
import type { SupplierNoteRow } from "@/lib/queries";

const KIND_META: Record<NoteKind, { dot: string; label: string }> = {
  infraction: { dot: "🔴", label: "Infraction" },
  blessing: { dot: "🟢", label: "Blessing" },
  note: { dot: "⚪", label: "Note" },
};

function formatWhen(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Notes trigger + drawer: a count badge that opens the org-internal timeline
 * (infraction 🔴 / blessing 🟢 / note ⚪, with author + date) and an add-note
 * form. Notes are never shown to suppliers or camps.
 */
export function SupplierNotesDrawer({
  supplierId,
  supplierName,
  count,
}: {
  supplierId: string;
  supplierName: string;
  count: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<SupplierNoteRow[]>([]);
  const [kind, setKind] = useState<NoteKind>("note");
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  async function load() {
    setLoading(true);
    const result = await fetchSupplierNotes({ supplierId });
    setLoading(false);
    if (result.ok) {
      setNotes(result.notes);
    } else {
      toast.error("Could not load notes", { description: result.error });
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) void load();
  }

  function submit() {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    startTransition(async () => {
      const result = await addSupplierNote({ supplierId, kind, body: trimmed });
      if (result.ok) {
        toast.success(`${KIND_META[kind].label} recorded.`);
        setBody("");
        setKind("note");
        await load();
        router.refresh();
      } else {
        toast.error("Could not add note", { description: result.error });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <MessageSquare className="h-3.5 w-3.5" aria-hidden />
          Notes
          <Badge variant={count > 0 ? "default" : "outline"} className="ml-0.5">
            {count}
          </Badge>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Notes · {supplierName}</DialogTitle>
          <DialogDescription>
            Org-internal record. Never shown to the supplier or to camps.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[45vh] flex-col gap-2 overflow-y-auto pr-1">
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Loading…
            </p>
          ) : notes.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              No notes yet. Record an infraction, a blessing, or a neutral note
              below.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {notes.map((n) => (
                <li
                  key={n.id}
                  className="rounded-lg border border-border bg-secondary/30 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <span aria-hidden>{KIND_META[n.kind].dot}</span>
                      {KIND_META[n.kind].label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatWhen(n.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm whitespace-pre-wrap text-foreground">
                    {n.body}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {n.authorEmail ?? "Unknown author"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={kind}
            onValueChange={(v) => {
              if (v) setKind(SupplierNoteKind.parse(v));
            }}
            className="justify-start"
          >
            {(["infraction", "blessing", "note"] as const).map((k) => (
              <ToggleGroupItem key={k} value={k} className="gap-1.5">
                <span aria-hidden>{KIND_META[k].dot}</span>
                {KIND_META[k].label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="What happened? Keep it factual — this is a POPIA-relevant org record."
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={pending || body.trim().length === 0}
              onClick={submit}
            >
              {pending ? "Saving…" : "Add note"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
