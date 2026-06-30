<!--
Copyright 2018-2026 CREATOR Team. LGPL-3.0.
UdL extension (PID RISC-V) — Cycle/pipeline timeline (WinMIPS64-style).
Renders the instruction×cycle grid + statistics from a PURE timing model
(`pipelineModel`) over the executed-instruction stream (`executionHistory`).
The engine is unchanged; timing is post-hoc, so changing the configuration
recomputes the diagram INSTANTLY without re-running the program.
-->
<script lang="ts">
import { defineComponent } from "vue";
import { coreEvents } from "@/core/events.mts";
import { architecture } from "@/core/core.mjs";
import { DATAPATH_TRACE_EVENT } from "@/core/trace/datapathTrace.mts";
import { getExecutionHistory } from "@/core/trace/executionHistory.mts";
import {
    schedulePipeline,
    buildPipeInstr,
    DEFAULT_PIPELINE_CONFIG,
    type PipelineConfig,
    type PipelineSchedule,
} from "@/core/trace/pipelineModel.mts";

type BranchStage = "ID" | "EX" | "MEM";
interface CyclesConfig {
    forwarding: boolean;
    btb: boolean;
    delaySlot: boolean;
    branchStage: BranchStage;
    fpAddLatency: number;
    mulLatency: number;
    divLatency: number;
}
const DEFAULTS: CyclesConfig = {
    forwarding: DEFAULT_PIPELINE_CONFIG.forwarding,
    btb: false,
    delaySlot: false,
    branchStage: "ID", // P&H COD textbook: branch resolved in ID → 1-cycle penalty
    fpAddLatency: DEFAULT_PIPELINE_CONFIG.fpAddLatency,
    mulLatency: DEFAULT_PIPELINE_CONFIG.mulLatency,
    divLatency: DEFAULT_PIPELINE_CONFIG.divLatency,
};
const LS_KEY = "creator-cycles-config";
const MAX_ROWS = 250;

const PRESETS: Record<string, CyclesConfig> = {
    "P&H textbook": { forwarding: true, btb: false, delaySlot: false, branchStage: "ID", fpAddLatency: 4, mulLatency: 7, divLatency: 24 },
    "MIPS classic": { forwarding: true, btb: false, delaySlot: true, branchStage: "ID", fpAddLatency: 4, mulLatency: 7, divLatency: 24 },
    "No forwarding": { forwarding: false, btb: false, delaySlot: false, branchStage: "ID", fpAddLatency: 4, mulLatency: 7, divLatency: 24 },
    "Predicted (BTB)": { forwarding: true, btb: true, delaySlot: false, branchStage: "ID", fpAddLatency: 4, mulLatency: 7, divLatency: 24 },
};

