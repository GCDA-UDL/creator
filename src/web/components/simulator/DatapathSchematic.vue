<!--
Copyright 2018-2026 CREATOR Team. LGPL-3.0.
UdL extension (PID RISC-V) — drawn datapath (Patterson-style 5-stage schematic).
Renders the classic RV32I datapath as SVG, highlights the stages the current
instruction traverses and shows its operands, driven by the "datapath-trace".
Appearance is customisable via a gear settings panel (persisted in localStorage).
-->
<script lang="ts">
import { defineComponent, type PropType } from "vue";
import type { DatapathTrace } from "@/core/trace/datapathTrace.mts";

interface DpSettings {
    labelSize: number;
    valColor: string;
    haloColor: string;
    haloWidth: number;
    activeColor: string;
    dimOpacity: number;
    scheme: "classic" | "neutral";
    showValues: boolean;
    showWires: boolean;
}

const DEFAULTS: DpSettings = {
    labelSize: 14,
    valColor: "#4fc3f7",
    haloColor: "#0b1020",
    haloWidth: 3.5,
    activeColor: "#ffb300",
    dimOpacity: 0.4,
    scheme: "classic",
    showValues: true,
    showWires: true,
};
const LS_KEY = "creator-dp-schematic-settings";

/** Student-mode explanations for each datapath element. */
const HELP: Record<string, { title: string; desc: string; look: string }> = {
    pc: { title: "PC — Program Counter", desc: "Holds the address of the instruction being executed.", look: "It increases by 4 each step (word size), or jumps to a target on branches/jumps." },
    imem: { title: "Instruction Memory", desc: "Stores the program. The PC indexes it to fetch the instruction word in the IF stage.", look: "The 'Instruction' field at the top shows the fetched instruction." },
    add: { title: "Adder (Next PC)", desc: "Computes PC + 4 (next sequential instruction) and branch/jump targets.", look: "Active in every fetch; the branch target path is used when a branch is taken." },
    regfile: { title: "Register File (x0–x31)", desc: "Reads source registers rs1/rs2 in ID and writes the destination rd in WB.", look: "rs1/rs2 feed the ALU; rd is written back at the end (WB)." },
    signext: { title: "Sign Extend", desc: "Extends the instruction's immediate to 32 bits (I, S, B, U, J formats).", look: "Used when ALUSrc = 1 (the immediate goes into the ALU instead of rs2)." },
    muxex: { title: "ALU source MUX", desc: "Selects the ALU's second operand: rs2 (R-type) or the immediate (I/S/U).", look: "Controlled by ALUSrc — the highlighted label shows which one is chosen." },
    alu: { title: "ALU", desc: "Arithmetic-Logic Unit: add/sub/and/or/shift… or the effective address for load/store.", look: "Its result goes to Write-Back, or to Data Memory for load/store." },
    zero: { title: "ZERO? (branch test)", desc: "Comparison flag used to decide if a conditional branch is taken.", look: "Relevant for B-type instructions (beq, bne, …)." },
    datamem: { title: "Data Memory", desc: "Main data memory. Loads read it (MemRead); stores write it (MemWrite), in the MEM stage.", look: "Only active for load/store instructions." },
    muxmem: { title: "Next-PC MUX", desc: "Chooses the next PC: PC + 4 or the branch/jump target.", look: "Switches to the target when a branch is taken." },
    muxwb: { title: "Write-Back MUX", desc: "Chooses what is written to rd: the ALU result or the value loaded from memory (MemToReg).", look: "For loads it picks memory data; otherwise the ALU result." },
    pipereg: { title: "Stage registers (IF/ID … MEM/WB)", desc: "Boundaries between the five stages (Fetch, Decode, Execute, Memory, Write-Back).", look: "In this functional view they delimit the phases the instruction goes through." },
};

/** Generic, university-neutral appearance presets. */
const PRESETS: Record<string, Partial<DpSettings>> = {
    Classic: { scheme: "classic", valColor: "#4fc3f7", haloColor: "#0b1020", haloWidth: 3.5, activeColor: "#ffb300", dimOpacity: 0.4 },
    "High contrast": { scheme: "classic", valColor: "#ffffff", haloColor: "#000000", haloWidth: 4.5, activeColor: "#ffd400", dimOpacity: 0.3 },
    "Print (B/W)": { scheme: "neutral", valColor: "#000000", haloColor: "#ffffff", haloWidth: 4, activeColor: "#555555", dimOpacity: 0.5 },
    "Dark neutral": { scheme: "neutral", valColor: "#7fd1ff", haloColor: "#0b1020", haloWidth: 3, activeColor: "#ff8a65", dimOpacity: 0.35 },
};

