<!--
Copyright 2018-2026 CREATOR Team. LGPL-3.0.
UdL extension (PID RISC-V) — "Lab" view: visual memory-mapped I/O peripherals.
A RISC-V program drives LEDs / 7-segment / 8×8 matrix / LCD 16×2 / buzzer / RGB LED
by writing to MMIO addresses, reads switches and a potentiometer with `lw`, and a
push-button or an interval timer raises an EXTERNAL interrupt (ISR). Peripherals update
live as you Step/Run, can be dragged around the canvas, shown/hidden from a palette, and
the whole board layout can be saved/loaded as `creator-board.json`.
Visuals use the MIT-licensed @wokwi/elements web components (presentation only);
the simulation runs on CREATOR's own engine (see src/core/executor/devices_udl.mts).
-->
<script lang="ts">
import { defineComponent } from "vue";
import "@wokwi/elements";
import { coreEvents } from "@/core/events.mts";
import { LAB_MMIO, registerUdlDevices, snapshotUdlDevices } from "@/core/executor/devices_udl.mts";

const LS_LAYOUT = "creator-lab-layout";
const LS_VISIBLE = "creator-lab-visible";
const BOARD_VERSION = 1;
const hex = (n: number, w = 8) => "0x" + (n >>> 0).toString(16).toUpperCase().padStart(w, "0");
// 7-segment patterns for 0..F: [a,b,c,d,e,f,g]
const SEG7: Record<number, number[]> = {
    0: [1, 1, 1, 1, 1, 1, 0], 1: [0, 1, 1, 0, 0, 0, 0], 2: [1, 1, 0, 1, 1, 0, 1], 3: [1, 1, 1, 1, 0, 0, 1],
    4: [0, 1, 1, 0, 0, 1, 1], 5: [1, 0, 1, 1, 0, 1, 1], 6: [1, 0, 1, 1, 1, 1, 1], 7: [1, 1, 1, 0, 0, 0, 0],
    8: [1, 1, 1, 1, 1, 1, 1], 9: [1, 1, 1, 1, 0, 1, 1], 10: [1, 1, 1, 0, 1, 1, 1], 11: [0, 0, 1, 1, 1, 1, 1],
    12: [1, 0, 0, 1, 1, 1, 0], 13: [0, 1, 1, 1, 1, 0, 1], 14: [1, 0, 0, 1, 1, 1, 1], 15: [1, 0, 0, 0, 1, 1, 1],
};
// peripherals shown in the palette (this array also fixes the palette order)
const PERIPHS: { id: string; label: string }[] = [
    { id: "led", label: "LEDs" }, { id: "switches", label: "Switches" }, { id: "seg", label: "7-seg" },
    { id: "button", label: "Pulsador" }, { id: "matrix", label: "Matriz" }, { id: "lcd", label: "LCD 16×2" },
    { id: "buzzer", label: "Buzzer" }, { id: "pot", label: "Potenciómetro" }, { id: "rgb", label: "RGB" },
    { id: "timer", label: "Timer" },
];
const DEFAULT_VISIBLE: Record<string, boolean> = Object.fromEntries(PERIPHS.map(p => [p.id, true]));
// default canvas positions (px) for each peripheral
const DEFAULT_POS: Record<string, { x: number; y: number }> = {
    led: { x: 8, y: 8 }, switches: { x: 300, y: 8 }, matrix: { x: 560, y: 8 },
    seg: { x: 8, y: 168 }, button: { x: 300, y: 168 }, lcd: { x: 540, y: 210 },
    buzzer: { x: 8, y: 320 }, pot: { x: 150, y: 330 }, rgb: { x: 360, y: 320 }, timer: { x: 500, y: 330 },
};

