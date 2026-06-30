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
    // The view now defaults to step mode (cursor at the engine's position); for the
    // assertions that need the full timeline, switch to Live.
    await page.getByRole("button", { name: "Live", exact: true }).click();
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
        await expect(page.locator(".cyc-stats")).toContainText("WAW");
        await expect(page.locator(".cyc-stats")).toContainText("Branch-mispred");
        expect(await cyclesCount(page)).toBeGreaterThan(0);
        // pipeline window: five stage boxes (IF/ID/EX/MEM/WB)
        expect(await page.locator(".cyc-pipe .pbox").count()).toBe(5);

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

    test("defaults to step mode (not the whole timeline); ⏮ rewinds to cycle 1", async ({ page }) => {
        await selectArchitecture(page, "RISC-V (RV32IMFD)");
        await loadFirstExampleAndRun(page);
        // open Cycles WITHOUT switching to Live
        await page.getByRole("button", { name: "Datapath" }).click();
        await page.getByRole("button", { name: "Cycles", exact: true }).click();
        await expect(page.locator(".cyc-grid")).toBeVisible();

        const parse = async () =>
            (await page.locator(".cyc-cnow").innerText()).split("/").map(s => parseInt(s.trim(), 10));
        const [n, m] = await parse();
        expect(m).toBeGreaterThan(1);
        expect(n).toBe(1); // step mode default: starts at cycle 1 (IF of instr 1), NOT the whole timeline
        // ▶ advances exactly one clock at a time
        await page.getByRole("button", { name: "▶" }).click();
        expect((await parse())[0]).toBe(2);
        await page.getByRole("button", { name: "▶" }).click();
        expect((await parse())[0]).toBe(3);
        // ⏮ rewinds to the first cycle
        await page.getByRole("button", { name: "⏮" }).click();
        expect((await parse())[0]).toBe(1);
    });

    test("forwarding (bypass) cells are marked on the grid", async ({ page }) => {
        await selectArchitecture(page, "RISC-V (RV32IMFD)");
        // pipeline "riesgos" program has RAW chains + a load-use → forwarding edges
        await page.locator('[title="Examples"]').click();
        const modal = page.locator(".modal.show");
        await modal.locator(".dropdown-toggle").click();
        await page.locator(".dropdown-item", { hasText: "UdL · Test Pipeline (Cycles)" }).click();
        await modal.locator(".list-group-item", { hasText: "riesgos" }).click();
        await page.getByRole("button", { name: "Run" }).click();
        await page.waitForTimeout(700);
        await openCycles(page); // switches to Live (full grid)

        expect(await page.locator(".stg.fwd-src").count()).toBeGreaterThan(0);
        await expect(page.locator(".cyc-legend")).toContainText("forward");
    });

    const delaySlot = (p: Page) =>
        p.locator(".cyc-settings label", { hasText: "Delay slot" }).locator('input[type="checkbox"]');

    test("delay slot is enabled on MIPS (MIPS has a branch delay slot)", async ({ page }) => {
        await selectArchitecture(page, "MIPS-32");
        await loadFirstExampleAndRun(page);
        await openCycles(page);
        await page.getByRole("button", { name: /Pipeline config/ }).click();
        await expect(delaySlot(page)).toBeEnabled();
    });

    test("delay slot is disabled on RISC-V (RV/ARM dropped the delay slot)", async ({ page }) => {
        await selectArchitecture(page, "RISC-V (RV32IMFD)");
        await loadFirstExampleAndRun(page);
        await openCycles(page);
        await page.getByRole("button", { name: /Pipeline config/ }).click();
        await expect(delaySlot(page)).toBeDisabled();
        await expect(page.locator(".cyc-settings")).toContainText("solo MIPS");
    });
});
