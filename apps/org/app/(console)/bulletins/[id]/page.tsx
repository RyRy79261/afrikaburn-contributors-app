import { redirect } from "next/navigation";

// A bulletin's deep link (`/bulletins/<id>` — the link every fan-out
// notification carries) is a READER surface in the participant app. Inside the
// console the same id means "work on this bulletin", so staff who follow their
// own inbox link land on the compose/edit view instead of a dead route.

export default async function ConsoleBulletinPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/bulletins/${id}/edit`);
}
