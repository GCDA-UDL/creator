import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end smoke for the pipeline cycle timeline (Datapath → Cycles mode).
 * Loads an example, runs it, opens the Cycles view and asserts the
 * instruction×cycle grid + statistics render. Verifies that toggling forwarding
 * recomputes the schedule WITHOUT re-running the program.
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

async function openCycles(page: Page) {
    await page.getByRole("button", { name: "Datapath" }).click();
    await page.getByRole("button", { name: "Cycles", exact: true }).click();
    await expect(page.locator(".cyc-grid")).toBeVisible();
}

async function cyclesCount(page: Page): Promise<number> {
    const txt = await page.locator(".cyc-stats .stat").first().locator(".n").innerText();
    return parseInt(txt.replace(/\D/g, ""), 10);
}

test.describe("Cycle timeline (pipeline)", () => {
    test("MIPS-32 renders the instruction×cycle grid + stats", async ({ page }) => {
        await selectArchitecture(page, "MIPS-32");
        await loadFirstExampleAndRun(page);
        await openCycles(page);

        // Grid has stage cells, including an IF stage.
        expect(await page.locator(".cyc-grid .stg").count()).toBeGreaterThan(0);
        await expect(page.locator(".cyc-grid .c-if").first()).toBeVisible();
        // Statistics present.
        await expect(page.locator(".cyc-stats")).toContainText("Cycles");
        await expect(page.locator(".cyc-stats")).toContainText("CPI");
        expect(await cyclesCount(page)).toBeGreaterThan(0);

        await page.locator(".cyc-view").screenshot({ path: "tests/e2e/__screenshots__/mips-cycles.png" });
    });

    test("toggling forwarding recomputes without re-running", async ({ page }) => {
        await selectArchitecture(page, "MIPS-32");
        await loadFirstExampleAndRun(page);
        await openCycles(page);

        const withFwd = await cyclesCount(page);
        // Open config and disable forwarding (no program re-run).
        await page.getByRole("button", { name: /Pipeline config/ }).click();
        await page.locator('.cyc-settings input[type="checkbox"]').first().uncheck();
        await page.waitForTimeout(200);
        const noFwd = await cyclesCount(page);

        // Without forwarding the schedule has more cycles (RAW stalls appear).
        expect(noFwd).toBeGreaterThan(withFwd);

        // Hovering a stall shows the explanation (which register, and when ready).
        const stall = page.locator(".cyc-grid .c-stall").first();
        await stall.hover();
        await expect(page.locator(".cyc-tip")).toContainText(/waiting for|divider/);
    });

    test("cycle-by-cycle cursor reveals the pipeline progressively", async ({ page }) => {
        await selectArchitecture(page, "MIPS-32");
        await loadFirstExampleAndRun(page);
        await openCycles(page);

        const allCells = await page.locator(".cyc-grid .stg").count();
        // step the cursor back several cycles → fewer cells revealed
        const prev = page.getByRole("button", { name: "◀" });
        for (let i = 0; i < 5; i++) await prev.click();
        const fewer = await page.locator(".cyc-grid .stg").count();
        expect(fewer).toBeLessThan(allCells);
        // the current-cycle column is highlighted
        expect(await page.locator(".cyc-grid .stg.now").count()).toBeGreaterThan(0);
        // back to live restores the full timeline
        await page.getByRole("button", { name: "Live" }).click();
        expect(await page.locator(".cyc-grid .stg").count()).toBe(allCells);
    });

    test("RISC-V (RV32IMFD) renders the cycle timeline", async ({ page }) => {
        await selectArchitecture(page, "RISC-V (RV32IMFD)");
        await loadFirstExampleAndRun(page);
        await openCycles(page);

        expect(await page.locator(".cyc-grid .stg").count()).toBeGreaterThan(0);
        expect(await cyclesCount(page)).toBeGreaterThan(0);
        await page.locator(".cyc-view").screenshot({ path: "tests/e2e/__screenshots__/riscv-cycles.png" });
    });
});
