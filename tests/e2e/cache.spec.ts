import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end smoke for the cache / memory-hierarchy view (Datapath → Cache mode).
 * Runs a program with loads/stores and asserts the cache statistics + contents
 * grid render, and that changing the configuration recomputes without re-running.
 */

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

async function openCache(page: Page) {
    await page.getByRole("button", { name: "Datapath" }).click();
    await page.getByRole("button", { name: "Cache", exact: true }).click();
}

test.describe("Cache / memory hierarchy view", () => {
    test("shows hit/miss stats and the cache contents grid", async ({ page }) => {
        await selectArchitecture(page, "MIPS-32");
        await loadFirstExampleAndRun(page);
        await openCache(page);

        await expect(page.locator(".cache-stats")).toContainText("L1 hit rate");
        await expect(page.locator(".cache-stats")).toContainText("AMAT");
        await expect(page.locator(".cache-stats")).toContainText("Conflict");
        await expect(page.locator(".cache-grid")).toBeVisible();
        expect(await page.locator(".cache-grid tbody tr").count()).toBeGreaterThan(0);

        await page.locator(".cache-view").screenshot({ path: "tests/e2e/__screenshots__/mips-cache.png" });
    });

    test("changing the mapping recomputes the cache without re-running", async ({ page }) => {
        await selectArchitecture(page, "MIPS-32");
        await loadFirstExampleAndRun(page);
        await openCache(page);

        const setsBefore = await page.locator(".cache-grid tbody tr").count();
        await page.getByRole("button", { name: /Cache config/ }).click();
        await page.locator(".cache-settings select").first().selectOption("direct");
        await page.waitForTimeout(150);
        // direct-mapped (8 lines) has more sets than 2-way (4 sets) → grid changes, still renders
        await expect(page.locator(".cache-grid")).toBeVisible();
        const setsAfter = await page.locator(".cache-grid tbody tr").count();
        expect(setsAfter).not.toBe(setsBefore);
    });

    test("L1+L2 and split I/D render", async ({ page }) => {
        await selectArchitecture(page, "MIPS-32");
        await loadFirstExampleAndRun(page);
        await openCache(page);

        await page.getByRole("button", { name: /Cache config/ }).click();
        await page.getByText("Split I/D").click(); // toggle split instruction/data
        await page.locator(".cache-settings select").nth(3).selectOption("2"); // Levels → L1 + L2
        await page.waitForTimeout(150);

        await expect(page.locator(".cache-stats")).toContainText("L2 hit rate");
        await expect(page.locator(".cache-split")).toBeVisible(); // I-cache … D-cache summary
        // switch the detailed grid to the instruction cache
        await page.getByRole("button", { name: "Instr" }).click();
        await expect(page.locator(".cache-grid")).toBeVisible();
    });
});