export default defineComponent({
    props: {
        dark: { type: Boolean, default: false },
    },
    data() {
        return {
            config: { ...DEFAULTS } as CyclesConfig,
            version: 0, // bumped on each trace/reset to recompute the schedule
            showConfig: false,
            studentMode: false,
            presets: PRESETS,
            tip: { show: false, text: "", x: 0, y: 0 },
            cursor: 1, // current cycle (manual ▶ step, or following CREATOR's Step)
            live: false, // false = step mode (start at cycle 1); true = show the full timeline
        };
    },
    mounted() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) this.config = { ...DEFAULTS, ...JSON.parse(raw) };
        } catch {
            /* ignore */
        }
        (coreEvents as any).on(DATAPATH_TRACE_EVENT, this.onChange);
        (coreEvents as any).on("registers-reset", this.onReset);
        this.$nextTick(() => this.scrollToCursor());
    },
    beforeUnmount() {
        (coreEvents as any).off(DATAPATH_TRACE_EVENT, this.onChange);
        (coreEvents as any).off("registers-reset", this.onReset);
    },
    watch: {
        config: {
            deep: true,
            handler(v: CyclesConfig) {
                try {
                    localStorage.setItem(LS_KEY, JSON.stringify(v));
                } catch {
                    /* ignore */
                }
            },
        },
        displayMaxCycle() {
            // in live mode keep the most recent cycles in view as the timeline grows
            this.$nextTick(() => {
                if (this.live) this.scrollRight();
            });
        },
    },
    computed: {
        /** Delay slot is a MIPS feature; RISC-V and ARM dropped it (P&H COD-RISCV §4.6
         *  Elaboration: "the solution actually used by the MIPS architecture"). Only MIPS
         *  exposes/applies it here. */
        isMips(): boolean {
            void this.version;
            return String((architecture as any)?.config?.plugin ?? "").toLowerCase() === "mips";
        },
        /** Delay slot only takes effect on MIPS, regardless of a stored MIPS-preset value. */
        effectiveDelaySlot(): boolean {
            return this.isMips && this.config.delaySlot;
        },
        schedule(): PipelineSchedule {
            // touch `version` so the (impure) history read recomputes on new traces
            void this.version;
            // read each config field explicitly so the computed tracks them all
            const cfg: PipelineConfig = {
                ...DEFAULT_PIPELINE_CONFIG,
                forwarding: this.config.forwarding,
                btb: this.config.btb,
                delaySlot: this.effectiveDelaySlot,
                branchStage: this.config.branchStage,
                fpAddLatency: this.config.fpAddLatency,
                mulLatency: this.config.mulLatency,
                divLatency: this.config.divLatency,
            };
            const instrs = getExecutionHistory().map((t, i) => buildPipeInstr(t, i));
            return schedulePipeline(instrs, cfg);
        },
        hasData(): boolean {
            return this.schedule.rows.length > 0;
        },
        truncated(): boolean {
            return this.schedule.rows.length > MAX_ROWS;
        },
        gridRows(): { instr: any; byCycle: Map<number, any> }[] {
            return this.schedule.rows.slice(0, MAX_ROWS).map(r => {
                const byCycle = new Map<number, any>();
                for (const c of r.cells) byCycle.set(c.cycle, c);
                return { instr: r.instr, byCycle };
            });
        },
        displayMaxCycle(): number {
            let m = 0;
            for (const r of this.schedule.rows.slice(0, MAX_ROWS)) {
                if (r.lastCycle > m) m = r.lastCycle;
            }
            return m;
        },
        cycleCols(): number[] {
            return Array.from({ length: this.displayMaxCycle }, (_, i) => i + 1);
        },
        /** The cycle the cursor is on: follows the latest cycle in "live" mode. */
        cursorCycle(): number {
            const max = this.displayMaxCycle;
            if (max <= 0) return 0;
            return this.live ? max : Math.min(Math.max(this.cursor, 1), max);
        },
        /** Pipeline-window occupancy at the cursor cycle (one instruction per stage box). */
        pipelineBoxes(): { id: string; occupant: string; unit: string; stalled: boolean }[] {
            const cyc = this.cursorCycle;
            const groups: Record<string, { occupant: string; unit: string; stalled: boolean }> = {};
            for (const gr of this.gridRows) {
                const cell = gr.byCycle.get(cyc);
                if (!cell) continue;
                let g = cell.stage as string;
                let unit = "";
                if (cell.stalled) {
                    g = "ID";
                } else if (g === "EX" || g === "DIV" || g[0] === "M" || g[0] === "A") {
                    unit = g === "EX" ? "" : g;
                    g = "EX";
                }
                if (!groups[g]) {
                    groups[g] = { occupant: gr.instr.mnemonic || gr.instr.asm, unit, stalled: !!cell.stalled };
                }
            }
            return ["IF", "ID", "EX", "MEM", "WB"].map(id => ({
                id,
                occupant: groups[id]?.occupant ?? "",
                unit: groups[id]?.unit ?? "",
                stalled: groups[id]?.stalled ?? false,
            }));
        },
        stats() {
            return this.schedule.stats;
        },
        cpiText(): string {
            return this.stats.instructions > 0 ? this.stats.cpi.toFixed(3) : "—";
        },
        forwards() {
            return this.schedule.forwards;
        },
        fwdSrc(): Set<string> {
            return new Set(this.forwards.map(f => f.fromIndex + ":" + f.fromCycle));
        },
        fwdDst(): Set<string> {
            return new Set(this.forwards.map(f => f.toIndex + ":" + f.toCycle));
        },
        /** Tooltip text per cell key (index:cycle) describing the forward(s). */
        fwdInfo(): Map<string, string> {
            const m = new Map<string, string[]>();
            const push = (k: string, s: string) => { (m.get(k) ?? m.set(k, []).get(k)!).push(s); };
            for (const f of this.forwards) {
                push(f.fromIndex + ":" + f.fromCycle, `→ forwarding ${f.reg} a la instrucción ${f.toIndex + 1}`);
                push(f.toIndex + ":" + f.toCycle, `← ${f.reg} reenviado desde la instrucción ${f.fromIndex + 1} (${f.fromStage})${f.loadUse ? " — load-use: 1 burbuja" : ""}`);
            }
            return new Map([...m].map(([k, v]) => [k, v.join("\n")]));
        },
    },
    methods: {
        // A new instruction was executed by CREATOR (one engine Step = one instruction).
        // In step mode the cursor FOLLOWS the engine: it advances to the cycle in which
        // the just-executed instruction enters the pipeline (its IF), so pressing CREATOR's
        // Step visibly advances the pipeline one issue at a time. Use ▶ for a finer,
        // cycle-by-cycle walk (IF→ID→EX→MEM→WB) within/after that.
        onChange() {
            this.version++;
            if (!this.live) {
                this.$nextTick(() => {
                    const rows = this.schedule.rows;
                    if (rows.length) this.cursor = rows[rows.length - 1].firstCycle;
                    this.scrollToCursor();
                });
            }
        },
        // Program reset → restart the pipeline view at cycle 1 (step mode).
        onReset() {
            this.version++;
            this.live = false;
            this.cursor = 1;
            this.$nextTick(() => this.scrollToCursor());
        },
        // Jump back to the first cycle (instruction 1 in IF) and step forward from there.
        cursorToStart() {
            this.live = false;
            this.cursor = 1;
            this.$nextTick(() => this.scrollToCursor());
        },
        isFwdSrc(gr: any, c: number): boolean {
            return this.fwdSrc.has(gr.instr.index + ":" + c);
        },
        isFwdDst(gr: any, c: number): boolean {
            return this.fwdDst.has(gr.instr.index + ":" + c);
        },
        fwdTitle(gr: any, c: number): string {
            return this.fwdInfo.get(gr.instr.index + ":" + c) ?? "";
        },
        scrollRight() {
            const el = this.$refs.scroller as HTMLElement | undefined;
            if (el) el.scrollLeft = el.scrollWidth;
        },
        scrollToCursor() {
            const el = this.$refs.scroller as HTMLElement | undefined;
            if (!el || this.displayMaxCycle <= 0) return;
            const frac = this.cursorCycle / this.displayMaxCycle;
            el.scrollLeft = frac * (el.scrollWidth - el.clientWidth);
        },
        stepCursor(delta: number) {
            const base = this.cursorCycle;
            this.live = false;
            this.cursor = Math.min(Math.max(base + delta, 1), this.displayMaxCycle);
            this.$nextTick(() => this.scrollToCursor());
        },
        goLive() {
            this.live = true;
            this.$nextTick(() => this.scrollRight());
        },
        stallTitle(cell: { stallKind?: string; waitFor?: string; readyCycle?: number }): string {
            if (cell.stallKind === "Str") {
                return cell.readyCycle != null
                    ? `Structural stall — divider busy, free in cycle ${cell.readyCycle}`
                    : "Structural stall";
            }
            if (cell.stallKind === "WAW") {
                return (
                    `WAW stall — write to ${cell.waitFor} kept in order` +
                    (cell.readyCycle != null ? ` (earlier writer commits in cycle ${cell.readyCycle})` : "")
                );
            }
            if (cell.stallKind === "WAR") {
                return `WAR stall — ${cell.waitFor ?? "register"}`;
            }
            if (cell.waitFor) {
                return (
                    `RAW stall — waiting for ${cell.waitFor}` +
                    (cell.readyCycle != null ? ` (ready in cycle ${cell.readyCycle})` : "")
                );
            }
            return "Stall";
        },
        applyPreset(name: string) {
            const p = PRESETS[name];
            if (p) this.config = { ...p };
        },
        resetConfig() {
            this.config = { ...DEFAULTS };
        },
        cellAt(gr: { byCycle: Map<number, any> }, cycle: number) {
            return gr.byCycle.get(cycle);
        },
        stageClass(stage: string): string {
            if (stage === "IF") return "c-if";
            if (stage === "ID") return "c-id";
            if (stage === "EX") return "c-ex";
            if (stage === "DIV") return "c-div";
            if (stage === "MEM") return "c-mem";
            if (stage === "WB") return "c-wb";
            if (stage[0] === "M") return "c-mul";
            if (stage[0] === "A") return "c-fpadd";
            return "";
        },
        showTip(ev: MouseEvent, cell: { stallKind?: string; waitFor?: string; readyCycle?: number }) {
            this.tip = { show: true, text: this.stallTitle(cell), x: ev.clientX, y: ev.clientY };
        },
        moveTip(ev: MouseEvent) {
            if (this.tip.show) {
                this.tip.x = ev.clientX;
                this.tip.y = ev.clientY;
            }
        },
        hideTip() {
            this.tip.show = false;
        },
    },
});
</script>