export default defineComponent({
    props: {
        trace: { type: Object as PropType<DatapathTrace | null>, default: null },
    },
    data() {
        return {
            settings: { ...DEFAULTS } as DpSettings,
            showSettings: false,
            studentMode: false,
            explain: null as string | null,
            help: HELP,
            presets: PRESETS,
        };
    },
    mounted() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) this.settings = { ...DEFAULTS, ...JSON.parse(raw) };
        } catch {
            /* ignore corrupt settings */
        }
    },
    watch: {
        settings: {
            deep: true,
            handler(v: DpSettings) {
                try {
                    localStorage.setItem(LS_KEY, JSON.stringify(v));
                } catch {
                    /* ignore */
                }
            },
        },
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
        rootStyle(): Record<string, string> {
            const s = this.settings;
            return {
                "--dp-val-size": s.labelSize + "px",
                "--dp-val-color": s.valColor,
                "--dp-halo-color": s.haloColor,
                "--dp-halo-width": s.haloWidth + "px",
                "--dp-active-color": s.activeColor,
                "--dp-dim-opacity": String(s.dimOpacity),
            };
        },
    },
    methods: {
        act(stage: string): boolean {
            return this.stages.has(stage);
        },
        applyPreset(name: string) {
            this.settings = { ...this.settings, ...(PRESETS[name] ?? {}) };
        },
        resetSettings() {
            this.settings = { ...DEFAULTS };
        },
    },
});
</script>

