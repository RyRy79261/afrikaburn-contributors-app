import { consumeRateLimit } from "@quagga/db";
import { createReportHandler } from "@quagga/core/report-server";

import { reportViewer } from "@/lib/report-viewer";

// The supplier portal's filing endpoint. See @quagga/core/report-server for the
// pipeline and apps/suppliers/lib/report-viewer.ts for who is allowed through.

export const runtime = "nodejs";

export const POST = createReportHandler({
  surface: "suppliers",
  identify: reportViewer,
  consumeRateLimit,
});