<template>
    <div class="cyc-view">
        <!-- Toolbar -->
        <div class="cyc-toolbar">
            <button class="cyc-gear" :class="{ active: showConfig }" title="Pipeline configuration" @click="showConfig = !showConfig">
                <font-awesome-icon :icon="['fas', 'gear']" /> Pipeline config
            </button>
            <button class="cyc-gear" :class="{ active: studentMode }" title="Student mode: stalls show which register is awaited and when" @click="studentMode = !studentMode">
                <font-awesome-icon :icon="['fas', 'graduation-cap']" /> Student
            </button>
            <span class="cyc-hint">Recomputes instantly — no re-run needed.</span>
        </div>

        <!-- Configuration panel (the "Set Architecture" knobs) -->
        <div v-if="showConfig" class="cyc-settings">
            <div class="cyc-row">
                <label class="cyc-chk"><input type="checkbox" v-model="config.forwarding" /> Enable forwarding</label>
                <button v-for="(p, name) in presets" :key="name" class="cyc-preset" @click="applyPreset(name)">{{ name }}</button>
                <button class="cyc-reset" @click="resetConfig">Reset</button>
            </div>
            <div class="cyc-row">
                <label>FP Add latency</label>
                <input type="number" min="1" max="12" v-model.number="config.fpAddLatency" />
                <label>Multiplier latency</label>
                <input type="number" min="1" max="12" v-model.number="config.mulLatency" />
                <label>Division latency</label>
                <input type="number" min="1" max="40" v-model.number="config.divLatency" />
            </div>
            <div class="cyc-row">
                <label class="cyc-chk"><input type="checkbox" v-model="config.btb" /> Branch Target Buffer</label>
                <label class="cyc-chk" :class="{ disabled: !isMips }" :title="isMips ? '' : 'El delay slot es propio de MIPS; RISC-V y ARM no lo tienen'">
                    <input type="checkbox" :checked="effectiveDelaySlot" :disabled="!isMips"
                           @change="config.delaySlot = ($event.target as HTMLInputElement).checked" />
                    Delay slot <span v-if="!isMips" class="cyc-muted">(solo MIPS)</span>
                </label>
                <label class="cyc-sel" title="Etapa donde se resuelve el salto (predict-not-taken), según P&H COD: ID=1, EX=2, MEM=3 burbujas">
                    Branch resuelto en
                    <select v-model="config.branchStage">
                        <option value="ID">ID (1 ciclo · P&H)</option>
                        <option value="EX">EX (2 ciclos · WinMIPS64)</option>
                        <option value="MEM">MEM (3 ciclos · base)</option>
                    </select>
                </label>
            </div>
        </div>

        <!-- Empty state -->
        <p v-if="!hasData" class="cyc-empty">
            Run a program (<b>Step</b> or <b>Run</b>) to see the pipeline cycle timeline.
        </p>

        <template v-else>
            <!-- Statistics -->
            <div class="cyc-stats">
                <div class="stat"><div class="n">{{ stats.cycles }}</div><div class="l">Cycles</div></div>
                <div class="stat"><div class="n">{{ stats.instructions }}</div><div class="l">Instructions</div></div>
                <div class="stat hi"><div class="n">{{ cpiText }}</div><div class="l">CPI</div></div>
                <div class="stat"><div class="n">{{ stats.codeSize }}</div><div class="l">Code size (instr)</div></div>
                <div class="stat"><div class="n">{{ stats.rawStalls }}</div><div class="l">RAW stalls</div></div>
                <div class="stat"><div class="n">{{ stats.structStalls }}</div><div class="l">Structural stalls</div></div>
                <div class="stat"><div class="n">{{ stats.wawStalls }}</div><div class="l">WAW stalls</div></div>
                <div class="stat"><div class="n">{{ stats.warStalls }}</div><div class="l">WAR stalls</div></div>
                <div class="stat"><div class="n">{{ stats.branchTakenStalls }}</div><div class="l">Branch-taken stalls</div></div>
                <div class="stat"><div class="n">{{ stats.branchMispredStalls }}</div><div class="l">Branch-mispred stalls</div></div>
            </div>

            <!-- Legend -->
            <div class="cyc-legend">
                <span class="lg c-if">IF</span><span class="lg c-id">ID</span><span class="lg c-ex">EX</span>
                <span class="lg c-mul">M*</span><span class="lg c-fpadd">A*</span><span class="lg c-div">DIV</span>
                <span class="lg c-mem">MEM</span><span class="lg c-wb">WB</span><span class="lg c-stall">stall</span>
                <span class="lg lg-fwd">forward</span>
                <span v-if="forwards.length" class="lg-fwdn">{{ forwards.length }} forwarding(s) — pasa el ratón por las celdas marcadas</span>
            </div>

            <p class="cyc-cap">
                One row per <b>executed instruction</b> — each <b>Step</b> runs one full instruction and the grid grows.
                Rows overlap like a real pipeline: instruction <i>i</i>+1 is fetched (IF) while <i>i</i> is decoding (ID).
                A lone instruction takes 5 cycles to drain the pipeline (CPI 5); CPI approaches 1 as more instructions overlap.
            </p>

            <p v-if="studentMode" class="cyc-student-hint">
                Student mode: each <b>stall</b> shows the register the instruction is waiting for — hover it to see in which cycle that value becomes available.
            </p>
            <p v-if="truncated" class="cyc-trunc">Showing the first {{ gridRows.length }} of {{ schedule.rows.length }} instructions.</p>

            <!-- Cycle-by-cycle cursor (WinMIPS64-style: advance one clock at a time) -->
            <div class="cyc-cursor">
                <span class="cyc-cursor-lbl">Cycle step</span>
                <button class="cyc-cbtn" :disabled="cursorCycle <= 1" title="Back to cycle 1 (IF of instr. 1)" @click="cursorToStart">⏮</button>
                <button class="cyc-cbtn" :disabled="cursorCycle <= 1" title="Previous cycle" @click="stepCursor(-1)">◀</button>
                <span class="cyc-cnow">{{ cursorCycle }} / {{ displayMaxCycle }}</span>
                <button class="cyc-cbtn" :disabled="cursorCycle >= displayMaxCycle" title="Next clock cycle" @click="stepCursor(1)">▶</button>
                <button class="cyc-cbtn cyc-clive" :class="{ active: live }" title="Show the whole timeline" @click="goLive">Live</button>
                <span class="cyc-cursor-hint">▶ = un ciclo de reloj (IF→ID→EX→MEM→WB); el Step de CREATOR avanza una instrucción (entra en IF); Live = todo</span>
            </div>

            <!-- Pipeline window: which instruction is in each stage at the cursor cycle -->
            <div class="cyc-pipe">
                <div
                    v-for="b in pipelineBoxes"
                    :key="b.id"
                    class="pbox"
                    :class="['p-' + b.id.toLowerCase(), { occ: !!b.occupant, stl: b.stalled }]"
                >
                    <div class="pstage">{{ b.id }}<span v-if="b.unit" class="punit"> · {{ b.unit }}</span></div>
                    <div class="pocc">{{ b.occupant || '—' }}<span v-if="b.stalled"> · stall</span></div>
                </div>
            </div>

            <!-- Instruction × cycle grid -->
            <div class="cyc-scroll" ref="scroller">
                <table class="cyc-grid">
                    <thead>
                        <tr>
                            <th class="cyc-corner">Instruction</th>
                            <th v-for="c in cycleCols" :key="'h' + c" class="cyc-cnum" :class="{ now: c === cursorCycle }">{{ c }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(gr, ri) in gridRows" :key="ri">
                            <th class="cyc-asm">{{ gr.instr.asm }}</th>
                            <td v-for="c in cycleCols" :key="ri + '-' + c" class="cyc-cell">
                                <template v-if="cellAt(gr, c) && c <= cursorCycle">
                                    <div
                                        v-if="cellAt(gr, c).stalled"
                                        class="stg c-stall"
                                        :class="{ now: c === cursorCycle }"
                                        @mouseenter="showTip($event, cellAt(gr, c))"
                                        @mousemove="moveTip($event)"
                                        @mouseleave="hideTip"
                                    >{{ studentMode && cellAt(gr, c).waitFor ? cellAt(gr, c).waitFor : cellAt(gr, c).stallKind }}</div>
                                    <div v-else class="stg"
                                        :class="[stageClass(cellAt(gr, c).stage), { now: c === cursorCycle, 'fwd-src': isFwdSrc(gr, c), 'fwd-dst': isFwdDst(gr, c) }]"
                                        :title="fwdTitle(gr, c)"
                                    >{{ cellAt(gr, c).stage }}</div>
                                </template>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </template>

        <!-- Floating stall explanation (on hover) -->
        <div v-if="tip.show" class="cyc-tip" :style="{ left: tip.x + 14 + 'px', top: tip.y + 14 + 'px' }">{{ tip.text }}</div>
    </div>
</template>

<style scoped>
.cyc-view { width: 100%; display: flex; flex-direction: column; gap: 8px; }

.cyc-toolbar { display: flex; align-items: center; gap: 10px; }
.cyc-gear {
    display: inline-flex; align-items: center; gap: 6px;
    border: 1px solid rgba(var(--bs-secondary-rgb), 0.45);
    background: rgba(var(--bs-secondary-rgb), 0.12);
    color: rgba(var(--bs-body-color-rgb), 0.9);
    border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 0.75rem; font-weight: 600;
}
.cyc-gear:hover, .cyc-gear.active { background: rgba(var(--bs-primary-rgb), 0.15); color: rgba(var(--bs-primary-rgb), 1); }
.cyc-hint { font-size: 0.72rem; color: rgba(var(--bs-body-color-rgb), 0.6); font-style: italic; }

.cyc-settings {
    display: flex; flex-direction: column; gap: 8px; padding: 10px;
    border: 1px solid rgba(var(--bs-secondary-rgb), 0.3); border-radius: 8px;
    background: rgba(var(--bs-secondary-rgb), 0.06);
}
.cyc-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 0.75rem; }
.cyc-row label { color: rgba(var(--bs-body-color-rgb), 0.85); font-weight: 600; display: inline-flex; align-items: center; gap: 5px; }
.cyc-row input[type="number"] { width: 56px; font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(var(--bs-secondary-rgb), 0.4); }
.cyc-muted { color: rgba(var(--bs-body-color-rgb), 0.5); }
.cyc-muted i { font-weight: 400; }
.cyc-chk.disabled { opacity: 0.5; cursor: not-allowed; }
.cyc-sel { display: inline-flex; align-items: center; gap: 6px; font-size: 0.75rem; }
.cyc-sel select { font-size: 0.72rem; padding: 1px 4px; border-radius: 4px; }
.cyc-preset, .cyc-reset {
    border: 1px solid rgba(var(--bs-secondary-rgb), 0.4); background: rgba(var(--bs-secondary-rgb), 0.1);
    color: rgba(var(--bs-body-color-rgb), 0.9); border-radius: 4px; padding: 2px 9px; cursor: pointer;
    font-size: 0.72rem; font-weight: 600;
}
.cyc-preset:hover, .cyc-reset:hover { background: rgba(var(--bs-primary-rgb), 0.15); color: rgba(var(--bs-primary-rgb), 1); }
.cyc-reset { margin-left: auto; }