<template>
    <div class="dp-schematic">
        <!-- Toolbar: settings gear + student mode -->
        <div class="dp-toolbar">
            <button class="dp-gear" :class="{ active: showSettings }" title="Datapath display settings" @click="showSettings = !showSettings">
                <font-awesome-icon :icon="['fas', 'gear']" /> Display
            </button>
            <button class="dp-gear" :class="{ active: studentMode }" title="Student mode: click the ? marks to learn each part" @click="studentMode = !studentMode; explain = null">
                <font-awesome-icon :icon="['fas', 'graduation-cap']" /> Student
            </button>
        </div>

        <!-- Student-mode help box -->
        <div v-if="studentMode && explain" class="dp-help">
            <button class="dp-help-x" title="Close" @click="explain = null">×</button>
            <strong>{{ help[explain].title }}</strong>
            <p>{{ help[explain].desc }}</p>
            <p class="dp-look">Watch: {{ help[explain].look }}</p>
        </div>
        <div v-else-if="studentMode" class="dp-help hint">
            Click a <span class="qbadge">?</span> on the diagram to learn what each part does, where its data comes from and what to watch.
        </div>

        <!-- Settings panel -->
        <div v-if="showSettings" class="dp-settings">
            <div class="dp-set-row">
                <label>Theme preset</label>
                <button v-for="(p, name) in presets" :key="name" class="dp-preset" @click="applyPreset(name)">{{ name }}</button>
            </div>
            <div class="dp-set-row">
                <label>Label size</label>
                <input type="range" min="9" max="26" v-model.number="settings.labelSize" />
                <span class="dp-set-val">{{ settings.labelSize }}px</span>
            </div>
            <div class="dp-set-row">
                <label>Value color</label>
                <input type="color" v-model="settings.valColor" />
                <label>Halo / contrast</label>
                <input type="color" v-model="settings.haloColor" />
                <input type="range" min="0" max="6" step="0.5" v-model.number="settings.haloWidth" title="Halo width" />
            </div>
            <div class="dp-set-row">
                <label>Active highlight</label>
                <input type="color" v-model="settings.activeColor" />
                <label>Dim (inactive)</label>
                <input type="range" min="0.15" max="1" step="0.05" v-model.number="settings.dimOpacity" />
                <span class="dp-set-val">{{ settings.dimOpacity }}</span>
            </div>
            <div class="dp-set-row">
                <label>Color scheme</label>
                <select v-model="settings.scheme">
                    <option value="classic">Classic (Patterson)</option>
                    <option value="neutral">Neutral (theme)</option>
                </select>
                <label class="dp-chk"><input type="checkbox" v-model="settings.showValues" /> Values</label>
                <label class="dp-chk"><input type="checkbox" v-model="settings.showWires" /> Wires</label>
                <button class="dp-reset" @click="resetSettings">Reset</button>
            </div>
        </div>

        <svg
            viewBox="0 0 940 430"
            preserveAspectRatio="xMidYMid meet"
            class="dp-svg"
            :class="'scheme-' + settings.scheme"
            :style="rootStyle"
        >
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

            <!-- Representative wires (highlight + flow on the active stage) -->
            <g v-if="settings.showWires" class="dp-wires">
                <polyline points="58,210 78,210" :class="{ won: act('IF') }" />
                <polyline points="148,210 176,210" :class="{ won: act('IF') }" />
                <polyline points="58,150 40,150 40,90 60,90" :class="{ won: act('IF') }" />
                <polyline points="189,150 228,150" :class="{ won: act('ID') }" />
                <polyline points="189,330 268,330" :class="{ won: act('ID') }" />
                <polyline points="318,170 376,170" :class="{ won: act('EX') }" />
                <polyline points="389,175 412,175" :class="{ won: act('EX') }" />
                <polyline points="335,330 389,300 412,250" :class="{ won: act('EX'), wsel: aluSrc }" />
                <polyline points="452,205 470,205" :class="{ won: act('EX') }" />
                <polyline points="540,205 586,205" :class="{ won: act('EX') }" />
                <polyline points="599,210 628,210" :class="{ won: act('MEM') }" />
                <polyline points="712,210 766,210" :class="{ won: act('MEM') }" />
                <polyline points="779,210 800,210" :class="{ won: act('WB') }" />
                <polyline points="840,210 880,210 880,360 250,360 250,240" :class="['wb', { won: act('WB') }]" />
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
                <text v-if="settings.showValues" x="196" y="146" class="note val">{{ op.rs1 ? 'rs1: ' + op.rs1 : 'rs1' }}</text>
                <text v-if="settings.showValues" x="196" y="166" class="note val">{{ op.rs2 ? 'rs2: ' + op.rs2 : 'rs2' }}</text>
                <text v-if="settings.showValues" x="196" y="326" class="note val">{{ op.imm != null && op.imm !== '' ? 'imm: ' + op.imm : 'imm' }}</text>
            </g>

            <!-- EX stage -->
            <g class="stage" :class="{ active: act('EX') }">
                <ellipse class="blk gray" cx="430" cy="200" rx="20" ry="30" /><text x="430" y="204" class="bt sm">MUX</text>
                <text v-if="settings.showValues && trace" x="430" y="252" class="note val">{{ aluSrc ? 'imm' : 'rs2' }}</text>
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
                <text v-if="settings.showValues" x="852" y="360" class="note val">{{ op.rd ? 'rd: ' + op.rd : 'WB Data' }}</text>
            </g>

            <!-- Student-mode question marks (click for explanation) -->
            <g v-if="studentMode" class="dp-qmarks">
                <g class="qmark" @click="explain = 'add'"><circle cx="100" cy="64" r="9" /><text x="100" y="68">?</text></g>
                <g class="qmark" @click="explain = 'pc'"><circle cx="64" cy="186" r="9" /><text x="64" y="190">?</text></g>
                <g class="qmark" @click="explain = 'imem'"><circle cx="150" cy="174" r="9" /><text x="150" y="178">?</text></g>
                <g class="qmark" @click="explain = 'pipereg'"><circle cx="190" cy="46" r="9" /><text x="190" y="50">?</text></g>
                <g class="qmark" @click="explain = 'regfile'"><circle cx="322" cy="131" r="9" /><text x="322" y="135">?</text></g>
                <g class="qmark" @click="explain = 'signext'"><circle cx="336" cy="312" r="9" /><text x="336" y="316">?</text></g>
                <g class="qmark" @click="explain = 'muxex'"><circle cx="448" cy="174" r="9" /><text x="448" y="178">?</text></g>
                <g class="qmark" @click="explain = 'alu'"><circle cx="544" cy="178" r="9" /><text x="544" y="182">?</text></g>
                <g class="qmark" @click="explain = 'zero'"><circle cx="520" cy="118" r="9" /><text x="520" y="122">?</text></g>
                <g class="qmark" @click="explain = 'datamem'"><circle cx="716" cy="172" r="9" /><text x="716" y="176">?</text></g>
                <g class="qmark" @click="explain = 'muxmem'"><circle cx="722" cy="56" r="9" /><text x="722" y="60">?</text></g>
                <g class="qmark" @click="explain = 'muxwb'"><circle cx="840" cy="186" r="9" /><text x="840" y="190">?</text></g>
            </g>
        </svg>

        <p class="dp-note-cap">
            RV32I datapath — the stage the current instruction goes through is highlighted.
            <span v-if="trace">({{ trace.asm }})</span>
        </p>
    </div>
