import { Lock } from "lucide-react";

// The closing note on a public burner profile. It states the two rules that
// govern this page: hard-locked fields (phone, emergency contacts, ID, medical)
// are never shown to anyone — they are not even loaded into the view model —
// and everything else appears only because the owner flagged it public.

export function PrivacyNote() {
  return (
    <p className="flex items-start justify-center gap-2 border-t border-border pt-5 text-center text-xs text-muted-foreground">
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        Some details are private. Phone numbers, emergency contacts, ID
        documents and medical notes are never shown to anyone, and each burner
        chooses what else appears here.
      </span>
    </p>
  );
}
