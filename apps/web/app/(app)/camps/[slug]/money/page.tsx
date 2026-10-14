import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, Lock } from "lucide-react";
import { Button } from "@quagga/ui/components/button";
import { getAuthenticatedUser } from "@/lib/auth";
import { enforceGate, getCurrentCampUser } from "@/lib/session";
import { isDatabaseConfigured } from "@/lib/config";
import { getActiveEdition } from "@/lib/edition";
import {
  loadClaimsBoard,
  loadDuesBoard,
  loadMemberMoney,
  loadMoneyAccess,
  loadMoneyBooksPage,
  type MoneyEdition,
} from "@/lib/camp-money-store";
import { parseClaimFilter, parseMoneyTab } from "@/lib/money-view";
import { PreviewNotice } from "@/components/preview-notice";
import { MoneyNav } from "@/components/money/money-nav";
import { BudgetTab } from "@/components/money/budget-tab";
import { DuesTab } from "@/components/money/dues-tab";
import { ClaimsTab } from "@/components/money/claims-tab";
import { MemberMoney } from "@/components/money/member-view";
import { MoneyFootnote } from "@/components/money/money-ui";

export const dynamic = "force-dynamic";

// The camp's money page (docs/camp-budget-spec.md; frames M1 Budget F8Mr8Y /
// l5yuE8, M2 Dues F2Chu3 / DooLI, M3 Claims eT62X / jgNEH, M4 Member view
// tEtgq / YaU0P).
//
// THE BOUNDARY IS THE SERVER. `loadMoneyAccess` resolves the viewer's CURRENT
// membership of this camp and asks @quagga/core; null (no such camp, not a
// theme camp, not a member, a former member) is the camp's ordinary 404 — the
// same answer as a slug that does not exist. Money people (@quagga/core
// `canManageMoney`: lead/admin, or a `manage_money` grant) get the tabs; every
// other current member gets the members' view, whose loader reads only the
// totals and the viewer's OWN rows. `?tab=` from a member is ignored.
//
// RECORDS, NEVER TRANSACTIONS. There is no pay button, card field or payment
// link anywhere on this page, by law (AGENTS.md money law, Decision 009).

const ParamsSchema = z.object({ slug: z.string().min(1).max(200) });

export default async function CampMoneyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const query = await searchParams;

  if (!isDatabaseConfigured()) return <PreviewNotice feature="Camp money" />;

  const authUser = await getAuthenticatedUser();
  if (!authUser) redirect("/auth/sign-in");

  const [viewer, activeEdition] = await Promise.all([
    getCurrentCampUser(),
    getActiveEdition(),
  ]);
  if (!viewer) redirect("/auth/sign-in");
  if (!activeEdition) return <PreviewNotice feature="Camp money" />;

  await enforceGate(viewer.id);

  const access = await loadMoneyAccess(parsed.data.slug, viewer.id);
  if (!access) notFound();
  const { camp } = access;
  const edition: MoneyEdition = {
    id: activeEdition.id,
    year: activeEdition.year,
  };

  const header = (lede: string) => (
    <div>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href={`/camps/${camp.slug}`}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {camp.name}
        </Link>
      </Button>
      <h1 className="text-2xl font-semibold tracking-tight">Money</h1>
      <p className="mt-1 text-sm text-muted-foreground">{lede}</p>
    </div>
  );

  if (!access.isMoneyPerson) {
    const view = await loadMemberMoney(access, edition);
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        {header(
          "The camp's books are open: every member sees the totals. Your dues and claims are yours, seen only by you and the camp's money people.",
        )}
        <MemberMoney
          slug={camp.slug}
          editionName={activeEdition.name}
          view={view}
        />
      </div>
    );
  }

  const tab = parseMoneyTab(query.tab);
  // The claims list feeds the tab's badge on every tab; the rest is per tab.
  const claims = (await loadClaimsBoard(access, edition)) ?? [];
  const claimsWaiting = claims.filter((c) => c.status === "submitted").length;

  let body: ReactNode;
  if (tab === "dues") {
    const board = await loadDuesBoard(access, edition);
    if (!board) notFound();
    body = <DuesTab slug={camp.slug} year={edition.year} board={board} />;
  } else if (tab === "claims") {
    // The members' loader carries the live spending categories and whether
    // receipts are configured; its own-rows payload is the viewer's own.
    const own = await loadMemberMoney(access, edition);
    body = (
      <ClaimsTab
        slug={camp.slug}
        claims={claims}
        filter={parseClaimFilter(query.status)}
        categories={own.claimCategories}
        receiptsEnabled={own.receiptsEnabled}
      />
    );
  } else {
    const [page, board] = await Promise.all([
      loadMoneyBooksPage(access, edition),
      loadDuesBoard(access, edition),
    ]);
    if (!page || !board) notFound();
    body = (
      <BudgetTab
        slug={camp.slug}
        year={edition.year}
        page={page}
        dues={{
          outstandingCents: board.summary.outstandingCents,
          membersOwing: board.summary.membersOwing,
        }}
        showAllEntries={query.entries === "all"}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      {header(
        `The camp's budget, dues and claims for ${activeEdition.name}. The app keeps the records: money itself moves by EFT between people and the camp's own bank account.`,
      )}
      <MoneyNav slug={camp.slug} active={tab} claimsWaiting={claimsWaiting} />
      {body}
      {tab === "budget" && (
        <MoneyFootnote icon={<Lock />}>
          Only the camp&apos;s money people see this page: the leads, and
          members holding the &ldquo;Manage money&rdquo; privilege. Every change
          is recorded with who made it and when.
        </MoneyFootnote>
      )}
    </div>
  );
}