</template>

<style scoped>
.dp-schematic { width: 100%; display: flex; flex-direction: column; gap: 6px; }

/* Toolbar + gear */
.dp-toolbar { display: flex; align-items: center; gap: 6px; }
.dp-gear {
    display: inline-flex; align-items: center; gap: 6px;
    border: 1px solid rgba(var(--bs-secondary-rgb), 0.45);
    background: rgba(var(--bs-secondary-rgb), 0.12);
    color: rgba(var(--bs-body-color-rgb), 0.9);
    border-radius: 6px; padding: 3px 10px; cursor: pointer;
    font-size: 0.75rem; font-weight: 600;
}
.dp-gear:hover, .dp-gear.active {
    background: rgba(var(--bs-primary-rgb), 0.15);
    color: rgba(var(--bs-primary-rgb), 1);
}

/* Settings panel */
.dp-settings {
    display: flex; flex-direction: column; gap: 8px;
    padding: 10px;
    border: 1px solid rgba(var(--bs-secondary-rgb), 0.3);
    border-radius: 8px;
    background: rgba(var(--bs-secondary-rgb), 0.06);
}
.dp-set-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 0.75rem; }
.dp-set-row label { color: rgba(var(--bs-body-color-rgb), 0.8); font-weight: 600; }
.dp-set-row input[type="color"] { width: 28px; height: 22px; padding: 0; border: none; background: none; cursor: pointer; }
.dp-set-row input[type="range"] { width: 120px; }
.dp-set-row select { font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; }
.dp-set-val { font-variant-numeric: tabular-nums; min-width: 34px; color: rgba(var(--bs-body-color-rgb), 0.85); }
.dp-chk { display: inline-flex; align-items: center; gap: 4px; }
.dp-reset {
    margin-left: auto; border: 1px solid rgba(var(--bs-secondary-rgb), 0.4);
    background: transparent; color: rgba(var(--bs-body-color-rgb), 0.8);
    border-radius: 4px; padding: 2px 10px; cursor: pointer; font-weight: 600;
}
.dp-reset:hover { background: rgba(var(--bs-primary-rgb), 0.12); }
.dp-preset {
    border: 1px solid rgba(var(--bs-secondary-rgb), 0.4);
    background: rgba(var(--bs-secondary-rgb), 0.1);
    color: rgba(var(--bs-body-color-rgb), 0.9);
    border-radius: 4px; padding: 2px 9px; cursor: pointer; font-size: 0.72rem; font-weight: 600;
}
.dp-preset:hover { background: rgba(var(--bs-primary-rgb), 0.15); color: rgba(var(--bs-primary-rgb), 1); }

