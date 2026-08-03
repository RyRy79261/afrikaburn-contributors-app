import { consumeRateLimit } from "@quagga/db";
import { createTranscribeHandler } from "@quagga/core/report-server";

import { getCurrentCampUser } from "@/lib/session";

// Dictation for the reporter: audio in, transcript back to the browser. Nothing
// is stored and nothing is filed here — the transcript lands in the form for
// the reporter to edit, and only submitting it starts the redaction pass.

export const runtime = "nodejs";

export const POST = createTranscribeHandler({
  identify: async () => {
    const user = await getCurrentCampUser();
    return user ? { id: user.id } : null;
  },
  consumeRateLimit,
});
