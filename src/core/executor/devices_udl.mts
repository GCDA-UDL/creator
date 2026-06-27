/**
 * Copyright 2018-2026 CREATOR Team. LGPL-3.0.
 *
 * UdL extension (PID RISC-V) — visual I/O peripherals for the "Lab" view (TAREA 6).
 * Additive: new memory-mapped devices (LED bank, switches, 7-segment, LED matrix)
 * implemented as subclasses of the existing `Device` framework and registered into
 * the existing `devices` map. The engine's behaviour is unchanged — these only react
 * to writes/reads on a new MMIO region (0xF0001xxx) and bridge state to the UI via
 * the `coreEvents` bus:
 *   - simulator → UI: "device-output" { id, ... }  (emitted on change, per cycle)
 *   - UI → simulator: "device-input" { id, value } (e.g. flipping a switch)
 *
 * The visual rendering uses the MIT-licensed `@wokwi/elements` web components; the
 * Wokwi *simulation engine* is proprietary and is NOT used — CREATOR is the CPU.
 */

import { Device, devices } from "./devices.mts";
import { coreEvents } from "../events.mts";
import { INTERRUPTS } from "../capi/interrupts.mts";
import { InterruptType } from "./InterruptManager.mts";

// fire-and-forget emit (the event bus is loosely typed for UdL signals)
const emit = (type: string, payload: unknown) =>
    (coreEvents as unknown as { emit: (t: string, e: unknown) => void }).emit(type, payload);

// ---- MMIO map (region 0xF0001000, away from console/os at 0xF0000000) ----
// Per device, mirror the console layout: ctrl, status, then an 8-byte data block.
export const LAB_MMIO = {
    led: { ctrl: 0xf0001000, status: 0xf0001004, data: 0xf0001008 }, // DATA: 1 bit per LED
    switches: { ctrl: 0xf0001010, status: 0xf0001014, data: 0xf0001018 }, // DATA: 1 bit per switch (read)
    seg: { ctrl: 0xf0001020, status: 0xf0001024, data: 0xf0001028 }, // ctrl=mode, DATA=value
    button: { ctrl: 0xf0001030, status: 0xf0001034, data: 0xf0001038 }, // DATA bit0 = pressed
    matrix: { ctrl: 0xf0001040, status: 0xf0001044, data: 0xf0001048 }, // 8 rows × 1 word (row bitmap)
} as const;

/** LED bank: program writes a bitmask to DATA; each set bit lights a LED. */
export class LedBankDevice extends Device {
    private last = -1;
    override handler(): void {
        const v = this.readValue(LAB_MMIO.led.data).getUint32(0) >>> 0;
        if (v !== this.last) {
            this.last = v;
            emit("device-output", { id: "led", value: v });
        }
    }
    getValue(): number {
        return this.readValue(LAB_MMIO.led.data).getUint32(0) >>> 0;
    }
}

/** Switch bank: UI flips switches → DATA; the program reads DATA with `lw`. */
export class SwitchDevice extends Device {
    override handler(): void {
        /* input device: state is set by the UI, read by the program. */
    }
    setValue(v: number): void {
        this.writeValue(v >>> 0, LAB_MMIO.switches.data);
    }
    getValue(): number {
        return this.readValue(LAB_MMIO.switches.data).getUint32(0) >>> 0;
    }
}

/**
 * Push-button: a rising edge (press) raises a RISC-V EXTERNAL interrupt so a program
 * with an ISR (mtvec handler) runs on press. DATA bit0 is also readable for polling.
 * NOTE: vectoring to the ISR needs the "Custom (architecture)" interrupt handler
 * (Settings); the button is always pollable regardless.
 */
export class ButtonDevice extends Device {
    private last = -1;
    override handler(): void {
        const v = this.readValue(LAB_MMIO.button.data).getUint32(0) & 1;
        if (v !== this.last) {
            this.last = v;
            emit("device-output", { id: "button", pressed: v });
        }
    }
    press(down: boolean): void {
        const wasDown = (this.readValue(LAB_MMIO.button.data).getUint32(0) & 1) === 1;
        this.writeValue(down ? 1 : 0, LAB_MMIO.button.data);
        if (down && !wasDown) {
            // rising edge → external interrupt (serviced if mstatus.MIE + mie.MEIE)
            try {
                INTERRUPTS.create(InterruptType.External);
            } catch {
                /* interrupts may be unavailable in some contexts; polling still works */
            }
        }
    }
    getPressed(): number {
        return this.readValue(LAB_MMIO.button.data).getUint32(0) & 1;
    }
}

