<!--
Copyright 2018-2026 CREATOR Team. LGPL-3.0.
UdL extension (PID RISC-V) — generic, data-driven datapath renderer.
Draws the datapath of the loaded architecture from a `DatapathSpec` (built-in per
plugin, or a custom one authored in the architecture YAML), and binds it to the
live "datapath-trace": active stages, operand values, MUX source, branch path and
optional M/FPU units. Appearance is customisable via a gear panel (localStorage).
-->
<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { deriveControlSignals, type DatapathTrace } from "@/core/trace/datapathTrace.mts";
import { resolveDatapathSpec, builtinSpecsForPlugin, DEFAULT_STYLE } from "./datapath/index";
import type { DatapathSpec, DpBlock } from "./datapath/spec";
import { coreEvents } from "@/core/events.mts";
import { getExecutionHistory } from "@/core/trace/executionHistory.mts";
import {
    schedulePipeline,
    buildPipeInstr,
    DEFAULT_PIPELINE_CONFIG,
    RIPES_PIPELINE_CONFIG,
    type PipelineConfig,
} from "@/core/trace/pipelineModel.mts";
import { CYCLES_CONFIG_EVENT, loadCyclesConfig, saveCyclesConfig } from "./pipelineConfigStore.mts";

interface DpSettings {
    labelSize: number;
    valColor: string;
    haloColor: string;
    haloWidth: number;
    activeColor: string;
    highlight: number;
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
    highlight: 0.5,
    dimOpacity: 0.4,
    scheme: "classic",
    showValues: true,
    showWires: true,
};
const LS_KEY = "creator-dp-schematic-settings";
const STYLE_KEY = "creator-dp-style";

/** Live pipeline state of the current instruction (for Ripes-style drawings). */
interface PipeInfo {
    /** Forwarding source per operand role: "MEM" (EX/MEM result) or "WB" (MEM/WB result). */
    fwdSrc: Record<string, "MEM" | "WB">;
    /** Stall of the current instruction, if any (load-use / ecall drain …). */
    stalled: { kind: string; waitFor: string; cycles: number } | null;
}
const NO_PIPE: PipeInfo = { fwdSrc: {}, stalled: null };

/** Generic, university-neutral appearance presets. */
const PRESETS: Record<string, Partial<DpSettings>> = {
    Classic: { scheme: "classic", valColor: "#4fc3f7", haloColor: "#0b1020", haloWidth: 3.5, activeColor: "#ffb300", highlight: 0.5, dimOpacity: 0.4 },
    "High contrast": { scheme: "classic", valColor: "#ffffff", haloColor: "#000000", haloWidth: 4.5, activeColor: "#ffd400", highlight: 0.9, dimOpacity: 0.3 },
    "Print (B/W)": { scheme: "neutral", valColor: "#000000", haloColor: "#ffffff", haloWidth: 4, activeColor: "#555555", highlight: 0.3, dimOpacity: 0.5 },
    "Dark neutral": { scheme: "neutral", valColor: "#7fd1ff", haloColor: "#0b1020", haloWidth: 3, activeColor: "#ff8a65", highlight: 0.45, dimOpacity: 0.35 },
};