export default defineComponent({
    props: { dark: { type: Boolean, default: false } },
    data() {
        return {
            led: 0,
            switches: 0,
            seg: { value: 0, mode: 2 },
            button: 0,
            matrix: [0, 0, 0, 0, 0, 0, 0, 0],
            lcd: { text: " ".repeat(32), row0: " ".repeat(16), row1: " ".repeat(16), cursor: 0 },
            buzzer: 0,
            pot: 0,
            rgb: { value: 0, r: 0, g: 0, b: 0 },
            timer: { ticks: 0, period: 0, fired: 0 },
            timerPulse: false,
            mmio: LAB_MMIO,
            periphs: PERIPHS,
            visible: { ...DEFAULT_VISIBLE } as Record<string, boolean>,
            positions: { ...DEFAULT_POS } as Record<string, { x: number; y: number }>,
            drag: null as null | { id: string; ox: number; oy: number; rect: DOMRect },
        };
    },
    computed: {
        ledBits(): number[] {
            return [7, 6, 5, 4, 3, 2, 1, 0]; // bit 7 (left) … bit 0 (right)
        },
        segValues(): number[] {
            const v = this.seg.value >>> 0;
            const out: number[] = [];
            for (let d = 0; d < 4; d++) {
                const nibble = this.seg.mode === 1
                    ? Math.floor(v / Math.pow(10, 3 - d)) % 10
                    : (v >> ((3 - d) * 4)) & 0xf;
                out.push(...SEG7[nibble], 0);
            }
            return out;
        },
    },
    mounted() {
        registerUdlDevices();
        const s = snapshotUdlDevices();
        this.led = s.led; this.switches = s.switches; this.seg = s.seg; this.button = s.button; this.matrix = s.matrix;
        this.lcd = { text: s.lcd.text, row0: s.lcd.text.slice(0, 16), row1: s.lcd.text.slice(16, 32), cursor: s.lcd.cursor };
        this.buzzer = s.buzzer; this.pot = s.pot;
        this.rgb = { value: s.rgb, r: (s.rgb >>> 16) & 0xff, g: (s.rgb >>> 8) & 0xff, b: s.rgb & 0xff };
        this.timer = { ticks: s.timer.ticks, period: s.timer.period, fired: s.timer.pending };
        try {
            const raw = localStorage.getItem(LS_LAYOUT);
            if (raw) this.positions = { ...DEFAULT_POS, ...JSON.parse(raw) };
            const rv = localStorage.getItem(LS_VISIBLE);
            if (rv) this.visible = { ...DEFAULT_VISIBLE, ...JSON.parse(rv) };
        } catch { /* ignore */ }
        (coreEvents as any).on("device-output", this.onOutput);
        (coreEvents as any).on("registers-reset", this.onReset);
    },
    beforeUnmount() {
        (coreEvents as any).off("device-output", this.onOutput);
        (coreEvents as any).off("registers-reset", this.onReset);
    },
    methods: {
        hex,
        onOutput(e: {
            id: string; value?: number; mode?: number; pressed?: number; rows?: number[];
            text?: string; row0?: string; row1?: string; cursor?: number; on?: number;
            r?: number; g?: number; b?: number; ticks?: number; fired?: number; period?: number;
        }) {
            if (e.id === "led") this.led = e.value ?? 0;
            else if (e.id === "seg") this.seg = { value: e.value ?? 0, mode: e.mode ?? 2 };
            else if (e.id === "button") this.button = e.pressed ?? 0;
            else if (e.id === "matrix") this.matrix = e.rows ?? this.matrix;
            else if (e.id === "lcd")
                this.lcd = {
                    text: e.text ?? "", row0: e.row0 ?? "", row1: e.row1 ?? "", cursor: e.cursor ?? 0,
                };
            else if (e.id === "buzzer") this.buzzer = e.on ?? 0;
            else if (e.id === "rgb")
                this.rgb = { value: e.value ?? 0, r: e.r ?? 0, g: e.g ?? 0, b: e.b ?? 0 };
            else if (e.id === "timer") {
                this.timer = { ticks: e.ticks ?? 0, period: e.period ?? this.timer.period, fired: e.fired ?? 0 };
                if (e.fired) this.pulseTimer();
            }
        },
        onReset() {
            this.led = 0; this.switches = 0; this.seg = { value: 0, mode: 2 }; this.button = 0;
            this.matrix = [0, 0, 0, 0, 0, 0, 0, 0];
            this.lcd = { text: " ".repeat(32), row0: " ".repeat(16), row1: " ".repeat(16), cursor: 0 };
            this.buzzer = 0; this.pot = 0; this.rgb = { value: 0, r: 0, g: 0, b: 0 };
            this.timer = { ticks: 0, period: 0, fired: 0 };
            const el = this.$refs.dip as any;
            if (el) el.values = [0, 0, 0, 0, 0, 0, 0, 0];
        },
        ledOn(i: number): boolean { return ((this.led >> i) & 1) === 1; },
        matrixOn(r: number, c: number): boolean { return ((this.matrix[r] >> (7 - c)) & 1) === 1; },
        onSwitch(ev: Event) {
            const vals: number[] = (ev.target as any)?.values ?? [];
            let mask = 0;
            for (let i = 0; i < vals.length; i++) if (vals[i]) mask |= 1 << i;
            this.switches = mask;
            (coreEvents as any).emit("device-input", { id: "switches", value: mask });
        },
        onButton(down: boolean) {
            this.button = down ? 1 : 0;
            (coreEvents as any).emit("device-input", { id: "button", value: down ? 1 : 0 });
        },
        onPot(ev: Event) {
            const v = Math.round((ev as CustomEvent).detail ?? (ev.target as any)?.value ?? 0);
            this.pot = v;
            (coreEvents as any).emit("device-input", { id: "pot", value: v });
        },
        pulseTimer() {
            this.timerPulse = true;
            window.setTimeout(() => { this.timerPulse = false; }, 220);
        },
        // --- palette (show/hide peripherals) ---
        togglePeriph(id: string) {
            this.visible = { ...this.visible, [id]: !this.visible[id] };
            this.persistLayout();
        },
        // --- board.json (save/load the whole layout) ---
        persistLayout() {
            try {
                localStorage.setItem(LS_LAYOUT, JSON.stringify(this.positions));
                localStorage.setItem(LS_VISIBLE, JSON.stringify(this.visible));
            } catch { /* ignore */ }
        },
        exportBoard() {
            const board = { version: BOARD_VERSION, positions: this.positions, visible: this.visible };
            const blob = new Blob([JSON.stringify(board, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = "creator-board.json"; a.click();
            URL.revokeObjectURL(url);
        },
        triggerImport() {
            (this.$refs.boardFile as HTMLInputElement | undefined)?.click();
        },
        importBoard(ev: Event) {
            const input = ev.target as HTMLInputElement;
            const file = input.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const b = JSON.parse(String(reader.result));
                    if (b && typeof b === "object") {
                        if (b.positions) this.positions = { ...DEFAULT_POS, ...b.positions };
                        if (b.visible) this.visible = { ...DEFAULT_VISIBLE, ...b.visible };
                        this.persistLayout();
                    }
                } catch { /* malformed board.json → ignore */ }
            };
            reader.readAsText(file);
            input.value = ""; // allow re-importing the same file
        },
        // --- drag & drop ---
        posStyle(id: string) {
            const p = this.positions[id] ?? { x: 0, y: 0 };
            return { left: p.x + "px", top: p.y + "px" };
        },
        startDrag(id: string, e: PointerEvent) {
            const canvas = this.$refs.canvas as HTMLElement;
            const rect = canvas.getBoundingClientRect();
            const p = this.positions[id] ?? { x: 0, y: 0 };
            this.drag = { id, ox: e.clientX - rect.left - p.x, oy: e.clientY - rect.top - p.y, rect };
            // capture on the CANVAS so its pointermove/up handlers keep firing during the drag
            canvas.setPointerCapture?.(e.pointerId);
        },
        onMove(e: PointerEvent) {
            if (!this.drag) return;
            const { id, ox, oy, rect } = this.drag;
            const x = Math.max(0, e.clientX - rect.left - ox);
            const y = Math.max(0, e.clientY - rect.top - oy);
            this.positions = { ...this.positions, [id]: { x, y } };
        },
        endDrag() {
            if (!this.drag) return;
            this.drag = null;
            this.persistLayout();
        },
        resetLayout() {
            this.positions = { ...DEFAULT_POS };
            this.visible = { ...DEFAULT_VISIBLE };
            try { localStorage.removeItem(LS_LAYOUT); localStorage.removeItem(LS_VISIBLE); } catch { /* ignore */ }
        },
    },
});
</script>

<template>
    <div class="lab-view">
        <div class="lab-head">
            <font-awesome-icon :icon="['fas', 'microchip']" />
            <span class="lab-title">Lab — periféricos de E/S (MMIO)</span>
            <span class="lab-hint">Escribe/lee estas direcciones desde el programa; se actualizan al ejecutar. Arrastra por la cabecera.</span>
            <span class="lab-actions">
                <button class="lab-btn" @click="exportBoard" title="Guardar la placa (posiciones + visibles) en creator-board.json">💾 Guardar placa</button>
                <button class="lab-btn" @click="triggerImport" title="Cargar una placa desde creator-board.json">📂 Cargar placa</button>
                <button class="lab-btn" @click="resetLayout" title="Restaurar posiciones y mostrar todos los periféricos">↺ Reordenar</button>
                <input ref="boardFile" type="file" accept="application/json,.json" class="board-file" @change="importBoard" />
            </span>
        </div>

        <div class="lab-palette">
            <span class="palette-label">Paleta:</span>
            <button v-for="p in periphs" :key="'pal' + p.id" class="chip" :class="{ off: !visible[p.id] }"
                    @click="togglePeriph(p.id)" :title="(visible[p.id] ? 'Ocultar ' : 'Mostrar ') + p.label">
                <span class="chip-dot" /> {{ p.label }}
            </button>
        </div>

        <div ref="canvas" class="lab-canvas" @pointermove="onMove" @pointerup="endDrag" @pointerleave="endDrag">
            <!-- LED bank -->
            <section v-if="visible['led']" class="periph" :style="posStyle('led')">
                <header @pointerdown.prevent="startDrag('led', $event)">⠿ Banco de LEDs <code>{{ hex(mmio.led.data) }}</code></header>
                <div class="leds">
                    <div v-for="i in ledBits" :key="'led' + i" class="led-cell">
                        <wokwi-led color="red" :value.prop="ledOn(i)" />
                        <span class="bit">{{ i }}</span>
                    </div>
                </div>
                <div class="val">DATA = {{ hex(led) }} <span class="muted">(1 bit por LED)</span></div>
            </section>

            <!-- Switches -->
            <section v-if="visible['switches']" class="periph" :style="posStyle('switches')">
                <header @pointerdown.prevent="startDrag('switches', $event)">⠿ Switches <code>{{ hex(mmio.switches.data) }}</code></header>
                <wokwi-dip-switch-8 ref="dip" @switch-change="onSwitch" />
                <div class="val">DATA = {{ hex(switches) }} <span class="muted">(el programa lee con <code>lw</code>)</span></div>
            </section>

            <!-- 7-segment -->
            <section v-if="visible['seg']" class="periph" :style="posStyle('seg')">
                <header @pointerdown.prevent="startDrag('seg', $event)">⠿ Display 7-seg <code>{{ hex(mmio.seg.data) }}</code></header>
                <wokwi-7segment :digits.prop="4" :values.prop="segValues" color="red" />
                <div class="val">VALUE = {{ hex(seg.value) }} · modo {{ seg.mode === 1 ? 'dec' : 'hex' }}</div>
            </section>

            <!-- Push-button (interrupt) -->
            <section v-if="visible['button']" class="periph" :style="posStyle('button')">
                <header @pointerdown.prevent="startDrag('button', $event)">⠿ Pulsador (IRQ) <code>{{ hex(mmio.button.data) }}</code></header>
                <wokwi-pushbutton color="green" :pressed.prop="button === 1"
                                  @button-press="onButton(true)" @button-release="onButton(false)" />
                <div class="val">{{ button ? 'PULSADO' : 'libre' }}
                    <span class="muted">→ interrupción <b>External</b>; ISR vía mtvec (Settings → Interrupt handler → <b>Custom</b>). También sondeable con <code>lw</code>.</span>
                </div>
            </section>

            <!-- LED matrix 8×8 -->
            <section v-if="visible['matrix']" class="periph" :style="posStyle('matrix')">
                <header @pointerdown.prevent="startDrag('matrix', $event)">⠿ Matriz LED 8×8 <code>{{ hex(mmio.matrix.data) }}</code></header>
                <div class="matrix">
                    <template v-for="r in 8" :key="'r' + r">
                        <wokwi-led v-for="c in 8" :key="r + '-' + c" color="red" :value.prop="matrixOn(r - 1, c - 1)" />
                    </template>
                </div>
                <div class="val muted">ROW0..ROW7, MSB = columna izquierda</div>
            </section>

            <!-- LCD 16×2 -->
            <section v-if="visible['lcd']" class="periph" :style="posStyle('lcd')">
                <header @pointerdown.prevent="startDrag('lcd', $event)">⠿ LCD 16×2 <code>{{ hex(mmio.lcd.data) }}</code></header>
                <wokwi-lcd1602 :text.prop="lcd.text" background="#1c8" color="#003" />
                <div class="val">
                    <div class="lcd-mirror">[{{ lcd.row0 }}]<br />[{{ lcd.row1 }}]</div>
                    <span class="muted">CTRL: 1=escribe DATA, 2=borra, 3=cursor a DATA</span>
                </div>
            </section>

            <!-- Buzzer -->
            <section v-if="visible['buzzer']" class="periph" :style="posStyle('buzzer')">
                <header @pointerdown.prevent="startDrag('buzzer', $event)">⠿ Buzzer <code>{{ hex(mmio.buzzer.data) }}</code></header>
                <wokwi-buzzer :has-signal.prop="buzzer === 1" />
                <div class="val">{{ buzzer ? 'SONANDO' : 'silencio' }} <span class="muted">(DATA bit0)</span></div>
            </section>

            <!-- Potentiometer (analog input) -->
            <section v-if="visible['pot']" class="periph" :style="posStyle('pot')">
                <header @pointerdown.prevent="startDrag('pot', $event)">⠿ Potenciómetro <code>{{ hex(mmio.pot.data) }}</code></header>
                <wokwi-potentiometer :value.prop="pot" @input="onPot" />
                <div class="val">DATA = {{ pot }} <span class="muted">(0..1023; el programa lo lee con <code>lw</code>)</span></div>
            </section>

            <!-- RGB LED (NeoPixel) -->
            <section v-if="visible['rgb']" class="periph" :style="posStyle('rgb')">
                <header @pointerdown.prevent="startDrag('rgb', $event)">⠿ LED RGB <code>{{ hex(mmio.rgb.data) }}</code></header>
                <wokwi-neopixel :r.prop="rgb.r" :g.prop="rgb.g" :b.prop="rgb.b" />
                <div class="val">DATA = {{ hex(rgb.value, 6) }}
                    <span class="muted">(0x00RRGGBB) · r{{ rgb.r }} g{{ rgb.g }} b{{ rgb.b }}</span>
                </div>
            </section>

            <!-- Interval timer (IRQ) -->
            <section v-if="visible['timer']" class="periph" :style="posStyle('timer')">
                <header @pointerdown.prevent="startDrag('timer', $event)">⠿ Timer (IRQ) <code>{{ hex(mmio.timer.data) }}</code></header>
                <div class="timer-face">
                    <span class="timer-dot" :class="{ pulse: timerPulse }" />
                    <span class="timer-ticks">{{ timer.ticks }}</span>
                </div>
                <div class="val">ticks = {{ timer.ticks }} · periodo = {{ timer.period }}
                    <span class="muted">CTRL bit0=on, DATA=ciclos → interrupción <b>External</b> cada periodo (handler <b>Custom</b>); STATUS bit0 sondeable</span>
                </div>
            </section>
        </div>

        <!-- MMIO map -->
        <table class="mmio">
            <thead><tr><th>Periférico</th><th>DATA</th><th>CTRL</th><th>STATUS</th></tr></thead>
            <tbody>
                <tr><td>LED bank</td><td><code>{{ hex(mmio.led.data) }}</code></td><td><code>{{ hex(mmio.led.ctrl) }}</code></td><td><code>{{ hex(mmio.led.status) }}</code></td></tr>
                <tr><td>Switches</td><td><code>{{ hex(mmio.switches.data) }}</code></td><td><code>{{ hex(mmio.switches.ctrl) }}</code></td><td><code>{{ hex(mmio.switches.status) }}</code></td></tr>
                <tr><td>7-seg</td><td><code>{{ hex(mmio.seg.data) }}</code></td><td><code>{{ hex(mmio.seg.ctrl) }}</code> (modo)</td><td><code>{{ hex(mmio.seg.status) }}</code></td></tr>
                <tr><td>Pulsador</td><td><code>{{ hex(mmio.button.data) }}</code> (bit0=pulsado)</td><td><code>{{ hex(mmio.button.ctrl) }}</code></td><td><code>{{ hex(mmio.button.status) }}</code></td></tr>
                <tr><td>Matriz</td><td><code>{{ hex(mmio.matrix.data) }}</code> (ROW0, +4/fila)</td><td><code>{{ hex(mmio.matrix.ctrl) }}</code></td><td><code>{{ hex(mmio.matrix.status) }}</code></td></tr>
                <tr><td>LCD 16×2</td><td><code>{{ hex(mmio.lcd.data) }}</code> (char/pos)</td><td><code>{{ hex(mmio.lcd.ctrl) }}</code> (1=char,2=clr,3=cur)</td><td><code>{{ hex(mmio.lcd.status) }}</code></td></tr>
                <tr><td>Buzzer</td><td><code>{{ hex(mmio.buzzer.data) }}</code> (bit0=on)</td><td><code>{{ hex(mmio.buzzer.ctrl) }}</code></td><td><code>{{ hex(mmio.buzzer.status) }}</code></td></tr>
                <tr><td>Potenciómetro</td><td><code>{{ hex(mmio.pot.data) }}</code> (0..1023, entrada)</td><td><code>{{ hex(mmio.pot.ctrl) }}</code></td><td><code>{{ hex(mmio.pot.status) }}</code></td></tr>
                <tr><td>LED RGB</td><td><code>{{ hex(mmio.rgb.data) }}</code> (0x00RRGGBB)</td><td><code>{{ hex(mmio.rgb.ctrl) }}</code></td><td><code>{{ hex(mmio.rgb.status) }}</code></td></tr>
                <tr><td>Timer</td><td><code>{{ hex(mmio.timer.data) }}</code> (periodo)</td><td><code>{{ hex(mmio.timer.ctrl) }}</code> (bit0=on)</td><td><code>{{ hex(mmio.timer.status) }}</code> (bit0=pend)</td></tr>
            </tbody>
        </table>
        <p class="credit">Visuales: <a href="https://github.com/wokwi/wokwi-elements" target="_blank" rel="noopener">@wokwi/elements</a> (MIT). Simulación: motor de CREATOR.</p>
    </div>
</template>

<style scoped>
.lab-view { width: 100%; display: flex; flex-direction: column; gap: 12px; padding: 4px; }
.lab-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.lab-title { font-weight: 700; }
.lab-hint { font-size: 0.72rem; color: rgba(var(--bs-body-color-rgb), 0.6); font-style: italic; }
.lab-reset { margin-left: auto; border: 1px solid rgba(var(--bs-secondary-rgb), 0.4); background: rgba(var(--bs-secondary-rgb), 0.1); color: rgba(var(--bs-body-color-rgb), 0.9); border-radius: 5px; padding: 2px 10px; cursor: pointer; font-size: 0.72rem; font-weight: 600; }
.lab-reset:hover { background: rgba(var(--bs-primary-rgb), 0.15); color: rgba(var(--bs-primary-rgb), 1); }
.lab-canvas { position: relative; width: 100%; min-height: 660px; border: 1px dashed rgba(var(--bs-secondary-rgb), 0.3); border-radius: 8px; background: rgba(var(--bs-secondary-rgb), 0.03); overflow: hidden; }
.lab-actions { margin-left: auto; display: flex; gap: 6px; align-items: center; }
.lab-btn { border: 1px solid rgba(var(--bs-secondary-rgb), 0.4); background: rgba(var(--bs-secondary-rgb), 0.1); color: rgba(var(--bs-body-color-rgb), 0.9); border-radius: 5px; padding: 2px 10px; cursor: pointer; font-size: 0.72rem; font-weight: 600; }
.lab-btn:hover { background: rgba(var(--bs-primary-rgb), 0.15); color: rgba(var(--bs-primary-rgb), 1); }
.board-file { display: none; }
.lab-palette { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.palette-label { font-size: 0.72rem; font-weight: 700; color: rgba(var(--bs-body-color-rgb), 0.7); }
.chip { display: inline-flex; align-items: center; gap: 5px; border: 1px solid rgba(var(--bs-primary-rgb), 0.4); background: rgba(var(--bs-primary-rgb), 0.1); color: rgba(var(--bs-body-color-rgb), 0.9); border-radius: 12px; padding: 2px 10px; cursor: pointer; font-size: 0.7rem; font-weight: 600; }
.chip .chip-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--bs-primary); }
.chip.off { border-color: rgba(var(--bs-secondary-rgb), 0.35); background: rgba(var(--bs-secondary-rgb), 0.08); color: rgba(var(--bs-body-color-rgb), 0.45); text-decoration: line-through; }
.chip.off .chip-dot { background: rgba(var(--bs-body-color-rgb), 0.3); }
.lcd-mirror { font-family: ui-monospace, monospace; white-space: pre; letter-spacing: 1px; background: rgba(var(--bs-body-color-rgb), 0.06); padding: 2px 4px; border-radius: 4px; display: inline-block; margin-bottom: 4px; }
.timer-face { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
.timer-dot { width: 18px; height: 18px; border-radius: 50%; background: rgba(var(--bs-secondary-rgb), 0.3); }
.timer-dot.pulse { background: var(--bs-danger); animation: timer-ping 0.22s ease-out; }
@keyframes timer-ping { 0% { box-shadow: 0 0 0 0 rgba(var(--bs-danger-rgb), 0.6); } 100% { box-shadow: 0 0 0 12px rgba(var(--bs-danger-rgb), 0); } }
.timer-ticks { font-family: ui-monospace, monospace; font-size: 1.2rem; font-weight: 700; }
.periph { position: absolute; border: 1px solid rgba(var(--bs-secondary-rgb), 0.35); border-radius: 8px; padding: 0 12px 10px; background: var(--bs-body-bg); box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
.periph header { font-size: 0.8rem; font-weight: 700; margin: 0 -12px 8px; padding: 6px 12px; display: flex; gap: 8px; align-items: baseline; cursor: grab; background: rgba(var(--bs-secondary-rgb), 0.08); border-radius: 8px 8px 0 0; user-select: none; }
.periph header:active { cursor: grabbing; }
.periph header code { font-size: 0.7rem; color: rgba(var(--bs-primary-rgb), 1); }
.leds { display: flex; gap: 4px; align-items: flex-end; }
.led-cell { display: flex; flex-direction: column; align-items: center; }
.led-cell .bit { font-size: 0.6rem; color: rgba(var(--bs-body-color-rgb), 0.6); font-family: ui-monospace, monospace; }
.matrix { display: grid; grid-template-columns: repeat(8, 1fr); gap: 0; width: max-content; }
.matrix wokwi-led { transform: scale(0.5); margin: -7px; }
.val { margin-top: 8px; font-size: 0.74rem; font-family: ui-monospace, monospace; max-width: 240px; }
.muted { color: rgba(var(--bs-body-color-rgb), 0.55); font-family: inherit; }
.mmio { border-collapse: collapse; font-size: 0.72rem; }
.mmio th, .mmio td { border: 1px solid rgba(var(--bs-body-color-rgb), 0.12); padding: 3px 9px; text-align: left; }
.mmio th { background: rgba(var(--bs-secondary-rgb), 0.1); font-weight: 700; }
.mmio code { color: rgba(var(--bs-primary-rgb), 1); }
.credit { font-size: 0.66rem; color: rgba(var(--bs-body-color-rgb), 0.5); margin: 0; }
</style>
