import { consumeRateLimit } from "@quagga/db";
import { createTranscribeHandler } from "@quagga/core/report-server";

import { reportViewer } from "@/lib/report-viewer";

// Dictation for the console's reporter. Nothing is stored server-side; the
// transcript goes back to the browser for the reporter to edit.

export const runtime = "nodejs";

export const POST = createTranscribeHandler({
  identify: reportViewer,
  consumeRateLimit,
});
