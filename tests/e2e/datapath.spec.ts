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
});