/* Student mode */
.dp-help { position: relative; padding: 8px 28px 8px 10px; border-radius: 8px; font-size: 0.8rem; background: rgba(var(--bs-primary-rgb), 0.1); border: 1px solid rgba(var(--bs-primary-rgb), 0.35); }
.dp-help.hint { background: rgba(var(--bs-secondary-rgb), 0.1); border-color: rgba(var(--bs-secondary-rgb), 0.3); color: rgba(var(--bs-body-color-rgb), 0.8); }
.dp-help strong { color: rgba(var(--bs-primary-rgb), 1); }
.dp-help p { margin: 4px 0 0; }
.dp-help .dp-look { color: rgba(var(--bs-body-color-rgb), 0.75); font-style: italic; }
.dp-help-x { position: absolute; top: 3px; right: 6px; border: none; background: transparent; font-size: 1.1rem; line-height: 1; cursor: pointer; color: rgba(var(--bs-body-color-rgb), 0.6); }
.qbadge { display: inline-block; width: 16px; height: 16px; line-height: 16px; text-align: center; border-radius: 50%; background: var(--dp-active-color, #ffb300); color: #000; font-weight: 800; font-size: 0.7rem; }

.dp-qmarks .qmark { cursor: pointer; }
.dp-qmarks circle { fill: var(--dp-active-color, #ffb300); stroke: #000; stroke-width: 0.6; }
.dp-qmarks text { font-size: 12px; font-weight: 800; text-anchor: middle; fill: #000; pointer-events: none; }
.dp-qmarks .qmark:hover circle { fill: #fff; }

.dp-svg {
    width: 100%; height: auto; max-height: 62vh;
    background: rgba(var(--bs-secondary-rgb), 0.04);
    border: 1px solid rgba(0, 0, 0, 0.1); border-radius: 8px;
}
.hd { font-size: 11px; font-weight: 700; text-anchor: middle; fill: rgba(var(--bs-body-color-rgb), 0.85); }
.lbl { font-size: 9px; text-anchor: middle; fill: rgba(var(--bs-body-color-rgb), 0.7); font-weight: 600; }
.note { font-size: 9px; fill: rgba(var(--bs-body-color-rgb), 0.6); }
.note.val {
    font-size: var(--dp-val-size, 14px);
    fill: var(--dp-val-color, #4fc3f7);
    font-weight: 700;
    font-family: ui-monospace, "Cascadia Code", monospace;
    paint-order: stroke fill;
    stroke: var(--dp-halo-color, #0b1020);
    stroke-width: var(--dp-halo-width, 3.5px);
    stroke-linejoin: round;
}
.dp-sep line { stroke: rgba(var(--bs-body-color-rgb), 0.25); stroke-width: 1; stroke-dasharray: 4 4; }
.dp-pipereg rect { fill: #7CB342; opacity: 0.85; }
.dp-wires polyline { fill: none; stroke: rgba(var(--bs-body-color-rgb), 0.45); stroke-width: 1.6; }
.dp-wires .wb { stroke-dasharray: 5 3; }
.dp-wires .wsel { stroke: var(--dp-active-color, #ffb300); stroke-width: 2.6; }
.dp-wires .won {
    stroke: var(--dp-active-color, #ffb300);
    stroke-width: 2.6;
    stroke-dasharray: 6 4;
    animation: dpflow 0.7s linear infinite;
}
@keyframes dpflow { to { stroke-dashoffset: -10; } }
@media (prefers-reduced-motion: reduce) {
    .dp-wires .won { animation: none; }
}

.blk { stroke: rgba(0,0,0,0.35); stroke-width: 1; }
.blk.green   { fill: #66BB6A; }
.blk.greenlt { fill: #9CCC65; }
.blk.red     { fill: #E53935; }
.blk.blue    { fill: #42A5F5; }
.blk.cyan    { fill: #26C6DA; }
.blk.yellow  { fill: #FDD835; }
.blk.gray    { fill: #9E9E9E; }
.blk.white   { fill: #ECEFF1; }
/* Neutral scheme: monochrome blocks */
.scheme-neutral .blk { fill: #5b6370; }
.scheme-neutral .blk.white { fill: #cfd4da; }
.scheme-neutral .blk.yellow { fill: #b9a14a; }

.bt { font-size: 11px; font-weight: 700; text-anchor: middle; fill: #fff; }
.bt.sm { font-size: 9px; }
.bt.dark { fill: #222; }

.stage { opacity: var(--dp-dim-opacity, 0.4); transition: opacity 220ms ease, filter 220ms ease; }
.stage.active { opacity: 1; filter: drop-shadow(0 0 5px var(--dp-active-color, #ffb300)); }
.stage.active .blk { stroke: var(--dp-active-color, #ffb300); stroke-width: 2; }

.dp-note-cap { font-size: 0.72rem; color: rgba(var(--bs-body-color-rgb), 0.6); margin: 0; }

[data-bs-theme="dark"] {
    .dp-svg { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.1); }
}
</style>
