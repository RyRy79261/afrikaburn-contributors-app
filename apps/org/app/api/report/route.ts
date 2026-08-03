import { consumeRateLimit } from "@quagga/db";
import { createReportHandler } from "@quagga/core/report-server";

import { reportViewer } from "@/lib/report-viewer";

// The organiser console's filing endpoint. See @quagga/core/report-server for
// the pipeline and apps/org/lib/report-viewer.ts for who is allowed through.

export const runtime = "nodejs";

export const POST = createReportHandler({
  surface: "org",
  identify: reportViewer,
  consumeRateLimit,
});
