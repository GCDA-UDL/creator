<!--
Copyright 2018-2026 CREATOR Team.

This file is part of CREATOR.

CREATOR is free software: you can redistribute it and/or modify
it under the terms of the GNU Lesser General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

CREATOR is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Lesser General Public License for more details.

You should have received a copy of the GNU Lesser General Public License
along with CREATOR.  If not, see <http://www.gnu.org/licenses/>.
-->
<!--
UdL extension (PID RISC-V) — Visual datapath view.
Native 5th tab in the simulator data panel. Animates the conceptual
F-D-E-M-WB datapath of the *loaded* RISC-V architecture, driven by the
per-instruction "datapath-trace" events emitted by the execution engine.
Style mirrors Stats.vue (Bootstrap CSS variables + monospace + dark mode).
-->
<script lang="ts">
import { defineComponent } from "vue";
import { coreEvents } from "@/core/events.mts";
import {
    type DatapathTrace,
    DATAPATH_TRACE_EVENT,
    signalMap,
} from "@/core/trace/datapathTrace.mts";
import DatapathSchematic from "./DatapathSchematic.vue";
import CyclesView from "./CyclesView.vue";
import { architecture } from "@/core/core.mjs";

interface DpBlock {
    id: string;
    stage: string;
    name: string;
    active: boolean;
}

export default defineComponent({
    components: { DatapathSchematic, CyclesView },

    props: {
        dark: { type: Boolean, default: false },
    },

    data() {
        return {
            trace: null as DatapathTrace | null,
            mode: "blocks" as "blocks" | "schematic" | "cycles",
        };
    },

    mounted() {
        // mitt accepts arbitrary keys; cast keeps decoupled from typed CoreEvents
        (coreEvents as any).on(DATAPATH_TRACE_EVENT, this.onTrace);
        (coreEvents as any).on("registers-reset", this.onReset);
    },

    beforeUnmount() {
        (coreEvents as any).off(DATAPATH_TRACE_EVENT, this.onTrace);
        (coreEvents as any).off("registers-reset", this.onReset);
    },

    computed: {
        blocks(): DpBlock[] {
            const t = this.trace;
            const has = (s: string) =>
                !!t && t.microops.some(m => m.stage === s);
            return [
                { id: "pc", stage: "IF", name: "PC", active: has("IF") },
                { id: "imem", stage: "IF", name: "Instr. Mem", active: has("IF") },
                { id: "dec", stage: "ID", name: "Decode", active: has("ID") },
                { id: "rf", stage: "ID", name: "Reg File", active: has("ID") },
                { id: "alu", stage: "EX", name: "ALU", active: has("EX") },
                { id: "dmem", stage: "MEM", name: "Data Mem", active: has("MEM") },
                { id: "wb", stage: "WB", name: "Write-Back", active: has("WB") },
            ];
        },
        signals(): Record<string, number | string> {
            if (!this.trace) return {};
            return signalMap[this.trace.format] ?? signalMap.UNKNOWN;
        },
        /** Loaded architecture plugin (riscv, mips, …) — selects the drawn datapath. */
        plugin(): string {
            return (architecture as any)?.config?.plugin ?? "";
        },
        /** Optional custom datapath spec authored in the architecture YAML. */
        customSpec(): any {
            return (architecture as any)?.datapath ?? null;
        },
    },

    methods: {
        onTrace(t: DatapathTrace) {
            this.trace = t;
        },
        onReset() {
            this.trace = null;
        },
    },
});
</script>

