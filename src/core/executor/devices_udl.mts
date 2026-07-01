/**
 * Copyright 2018-2026 CREATOR Team. LGPL-3.0.
 *
 * UdL extension (PID RISC-V) — visual I/O peripherals for the "Lab" view (TAREA 6).
 * Additive: new memory-mapped devices (LED bank, switches, 7-segment, LED matrix,
 * push-button, LCD 16×2, buzzer, potentiometer, RGB LED and an interval timer)
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
    // --- Lab phase-3 (matrix data ends at 0xf0001067; keep new blocks ≥ 0xf0001070) ---
    lcd: { ctrl: 0xf0001070, status: 0xf0001074, data: 0xf0001078 }, // ctrl=command, data=char/pos
    buzzer: { ctrl: 0xf0001080, status: 0xf0001084, data: 0xf0001088 }, // DATA bit0 = on
    pot: { ctrl: 0xf0001090, status: 0xf0001094, data: 0xf0001098 }, // DATA = 0..1023 (input)
    rgb: { ctrl: 0xf00010a0, status: 0xf00010a4, data: 0xf00010a8 }, // DATA = 0x00RRGGBB
    timer: { ctrl: 0xf00010b0, status: 0xf00010b4, data: 0xf00010b8 }, // ctrl bit0=enable, data=period, status bit0=pending
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

/**
 * Character LCD 16×2 (HD44780-style). Command-strobe protocol, like the console
 * device: the program sets DATA, then pulses CTRL with a command; the handler
 * consumes it and resets CTRL to 0.
 *   CTRL = 1 → write the char in DATA (low byte) at the cursor; cursor advances
 *   CTRL = 2 → clear the display; cursor → 0
 *   CTRL = 3 → move the cursor to position DATA (0..31; 0..15 row0, 16..31 row1)
 */
export class Lcd1602Device extends Device {
    private buf: number[] = new Array(32).fill(0x20);
    private cursor = 0;
    private text(): string {
        return this.buf.map(c => (c >= 0x20 ? String.fromCharCode(c) : " ")).join("");
    }
    private render(): void {
        const text = this.text();
        emit("device-output", {
            id: "lcd",
            text,
            row0: text.slice(0, 16),
            row1: text.slice(16, 32),
            cursor: this.cursor,
        });
    }
    override handler(): void {
        const cmd = this.readValue(LAB_MMIO.lcd.ctrl).getUint32(0) >>> 0;
        if (cmd === 0) return;
        const data = this.readValue(LAB_MMIO.lcd.data).getUint32(0) >>> 0;
        switch (cmd) {
            case 1: // write char at cursor
                this.buf[Math.min(this.cursor, 31)] = data & 0xff;
                if (this.cursor < 31) this.cursor++;
                break;
            case 2: // clear
                this.buf.fill(0x20);
                this.cursor = 0;
                break;
            case 3: // set cursor
                this.cursor = data & 31;
                break;
            default:
                this.clear();
                return;
        }
        this.clear(); // consume the command (CTRL → 0)
        this.render();
    }
    getState(): { text: string; cursor: number } {
        return { text: this.text(), cursor: this.cursor };
    }
    override reset(): void {
        super.reset();
        this.buf = new Array(32).fill(0x20);
        this.cursor = 0;
    }
}

/** Piezo buzzer: DATA bit0 = sound on/off. */
export class BuzzerDevice extends Device {
    private last = -1;
    override handler(): void {
        const on = this.readValue(LAB_MMIO.buzzer.data).getUint32(0) & 1;
        if (on !== this.last) {
            this.last = on;
            emit("device-output", { id: "buzzer", on });
        }
    }
    getOn(): number {
        return this.readValue(LAB_MMIO.buzzer.data).getUint32(0) & 1;
    }
}

/**
 * Analog potentiometer (input): the UI sets a 0..1023 value; the program reads
 * DATA with `lw`. Purely an input device (handler is a no-op).
 */
export class PotentiometerDevice extends Device {
    override handler(): void {
        /* input device: value set by the UI, read by the program. */
    }
    setValue(v: number): void {
        this.writeValue(Math.max(0, Math.min(1023, v >>> 0)), LAB_MMIO.pot.data);
    }
    getValue(): number {
        return this.readValue(LAB_MMIO.pot.data).getUint32(0) >>> 0;
    }
}

/** RGB LED (NeoPixel-style): DATA = 0x00RRGGBB; each byte is a channel 0..255. */
export class RgbLedDevice extends Device {
    private last = -1;
    override handler(): void {
        const v = this.readValue(LAB_MMIO.rgb.data).getUint32(0) >>> 0;
        if (v !== this.last) {
            this.last = v;
            emit("device-output", {
                id: "rgb",
                value: v,
                r: (v >>> 16) & 0xff,
                g: (v >>> 8) & 0xff,
                b: v & 0xff,
            });
        }
    }
    getValue(): number {
        return this.readValue(LAB_MMIO.rgb.data).getUint32(0) >>> 0;
    }
}

/**
 * Programmable interval timer (PIT). Each cycle, when enabled (CTRL bit0), an
 * internal counter counts executed cycles; when it reaches the period (DATA) it
 * reloads, sets STATUS bit0 (pending — sticky until the program clears it) and
 * raises a RISC-V EXTERNAL interrupt so an ISR runs (like the push-button; needs
 * the "Custom (architecture)" handler in Settings). Also fully pollable via STATUS.
 * (This is a *peripheral* timer; CREATOR also exposes the machine-timer CSRs
 *  mtime/mtimecmp that raise a Timer interrupt — see 06-lab.md for that advanced path.)
 */
