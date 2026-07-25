// One labelled block on the public burner profile (canvas: ABOUT / YEARS
// ATTENDED / CAMPS / VOLUNTEERING / RANGERS). Purely presentational — callers
// only render a section when the underlying public field survived
// `publicBioView`, so an omitted section IS the privacy outcome.

export function ProfileSection({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5 border-t border-border pt-5">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {icon}
        {label}
      </h2>
      {children}
    </section>
  );
}