<template>
    <div class="datapath-container">
        <div class="dp-content">
            <!-- Current instruction summary (only once an instruction has run) -->
            <div v-if="trace" class="dp-summary">
                <div class="summary-card">
                    <div class="summary-label">PC</div>
                    <div class="summary-value">{{ trace.pc }}</div>
                </div>
                <div class="summary-card">
                    <div class="summary-label">Instruction</div>
                    <div class="summary-value asm">{{ trace.asm }}</div>
                </div>
                <div class="summary-card">
                    <div class="summary-label">Machine code</div>
                    <div class="summary-value">0x{{ trace.instructionHex }}</div>
                </div>
                <div class="summary-card">
                    <div class="summary-label">Format</div>
                    <div class="summary-value">{{ trace.format }}</div>
                </div>
            </div>

            <!-- Mode toggle: Blocks (generic) / Schematic (SVG RV32I) -->
            <div class="dp-modes">
                <button class="dp-mode-btn" :class="{ active: mode === 'blocks' }" @click="mode = 'blocks'">Blocks</button>
                <button class="dp-mode-btn" :class="{ active: mode === 'schematic' }" @click="mode = 'schematic'">Schematic</button>
                <button class="dp-mode-btn" :class="{ active: mode === 'cycles' }" @click="mode = 'cycles'">Cycles</button>
            </div>

            <!-- Drawn schematic (per-architecture, data-driven) -->
            <DatapathSchematic v-if="mode === 'schematic'" :trace="trace" :plugin="plugin" :custom-spec="customSpec" />

            <!-- Pipeline cycle timeline (WinMIPS64-style) -->
            <CyclesView v-else-if="mode === 'cycles'" :dark="dark" />

            <!-- Block view (generic, any architecture) -->
            <template v-else>
            <!-- Datapath flow -->
            <div class="dp-section">
                <h6 class="dp-title">Datapath</h6>
                <div class="dp-flow">
                    <template v-for="(b, i) in blocks" :key="b.id">
                        <div class="dp-block" :class="{ active: b.active }">
                            <div class="dp-block-stage">{{ b.stage }}</div>
                            <div class="dp-block-name">{{ b.name }}</div>
                        </div>
                        <div
                            v-if="i < blocks.length - 1"
                            class="dp-arrow"
                            :class="{ active: b.active && blocks[i + 1].active }"
                        >
                            →
                        </div>
                    </template>
                </div>
            </div>

            <!-- Control signals (only when an instruction has run) -->
            <div v-if="trace" class="dp-section">
                <h6 class="dp-title">Control signals</h6>
                <div class="dp-signals">
                    <span
                        v-for="(v, k) in signals"
                        :key="k"
                        class="dp-signal"
                        :class="{ on: Number(v) > 0 }"
                    >
                        {{ k }} = {{ v }}
                    </span>
                </div>
            </div>

            <!-- Micro-operations (only when an instruction has run) -->
            <div v-if="trace" class="dp-section">
                <h6 class="dp-title">Micro-operations (RTL)</h6>
                <div class="dp-microops">
                    <div
                        v-for="(m, i) in trace.microops"
                        :key="i"
                        class="dp-microop"
                    >
                        <span class="dp-stage-badge" :data-stage="m.stage">{{ m.stage }}</span>
                        <span class="dp-rtl">{{ m.rtl }}</span>
                    </div>
                </div>
            </div>
            </template>
        </div>
    </div>
</template>

<style lang="scss" scoped>
.datapath-container {
    height: 100%;
    width: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
    scrollbar-color: rgba(139, 148, 158, 0.3) transparent;
    padding: 8px;
}
.datapath-container::-webkit-scrollbar { width: 8px; }
.datapath-container::-webkit-scrollbar-thumb {
    background-color: rgba(139, 148, 158, 0.3);
    border-radius: 4px;
}

.dp-empty {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: rgba(var(--bs-body-color-rgb), 0.55);
    text-align: center;
}
.dp-empty-icon { font-size: 2.4rem; opacity: 0.5; }

.dp-content { display: flex; flex-direction: column; gap: 12px; }

/* Mode toggle (Bloques / Esquema) */
.dp-modes {
    display: inline-flex;
    gap: 4px;
    background-color: rgba(var(--bs-secondary-rgb), 0.12);
    padding: 3px;
    border-radius: 6px;
    align-self: flex-start;
}
.dp-mode-btn {
    padding: 4px 14px;
    border: none;
    background: transparent;
    color: rgba(var(--bs-body-color-rgb), 0.7);
    font-size: 0.75rem;
    font-weight: 600;
    border-radius: 4px;
    cursor: pointer;
    transition: all 150ms ease;
}
.dp-mode-btn:hover { color: rgba(var(--bs-body-color-rgb), 1); }
.dp-mode-btn.active {
    background-color: rgba(var(--bs-primary-rgb), 0.15);
    color: rgba(var(--bs-primary-rgb), 1);
    font-weight: 700;
}

