import { describe, it, expect, vi } from "vitest";
import {
    LedBankDevice,
    SwitchDevice,
    SevenSegDevice,
    LedMatrixDevice,
    ButtonDevice,
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

    it("registerUdlDevices wires the devices + device-input updates switches/button", () => {
        registerUdlDevices();
        for (const id of ["led", "switches", "seg", "button", "matrix"]) expect(devices.has(id)).toBe(true);
        bus.emit("device-input", { id: "switches", value: 0b101 });
        expect((devices.get("switches") as any).getValue()).toBe(0b101);
        expect(snapshotUdlDevices().switches).toBe(0b101);
        bus.emit("device-input", { id: "button", value: 1 });
        expect((devices.get("button") as any).getPressed()).toBe(1);
    });
});
