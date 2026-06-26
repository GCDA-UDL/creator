import { describe, it, expect } from "vitest";
import {
    LedBankDevice,
    SwitchDevice,
    SevenSegDevice,
    LedMatrixDevice,
    LAB_MMIO,
    registerUdlDevices,
    snapshotUdlDevices,
} from "@/core/executor/devices_udl.mts";
import { devices } from "@/core/executor/devices.mts";
import { coreEvents } from "@/core/events.mts";

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

    it("registerUdlDevices wires the devices + device-input updates switches", () => {
        registerUdlDevices();
        for (const id of ["led", "switches", "seg", "matrix"]) expect(devices.has(id)).toBe(true);
        bus.emit("device-input", { id: "switches", value: 0b101 });
        expect((devices.get("switches") as any).getValue()).toBe(0b101);
        expect(snapshotUdlDevices().switches).toBe(0b101);
    });
});
