/**
 * Datapath drawing spec (UdL extension — per-architecture datapath schematics).
 *
 * A `DatapathSpec` is *pure data*: it fully describes how to draw an architecture's
 * datapath (blocks, wires, pipeline registers, value anchors, optional units and
 * student-mode help). The generic renderer `DatapathSchematic.vue` consumes a spec
 * and binds it to the live `DatapathTrace` (active stages, operand values, MUX
 * source, branch path, M/FPU units).
 *
 * Because it is plain data, the SAME shape can be authored in an architecture YAML
 * under a `datapath:` block, enabling *custom* architectures to ship their own
 * drawing. Resolution order (see ./index.ts):
 *   1. `architecture.datapath` (custom, from YAML)  →  2. built-in spec by plugin
 *   →  3. none (the UI falls back to the data-driven "Blocks" view).
 *
 * Licence: LGPL-3.0 (same as CREATOR).
 */
import type { Stage } from "@/core/trace/datapathTrace.mts";

/** Colour tokens (mapped to fills in the renderer's CSS; theme-aware). */
export type DpColor =
    | "green"
    | "greenlt"
    | "red"
    | "blue"
    | "cyan"
    | "yellow"
    | "gray"
    | "white";

/** A point used for a label or a question-mark badge. */
export interface DpPoint {
    x: number;
    y: number;
}

/** Block geometry: one of rect / ellipse / polygon. */
export type DpGeom =
    | { kind: "rect"; x: number; y: number; w: number; h: number; rx?: number }
    | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
    | { kind: "polygon"; points: string };

/** Student-mode explanation for an element. */
export interface DpHelp {
    title: string;
    desc: string;
    look: string;
}

/** A functional block (PC, register file, ALU, MUX, memory…). */
export interface DpBlock {
    id: string;
    /** Stage it belongs to; drives the active-highlight. Omit for a neutral block. */
    stage?: Stage;
    geom: DpGeom;
    label: string;
    labelPos: DpPoint;
    color?: DpColor;
    /** Dark label text (for light-filled blocks). */
    dark?: boolean;
    /** Smaller label font. */
    small?: boolean;
    /** Where to place the student-mode "?" badge (its help is looked up by `id`). */
    qmark?: DpPoint;
}

/** A representative wire; highlights/flows when its stage is active. */
export interface DpWire {
    points: string;
    stage?: Stage;
    /** Dashed (e.g. the write-back bus). */
    dashed?: boolean;
    /** Highlight this wire when the ALU takes the immediate (ALUSrc = 1). */
    selImm?: boolean;
}

/** A static text note (e.g. "Next PC"). */
export interface DpNote {
    text: string;
    x: number;
    y: number;
}

/** An operand value anchor (renders "role: reg = value" or the immediate). */
export interface DpValue {
    kind: "operand" | "imm";
    role: string;
    x: number;
    y: number;
}

/** An optional execution unit shown only when the ISA has the extension. */
export interface DpUnit {
    id: string;
    /** ISA extension that must be present for this unit to be drawn. */
    extReq: "M" | "FP";
    /** Trace unit value that lights this block. */
    unit: "mul" | "fpu";
    /** CSS fill class. */
    fillClass: "mul" | "fpu";
    rect: { x: number; y: number; w: number; h: number; rx?: number };
    label: string;
    labelPos: DpPoint;
    ulbl: string;
    ulblPos: DpPoint;
    qmark?: DpPoint;
}

/** Full per-architecture datapath spec. Also the schema for a YAML `datapath:` block. */
export interface DatapathSpec {
    id: string;
    /** Architecture `plugin` keys this built-in spec serves (e.g. ["riscv"]). */
    plugins: string[];
    caption: string;
    viewBox: string;
    headers: { label: string; x: number }[];
    /** X positions of the dashed stage separators. */
    separators: number[];
    pipeRegs: { x: number; label: string }[];
    notes?: DpNote[];
    wires: DpWire[];
    blocks: DpBlock[];
    /** Explanations keyed by element id (blocks, units, extra qmarks). */
    help: Record<string, DpHelp>;
    /** Question marks not tied to a drawn block (e.g. the pipeline registers). */
    extraQmarks?: { id: string; x: number; y: number }[];
    values: DpValue[];
    /** Destination operand roles, tried in order (RISC-V: ["rd"]; MIPS: ["rd","rt"]). */
    destRoles: string[];
    /** Second ALU source register role used in the MUX-source label (rs2 / rt). */
    srcRegRole: string;
    /** Write-back value anchor. */
    wb: DpPoint;
    /** ALU-result value anchor. */
    aluResult?: DpPoint;
    /** ALU-source ("imm" vs srcRegRole) label anchor. */
    muxSrc?: DpPoint;
    /** Branch-taken path: wire + label position. */
    branchPath?: { points: string; x: number; y: number };
    units?: DpUnit[];
}