/** 7-segment display: program writes the value to DATA (mode via ctrl). */
export class SevenSegDevice extends Device {
    private last = "";
    override handler(): void {
        const value = this.readValue(LAB_MMIO.seg.data).getUint32(0) >>> 0;
        const mode = this.readValue(LAB_MMIO.seg.ctrl).getUint32(0) >>> 0;
        const key = `${value}:${mode}`;
        if (key !== this.last) {
            this.last = key;
            emit("device-output", { id: "seg", value, mode });
        }
    }
    getState(): { value: number; mode: number } {
        return {
            value: this.readValue(LAB_MMIO.seg.data).getUint32(0) >>> 0,
            mode: this.readValue(LAB_MMIO.seg.ctrl).getUint32(0) >>> 0,
        };
    }
}

/** LED matrix 8×8: 8 row registers (one word each); MSB = leftmost column. */
export class LedMatrixDevice extends Device {
    private last = "";
    private rows(): number[] {
        const r: number[] = [];
        for (let i = 0; i < 8; i++)
            r.push(this.readValue(LAB_MMIO.matrix.data + i * 4).getUint32(0) & 0xff);
        return r;
    }
    override handler(): void {
        const rows = this.rows();
        const key = rows.join(",");
        if (key !== this.last) {
            this.last = key;
            emit("device-output", { id: "matrix", rows });
        }
    }
    getRows(): number[] {
        return this.rows();
    }
}

function makeBlock(m: { ctrl: number; status: number; data: number }, dataWords: number) {
    return {
        ctrl_addr: m.ctrl,
        status_addr: m.status,
        data: { start: m.data, end: m.data + dataWords * 4 - 1 },
        enabled: true,
    };
}

let registered = false;

/** Registers the UdL Lab peripherals (idempotent). Call once at web bootstrap. */
export function registerUdlDevices(): void {
    if (registered) return;
    registered = true;

    const led = new LedBankDevice(makeBlock(LAB_MMIO.led, 2));
    const switches = new SwitchDevice(makeBlock(LAB_MMIO.switches, 2));
    const seg = new SevenSegDevice(makeBlock(LAB_MMIO.seg, 2));
    const button = new ButtonDevice(makeBlock(LAB_MMIO.button, 2));
    const matrix = new LedMatrixDevice(makeBlock(LAB_MMIO.matrix, 8));

    devices.set("led", led);
    devices.set("switches", switches);
    devices.set("seg", seg);
    devices.set("button", button);
    devices.set("matrix", matrix);

    // UI → simulator: a flipped switch / a button press updates the device register.
    (coreEvents as unknown as { on: (t: string, h: (e: any) => void) => void }).on(
        "device-input",
        (e: { id: string; value: number }) => {
            if (e?.id === "switches") switches.setValue(e.value);
            else if (e?.id === "button") button.press(!!e.value);
        },
    );

    // on program reset, clear peripherals and notify the UI.
    (coreEvents as unknown as { on: (t: string, h: () => void) => void }).on(
        "registers-reset",
        () => {
            for (const d of [led, switches, seg, button, matrix]) d.reset();
            emit("device-output", { id: "led", value: 0 });
            emit("device-output", { id: "seg", value: 0, mode: 0 });
            emit("device-output", { id: "button", pressed: 0 });
            emit("device-output", { id: "matrix", rows: [0, 0, 0, 0, 0, 0, 0, 0] });
        },
    );
}

/** Current state of the Lab peripherals (for a view mounting after a run). */
export function snapshotUdlDevices(): {
    led: number;
    switches: number;
    seg: { value: number; mode: number };
    button: number;
    matrix: number[];
} {
    const led = devices.get("led") as LedBankDevice | undefined;
    const sw = devices.get("switches") as SwitchDevice | undefined;
    const seg = devices.get("seg") as SevenSegDevice | undefined;
    const btn = devices.get("button") as ButtonDevice | undefined;
    const mat = devices.get("matrix") as LedMatrixDevice | undefined;
    return {
        led: led?.getValue() ?? 0,
        switches: sw?.getValue() ?? 0,
        seg: seg?.getState() ?? { value: 0, mode: 0 },
        button: btn?.getPressed() ?? 0,
        matrix: mat?.getRows() ?? [0, 0, 0, 0, 0, 0, 0, 0],
    };
}