.cyc-empty { font-size: 0.85rem; color: rgba(var(--bs-body-color-rgb), 0.6); padding: 16px 4px; }

.cyc-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 6px; }
.stat { padding: 8px 10px; border-radius: 6px; background: rgba(var(--bs-secondary-rgb), 0.08); border: 1px solid rgba(0, 0, 0, 0.1); text-align: center; }
.stat .n { font-size: 1.15rem; font-weight: 800; font-variant-numeric: tabular-nums; color: rgba(var(--bs-body-color-rgb), 1); }
.stat .l { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.04em; color: rgba(var(--bs-body-color-rgb), 0.65); margin-top: 2px; }
.stat.hi .n { color: rgba(var(--bs-primary-rgb), 1); }

.cyc-legend { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.lg { font-size: 0.62rem; font-weight: 800; padding: 1px 7px; border-radius: 4px; color: #fff; }
.lg-fwd { font-size: 0.62rem; font-weight: 800; padding: 1px 7px; border-radius: 4px; color: #2e7d32; border-bottom: 3px solid #2e7d32; }
.lg-fwdn { font-size: 0.66rem; color: rgba(var(--bs-body-color-rgb), 0.6); font-style: italic; }

.cyc-trunc { font-size: 0.72rem; color: rgba(var(--bs-body-color-rgb), 0.6); margin: 0; }
.cyc-cap { font-size: 0.72rem; color: rgba(var(--bs-body-color-rgb), 0.6); margin: 0; line-height: 1.4; }

/* Cycle cursor controls */
.cyc-cursor { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cyc-cursor-lbl { font-size: 0.72rem; font-weight: 700; color: rgba(var(--bs-body-color-rgb), 0.8); }
.cyc-cbtn {
    border: 1px solid rgba(var(--bs-secondary-rgb), 0.4); background: rgba(var(--bs-secondary-rgb), 0.1);
    color: rgba(var(--bs-body-color-rgb), 0.9); border-radius: 4px; padding: 2px 10px; cursor: pointer;
    font-weight: 700; font-size: 0.8rem; line-height: 1.2;
}
.cyc-cbtn:hover:not(:disabled) { background: rgba(var(--bs-primary-rgb), 0.15); color: rgba(var(--bs-primary-rgb), 1); }
.cyc-cbtn:disabled { opacity: 0.4; cursor: default; }
.cyc-clive.active { background: rgba(var(--bs-primary-rgb), 0.85); color: #fff; border-color: transparent; }
.cyc-cnow { font-variant-numeric: tabular-nums; font-weight: 700; min-width: 56px; text-align: center; font-size: 0.78rem; }
.cyc-cursor-hint { font-size: 0.7rem; color: rgba(var(--bs-body-color-rgb), 0.55); font-style: italic; }
.stg.now { outline: 2px solid rgba(var(--bs-body-color-rgb), 0.85); outline-offset: -2px; filter: brightness(1.1); }
/* Forwarding (bypass) endpoints: green bar at the bottom of the producer (source),
   at the top of the consumer's EX (destination). Hover the cell for details. */
.stg.fwd-src { box-shadow: inset 0 -4px 0 #2e7d32; cursor: help; }
.stg.fwd-dst { box-shadow: inset 0 4px 0 #2e7d32; cursor: help; }
.stg.fwd-src.fwd-dst { box-shadow: inset 0 -4px 0 #2e7d32, inset 0 4px 0 #2e7d32; }
.cyc-cnum.now { color: rgba(var(--bs-primary-rgb), 1); font-weight: 800; }

/* Pipeline window (box row at the cursor cycle) */
.cyc-pipe { display: flex; gap: 6px; }
.pbox { flex: 1; border: 1px solid var(--line, rgba(0,0,0,.12)); border-radius: 8px; overflow: hidden; background: rgba(var(--bs-secondary-rgb), 0.05); opacity: 0.5; transition: opacity 150ms ease; }
.pbox.occ { opacity: 1; }
.pstage { font-size: 0.62rem; font-weight: 800; color: #fff; padding: 3px 7px; letter-spacing: 0.03em; }
.p-if .pstage { background: #FDD835; color: #222; }
.p-id .pstage { background: #26C6DA; color: #08323a; }
.p-ex .pstage { background: #E53935; }
.p-mem .pstage { background: #43A047; }
.p-wb .pstage { background: #D81B60; }
.pocc { font-family: ui-monospace, "Cascadia Code", monospace; font-size: 0.72rem; padding: 5px 7px; color: rgba(var(--bs-body-color-rgb), 0.9); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pbox.stl .pocc { color: #1E88E5; font-weight: 700; }
.punit { opacity: 0.85; }
.cyc-student-hint {
    font-size: 0.72rem; margin: 0; color: rgba(var(--bs-primary-rgb), 1);
    background: rgba(var(--bs-primary-rgb), 0.08);
    border: 1px solid rgba(var(--bs-primary-rgb), 0.25);
    border-radius: 6px; padding: 6px 9px;
}
.cyc-grid .stg { white-space: nowrap; }
.c-stall { cursor: help; }
.cyc-tip {
    position: fixed; z-index: 1080; pointer-events: none;
    max-width: 260px; padding: 6px 9px; border-radius: 6px;
    background: #0b1020; color: #fff; font-size: 0.72rem; line-height: 1.35;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}

.cyc-scroll { overflow: auto; max-height: 60vh; border: 1px solid rgba(0, 0, 0, 0.1); border-radius: 8px; }
.cyc-grid { border-collapse: collapse; font-family: ui-monospace, "Cascadia Code", monospace; }
.cyc-grid th, .cyc-grid td { border: 1px solid rgba(var(--bs-body-color-rgb), 0.08); }
.cyc-cnum { min-width: 26px; font-size: 0.6rem; font-weight: 700; color: rgba(var(--bs-body-color-rgb), 0.6); text-align: center; position: sticky; top: 0; background: rgba(var(--bs-body-bg-rgb), 1); z-index: 2; }
.cyc-corner { position: sticky; left: 0; top: 0; z-index: 3; background: rgba(var(--bs-body-bg-rgb), 1); font-size: 0.66rem; text-align: left; padding: 3px 8px; color: rgba(var(--bs-body-color-rgb), 0.7); }
.cyc-asm { position: sticky; left: 0; z-index: 1; background: rgba(var(--bs-body-bg-rgb), 1); font-size: 0.68rem; text-align: left; padding: 2px 8px; white-space: nowrap; color: rgba(var(--bs-body-color-rgb), 0.92); }
.cyc-cell { padding: 0; height: 20px; }
.stg { font-size: 0.58rem; font-weight: 800; text-align: center; padding: 2px 1px; color: #fff; }

/* WinMIPS64-style stage colours */
.c-if { background: #FDD835; color: #222; }
.c-id { background: #26C6DA; color: #08323a; }
.c-ex { background: #E53935; }
.c-mul { background: #FB8C00; }
.c-fpadd { background: #8E24AA; }
.c-div { background: #6D4C41; }
.c-mem { background: #43A047; }
.c-wb { background: #D81B60; }
.c-stall { background: #1E88E5; }

[data-bs-theme="dark"] {
    .cyc-cnum, .cyc-corner, .cyc-asm { background: #1b1f24; }
}
</style>
