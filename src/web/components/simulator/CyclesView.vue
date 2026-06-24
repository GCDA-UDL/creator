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
import { DATAPATH_TRACE_EVENT } from "@/core/trace/datapathTrace.mts";
import { getExecutionHistory } from "@/core/trace/executionHistory.mts";
import {
    schedulePipeline,
    buildPipeInstr,
    DEFAULT_PIPELINE_CONFIG,
    type PipelineConfig,
    type PipelineSchedule,
} from "@/core/trace/pipelineModel.mts";

interface CyclesConfig {
    forwarding: boolean;
    fpAddLatency: number;
    mulLatency: number;
    divLatency: number;
}
const DEFAULTS: CyclesConfig = {
    forwarding: DEFAULT_PIPELINE_CONFIG.forwarding,
    fpAddLatency: DEFAULT_PIPELINE_CONFIG.fpAddLatency,
    mulLatency: DEFAULT_PIPELINE_CONFIG.mulLatency,
    divLatency: DEFAULT_PIPELINE_CONFIG.divLatency,
};
const LS_KEY = "creator-cycles-config";
const MAX_ROWS = 250;

const PRESETS: Record<string, CyclesConfig> = {
    "MIPS classic": { forwarding: true, fpAddLatency: 4, mulLatency: 7, divLatency: 24 },
    "No forwarding": { forwarding: false, fpAddLatency: 4, mulLatency: 7, divLatency: 24 },
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
            presets: PRESETS,
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
        (coreEvents as any).on("registers-reset", this.onChange);
    },
    beforeUnmount() {
        (coreEvents as any).off(DATAPATH_TRACE_EVENT, this.onChange);
        (coreEvents as any).off("registers-reset", this.onChange);
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
    },
    computed: {
        schedule(): PipelineSchedule {
            // touch `version` so the (impure) history read recomputes on new traces
            void this.version;
            const cfg: PipelineConfig = { ...DEFAULT_PIPELINE_CONFIG, ...this.config };
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
        stats() {
            return this.schedule.stats;
        },
        cpiText(): string {
            return this.stats.instructions > 0 ? this.stats.cpi.toFixed(3) : "—";
        },
    },
    methods: {
        onChange() {
            this.version++;
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
            <div class="cyc-row cyc-muted">
                <label><input type="checkbox" disabled /> Branch Target Buffer <i>(coming soon)</i></label>
                <label><input type="checkbox" disabled /> Delay slot <i>(coming soon)</i></label>
                <span>Code/Data Address Bus: 10</span>
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
                <div class="stat"><div class="n">{{ stats.branchTakenStalls }}</div><div class="l">Branch-taken stalls</div></div>
            </div>

            <!-- Legend -->
            <div class="cyc-legend">
                <span class="lg c-if">IF</span><span class="lg c-id">ID</span><span class="lg c-ex">EX</span>
                <span class="lg c-mul">M*</span><span class="lg c-fpadd">A*</span><span class="lg c-div">DIV</span>
                <span class="lg c-mem">MEM</span><span class="lg c-wb">WB</span><span class="lg c-stall">stall</span>
            </div>

            <p v-if="truncated" class="cyc-trunc">Showing the first {{ gridRows.length }} of {{ schedule.rows.length }} instructions.</p>

            <!-- Instruction × cycle grid -->
            <div class="cyc-scroll">
                <table class="cyc-grid">
                    <thead>
                        <tr>
                            <th class="cyc-corner">Instruction</th>
                            <th v-for="c in cycleCols" :key="'h' + c" class="cyc-cnum">{{ c }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(gr, ri) in gridRows" :key="ri">
                            <th class="cyc-asm">{{ gr.instr.asm }}</th>
                            <td v-for="c in cycleCols" :key="ri + '-' + c" class="cyc-cell">
                                <template v-if="cellAt(gr, c)">
                                    <div
                                        v-if="cellAt(gr, c).stalled"
                                        class="stg c-stall"
                                        :title="'Stall: ' + cellAt(gr, c).stallKind"
                                    >{{ cellAt(gr, c).stallKind }}</div>
                                    <div v-else class="stg" :class="stageClass(cellAt(gr, c).stage)">{{ cellAt(gr, c).stage }}</div>
                                </template>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </template>
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

.cyc-trunc { font-size: 0.72rem; color: rgba(var(--bs-body-color-rgb), 0.6); margin: 0; }

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
