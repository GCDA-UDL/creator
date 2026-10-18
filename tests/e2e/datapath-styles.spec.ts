import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end smoke for the datapath drawing styles (UdL extension):
 * RISC-V ships two drawings — the CREATOR (P&H) schematic and the Ripes RV5S
 * circuit — selectable from the Schematic toolbar, plus a one-click "Ripes (RV5S)"
 * cycles preset that is shared with the Cycles view. Also checks that the Ripes
 * drawing shows live hazard / forwarding state after a load-use program runs.
 */

async function selectArchitecture(page: Page, name: string) {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByText(name, { exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Datapath" })).toBeVisible({ timeout: 20_000 });
}

async function openSchematic(page: Page) {
    await page.getByRole("button", { name: "Datapath" }).click();
    await page.getByRole("button", { name: "Schematic" }).click();
    await expect(page.locator(".dp-svg")).toBeVisible();
}

async function loadPipelineExample(page: Page, name: string) {
    await page.locator('[title="Examples"]').click();
    const modal = page.locator(".modal.show");
    await expect(modal).toBeVisible();
    await modal.locator(".dropdown-toggle").click();
    await page.locator(".dropdown-item", { hasText: "UdL · Test Pipeline (Cycles)" }).click();
    await modal.locator(".list-group-item", { hasText: name }).click();
    await expect(page.getByRole("button", { name: "Step" }).first()).toBeVisible({ timeout: 20_000 });
}

test.describe("Datapath drawing styles (CREATOR / Ripes)", () => {
    test("RISC-V offers the two styles; Ripes draws the RV5S circuit with its units", async ({ page }) => {
        await selectArchitecture(page, "RISC-V (RV32IMFD)");
        await openSchematic(page);

        const sel = page.locator(".dp-style select");
        await expect(sel).toBeVisible();
        await expect(sel.locator("option")).toHaveCount(2);
        // default = CREATOR (P&H): textbook blocks, branch resolved in MEM in this drawing
        await expect(page.locator(".dp-svg").getByText("Reg File", { exact: true })).toBeVisible();
        await expect(page.locator(".dp-branchinfo")).toContainText("MEM");

        await sel.selectOption("ripes");
        const svg = page.locator(".dp-svg");
        for (const label of ["Registers", "Hazard unit", "Forwarding unit", "Branch", "Data mem"]) {
            await expect(svg.getByText(label, { exact: true })).toBeVisible();
        }
        await expect(svg).toHaveClass(/theme-ripes/);
        await expect(page.locator(".dp-branchinfo")).toContainText("EX");
        await expect(page.locator(".dp-schematic")).toContainText("Ripes (RV5S)");
        await page.locator(".dp-schematic").screenshot({ path: "tests/e2e/__screenshots__/riscv-datapath-ripes.png" });

        // the choice persists across reloads
        await page.reload();
        await page.waitForLoadState("networkidle");
        await page.getByText("RISC-V (RV32IMFD)", { exact: true }).first().click();
        await openSchematic(page);
        await expect(page.locator(".dp-style select")).toHaveValue("ripes");
    });

    test("MIPS has a single drawing → no style selector", async ({ page }) => {
        await selectArchitecture(page, "MIPS-32");
        await openSchematic(page);
        await expect(page.locator(".dp-style")).toHaveCount(0);
        await expect(page.locator(".dp-branchinfo")).toContainText("MEM");
    });

    test("Ripes drawing shows live hazard + forwarding state on a load-use program", async ({ page }) => {
        await selectArchitecture(page, "RISC-V (RV32IMFD)");
        await loadPipelineExample(page, "Pipeline 02");
        const step = page.getByRole("button", { name: "Step" }).first();
        await step.click(); // auipc (la)
        await step.click(); // addi  (la)
        await openSchematic(page);
        await page.locator(".dp-style select").selectOption("ripes");
        await step.click(); // lw t1, 0(t0)   → rs1 forwarded from MEM
        await expect(page.locator(".dp-svg")).toContainText("rs1 ← MEM");
        await step.click(); // addi t2, t1, 1 → load-use: 1 stall, rs1 from WB
        await expect(page.locator(".dp-svg")).toContainText("stall ×1");
        await expect(page.locator(".dp-svg")).toContainText("rs1 ← WB");
        await expect(page.locator(".dp-wires .wfwd")).toHaveCount(1);
        await page.locator(".dp-schematic").screenshot({ path: "tests/e2e/__screenshots__/riscv-ripes-live.png" });
    });

    test("the Ripes preset button configures the Cycles view (branch EX, ecall drain)", async ({ page }) => {
        await selectArchitecture(page, "RISC-V (RV32IMFD)");
        await loadPipelineExample(page, "Pipeline 02");
        await page.getByRole("button", { name: "Run" }).first().click();
        await page.waitForTimeout(800);
        await openSchematic(page);
        await page.locator(".dp-style select").selectOption("ripes");
        // drawing resolves in EX; the default cycles model (P&H) resolves in ID → mismatch hint
        await expect(page.locator(".dp-bi-mismatch")).toBeVisible();
        await page.getByRole("button", { name: /Aplicar preset/ }).click();
        await expect(page.locator(".dp-bi-mismatch")).toHaveCount(0);

        await page.getByRole("button", { name: "Cycles", exact: true }).click();
        await expect(page.locator(".cyc-grid")).toBeVisible();
        await page.getByRole("button", { name: /Pipeline config/ }).click();
        await expect(page.locator(".cyc-settings select")).toHaveValue("EX");
        await expect(page.locator(".cyc-settings input[type=number]").first()).toHaveValue("1");
        await expect(page.locator(".cyc-preset", { hasText: "Ripes (RV5S)" })).toBeVisible();
        await expect(page.locator(".cyc-stats")).toContainText("Syscall stalls");
    });
});