export default defineComponent({
    props: {
        trace: { type: Object as PropType<DatapathTrace | null>, default: null },
        /** Architecture plugin (riscv, mips, …) used to pick the built-in spec. */
        plugin: { type: String, default: "" },
        /** Optional custom spec authored in the architecture YAML (`datapath:`). */
        customSpec: { type: Object as PropType<Partial<DatapathSpec> | null>, default: null },
    },
    data() {
        return {
            settings: { ...DEFAULTS } as DpSettings,
            showSettings: false,
            studentMode: false,
            explain: null as string | null,
            presets: PRESETS,
            // Phase stepper: walk the current instruction's phases (IF→ID→EX→MEM→WB)
            // one at a time. "allPhases" = the single-cycle view (everything lit at once).
            phaseCursor: 1,
            allPhases: false,
            showControl: true, // show the control-signal strip (RegWrite, ALUSrc, …)
            // Drawing style (when the plugin ships several, e.g. RISC-V: CREATOR / Ripes).
            style: DEFAULT_STYLE as string,
            // Pipeline configuration shared with the Cycles view (branch stage, forwarding…).
            cyclesCfg: loadCyclesConfig() as Partial<PipelineConfig>,
            histVersion: 0, // bumped on each executed instruction / reset
        };
    },
    mounted() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) this.settings = { ...DEFAULTS, ...JSON.parse(raw) };
            const st = localStorage.getItem(STYLE_KEY);
            if (st) this.style = st;
        } catch {
            /* ignore corrupt settings */
        }
        window.addEventListener(CYCLES_CONFIG_EVENT, this.onCyclesConfig);
        (coreEvents as any).on("registers-reset", this.onReset);
    },
    beforeUnmount() {
        window.removeEventListener(CYCLES_CONFIG_EVENT, this.onCyclesConfig);
        (coreEvents as any).off("registers-reset", this.onReset);
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
        // New instruction executed by CREATOR (engine Step) → restart its phases at IF
        // (unless the user chose the all-phases / single-cycle view).
        trace() {
            if (!this.allPhases) this.phaseCursor = 1;
            this.histVersion++;
        },
        style(v: string) {
            try {
                localStorage.setItem(STYLE_KEY, v);
            } catch {
                /* ignore */
            }
        },
    },
    computed: {
        spec(): DatapathSpec | null {
            return resolveDatapathSpec(this.plugin, this.customSpec, this.style);
        },
        /** Drawing styles available for this architecture (none when a custom YAML drawing is used). */
        styles(): { id: string; label: string }[] {
            const custom = this.customSpec;
            if (custom && Array.isArray(custom.blocks) && custom.blocks.length > 0) return [];
            return builtinSpecsForPlugin(this.plugin).map(s => ({
                id: s.style ?? DEFAULT_STYLE,
                label: s.styleLabel ?? s.id,
            }));
        },
        /** Stage in which the DRAWING resolves branches (badge + branch-path timing). */
        branchStageDrawn(): string {
            return this.spec?.branchStage ?? "EX";
        },
        /** Stage the Cycles model resolves branches in (its configuration). */
        cyclesBranchStage(): string {
            return this.cyclesCfg.branchStage ?? DEFAULT_PIPELINE_CONFIG.branchStage ?? "ID";
        },
        branchMismatch(): boolean {
            return this.branchStageDrawn !== this.cyclesBranchStage;
        },
        /** Does the drawing show pipeline state (forwarding wires, hazard/forwarding units)? */
        needsPipeline(): boolean {
            const s = this.spec;
            if (!s) return false;
            return s.wires.some(w => w.fwd !== undefined) || s.blocks.some(b => b.unitState !== undefined) || s.values.some(v => v.kind === "fwd");
        },
        /** Forwarding sources + stall of the current instruction, from the pipeline model. */
        pipeInfo(): PipeInfo {
            // histVersion is a dependency on purpose: the history is read outside Vue's reactivity
            if (this.histVersion < 0 || !this.needsPipeline || !this.trace) return NO_PIPE;
            const hist = getExecutionHistory();
            const idx = hist.length - 1;
            if (idx < 0) return NO_PIPE;
            const cfg: PipelineConfig = { ...DEFAULT_PIPELINE_CONFIG, ...this.cyclesCfg };
            const sched = schedulePipeline(hist.map((t, i) => buildPipeInstr(t, i)), cfg);
            const fwdSrc: Record<string, "MEM" | "WB"> = {};
            for (const f of sched.forwards) {
                if (f.toIndex !== idx) continue;
                // producer one stage ahead (in MEM) → EX/MEM result; otherwise it is in WB
                const src: "MEM" | "WB" = !f.loadUse && f.toCycle - f.fromCycle === 1 ? "MEM" : "WB";
                for (const role of Object.keys(this.op)) {
                    if (this.op[role] === f.reg && /^(rs1|rs2|rs|rt|rs3)$/.test(role)) fwdSrc[role] = src;
                }
            }
            const row = sched.rows[idx];
            const stalls = row ? row.cells.filter(c => c.stalled) : [];
            const first = stalls[0];
            const stalled = first
                ? { kind: first.stallKind ?? "RAW", waitFor: first.waitFor ?? "", cycles: stalls.length }
                : null;
            return { fwdSrc, stalled };
        },
        fwdCount(): number {
            return Object.keys(this.pipeInfo.fwdSrc).length;
        },
        stages(): Set<string> {
            const t = this.trace;
            return new Set(t ? t.microops.map(m => m.stage) : []);
        },
        /** Phases this instruction goes through, in canonical order. */
        phases(): string[] {
            return ["IF", "ID", "EX", "MEM", "WB"].filter(s => this.stages.has(s));
        },
        phaseCount(): number {
            return this.phases.length;
        },
        currentPhase(): string {
            if (this.phases.length === 0) return "";
            const n = Math.min(Math.max(this.phaseCursor, 1), this.phases.length);
            return this.phases[n - 1];
        },
        /** Highlighted stages: cumulative up to the cursor (step mode), or all (single-cycle). */
        activeStages(): Set<string> {
            if (this.allPhases || !this.trace) return this.stages;
            const n = Math.min(Math.max(this.phaseCursor, 1), this.phases.length);
            return new Set(this.phases.slice(0, n));
        },
        exReached(): boolean {
            return this.activeStages.has("EX");
        },
        /** Control signals (P&H) for the current instruction, derived from the mnemonic. */
        controlSignals(): { name: string; on: boolean }[] {
            if (!this.trace) return [];
            const s = deriveControlSignals(this.trace.asm);
            const CTRL: (keyof typeof s)[] = ["RegWrite", "ALUSrc", "MemRead", "MemWrite", "MemToReg", "Branch"];
            return CTRL.map(k => ({ name: k, on: s[k] === 1 }));
        },
        op(): Record<string, string> {
            return this.trace?.operands ?? {};
        },
        val(): Record<string, string> {
            return this.trace?.operandValues ?? {};
        },
        aluSrc(): boolean {
            // Derived from the mnemonic (robust) rather than CREATOR's coarse type,
            // so the ALU-source MUX shows "imm" for addi/loads/stores per P&H.
            return deriveControlSignals(this.trace?.asm ?? "").ALUSrc === 1;
        },
        branched(): boolean {
            return this.trace?.branchTaken === true;
        },
        unit(): string {
            return this.trace?.unit ?? "alu";
        },
        hasM(): boolean {
            return this.trace?.extensions?.includes("M") ?? false;
        },
        hasFP(): boolean {
            return this.trace?.extensions?.some(e => e === "F" || e === "D") ?? false;
        },
        destRole(): string {
            const roles = this.spec?.destRoles ?? ["rd"];
            return roles.find(r => this.op[r] != null) ?? roles[0];
        },
        visibleUnits() {
            return (this.spec?.units ?? []).filter(u => this.extActive(u.extReq));
        },
        qmarks(): { id: string; x: number; y: number }[] {
            const s = this.spec;
            if (!s) return [];
            const out: { id: string; x: number; y: number }[] = [];
            for (const b of s.blocks) if (b.qmark) out.push({ id: b.id, x: b.qmark.x, y: b.qmark.y });
            for (const e of s.extraQmarks ?? []) out.push({ id: e.id, x: e.x, y: e.y });
            for (const u of this.visibleUnits) if (u.qmark) out.push({ id: u.id, x: u.qmark.x, y: u.qmark.y });
            return out;
        },
        helpMap(): Record<string, { title: string; desc: string; look: string }> {
            return this.spec?.help ?? {};
        },
        rootStyle(): Record<string, string> {
            const s = this.settings;
            return {
                "--dp-val-size": s.labelSize + "px",
                "--dp-val-color": s.valColor,
                "--dp-halo-color": s.haloColor,
                "--dp-halo-width": s.haloWidth + "px",
                "--dp-active-color": s.activeColor,
                "--dp-glow": (s.highlight * 5).toFixed(2) + "px",
                "--dp-active-stroke": (s.highlight * 2).toFixed(2) + "px",
                "--dp-dim-opacity": String(s.dimOpacity),
            };
        },
    },
    methods: {
        act(stage: string): boolean {
            return this.activeStages.has(stage);
        },
        onCyclesConfig() {
            this.cyclesCfg = loadCyclesConfig();
        },
        onReset() {
            this.histVersion++;
        },
        /** Puts the Cycles view in the Ripes RV5S configuration (branch in EX, 1-cycle units, ecall drain). */
        applyRipesPreset() {
            saveCyclesConfig({ ...RIPES_PIPELINE_CONFIG });
            this.cyclesCfg = loadCyclesConfig();
        },
        /** Is a pipeline-control unit block lit (hazard → stalled; forwarding → bypass active)? */
        unitOn(b: DpBlock): boolean {
            if (b.unitState === "hazard") return this.pipeInfo.stalled !== null;
            if (b.unitState === "forwarding") return this.fwdCount > 0;
            return false;
        },
        unitStateText(b: DpBlock): string {
            const p = this.pipeInfo;
            if (b.unitState === "hazard") {
                return p.stalled ? `stall ×${p.stalled.cycles}${p.stalled.waitFor ? " (" + p.stalled.waitFor + ")" : ""}` : "—";
            }
            if (b.unitState === "forwarding") {
                const e = Object.entries(p.fwdSrc);
                return e.length ? e.map(([r, src]) => `${r} ← ${src}`).join("  ") : "—";
            }
            return "";
        },
        /** Position of a unit's state text: just under the block. */
        unitStateY(b: DpBlock): number {
            return b.geom.kind === "rect" ? b.geom.y + b.geom.h + 12 : b.labelPos.y + 20;
        },
        /** Bare value of a datapath port ("pc", "alu", "wb") for Ripes-style value labels. */
        portLabel(role: string): string {
            if (role === "pc") return "pc = " + (this.trace?.pc ?? "");
            const v = this.val[this.destRole];
            if (role === "alu") return this.unit === "alu" && v !== undefined ? "= " + v : "";
            if (role === "wb") return v !== undefined ? "wb = " + v : "";
            return "";
        },
        /** Forwarding source chosen for an operand role (ID = register file). */
        fwdLabel(role: string): string {
            if (!this.op[role]) return "";
            return role + " ← " + (this.pipeInfo.fwdSrc[role] ?? "ID");
        },
        stepPhase(delta: number) {
            this.allPhases = false;
            this.phaseCursor = Math.min(Math.max(this.phaseCursor + delta, 1), Math.max(1, this.phaseCount));
        },
        phaseToStart() {
            this.allPhases = false;
            this.phaseCursor = 1;
        },
        showAllPhases() {
            this.allPhases = true;
        },
        valLabel(role: string): string {
            const name = this.op[role];
            if (!name) return role;
            const v = this.val[role];
            return role + ": " + name + (v !== undefined ? " = " + v : "");
        },
        immValue(role: string): string | undefined {
            for (const k of [role, "imm", "offset", "inm"]) {
                const v = this.op[k];
                if (v != null && v !== "") return v;
            }
            return undefined;
        },
        immLabel(role: string): string {
            const v = this.immValue(role);
            return v !== undefined ? role + ": " + v : role;
        },
        extActive(req: "M" | "FP"): boolean {
            return req === "M" ? this.hasM : this.hasFP;
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
            <label v-if="styles.length > 1" class="dp-style" title="Estilo del dibujo: esquema del libro (P&H) o circuito de Ripes (RV5S)">
                Estilo
                <select v-model="style">
                    <option v-for="st in styles" :key="st.id" :value="st.id">{{ st.label }}</option>
                </select>
            </label>
            <button class="dp-gear" :class="{ active: showControl }" title="Mostrar las señales de control (RegWrite, ALUSrc, …) que genera la unidad de control" @click="showControl = !showControl">
                <font-awesome-icon :icon="['fas', 'sliders']" /> Control
            </button>
        </div>

        <!-- Control signals (P&H): generated in ID, drive the datapath -->
        <div v-if="showControl && trace && controlSignals.length && act('ID')" class="dp-control">
            <span class="dp-control-lbl">Control</span>
            <span v-for="c in controlSignals" :key="c.name" class="dp-sig" :class="{ on: c.on }">
                {{ c.name }}<b>{{ c.on ? 1 : 0 }}</b>
            </span>
            <span class="dp-control-hint">la Unidad de Control las genera en ID a partir del opcode/formato; gobiernan MUX, ALU y memorias</span>
        </div>

        <!-- Where this drawing resolves branches vs. the Cycles model (they are independent knobs) -->
        <div v-if="spec && spec.branchStage" class="dp-branchinfo">
            <span class="dp-bi-lbl">Salto resuelto en</span>
            <b class="dp-bi-stage">{{ spec.branchStage }}</b>
            <span class="dp-bi-hint">en este esquema</span>
            <span v-if="branchMismatch" class="dp-bi-mismatch" title="El modelo de ciclos (vista Cycles) resuelve el salto en otra etapa: cambia su preset o el estilo del dibujo para que coincidan">
                · el modelo de ciclos usa <b>{{ cyclesBranchStage }}</b>
            </span>
            <button v-if="spec.style === 'ripes'" class="dp-pbtn dp-ripes-preset" title="Configura la vista Cycles como el procesador RV5S de Ripes: salto en EX, unidades de 1 ciclo, ecall drena el pipeline" @click="applyRipesPreset">
                Aplicar preset de ciclos "Ripes (RV5S)"
            </button>
        </div>

        <!-- Phase stepper: walk the current instruction's phases IF→ID→EX→MEM→WB -->
        <div v-if="spec && trace" class="dp-phase">
            <span class="dp-phase-lbl">Fase</span>
            <button class="dp-pbtn" :disabled="!allPhases && phaseCursor <= 1" title="Primera fase (IF)" @click="phaseToStart">⏮</button>
            <button class="dp-pbtn" :disabled="allPhases || phaseCursor <= 1" title="Fase anterior" @click="stepPhase(-1)">◀</button>
            <span class="dp-phase-now">{{ allPhases ? "todas" : currentPhase + " · " + phaseCursor + "/" + phaseCount }}</span>
            <button class="dp-pbtn" :disabled="allPhases || phaseCursor >= phaseCount" title="Fase siguiente" @click="stepPhase(1)">▶</button>
            <button class="dp-pbtn dp-clive" :class="{ active: allPhases }" title="Mostrar todas las fases a la vez (vista mono-ciclo)" @click="showAllPhases">Todo</button>
            <span class="dp-phase-hint">mono-ciclo: las fases ocurren en 1 ciclo; ▶ recorre fetch→decode→execute→mem→write-back de esta instrucción</span>
        </div>

        <!-- Student-mode help box -->
        <div v-if="studentMode && explain && helpMap[explain]" class="dp-help">
            <button class="dp-help-x" title="Close" @click="explain = null">×</button>
            <strong>{{ helpMap[explain].title }}</strong>
            <p>{{ helpMap[explain].desc }}</p>
            <p class="dp-look">Watch: {{ helpMap[explain].look }}</p>
        </div>
        <div v-else-if="studentMode && spec" class="dp-help hint">
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
                <input type="range" min="0" max="1" step="0.05" v-model.number="settings.highlight" title="Highlight strength (glow + border)" />
                <span class="dp-set-val">{{ Math.round(settings.highlight * 100) }}%</span>
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

        <!-- No drawn datapath for this architecture -->
        <p v-if="!spec" class="dp-note-cap">
            No drawn datapath for this architecture yet — use the <strong>Blocks</strong> view (it works for any ISA).
        </p>

        <svg
            v-else
            :viewBox="spec.viewBox"
            preserveAspectRatio="xMidYMid meet"
            class="dp-svg"
            :class="['scheme-' + settings.scheme, 'theme-' + (spec.theme ?? 'classic')]"
            :style="rootStyle"
        >
            <!-- Stage headers -->
            <g class="dp-headers">
                <text v-for="(h, i) in spec.headers" :key="'h' + i" :x="h.x" y="22" class="hd">{{ h.label }}</text>
            </g>

            <!-- Dashed stage separators -->
            <g class="dp-sep">
                <line v-for="(x, i) in spec.separators" :key="'s' + i" :x1="x" y1="34" :x2="x" y2="410" />
            </g>

            <!-- Pipeline registers -->
            <g class="dp-pipereg">
                <template v-for="(p, i) in spec.pipeRegs" :key="'p' + i">
                    <rect :x="p.x" y="40" width="13" height="360" />
                    <text :x="p.x + 6" y="416" class="lbl">{{ p.label }}</text>
                </template>
            </g>

            <!-- Static notes -->
            <text v-for="(n, i) in spec.notes" :key="'n' + i" :x="n.x" :y="n.y" class="note">{{ n.text }}</text>

            <!-- Wires (highlight + flow on the active stage) -->
            <g v-if="settings.showWires" class="dp-wires">
                <polyline
                    v-for="(w, i) in spec.wires"
                    :key="'w' + i"
                    :points="w.points"
                    :class="{ won: w.stage && act(w.stage), wsel: w.selImm && aluSrc, wb: w.dashed, wfwd: w.fwd && pipeInfo.fwdSrc[w.fwd.role] === w.fwd.from }"
                />
            </g>

            <!-- Functional blocks -->
            <g v-for="b in spec.blocks" :key="b.id" class="stage" :class="{ active: (b.stage && act(b.stage)) || unitOn(b), 'unit-state': !!b.unitState, 'unit-on': unitOn(b) }">
                <rect v-if="b.geom.kind === 'rect'" class="blk" :class="b.color" :x="b.geom.x" :y="b.geom.y" :width="b.geom.w" :height="b.geom.h" :rx="b.geom.rx" />
                <ellipse v-else-if="b.geom.kind === 'ellipse'" class="blk" :class="b.color" :cx="b.geom.cx" :cy="b.geom.cy" :rx="b.geom.rx" :ry="b.geom.ry" />
                <polygon v-else-if="b.geom.kind === 'polygon'" class="blk" :class="b.color" :points="b.geom.points" />
                <text :x="b.labelPos.x" :y="b.labelPos.y" class="bt" :class="{ sm: b.small, dark: b.dark }">{{ b.label }}</text>
                <text v-if="b.unitState && settings.showValues" :x="b.labelPos.x" :y="unitStateY(b)" class="note val ustate">{{ unitStateText(b) }}</text>
            </g>

            <!-- Operand values -->
            <template v-if="settings.showValues">
                <text v-for="(v, i) in spec.values" :key="'val' + i" :x="v.x" :y="v.y" class="note val">{{ v.kind === 'imm' ? immLabel(v.role) : v.kind === 'port' ? portLabel(v.role) : v.kind === 'fwd' ? fwdLabel(v.role) : valLabel(v.role) }}</text>
                <text :x="spec.wb.x" :y="spec.wb.y" class="note val">{{ op[destRole] ? valLabel(destRole) : 'WB Data' }}</text>
                <text v-if="spec.aluResult && unit === 'alu' && val[destRole] !== undefined" :x="spec.aluResult.x" :y="spec.aluResult.y" class="note val">= {{ val[destRole] }}</text>
                <text v-if="spec.muxSrc && trace" :x="spec.muxSrc.x" :y="spec.muxSrc.y" class="note val">{{ aluSrc ? 'imm' : spec.srcRegRole }}</text>
            </template>

            <!-- Optional execution units (shown per ISA extensions) -->
            <g class="dp-units">
                <g v-for="u in visibleUnits" :key="u.id" class="unit" :class="[u.fillClass, { 'unit-on': unit === u.unit && exReached }]">
                    <text :x="u.ulblPos.x" :y="u.ulblPos.y" class="ulbl">{{ u.ulbl }}</text>
                    <rect :x="u.rect.x" :y="u.rect.y" :width="u.rect.w" :height="u.rect.h" :rx="u.rect.rx" />
                    <text :x="u.labelPos.x" :y="u.labelPos.y">{{ u.label }}</text>
                </g>
            </g>

            <!-- Branch-taken path -->
            <g v-if="branched && act(branchStageDrawn) && spec.branchPath" class="dp-branch">
                <polyline :points="spec.branchPath.points" />
                <text :x="spec.branchPath.x" :y="spec.branchPath.y" class="note val">branch taken</text>
            </g>

            <!-- Student-mode question marks -->
            <g v-if="studentMode" class="dp-qmarks">
                <g v-for="q in qmarks" :key="q.id" class="qmark" @click="explain = q.id">
                    <circle :cx="q.x" :cy="q.y" r="9" />
                    <text :x="q.x" :y="q.y + 4">?</text>
                </g>
            </g>
        </svg>

        <p v-if="spec" class="dp-note-cap">
            <span v-if="spec.styleLabel && styles.length > 1" class="dp-cap-style">{{ spec.styleLabel }} · </span>{{ spec.caption }}
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

/* Style selector + branch-stage badge */
.dp-style { display: inline-flex; align-items: center; gap: 5px; font-size: 0.75rem; font-weight: 600; color: rgba(var(--bs-body-color-rgb), 0.85); }
.dp-style select { font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; }
.dp-branchinfo { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 0.72rem; color: rgba(var(--bs-body-color-rgb), 0.75); }
.dp-bi-lbl { font-weight: 700; color: rgba(var(--bs-body-color-rgb), 0.8); }
.dp-bi-stage { padding: 0 7px; border-radius: 10px; background: var(--dp-active-color, #ffb300); color: #000; }
.dp-bi-hint, .dp-bi-mismatch { font-style: italic; }
.dp-bi-mismatch { color: rgba(var(--bs-warning-rgb), 1); }
.dp-ripes-preset { font-size: 0.7rem; }

/* Phase stepper */
.dp-phase { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dp-phase-lbl { font-size: 0.72rem; font-weight: 700; color: rgba(var(--bs-body-color-rgb), 0.8); }
.dp-pbtn {
    border: 1px solid rgba(var(--bs-secondary-rgb), 0.4);
    background: rgba(var(--bs-secondary-rgb), 0.1);
    color: rgba(var(--bs-body-color-rgb), 0.9);
    border-radius: 4px; padding: 2px 10px; cursor: pointer; font-weight: 700; font-size: 0.8rem;
}
.dp-pbtn:hover:not(:disabled) { background: rgba(var(--bs-primary-rgb), 0.15); color: rgba(var(--bs-primary-rgb), 1); }
.dp-pbtn:disabled { opacity: 0.4; cursor: default; }
.dp-clive.active { background: rgba(var(--bs-primary-rgb), 0.85); color: #fff; border-color: transparent; }
.dp-phase-now { font-variant-numeric: tabular-nums; font-weight: 700; min-width: 64px; text-align: center; font-size: 0.78rem; }
.dp-phase-hint { font-size: 0.7rem; color: rgba(var(--bs-body-color-rgb), 0.55); font-style: italic; }

/* Control-signal strip */
.dp-control { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dp-control-lbl { font-size: 0.72rem; font-weight: 700; color: rgba(var(--bs-body-color-rgb), 0.8); }
.dp-sig {
    font-size: 0.68rem; font-family: ui-monospace, monospace; font-weight: 600;
    padding: 1px 6px; border-radius: 10px;
    border: 1px solid rgba(var(--bs-secondary-rgb), 0.4);
    background: rgba(var(--bs-secondary-rgb), 0.1);
    color: rgba(var(--bs-body-color-rgb), 0.55);
}
.dp-sig b { margin-left: 4px; font-weight: 800; }
.dp-sig.on {
    color: #000; border-color: transparent;
    background: var(--dp-active-color, #ffb300);
}
.dp-control-hint { font-size: 0.7rem; color: rgba(var(--bs-body-color-rgb), 0.55); font-style: italic; }

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
/* active forwarding (bypass) wire */
.dp-wires .wfwd {
    stroke: #43a047; stroke-width: 2.8; stroke-dasharray: 6 4;
    animation: dpflow 0.7s linear infinite;
}
.dp-wires .won {
    stroke: var(--dp-active-color, #ffb300);
    stroke-width: 2.6;
    stroke-dasharray: 6 4;
    animation: dpflow 0.7s linear infinite;
}
@keyframes dpflow { to { stroke-dashoffset: -10; } }
@media (prefers-reduced-motion: reduce) {
    .dp-wires .won, .dp-branch polyline { animation: none; }
}
.dp-branch polyline {
    fill: none;
    stroke: var(--dp-active-color, #ffb300);
    stroke-width: 2.4;
    stroke-dasharray: 6 4;
    animation: dpflow 0.7s linear infinite;
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
.stage.active { opacity: 1; filter: drop-shadow(0 0 var(--dp-glow, 2.5px) var(--dp-active-color, #ffb300)); }
.stage.active .blk { stroke: var(--dp-active-color, #ffb300); stroke-width: var(--dp-active-stroke, 1px); }

/* Optional execution units (M / F-D) */
.dp-units .unit { opacity: 0.4; transition: opacity 220ms ease, filter 220ms ease; }
.dp-units .unit.unit-on { opacity: 1; filter: drop-shadow(0 0 var(--dp-glow, 2.5px) var(--dp-active-color, #ffb300)); }
.dp-units rect { stroke: rgba(0, 0, 0, 0.35); stroke-width: 1; }
.dp-units .mul rect { fill: #7E57C2; }
.dp-units .fpu rect { fill: #00897B; }
.dp-units .unit-on rect { stroke: var(--dp-active-color, #ffb300); stroke-width: var(--dp-active-stroke, 1px); }
.dp-units text { font-size: 10px; font-weight: 700; text-anchor: middle; fill: #fff; }
.dp-units .ulbl { font-size: 8px; font-weight: 600; fill: rgba(var(--bs-body-color-rgb), 0.6); }
/* Pipeline-control units with live state (hazard / forwarding) */
.unit-state .ustate { font-size: 10px; text-anchor: middle; }
.unit-state.unit-on .blk { stroke: #43a047; }
.unit-state.unit-on { filter: drop-shadow(0 0 var(--dp-glow, 2.5px) #43a047); }
/* Ripes / VSRTL look: dark canvas, grey components, light wires */
.theme-ripes { background: #2b2b2b; border-color: #3c3c3c; }
.theme-ripes .hd { fill: #e6e6e6; }
.theme-ripes .lbl { fill: #bdbdbd; }
.theme-ripes .note { fill: #9e9e9e; }
.theme-ripes .dp-sep line { stroke: rgba(255, 255, 255, 0.22); }
.theme-ripes .dp-pipereg rect { fill: #6f6f6f; opacity: 0.95; }
.theme-ripes .blk { fill: #8e8e8e; stroke: #d6d6d6; }
.theme-ripes .bt { fill: #0e0e0e; }
.theme-ripes .dp-wires polyline { stroke: #cfcfcf; stroke-width: 1.4; }
.theme-ripes .dp-wires .wb { stroke: #a8a8a8; }
.theme-ripes .dp-wires .won { stroke: var(--dp-active-color, #ffb300); }
.theme-ripes .dp-wires .wfwd { stroke: #66bb6a; }
.theme-ripes .stage { opacity: 0.55; }
.theme-ripes .dp-qmarks circle { stroke: #fff; }

.dp-note-cap { font-size: 0.72rem; color: rgba(var(--bs-body-color-rgb), 0.6); margin: 0; }

[data-bs-theme="dark"] {
    .dp-svg { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.1); }
}
</style>
