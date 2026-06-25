import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Verifies EVERY example of EVERY UdL test group LOADS and ASSEMBLES (no assembler
 *  error): after loading, the instruction table shows the program (ends with `ecall`). */

const ROOT = process.cwd();
const ex = (p: string) => join(ROOT, p);

interface SetEntry { name: string; id: string; architecture: string; url: string }
interface Example { name: string; id: string; url: string }

const allSets: SetEntry[] = JSON.parse(readFileSync(ex("examples/example_set.json"), "utf8"));
const udlSets = allSets.filter(s => s.id.startsWith("udl-"));

for (const set of udlSets) {
    const examples: Example[] = JSON.parse(readFileSync(ex(set.url), "utf8"));

    test.describe(set.name, () => {
        for (const e of examples) {
            test(`${e.name} loads and assembles`, async ({ page }) => {
                await page.goto("/");
                await page.waitForLoadState("networkidle");
                await page.getByText("RISC-V (RV32IMFD)", { exact: true }).first().click();
                await expect(page.getByRole("button", { name: "Datapath" })).toBeVisible({ timeout: 20_000 });

                await page.locator('[title="Examples"]').click();
                const modal = page.locator(".modal.show");
                await expect(modal).toBeVisible();
                // select the group, then load this specific example
                await modal.locator(".dropdown-toggle").click();
                await page.locator(".dropdown-item", { hasText: set.name }).click();
                await modal.locator(".list-group-item", { hasText: e.name }).click();

                // assembled → instruction table shows the program
                await expect(page.locator("#inst_table")).toContainText("ecall");
            });
        }
    });
}
