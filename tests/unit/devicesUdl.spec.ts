import { describe, it, expect, vi } from "vitest";
import {
    LedBankDevice,
    SwitchDevice,
    SevenSegDevice,
    LedMatrixDevice,
    ButtonDevice,
    Lcd1602Device,
    BuzzerDevice,
    PotentiometerDevice,
    RgbLedDevice,
    TimerDevice,
    LAB_MMIO,
    registerUdlDevices,
    snapshotUdlDevices,
} from "@/core/executor/devices_udl.mts";
import { devices } from "@/core/executor/devices.mts";
import { coreEvents } from "@/core/events.mts";
import { INTERRUPTS } from "@/core/capi/interrupts.mts";
import { InterruptType } from "@/core/executor/InterruptManager.mts";

const bus = coreEvents as unknown as {
    on: (t: string, h: (e: any) => void) => void;
    off: (t: string, h: (e: any) => void) => void;
    emit: (t: string, e: unknown) => void;
};

function block(m: { ctrl: number; status: number; data: number }, words: number) {
    return { ctrl_addr: m.ctrl, status_addr: m.status, data: { start: m.data, end: m.data + words * 4 - 1 }, enabled: true };
}
// write a 32-bit value (big-endian) to an absolute address of a device's memory
function poke(dev: any, addr: number, value: number) {
    dev.memory.writeWord(BigInt(addr), [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}
function capture(id: string, fn: () => void): any {
    let evt: any = null;
    const h = (e: any) => { if (e?.id === id) evt = e; };
    bus.on("device-output", h);
    fn();
    bus.off("device-output", h);
    return evt;
}

describe("UdL Lab devices — MMIO model", () => {
    it("LED bank emits device-output on change (and not when unchanged)", () => {
        const led = new LedBankDevice(block(LAB_MMIO.led, 2));
        poke(led, LAB_MMIO.led.data, 0xaa);
        expect(capture("led", () => led.handler())).toEqual({ id: "led", value: 0xaa });
        expect(led.getValue()).toBe(0xaa);
        // unchanged → no re-emit
        expect(capture("led", () => led.handler())).toBeNull();
    });

    it("switch bank: setValue is read back (UI → DATA, program reads with lw)", () => {
        const sw = new SwitchDevice(block(LAB_MMIO.switches, 2));
        sw.setValue(0b10110);
        expect(sw.getValue()).toBe(0b10110);
    });

    it("7-segment emits value + mode", () => {
        const seg = new SevenSegDevice(block(LAB_MMIO.seg, 2));
        poke(seg, LAB_MMIO.seg.data, 0xcafe);
        poke(seg, LAB_MMIO.seg.ctrl, 2);
        expect(capture("seg", () => seg.handler())).toEqual({ id: "seg", value: 0xcafe, mode: 2 });
    });

    it("LED matrix emits the 8 row bitmaps", () => {
        const mat = new LedMatrixDevice(block(LAB_MMIO.matrix, 8));
        poke(mat, LAB_MMIO.matrix.data, 0x18);
        poke(mat, LAB_MMIO.matrix.data + 4, 0x3c);
        const e = capture("matrix", () => mat.handler());
        expect(e.rows.length).toBe(8);
        expect(e.rows[0]).toBe(0x18);
        expect(e.rows[1]).toBe(0x3c);
    });

    it("push-button: a press raises an EXTERNAL interrupt on the rising edge only", () => {
        const spy = vi.spyOn(INTERRUPTS, "create").mockImplementation(() => {});
        const btn = new ButtonDevice(block(LAB_MMIO.button, 2));
        expect(btn.getPressed()).toBe(0);
        btn.press(true); // 0 → 1: rising edge → raise External
        expect(btn.getPressed()).toBe(1);
        expect(spy).toHaveBeenCalledWith(InterruptType.External);
        spy.mockClear();
        btn.press(true); // still down: no new edge → no raise
        expect(spy).not.toHaveBeenCalled();
        btn.press(false); // release
        expect(btn.getPressed()).toBe(0);
        spy.mockRestore();
    });

    it("registerUdlDevices wires the devices + device-input updates switches/button/pot", () => {
        registerUdlDevices();
        for (const id of ["led", "switches", "seg", "button", "matrix", "lcd", "buzzer", "pot", "rgb", "timer"])
            expect(devices.has(id)).toBe(true);
        bus.emit("device-input", { id: "switches", value: 0b101 });
        expect((devices.get("switches") as any).getValue()).toBe(0b101);
        expect(snapshotUdlDevices().switches).toBe(0b101);
        bus.emit("device-input", { id: "button", value: 1 });
        expect((devices.get("button") as any).getPressed()).toBe(1);
        bus.emit("device-input", { id: "pot", value: 512 });
        expect((devices.get("pot") as any).getValue()).toBe(512);
        expect(snapshotUdlDevices().pot).toBe(512);
    });

    // ---- Lab phase-3 peripherals ----

    it("LCD 16×2: command-strobe writes a char at the cursor and advances it", () => {
        const lcd = new Lcd1602Device(block(LAB_MMIO.lcd, 1));
        poke(lcd, LAB_MMIO.lcd.data, 0x48); // 'H'
        poke(lcd, LAB_MMIO.lcd.ctrl, 1); // command: write char
        const e = capture("lcd", () => lcd.handler());
        expect(e.row0[0]).toBe("H");
        expect(e.cursor).toBe(1);
        // command consumed (CTRL → 0) → no re-emit on the next cycle
        expect(capture("lcd", () => lcd.handler())).toBeNull();
        // write a second char
        poke(lcd, LAB_MMIO.lcd.data, 0x69); // 'i'
        poke(lcd, LAB_MMIO.lcd.ctrl, 1);
        expect(capture("lcd", () => lcd.handler()).row0.slice(0, 2)).toBe("Hi");
    });

    it("LCD 16×2: clear (cmd 2) and set-cursor (cmd 3)", () => {
        const lcd = new Lcd1602Device(block(LAB_MMIO.lcd, 1));
        poke(lcd, LAB_MMIO.lcd.data, 0x41); // 'A'
        poke(lcd, LAB_MMIO.lcd.ctrl, 1);
        lcd.handler();
        poke(lcd, LAB_MMIO.lcd.ctrl, 2); // clear
        const e = capture("lcd", () => lcd.handler());
        expect(e.text.trim()).toBe("");
        expect(e.cursor).toBe(0);
        // set cursor to row1 (position 16) then write
        poke(lcd, LAB_MMIO.lcd.data, 16);
        poke(lcd, LAB_MMIO.lcd.ctrl, 3);
        lcd.handler();
        poke(lcd, LAB_MMIO.lcd.data, 0x5a); // 'Z'
        poke(lcd, LAB_MMIO.lcd.ctrl, 1);
        expect(capture("lcd", () => lcd.handler()).row1[0]).toBe("Z");
    });

    it("buzzer: DATA bit0 toggles the sound (emits on change only)", () => {
        const bz = new BuzzerDevice(block(LAB_MMIO.buzzer, 1));
        poke(bz, LAB_MMIO.buzzer.data, 1);
        expect(capture("buzzer", () => bz.handler())).toEqual({ id: "buzzer", on: 1 });
        expect(capture("buzzer", () => bz.handler())).toBeNull(); // unchanged
        poke(bz, LAB_MMIO.buzzer.data, 0);
        expect(capture("buzzer", () => bz.handler())).toEqual({ id: "buzzer", on: 0 });
    });

    it("potentiometer: UI value read back, clamped to 0..1023", () => {
        const pot = new PotentiometerDevice(block(LAB_MMIO.pot, 1));
        pot.setValue(700);
        expect(pot.getValue()).toBe(700);
        pot.setValue(5000); // over-range → clamp
        expect(pot.getValue()).toBe(1023);
    });

    it("RGB LED: DATA = 0x00RRGGBB → r/g/b channels", () => {
        const rgb = new RgbLedDevice(block(LAB_MMIO.rgb, 1));
        poke(rgb, LAB_MMIO.rgb.data, 0x00ff8000);
        const e = capture("rgb", () => rgb.handler());
        expect(e).toEqual({ id: "rgb", value: 0xff8000, r: 0xff, g: 0x80, b: 0x00 });
        expect(capture("rgb", () => rgb.handler())).toBeNull(); // unchanged
    });

    it("timer (PIT): fires every `period` cycles → External IRQ + pending flag", () => {
        const spy = vi.spyOn(INTERRUPTS, "create").mockImplementation(() => {});
        const t = new TimerDevice(block(LAB_MMIO.timer, 1));
        poke(t, LAB_MMIO.timer.ctrl, 1); // enable
        poke(t, LAB_MMIO.timer.data, 3); // period = 3 cycles
        expect(capture("timer", () => t.handler())).toBeNull(); // 1
        expect(capture("timer", () => t.handler())).toBeNull(); // 2
        const e = capture("timer", () => t.handler()); // 3 → fire
        expect(e).toMatchObject({ id: "timer", fired: 1, ticks: 1, period: 3 });
        expect(spy).toHaveBeenCalledWith(InterruptType.External);
        expect(t.getState().pending).toBe(1);
        spy.mockRestore();
    });

    it("timer (PIT): disabled or zero-period never fires", () => {
        const spy = vi.spyOn(INTERRUPTS, "create").mockImplementation(() => {});
        const t = new TimerDevice(block(LAB_MMIO.timer, 1));
        poke(t, LAB_MMIO.timer.ctrl, 0); // disabled
        poke(t, LAB_MMIO.timer.data, 2);
        for (let i = 0; i < 5; i++) expect(capture("timer", () => t.handler())).toBeNull();
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});
