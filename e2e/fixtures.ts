// e2e/fixtures.ts — the extended Playwright `test` every spec imports.
//
// Because cross-subdomain SSO does not span the different HOSTS of a preview
// (app-… / org-… / suppliers-… are separate origins on *.vercel.app), each app
// gets its OWN browser context + page, created against that app's baseURL and
// carrying the Vercel protection-bypass header. Specs that only touch one app
// use just that app's page; cross-app journeys (org reviewing a burner's camp)
// use two. No shared mutable state — every spec creates its own accounts/data.

import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  APP_URLS,
  godCredentials,
  isMailCaptureAvailable,
  protectionBypassHeaders,
  type AppName,
} from "./lib/env";

interface Fixtures {
  /** Create an isolated page against any app; auto-closed at test end. */
  makeAppPage: (app: AppName) => Promise<Page>;
  /** Convenience pages, created lazily only if the spec asks for them. */
  webPage: Page;
  orgPage: Page;
  suppliersPage: Page;
}

export const test = base.extend<Fixtures>({
  makeAppPage: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    // Inherit the running project's device profile (desktop vs 360px mobile) so a
    // manually-created context reflows exactly like the default page fixture.
    const projectUse = test.info().project.use;
    const factory = async (app: AppName): Promise<Page> => {
      const context = await browser.newContext({
        baseURL: APP_URLS[app],
        extraHTTPHeaders: protectionBypassHeaders(),
        viewport: projectUse.viewport ?? undefined,
        userAgent: projectUse.userAgent,
        deviceScaleFactor: projectUse.deviceScaleFactor,
        isMobile: projectUse.isMobile,
        hasTouch: projectUse.hasTouch,
      });
      contexts.push(context);
      return context.newPage();
    };
    await use(factory);
    for (const context of contexts) await context.close();
  },

  webPage: async ({ makeAppPage }, use) => {
    await use(await makeAppPage("web"));
  },
  orgPage: async ({ makeAppPage }, use) => {
    await use(await makeAppPage("org"));
  },
  suppliersPage: async ({ makeAppPage }, use) => {
    await use(await makeAppPage("suppliers"));
  },
});

export { expect };

/**
 * Skip the current test unless the deployment sends+captures email. Use for any
 * flow that must READ a verification/reset link.
 */
export function skipUnlessMail(): void {
  test.skip(
    !isMailCaptureAvailable(),
    "mail capture unavailable (E2E_MAIL_MODE=off)",
  );
}

/** Skip the current test unless god credentials are configured. */
export function skipUnlessGod(): void {
  test.skip(
    !godCredentials(),
    "no god credentials (E2E_GOD_EMAIL/E2E_GOD_PASSWORD)",
  );
}
