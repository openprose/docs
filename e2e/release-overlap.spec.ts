import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

type Mode = "a" | "b" | "a-page-b-assets" | "b-page-a-assets";

async function routeTo(request: APIRequestContext, mode: Mode) {
  const response = await request.post("/__release-check/control", { data: { mode } });
  expect(response.status()).toBe(200);
}

function watch(page: Page) {
  const assetErrors: string[] = [];
  const pageErrors: string[] = [];
  let navigations = 0;
  page.on("response", (response) => {
    if (response.url().includes("/_next/static/") && response.status() >= 400) {
      assetErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("/_next/static/")) assetErrors.push(`${request.failure()?.errorText} ${new URL(request.url()).pathname}`);
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations++; });
  return { assetErrors, pageErrors, navigations: () => navigations };
}

test.afterEach(async ({ request }, info) => {
  const report = await request.get("/__release-check/report");
  await info.attach("release-evidence", { body: await report.body(), contentType: "application/json" });
});

for (const release of ["a", "b"] as const) {
  test(`release ${release.toUpperCase()} hydrates and serves its deployment identity`, async ({ page, request }) => {
    await routeTo(request, release);
    const observed = watch(page);
    await page.goto("/setup");
    const scripts = await page.locator('script[src*="/_next/static/"]').evaluateAll((nodes) => nodes.map((node) => (node as HTMLScriptElement).src));
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.every((url) => new URL(url).searchParams.get("dpl") === `release-${release}`)).toBe(true);
    const button = page.getByTestId("release-check");
    await expect(button).toHaveText(`Release ${release.toUpperCase()}: 0`);
    await button.click();
    await expect(button).toHaveText(`Release ${release.toUpperCase()}: 1`);
    await expect(page.getByText(`Release fixture ${release.toUpperCase()}.`, { exact: true })).toBeVisible();
    expect(observed.assetErrors).toEqual([]);
    expect(observed.pageErrors).toEqual([]);
  });
}

for (const [mode, label] of [["a-page-b-assets", "rollout"], ["b-page-a-assets", "rollback"]] as const) {
  test(`${label}: a new reader hydrates when required assets reach the other image`, async ({ page, request }) => {
    await routeTo(request, mode);
    const observed = watch(page);
    await page.goto("/setup");
    expect.soft(observed.assetErrors, "Every required asset must remain available across images").toEqual([]);
    const button = page.getByTestId("release-check");
    await button.click();
    await expect(button, "Server-rendered HTML alone is not a hydrated page").toHaveText(/Release [AB]: 1/);
    expect(observed.pageErrors).toEqual([]);
    expect(observed.navigations()).toBeLessThanOrEqual(3);
  });
}

for (const [from, to, label] of [["a", "b", "replacement"], ["b", "a", "rollback"]] as const) {
  test(`an open ${from.toUpperCase()} tab can navigate and search after ${label}`, async ({ page, request }) => {
    await routeTo(request, from);
    const observed = watch(page);
    await page.goto("/setup");
    await page.getByTestId("release-check").click();
    await expect(page.getByTestId("release-check")).toHaveText(`Release ${from.toUpperCase()}: 1`);
    // Every following request reaches the replacement; the previous image
    // remains available only through the harness's private control endpoint.
    await routeTo(request, to);
    await page.locator('a[href="/contracts"]').first().click();
    await expect(page).toHaveURL(/\/contracts(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "Contracts", exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: /search/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const searchResponse = page.waitForResponse((response) => response.url().includes("/api/search?") && response.url().includes("setup"));
    await dialog.locator("input").fill("setup");
    const response = await searchResponse;
    expect(response.status()).toBe(200);
    const results = await response.json();
    expect(results.some((result: { url?: string }) => result.url?.startsWith("/setup"))).toBe(true);
    await expect(dialog.getByText("Setup", { exact: true }).first()).toBeVisible();
    expect(observed.assetErrors).toEqual([]);
    expect(observed.pageErrors).toEqual([]);
    expect(observed.navigations(), "At most one hard recovery navigation is expected").toBeLessThanOrEqual(3);
  });
}
