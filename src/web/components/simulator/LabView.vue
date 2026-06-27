<!--
Copyright 2018-2026 CREATOR Team. LGPL-3.0.
UdL extension (PID RISC-V) — "Lab" view: visual memory-mapped I/O peripherals.
A RISC-V program drives LEDs / a 7-segment / an 8×8 matrix by writing to MMIO
addresses, reads switches with `lw`, and a push-button raises an EXTERNAL interrupt
(ISR). Peripherals update live as you Step/Run, and can be dragged around the canvas.
Visuals use the MIT-licensed @wokwi/elements web components (presentation only);
the simulation runs on CREATOR's own engine (see src/core/executor/devices_udl.mts).
-->
<script lang="ts">
import { defineComponent } from "vue";
import "@wokwi/elements";
import { coreEvents } from "@/core/events.mts";
import { LAB_MMIO, registerUdlDevices, snapshotUdlDevices } from "@/core/executor/devices_udl.mts";

const LS_LAYOUT = "creator-lab-layout";
const hex = (n: number, w = 8) => "0x" + (n >>> 0).toString(16).toUpperCase().padStart(w, "0");
// 7-segment patterns for 0..F: [a,b,c,d,e,f,g]
const SEG7: Record<number, number[]> = {
    0: [1, 1, 1, 1, 1, 1, 0], 1: [0, 1, 1, 0, 0, 0, 0], 2: [1, 1, 0, 1, 1, 0, 1], 3: [1, 1, 1, 1, 0, 0, 1],
    4: [0, 1, 1, 0, 0, 1, 1], 5: [1, 0, 1, 1, 0, 1, 1], 6: [1, 0, 1, 1, 1, 1, 1], 7: [1, 1, 1, 0, 0, 0, 0],
    8: [1, 1, 1, 1, 1, 1, 1], 9: [1, 1, 1, 1, 0, 1, 1], 10: [1, 1, 1, 0, 1, 1, 1], 11: [0, 0, 1, 1, 1, 1, 1],
    12: [1, 0, 0, 1, 1, 1, 0], 13: [0, 1, 1, 1, 1, 0, 1], 14: [1, 0, 0, 1, 1, 1, 1], 15: [1, 0, 0, 0, 1, 1, 1],
};
// default canvas positions (px) for each peripheral
const DEFAULT_POS: Record<string, { x: number; y: number }> = {
    led: { x: 8, y: 8 }, switches: { x: 300, y: 8 }, seg: { x: 8, y: 150 },
    button: { x: 300, y: 150 }, matrix: { x: 560, y: 8 },
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
            mmio: LAB_MMIO,
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
        try {
            const raw = localStorage.getItem(LS_LAYOUT);
            if (raw) this.positions = { ...DEFAULT_POS, ...JSON.parse(raw) };
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
        onOutput(e: { id: string; value?: number; mode?: number; pressed?: number; rows?: number[] }) {
            if (e.id === "led") this.led = e.value ?? 0;
            else if (e.id === "seg") this.seg = { value: e.value ?? 0, mode: e.mode ?? 2 };
            else if (e.id === "button") this.button = e.pressed ?? 0;
            else if (e.id === "matrix") this.matrix = e.rows ?? this.matrix;
        },
        onReset() {
            this.led = 0; this.switches = 0; this.seg = { value: 0, mode: 2 }; this.button = 0;
            this.matrix = [0, 0, 0, 0, 0, 0, 0, 0];
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
            try { localStorage.setItem(LS_LAYOUT, JSON.stringify(this.positions)); } catch { /* ignore */ }
        },
        resetLayout() {
            this.positions = { ...DEFAULT_POS };
            try { localStorage.removeItem(LS_LAYOUT); } catch { /* ignore */ }
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
            <button class="lab-reset" @click="resetLayout">Reordenar</button>
        </div>

        <div ref="canvas" class="lab-canvas" @pointermove="onMove" @pointerup="endDrag" @pointerleave="endDrag">
            <!-- LED bank -->
            <section class="periph" :style="posStyle('led')">
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
            <section class="periph" :style="posStyle('switches')">
                <header @pointerdown.prevent="startDrag('switches', $event)">⠿ Switches <code>{{ hex(mmio.switches.data) }}</code></header>
                <wokwi-dip-switch-8 ref="dip" @switch-change="onSwitch" />
                <div class="val">DATA = {{ hex(switches) }} <span class="muted">(el programa lee con <code>lw</code>)</span></div>
            </section>

            <!-- 7-segment -->
            <section class="periph" :style="posStyle('seg')">
                <header @pointerdown.prevent="startDrag('seg', $event)">⠿ Display 7-seg <code>{{ hex(mmio.seg.data) }}</code></header>
                <wokwi-7segment :digits.prop="4" :values.prop="segValues" color="red" />
                <div class="val">VALUE = {{ hex(seg.value) }} · modo {{ seg.mode === 1 ? 'dec' : 'hex' }}</div>
            </section>

            <!-- Push-button (interrupt) -->
            <section class="periph" :style="posStyle('button')">
                <header @pointerdown.prevent="startDrag('button', $event)">⠿ Pulsador (IRQ) <code>{{ hex(mmio.button.data) }}</code></header>
                <wokwi-pushbutton color="green" :pressed.prop="button === 1"
                                  @button-press="onButton(true)" @button-release="onButton(false)" />
                <div class="val">{{ button ? 'PULSADO' : 'libre' }}
                    <span class="muted">→ interrupción <b>External</b>; ISR vía mtvec (Settings → Interrupt handler → <b>Custom</b>). También sondeable con <code>lw</code>.</span>
                </div>
            </section>

            <!-- LED matrix 8×8 -->
            <section class="periph" :style="posStyle('matrix')">
                <header @pointerdown.prevent="startDrag('matrix', $event)">⠿ Matriz LED 8×8 <code>{{ hex(mmio.matrix.data) }}</code></header>
                <div class="matrix">
                    <template v-for="r in 8" :key="'r' + r">
                        <wokwi-led v-for="c in 8" :key="r + '-' + c" color="red" :value.prop="matrixOn(r - 1, c - 1)" />
                    </template>
                </div>
                <div class="val muted">ROW0..ROW7, MSB = columna izquierda</div>
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
.lab-canvas { position: relative; width: 100%; min-height: 560px; border: 1px dashed rgba(var(--bs-secondary-rgb), 0.3); border-radius: 8px; background: rgba(var(--bs-secondary-rgb), 0.03); overflow: hidden; }
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
