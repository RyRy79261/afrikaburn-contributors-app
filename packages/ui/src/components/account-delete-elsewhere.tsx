import { ExternalLink } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@quagga/ui/components/card";

// The Delete tab in the apps that do NOT own deletion (org console, supplier
// portal) — roadmap M4-21.
//
// WHY THE TAB EXISTS AT ALL WHEN THE BUTTON DOES NOT. An account suite whose
// Delete tab is simply missing reads as "you cannot delete this account", which
// is false: there is one AfrikaBurn account and it is deletable. The tab is here
// to answer the question honestly and hand over the right door, rather than
// leave a staff member or a supplier hunting for a control that lives one
// hostname away.
//
// WHY THE PARTICIPANT APP OWNS IT. Deletion is not a button; it is a request
// with a grace period, an eligibility assessment that reads across camps,
// registrations, supplier listings and org roles, and a sweeper that erases on a
// schedule. All of that has one implementation and one owner. A second entry
// point would be a second place for the guards to be forgotten — and the guards
// are what stop a deletion stranding a camp without a lead or the deployment
// without a System manager.
//
// WHAT THIS APP LOSES is passed in, because only the app knows: the console
// knows about roles, the portal knows about a claimed listing. Saying nothing
// would let someone delete an account without learning what it was holding.

export function AccountDeleteElsewhere({
  href,
  /** What deleting this one account costs in THIS app. */
  consequences,
  linkLabel = "Delete on the participant app",
}: {
  href: string;
  consequences: React.ReactNode;
  linkLabel?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Delete your account</CardTitle>
        <CardDescription>
          You can delete your account — just not from here.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          There is one AfrikaBurn account behind all three apps, and deleting it
          deletes it everywhere. The request is made on the participant app,
          which is where the checks, the grace period and the erasure all live —
          keeping them in one place is what stops a deletion going through with
          a check missed.
        </p>

        <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm">
          <p className="font-medium">What deleting it means here</p>
          <div className="mt-1 text-muted-foreground">{consequences}</div>
        </div>

        <div>
          <Button variant="outline" size="sm" asChild>
            <a href={href} target="_blank" rel="noreferrer">
              {linkLabel}
              <ExternalLink className="ml-2 h-3.5 w-3.5" aria-hidden />
            </a>
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          You&rsquo;ll be asked to sign in there if you aren&rsquo;t already —
          it&rsquo;s the same account and the same password.
        </p>
      </CardContent>
    </Card>
  );
}
