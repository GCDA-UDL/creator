import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end smoke for the data-driven datapath view.
 * Drives the real app: pick an architecture → open the Datapath tab → switch to
 * the drawn Schematic → assert the correct per-architecture drawing renders, and
 * capture a screenshot for visual review.
 *
 * The drawn structure is shown before any execution, so these tests are
 * deterministic without needing to assemble/run a program (live operand values
 * are covered by the Vitest component tests).
 */

async function selectArchitecture(page: Page, name: string) {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByText(name, { exact: true }).first().click();
    // Simulator is ready once the data-panel tabs are present.
    await expect(page.getByRole("button", { name: "Datapath" })).toBeVisible({ timeout: 20_000 });
}

async function openSchematic(page: Page) {
    await page.getByRole("button", { name: "Datapath" }).click();
    await page.getByRole("button", { name: "Schematic" }).click();
    await expect(page.locator(".dp-svg")).toBeVisible();
}

test.describe("Datapath view (per-architecture)", () => {
    test("RISC-V draws the RV32I datapath", async ({ page }) => {
        await selectArchitecture(page, "RISC-V (RV32IMFD)");
        await openSchematic(page);

        const svg = page.locator(".dp-svg");
        for (const label of ["PC", "IMem", "Reg File", "ALU", "DataMem"]) {
            await expect(svg.getByText(label, { exact: true })).toBeVisible();
        }
        await expect(page.locator(".dp-schematic")).toContainText("RV32I datapath");
        await page.locator(".dp-schematic").screenshot({ path: "tests/e2e/__screenshots__/riscv-datapath.png" });
    });

    test("MIPS-32 draws its own datapath", async ({ page }) => {
        await selectArchitecture(page, "MIPS-32");
        await openSchematic(page);

        await expect(page.locator(".dp-schematic")).toContainText("MIPS-32 single-cycle datapath");
        await expect(page.locator(".dp-svg").getByText("Reg File", { exact: true })).toBeVisible();
        await page.locator(".dp-schematic").screenshot({ path: "tests/e2e/__screenshots__/mips-datapath.png" });
    });

    test("student mode reveals clickable explanations", async ({ page }) => {
        await selectArchitecture(page, "RISC-V (RV32IMFD)");
        await openSchematic(page);

        await page.getByRole("button", { name: /Student/ }).click();
        // The first "?" badge opens the explanation panel.
        await page.locator(".dp-qmarks .qmark").first().click();
        await expect(page.locator(".dp-help")).toBeVisible();
    });

    test("the display gear exposes appearance settings", async ({ page }) => {
        await selectArchitecture(page, "RISC-V (RV32IMFD)");
        await openSchematic(page);

        await page.getByRole("button", { name: /Display/ }).click();
        await expect(page.locator(".dp-settings")).toBeVisible();
        await expect(page.locator(".dp-settings")).toContainText("Theme preset");
    });

    test("a custom architecture draws the datapath from its YAML block", async ({ page }) => {
        await page.goto("/");
        await page.waitForLoadState("networkidle");

        // Open the "Load Custom Architecture" modal, fill name + file, submit.
        await page.getByText("Load Custom Architecture", { exact: true }).first().click();
        await page.locator("#arch-name").fill("Simple8 DP demo");
        await page
            .locator('input[type="file"]')
            .setInputFiles("tests/e2e/fixtures/simple8_datapath.yml");
        await page.getByRole("button", { name: "OK" }).click();

        // Custom architecture loads through the real engine pipeline.
        await expect(page.getByRole("button", { name: "Datapath" })).toBeVisible({ timeout: 20_000 });
        await openSchematic(page);

        // The drawing comes entirely from the YAML `datapath:` block.
        await expect(page.locator(".dp-schematic")).toContainText(
            "Simple8Bit — custom datapath drawn from YAML",
        );
        await expect(page.locator(".dp-svg").getByText("ALU", { exact: true })).toBeVisible();
        await expect(page.locator(".dp-svg").getByText("Reg File", { exact: true })).toBeVisible();
        await page
            .locator(".dp-schematic")
            .screenshot({ path: "tests/e2e/__screenshots__/custom-datapath.png" });
    });

    test("Schematic walks the instruction phases (IF→ID→…); ⏮ and Todo work", async ({ page }) => {
        await selectArchitecture(page, "RISC-V (RV32IMFD)");
        await page.locator('[title="Examples"]').click();
        await page.locator(".modal.show .list-group-item").first().click();
        await openSchematic(page); // mount the trace listener before stepping

        // Execute one instruction while the Schematic is open → phase resets to IF.
        await page.getByRole("button", { name: "Step" }).click();
        await page.waitForTimeout(150);
        const now = page.locator(".dp-phase-now");
        await expect(now).toContainText("IF"); // starts at fetch
        // only the IF stage is highlighted (cumulative reveal begins at IF)
        await page.getByRole("button", { name: "▶" }).click();
        await expect(now).toContainText("ID"); // ▶ advances one phase (decode)
        await page.getByRole("button", { name: "⏮" }).click();
        await expect(now).toContainText("IF"); // ⏮ rewinds to fetch
        await page.getByRole("button", { name: "Todo" }).click();
        await expect(now).toContainText("todas"); // single-cycle: all phases at once
    });

    test("stepping a loaded example shows live operand values", async ({ page }) => {
        await selectArchitecture(page, "RISC-V (RV32IMFD)");

        // Load the first example (compile=true → auto-assembles).
        await page.locator('[title="Examples"]').click();
        const modal = page.locator(".modal.show");
        await expect(modal).toBeVisible();
        await modal.locator(".list-group-item").first().click();

        // Open the datapath schematic FIRST so its trace listener is mounted
        // before we step (the view subscribes to the trace event on mount).
        await openSchematic(page);

        // Step a few instructions; each emits a datapath trace.
        const step = page.getByRole("button", { name: "Step" });
        await expect(step).toBeVisible({ timeout: 20_000 });
        for (let i = 0; i < 4; i++) {
            await step.click();
            await page.waitForTimeout(150);
        }

        // A live operand value ("role: reg = N") is shown on the diagram.
        await expect(page.locator(".dp-schematic")).toContainText(/=\s*-?\d/);
        await page
            .locator(".dp-schematic")
            .screenshot({ path: "tests/e2e/__screenshots__/riscv-live-values.png" });
    });
});