/* Summary cards (same look as Stats.vue) */
.dp-summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 6px;
}
.summary-card {
    padding: 8px 10px;
    border-radius: 6px;
    background-color: rgba(var(--bs-secondary-rgb), 0.08);
    border: 1px solid rgba(0, 0, 0, 0.1);
}
.summary-label {
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(var(--bs-body-color-rgb), 0.7);
    margin-bottom: 3px;
}
.summary-value {
    font-size: 1rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    font-family: ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace;
    color: rgba(var(--bs-body-color-rgb), 1);
    word-break: break-all;
}
.summary-value.asm { color: rgba(var(--bs-primary-rgb), 1); }

.dp-section { display: flex; flex-direction: column; gap: 6px; }
.dp-title {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(var(--bs-body-color-rgb), 0.8);
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
}

/* Datapath flow */
.dp-flow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
}
.dp-block {
    min-width: 78px;
    padding: 8px 10px;
    border-radius: 6px;
    background-color: rgba(var(--bs-secondary-rgb), 0.08);
    border: 1px solid rgba(0, 0, 0, 0.12);
    text-align: center;
    opacity: 0.45;
    transition: all 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
}
.dp-block.active {
    opacity: 1;
    background-color: rgba(var(--bs-primary-rgb), 0.15);
    border-color: rgba(var(--bs-primary-rgb), 0.7);
    box-shadow: 0 0 0 2px rgba(var(--bs-primary-rgb), 0.15);
}
.dp-block-stage {
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: rgba(var(--bs-primary-rgb), 1);
}
.dp-block-name {
    font-size: 0.8rem;
    font-weight: 600;
    color: rgba(var(--bs-body-color-rgb), 0.95);
}
.dp-arrow {
    font-size: 1.1rem;
    color: rgba(var(--bs-body-color-rgb), 0.3);
    transition: color 200ms ease;
}
.dp-arrow.active { color: rgba(var(--bs-primary-rgb), 1); }

/* Control signals */
.dp-signals { display: flex; flex-wrap: wrap; gap: 4px; }
.dp-signal {
    font-size: 0.72rem;
    font-family: ui-monospace, "Cascadia Code", monospace;
    padding: 2px 8px;
    border-radius: 10px;
    background-color: rgba(var(--bs-secondary-rgb), 0.12);
    color: rgba(var(--bs-body-color-rgb), 0.55);
    border: 1px solid rgba(0, 0, 0, 0.08);
}
.dp-signal.on {
    background-color: rgba(var(--bs-primary-rgb), 0.18);
    color: rgba(var(--bs-primary-rgb), 1);
    border-color: rgba(var(--bs-primary-rgb), 0.4);
    font-weight: 700;
}

/* Micro-operations */
.dp-microops { display: flex; flex-direction: column; gap: 4px; }
.dp-microop {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 4px;
    background-color: rgba(var(--bs-light-rgb), 0.3);
    border: 1px solid rgba(0, 0, 0, 0.08);
}
.dp-stage-badge {
    font-size: 0.62rem;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 4px;
    background-color: rgba(var(--bs-primary-rgb), 0.85);
    color: #fff;
    min-width: 34px;
    text-align: center;
}
.dp-rtl {
    font-size: 0.8rem;
    font-family: ui-monospace, "Cascadia Code", monospace;
    color: rgba(var(--bs-body-color-rgb), 0.9);
}

/* Dark mode */
[data-bs-theme="dark"] {
    .summary-card,
    .dp-block {
        background-color: rgba(255, 255, 255, 0.05);
        border-color: rgba(255, 255, 255, 0.1);
    }
    .dp-block.active {
        background-color: rgba(var(--bs-primary-rgb), 0.2);
        border-color: rgba(var(--bs-primary-rgb), 0.8);
    }
    .summary-label { color: rgba(255, 255, 255, 0.7); }
    .summary-value { color: rgba(255, 255, 255, 1); }
    .dp-title { color: rgba(255, 255, 255, 0.8); border-bottom-color: rgba(255, 255, 255, 0.1); }
    .dp-microop { background-color: rgba(0, 0, 0, 0.2); border-color: rgba(255, 255, 255, 0.08); }
    .dp-signal { background-color: rgba(255, 255, 255, 0.06); }
}
</style>