export class TimerDevice extends Device {
    private counter = 0;
    private ticks = 0;
    override handler(): void {
        const enabled = (this.readValue(LAB_MMIO.timer.ctrl).getUint32(0) & 1) === 1;
        if (!enabled) return;
        const period = this.readValue(LAB_MMIO.timer.data).getUint32(0) >>> 0;
        if (period === 0) return;
        this.counter++;
        if (this.counter >= period) {
            this.counter = 0;
            this.ticks = (this.ticks + 1) >>> 0;
            this.writeValue(1, LAB_MMIO.timer.status); // pending flag (sticky until cleared)
            try {
                INTERRUPTS.create(InterruptType.External);
            } catch {
                /* interrupts may be unavailable; polling STATUS still works */
            }
            emit("device-output", { id: "timer", ticks: this.ticks, fired: 1, period });
        }
    }
    getState(): { enabled: number; period: number; pending: number; ticks: number } {
        return {
            enabled: this.readValue(LAB_MMIO.timer.ctrl).getUint32(0) & 1,
            period: this.readValue(LAB_MMIO.timer.data).getUint32(0) >>> 0,
            pending: this.readValue(LAB_MMIO.timer.status).getUint32(0) & 1,
            ticks: this.ticks,
        };
    }
    override reset(): void {
        super.reset();
        this.counter = 0;
        this.ticks = 0;
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
    const lcd = new Lcd1602Device(makeBlock(LAB_MMIO.lcd, 1));
    const buzzer = new BuzzerDevice(makeBlock(LAB_MMIO.buzzer, 1));
    const pot = new PotentiometerDevice(makeBlock(LAB_MMIO.pot, 1));
    const rgb = new RgbLedDevice(makeBlock(LAB_MMIO.rgb, 1));
    const timer = new TimerDevice(makeBlock(LAB_MMIO.timer, 1));

    devices.set("led", led);
    devices.set("switches", switches);
    devices.set("seg", seg);
    devices.set("button", button);
    devices.set("matrix", matrix);
    devices.set("lcd", lcd);
    devices.set("buzzer", buzzer);
    devices.set("pot", pot);
    devices.set("rgb", rgb);
    devices.set("timer", timer);

    // UI → simulator: a flipped switch / a button press / a turned pot updates a register.
    (coreEvents as unknown as { on: (t: string, h: (e: any) => void) => void }).on(
        "device-input",
        (e: { id: string; value: number }) => {
            if (e?.id === "switches") switches.setValue(e.value);
            else if (e?.id === "button") button.press(!!e.value);
            else if (e?.id === "pot") pot.setValue(e.value);
        },
    );

    // on program reset, clear peripherals and notify the UI.
    (coreEvents as unknown as { on: (t: string, h: () => void) => void }).on(
        "registers-reset",
        () => {
            for (const d of [led, switches, seg, button, matrix, lcd, buzzer, pot, rgb, timer])
                d.reset();
            emit("device-output", { id: "led", value: 0 });
            emit("device-output", { id: "seg", value: 0, mode: 0 });
            emit("device-output", { id: "button", pressed: 0 });
            emit("device-output", { id: "matrix", rows: [0, 0, 0, 0, 0, 0, 0, 0] });
            emit("device-output", {
                id: "lcd",
                text: " ".repeat(32),
                row0: " ".repeat(16),
                row1: " ".repeat(16),
                cursor: 0,
            });
            emit("device-output", { id: "buzzer", on: 0 });
            emit("device-output", { id: "rgb", value: 0, r: 0, g: 0, b: 0 });
            emit("device-output", { id: "timer", ticks: 0, fired: 0, period: 0 });
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
    lcd: { text: string; cursor: number };
    buzzer: number;
    pot: number;
    rgb: number;
    timer: { enabled: number; period: number; pending: number; ticks: number };
} {
    const led = devices.get("led") as LedBankDevice | undefined;
    const sw = devices.get("switches") as SwitchDevice | undefined;
    const seg = devices.get("seg") as SevenSegDevice | undefined;
    const btn = devices.get("button") as ButtonDevice | undefined;
    const mat = devices.get("matrix") as LedMatrixDevice | undefined;
    const lcd = devices.get("lcd") as Lcd1602Device | undefined;
    const buzzer = devices.get("buzzer") as BuzzerDevice | undefined;
    const pot = devices.get("pot") as PotentiometerDevice | undefined;
    const rgb = devices.get("rgb") as RgbLedDevice | undefined;
    const timer = devices.get("timer") as TimerDevice | undefined;
    return {
        led: led?.getValue() ?? 0,
        switches: sw?.getValue() ?? 0,
        seg: seg?.getState() ?? { value: 0, mode: 0 },
        button: btn?.getPressed() ?? 0,
        matrix: mat?.getRows() ?? [0, 0, 0, 0, 0, 0, 0, 0],
        lcd: lcd?.getState() ?? { text: " ".repeat(32), cursor: 0 },
        buzzer: buzzer?.getOn() ?? 0,
        pot: pot?.getValue() ?? 0,
        rgb: rgb?.getValue() ?? 0,
        timer: timer?.getState() ?? { enabled: 0, period: 0, pending: 0, ticks: 0 },
    };
}
