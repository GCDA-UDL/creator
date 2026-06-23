<!--
Copyright 2018-2026 CREATOR Team. LGPL-3.0.
UdL extension (PID RISC-V) — drawn datapath (Patterson-style 5-stage schematic).
Renders the classic RV32I datapath as SVG and highlights the stages the current
instruction traverses, driven by the same "datapath-trace" the block view uses.
Slice 1: static layout + active-stage highlight. (Per-wire/MUX value animation and
per-architecture unit show/hide come next.)
-->
<script lang="ts">
import { defineComponent, type PropType } from "vue";
import type { DatapathTrace } from "@/core/trace/datapathTrace.mts";

export default defineComponent({
    props: {
        trace: { type: Object as PropType<DatapathTrace | null>, default: null },
    },
    computed: {
        stages(): Set<string> {
            const t = this.trace;
            return new Set(t ? t.microops.map(m => m.stage) : []);
        },
        op(): Record<string, string> {
            return this.trace?.operands ?? {};
        },
        aluSrc(): boolean {
            return Number(this.trace?.signals?.ALUSrc ?? 0) > 0;
        },
    },
    methods: {
        act(stage: string): boolean {
            return this.stages.has(stage);
        },
    },
});
</script>

<template>
    <div class="dp-schematic">
        <svg viewBox="0 0 940 430" preserveAspectRatio="xMidYMid meet" class="dp-svg">
            <!-- Stage headers -->
            <g class="dp-headers">
                <text x="95" y="22" class="hd">Instruction Fetch</text>
                <text x="285" y="22" class="hd">Instr. Decode / Reg Fetch</text>
                <text x="485" y="22" class="hd">Execute / Addr. Calc</text>
                <text x="680" y="22" class="hd">Memory Access</text>
                <text x="855" y="22" class="hd">Write Back</text>
            </g>

            <!-- Dashed stage separators -->
            <g class="dp-sep">
                <line x1="182" y1="34" x2="182" y2="410" />
                <line x1="382" y1="34" x2="382" y2="410" />
                <line x1="592" y1="34" x2="592" y2="410" />
                <line x1="772" y1="34" x2="772" y2="410" />
            </g>

            <!-- Pipeline registers (green bars) -->
            <g class="dp-pipereg">
                <rect x="176" y="40" width="13" height="360" /><text x="182" y="416" class="lbl">IF/ID</text>
                <rect x="376" y="40" width="13" height="360" /><text x="382" y="416" class="lbl">ID/EX</text>
                <rect x="586" y="40" width="13" height="360" /><text x="592" y="416" class="lbl">EX/MEM</text>
                <rect x="766" y="40" width="13" height="360" /><text x="772" y="416" class="lbl">MEM/WB</text>
            </g>

            <!-- Representative wires -->
            <g class="dp-wires">
                <polyline points="58,210 78,210" />
                <polyline points="148,210 176,210" />
                <polyline points="189,150 228,150" />
                <polyline points="189,330 268,330" />
                <polyline points="318,170 376,170" />
                <polyline points="389,175 412,175" />
                <polyline points="335,330 389,300 412,250" :class="{ wsel: aluSrc }" />
                <polyline points="452,205 470,205" />
                <polyline points="540,205 586,205" />
                <polyline points="599,210 628,210" />
                <polyline points="712,210 766,210" />
                <polyline points="779,210 800,210" />
                <polyline points="840,210 880,210 880,360 250,360 250,240" class="wb" />
                <polyline points="58,150 40,150 40,90 60,90" />
            </g>

            <!-- IF stage -->
            <g class="stage" :class="{ active: act('IF') }">
                <rect class="blk green" x="26" y="190" width="34" height="44" rx="3" /><text x="43" y="216" class="bt">PC</text>
                <rect class="blk red" x="78" y="178" width="70" height="68" rx="4" /><text x="113" y="216" class="bt">IMem</text>
                <polygon class="blk blue" points="60,70 96,84 96,116 60,130 70,100" /><text x="80" y="104" class="bt sm">Add</text>
                <text x="30" y="70" class="note">Next PC</text>
            </g>

            <!-- ID stage -->
            <g class="stage" :class="{ active: act('ID') }">
                <rect class="blk greenlt" x="228" y="135" width="90" height="95" rx="4" /><text x="273" y="186" class="bt">Reg File</text>
                <ellipse class="blk yellow" cx="300" cy="330" rx="34" ry="22" /><text x="300" y="334" class="bt sm dark">SignExt</text>
                <text x="196" y="146" class="note val">{{ op.rs1 ? 'rs1: ' + op.rs1 : 'rs1' }}</text>
                <text x="196" y="166" class="note val">{{ op.rs2 ? 'rs2: ' + op.rs2 : 'rs2' }}</text>
                <text x="196" y="326" class="note val">{{ op.imm != null ? 'imm: ' + op.imm : 'imm' }}</text>
            </g>

            <!-- EX stage -->
            <g class="stage" :class="{ active: act('EX') }">
                <ellipse class="blk gray" cx="430" cy="200" rx="20" ry="30" /><text x="430" y="204" class="bt sm">MUX</text>
                <text v-if="trace" x="430" y="252" class="note val">{{ aluSrc ? 'imm' : 'rs2' }}</text>
                <polygon class="blk cyan" points="470,175 540,195 540,215 470,235 488,205" /><text x="500" y="209" class="bt">ALU</text>
                <rect class="blk white" x="470" y="120" width="46" height="26" rx="3" /><text x="493" y="137" class="bt sm dark">ZERO?</text>
            </g>

            <!-- MEM stage -->
            <g class="stage" :class="{ active: act('MEM') }">
                <rect class="blk red" x="628" y="176" width="84" height="68" rx="4" /><text x="670" y="214" class="bt">DataMem</text>
                <ellipse class="blk gray" cx="700" cy="78" rx="20" ry="26" /><text x="700" y="82" class="bt sm">MUX</text>
            </g>

            <!-- WB stage -->
            <g class="stage" :class="{ active: act('WB') }">
                <ellipse class="blk gray" cx="820" cy="210" rx="20" ry="30" /><text x="820" y="214" class="bt sm">MUX</text>
                <text x="852" y="360" class="note val">{{ op.rd ? 'rd: ' + op.rd : 'WB Data' }}</text>
            </g>
        </svg>

        <p class="dp-note">
            RV32I datapath — the stage the current instruction goes through is highlighted.
            <span v-if="trace">({{ trace.asm }})</span>
        </p>
    </div>
