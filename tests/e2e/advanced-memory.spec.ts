import { test, expect, type Page } from "@playwright/test";

/** E2E for the advanced memory views: MESI coherence + virtual memory. */

async function selectArchitecture(page: Page, name: string) {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByText(name, { exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Datapath" })).toBeVisible({ timeout: 20_000 });
}

async function loadFirstExampleAndRun(page: Page) {
    await page.locator('[title="Examples"]').click();
    const modal = page.locator(".modal.show");
    await expect(modal).toBeVisible();
    await modal.locator(".list-group-item").first().click();
    const run = page.getByRole("button", { name: "Run" });
    await expect(run).toBeVisible({ timeout: 20_000 });
    await run.click();
    await page.waitForTimeout(800);
}

test.describe("Advanced memory views", () => {
    test("coherence: MESI trace + false-sharing example", async ({ page }) => {
        await selectArchitecture(page, "RISC-V (RV32IMFD)");
        await page.getByRole("button", { name: "Datapath" }).click();
        await page.getByRole("button", { name: "Coherence", exact: true }).click();

        await expect(page.locator(".coh-stats")).toBeVisible();
        expect(await page.locator(".coh-core").count()).toBeGreaterThan(0);

        await page.getByRole("button", { name: "False sharing" }).click();
        await page.waitForTimeout(150);
        const fs = await page.locator(".coh-stats .stat", { hasText: "False sharing" }).locator(".n").innerText();
        expect(parseInt(fs, 10)).toBeGreaterThan(0);

        await page.locator(".coh-view").screenshot({ path: "tests/e2e/__screenshots__/coherence.png" });
    });

    test("virtual memory: translates the program's accesses", async ({ page }) => {
        await selectArchitecture(page, "MIPS-32");
        await loadFirstExampleAndRun(page);
        await page.getByRole("button", { name: "Datapath" }).click();
        await page.getByRole("button", { name: "Virtual mem", exact: true }).click();

        await expect(page.locator(".vm-stats")).toContainText("TLB hit rate");
        await expect(page.locator(".vm-stats")).toContainText("Page faults");
        await expect(page.locator(".vm-xlate")).toBeVisible();
        await expect(page.locator(".vm-tables")).toBeVisible();

        await page.locator(".vm-view").screenshot({ path: "tests/e2e/__screenshots__/vmemory.png" });
    });
});
