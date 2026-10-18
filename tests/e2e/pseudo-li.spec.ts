import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end check of the `li` pseudo-instruction expansion through the real
 * assembler (UdL extension): with the default policy (`config.li_expansion:
 * standard`) a value whose low 12 bits are zero expands to a single `lui`, a 12-bit
 * value to a single `addi`, anything else to `lui` + `addi` — the sequence of the
 * RISC-V toolchains and of Ripes. Uses the "Datapath 08" example and reads the
 * code table ("Loaded Instructions").
 */

async function selectArchitecture(page: Page, name: string) {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByText(name, { exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Datapath" })).toBeVisible({ timeout: 20_000 });
}

async function loadExample(page: Page, group: string, name: string) {
    await page.locator('[title="Examples"]').click();
    const modal = page.locator(".modal.show");
    await expect(modal).toBeVisible();
    await modal.locator(".dropdown-toggle").click();
    await page.locator(".dropdown-item", { hasText: group }).click();
    await modal.locator(".list-group-item", { hasText: name }).click();
    await expect(page.getByRole("button", { name: "Run" }).first()).toBeVisible({ timeout: 20_000 });
}

test.describe("li pseudo-instruction expansion (standard policy)", () => {
    test("Datapath 08: addi | lui | lui+addi as the toolchains do", async ({ page }) => {
        await selectArchitecture(page, "RISC-V (RV32IMFD)");
        await loadExample(page, "UdL · Test Datapath", "Datapath 08");

        const rows = page.locator("#inst_table tbody tr");
        // 6 li (1+1+2+1+2+1 = 8 machine instructions) + add + li a7 + ecall = 11 rows
        await expect(rows).toHaveCount(11);
        const loaded = (await rows.locator("td:nth-child(3) .instruction-text").allInnerTexts()).map(t => t.replace(/\s+/g, " ").trim());
        // the table prints ABI register names and decimal immediates
        expect(loaded[0]).toMatch(/^addi t0, x0, 5$/);
        expect(loaded[1]).toMatch(/^lui t1, 74565$/); // 0x12345: low 12 bits zero → lui alone
        expect(loaded[2]).toMatch(/^lui t2, 74565$/);
        expect(loaded[3]).toMatch(/^addi t2, t2, 1656$/);
        expect(loaded[4]).toMatch(/^addi t3, x0, -1$/);
        expect(loaded[5]).toMatch(/^lui t4, 524288$/); // 0x80000: rounded upper part
        expect(loaded[6]).toMatch(/^addi t4, t4, -2048$/);
        expect(loaded[7]).toMatch(/^lui t5, 4080$/); // 0xff0: the lab_11 / Ripes case
        expect(loaded[8]).toMatch(/^add t6, t1, t2$/);

        // and the program computes the expected values
        await page.getByRole("button", { name: "Run" }).first().click();
        await expect(page.getByRole("button", { name: /Finished/ }).first()).toBeVisible({ timeout: 10_000 });
        await page.getByRole("button", { name: "Registers", exact: true }).first().click();
        const regs = await page.locator("body").innerText();
        expect(regs).toMatch(/x6 \| t1\s+12345000/);
        expect(regs).toMatch(/x29 \| t4\s+7FFFF800/);
        expect(regs).toMatch(/x30 \| t5\s+00FF0000/);
    });
});