</template>

<style scoped>
.dp-schematic { width: 100%; display: flex; flex-direction: column; gap: 6px; }
.dp-svg {
    width: 100%;
    height: auto;
    max-height: 62vh;
    background: rgba(var(--bs-secondary-rgb), 0.04);
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 8px;
}
.hd { font-size: 11px; font-weight: 700; text-anchor: middle; fill: rgba(var(--bs-body-color-rgb), 0.85); }
.lbl { font-size: 9px; text-anchor: middle; fill: rgba(var(--bs-body-color-rgb), 0.7); font-weight: 600; }
.note { font-size: 9px; fill: rgba(var(--bs-body-color-rgb), 0.6); }
.note.val {
    fill: rgba(var(--bs-primary-rgb), 1);
    font-weight: 700;
    font-family: ui-monospace, "Cascadia Code", monospace;
}
.dp-wires .wsel { stroke: rgba(var(--bs-primary-rgb), 1); stroke-width: 2.6; }
.dp-sep line { stroke: rgba(var(--bs-body-color-rgb), 0.25); stroke-width: 1; stroke-dasharray: 4 4; }
.dp-pipereg rect { fill: #7CB342; opacity: 0.85; }
.dp-wires polyline { fill: none; stroke: rgba(var(--bs-body-color-rgb), 0.45); stroke-width: 1.6; }
.dp-wires .wb { stroke-dasharray: 5 3; }

.blk { stroke: rgba(0,0,0,0.35); stroke-width: 1; }
.blk.green   { fill: #66BB6A; }
.blk.greenlt { fill: #9CCC65; }
.blk.red     { fill: #E53935; }
.blk.blue    { fill: #42A5F5; }
.blk.cyan    { fill: #26C6DA; }
.blk.yellow  { fill: #FDD835; }
.blk.gray    { fill: #9E9E9E; }
.blk.white   { fill: #ECEFF1; }
.bt { font-size: 11px; font-weight: 700; text-anchor: middle; fill: #fff; }
.bt.sm { font-size: 9px; }
.bt.dark { fill: #222; }

.stage { opacity: 0.4; transition: opacity 220ms ease, filter 220ms ease; }
.stage.active { opacity: 1; filter: drop-shadow(0 0 4px rgba(var(--bs-primary-rgb), 0.85)); }

.dp-note { font-size: 0.72rem; color: rgba(var(--bs-body-color-rgb), 0.6); margin: 0; }

[data-bs-theme="dark"] {
    .dp-svg { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.1); }
}
</style>
