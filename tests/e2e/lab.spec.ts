import { test, expect, type Page } from "@playwright/test";

/** Lab / I/O peripherals view: a RISC-V program drives the peripherals via MMIO,
 *  and the Lab tab shows their state (LEDs lit, 7-seg value, matrix pattern). */

async function bootRV32(page: Page) {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByText("RISC-V (RV32IMFD)", { exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Datapath" })).toBeVisible({ timeout: 20_000 });
}

async function loadLab(page: Page, name: string) {
    await page.locator('[title="Examples"]').click();
    const modal = page.locator(".modal.show");
    await expect(modal).toBeVisible();
    await modal.locator(".dropdown-toggle").click();
    await page.locator(".dropdown-item", { hasText: "UdL · Test Lab (I/O)" }).click();
    await modal.locator(".list-group-item", { hasText: name }).click();
}

async function runAndOpenLab(page: Page) {
    await page.getByRole("button", { name: "Run" }).click();
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: "Lab", exact: true }).click();
    await expect(page.locator(".lab-view")).toBeVisible();
}

test("LED bank lights from an MMIO write", async ({ page }) => {
    await bootRV32(page);
    await loadLab(page, "Lab 01 · Encender LEDs");
    await runAndOpenLab(page);
    // program wrote 0xAA to the LED DATA register
    await expect(page.locator(".leds")).toBeVisible();
    await expect(page.locator(".periph").first()).toContainText("0x000000AA");
    // at least one wokwi-led is on (bit 7 of 0xAA = 1 → first rendered LED)
    const on = await page.locator(".leds wokwi-led").first().evaluate((el: any) => el.value === true);
    expect(on).toBe(true);
});

test("7-segment shows the written value", async ({ page }) => {
    await bootRV32(page);
    await loadLab(page, "Lab 05 · Display 7-seg");
    await runAndOpenLab(page);
    await expect(page.locator(".lab-view")).toContainText("0x0000CAFE");
    await expect(page.locator("wokwi-7segment")).toBeVisible();
});

test("LED matrix renders a pattern", async ({ page }) => {
    await bootRV32(page);
    await loadLab(page, "Lab 04 · Matriz LED 8x8");
    await runAndOpenLab(page);
    // 64 LEDs rendered; several are lit by the diamond pattern
    await expect(page.locator(".matrix wokwi-led")).toHaveCount(64);
    const lit = await page.locator(".matrix wokwi-led").evaluateAll(
        (els) => els.filter((e: any) => e.value === true).length,
    );
    expect(lit).toBeGreaterThan(8);
});

test("push-button press updates the peripheral state", async ({ page }) => {
    await bootRV32(page);
    await loadLab(page, "Lab 07 · Pulsador (sondeo/polling)");
    await page.getByRole("button", { name: "Lab", exact: true }).click();
    await expect(page.locator(".lab-view")).toBeVisible();
    // press the button → @button-press → device-input → device updates → "PULSADO"
    await page.locator("wokwi-pushbutton").evaluate((el) => el.dispatchEvent(new Event("button-press")));
    await expect(page.locator(".lab-view")).toContainText("PULSADO");
});

test("peripherals can be dragged around the canvas", async ({ page }) => {
    await bootRV32(page);
    await loadLab(page, "Lab 01 · Encender LEDs");
    await page.getByRole("button", { name: "Lab", exact: true }).click();
    const led = page.locator(".periph").first();
    const before = await led.evaluate((el) => (el as HTMLElement).style.left);
    const header = led.locator("header");
    const box = (await header.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + 110, { steps: 6 });
    await page.mouse.up();
    const after = await led.evaluate((el) => (el as HTMLElement).style.left);
    expect(after).not.toBe(before);
});
