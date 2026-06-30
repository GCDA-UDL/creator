/**
 * Pipeline timing model (UdL extension — T4 "cycle/pipeline timeline").
 *
 * CREATOR's engine is a *functional* step-by-step executor with no cycle-accurate
 * pipeline. This module is a PURE, engine-independent, WinMIPS64-style scheduler:
 * given the ordered stream of *actually executed* instructions (each derived from a
 * `DatapathTrace`) plus a pipeline configuration, it synthesises a cycle-by-cycle
 * schedule (instruction × cycle grid) with stalls and aggregate statistics.
 *
 * Núcleo (this version): in-order scalar 5-stage pipeline (IF/ID/EX/MEM/WB),
 * multi-cycle pipelined multiplier (M1..Mn) and FP adder (A1..An), non-pipelined
 * divider (DIV), data forwarding (toggle), RAW hazards, structural hazard on the
 * divider + single write-back port, and a taken-branch penalty (resolved in EX,
 * predict-not-taken). Deferred to a later batch: WAW/WAR, Branch Target Buffer,
 * delay slot (config fields are reserved but inert here).
 *
 * It never mutates engine state; it only reads a list of plain `PipeInstr`.
 *
 * Licence: LGPL-3.0 (same as CREATOR).
 */
import type { DatapathTrace } from "./datapathTrace.mts";

/** Functional unit that an instruction exercises. */
export type PipeUnit = "alu" | "mul" | "fpu" | "div";

/** Stall categories drawn on the grid (núcleo). */
export type StallKind = "RAW" | "WAW" | "WAR" | "Str";

/** One executed instruction, normalised for scheduling (ISA-agnostic). */
export interface PipeInstr {
    index: number;
    pc: string;
    asm: string;
    mnemonic: string;
    type: string;
    unit: PipeUnit;
    /** Source register names actually read (zero register excluded). */
    reads: string[];
    /** Destination register names written (empty if none; zero register excluded). */
    writes: string[];
    isLoad: boolean;
    isStore: boolean;
    isBranch: boolean;
    branchTaken: boolean;
}

/** Pipeline configuration (the "Set Architecture" knobs). */
export interface PipelineConfig {
    forwarding: boolean;
    fpAddLatency: number; // FP adder pipeline depth (A1..An)
    mulLatency: number; // multiplier pipeline depth (M1..Mn)
    divLatency: number; // divider latency (non-pipelined DIV)
    /** Branch Target Buffer: predict-taken for branches already seen taken. */
    btb?: boolean;
    /** Delay slot: the instruction after a branch always issues (hides 1 penalty cycle). */
    delaySlot?: boolean;
    /**
     * Pipeline stage in which a conditional branch is resolved (predict-not-taken).
     * This sets the taken-branch penalty, following Patterson & Hennessy COD:
     *   - "ID"  → 1 bubble  (the textbook optimized pipeline; resolve in decode), DEFAULT.
     *   - "EX"  → 2 bubbles (WinMIPS64-style intermediate).
     *   - "MEM" → 3 bubbles (the un-optimized base pipeline).
     */
    branchStage?: "ID" | "EX" | "MEM";
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
    forwarding: true,
    fpAddLatency: 4,
    mulLatency: 7,
    divLatency: 24,
    btb: false,
    delaySlot: false,
    branchStage: "ID", // P&H COD textbook default: branch resolved in ID → 1-cycle penalty
};

export interface PipeCell {
    cycle: number;
    stage: string; // "IF" | "ID" | "EX" | "M1".. | "A1".. | "DIV" | "MEM" | "WB" | "" (stall)
    stalled: boolean;
    stallKind?: StallKind;
    /** For a stall: what the instruction is waiting for (register name or "divider"). */
    waitFor?: string;
    /** For a stall: the cycle in which that value/resource becomes available. */
    readyCycle?: number;
}

export interface PipeRow {
    instr: PipeInstr;
    cells: PipeCell[];
    firstCycle: number;
    lastCycle: number;
}

export interface PipelineStats {
    cycles: number;
    instructions: number;
    cpi: number;
    rawStalls: number;
    wawStalls: number;
    warStalls: number;
    structStalls: number;
    branchTakenStalls: number;
    branchMispredStalls: number;
    codeSize: number;
}

/** A data-forwarding (bypass) edge: a producer's result reused by a later consumer. */
export interface Forward {
    reg: string;
    fromIndex: number; // producing instruction (row index)
    fromCycle: number; // cycle the value leaves the producer (end of EX, or MEM for loads)
    fromStage: string; // "EX" | "M7" | … | "MEM"
    toIndex: number; // consuming instruction
    toCycle: number; // the consumer's EX cycle that receives the bypassed value
    loadUse: boolean; // load→use (the bypass still costs 1 bubble)
}

export interface PipelineSchedule {
    rows: PipeRow[];
    stats: PipelineStats;
    maxCycle: number;
    forwards: Forward[];
}

/** True for the architectural zero register across the ISAs CREATOR ships. */
export function isZeroReg(name: string): boolean {
    const n = String(name).trim().toLowerCase();
    return n === "x0" || n === "$zero" || n === "zero" || n === "$0" || n === "r0" || n === "0";
}

/** Register operand keys (RISC-V rd/rs1/rs2, MIPS rs/rt/rd, generic reg1/reg2…). */
const REG_KEY = /^(rd|rs1|rs2|rs3|rs|rt|reg\d+)$/;
const LOAD_RE = /^(l[bhwd]u?|ld|ll|lwl|lwr|lwc\d|ldc\d|fl[wd])$/;
const STORE_RE = /^(s[bhwd]|sc|swl|swr|swc\d|sdc\d|fs[wd])$/;
const BRANCH_RE = /^(b[a-z0-9]*|j|jr|jal|jalr)$/;

/**
 * Builds a normalised `PipeInstr` from a per-instruction `DatapathTrace`.
 *
 * ISA-agnostic and signal-independent: CREATOR types many MIPS instructions as
 * "Other" (so the datapath signals are all zero) and names operands generically
 * (reg1/reg2/val), so hazards are derived from the operand roles + the mnemonic:
 *   - load/store/branch are recognised by the mnemonic;
 *   - for everything else the FIRST register operand is the destination and the
 *     rest are sources (the assembly/decode convention is destination-first);
 *   - stores/branches have no destination (all registers are sources).
 */
export function buildPipeInstr(trace: DatapathTrace, index: number): PipeInstr {
    const operands: Record<string, string> = trace.operands ?? {};
    const mnemonic = (trace.asm ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";

    // Refine the execution unit: the datapath trace lumps divides under "mul" / "fpu".
    let unit: PipeUnit = (trace.unit as PipeUnit) ?? "alu";
    if (/^f?(div|rem)/.test(mnemonic) || mnemonic.includes("sqrt")) unit = "div";

    const isLoad = LOAD_RE.test(mnemonic);
    const isStore = STORE_RE.test(mnemonic);
    const isBranch = BRANCH_RE.test(mnemonic);

    // Register operands in decode (assembly) order.
    const regs: string[] = [];
    for (const key of Object.keys(operands)) {
        if (!REG_KEY.test(key)) continue;
        const v = operands[key];
        if (v != null && v !== "") regs.push(String(v));
    }

    let writes: string[] = [];
    let reads: string[] = [];
    if (isStore || isBranch) {
        reads = regs.filter(r => !isZeroReg(r));
    } else if (regs.length > 0) {
        const dest = regs[0];
        if (!isZeroReg(dest)) writes = [dest];
        reads = regs.slice(1).filter(r => !isZeroReg(r));
    }

    return {
        index,
        pc: trace.pc,
        asm: trace.asm,
        mnemonic,
        type: trace.type,
        unit,
        reads,
        writes,
        isLoad,
        isStore,
        isBranch,
        branchTaken: trace.branchTaken === true,
    };
}

/** EX-segment stage labels for an instruction's functional unit. */
function exStages(unit: PipeUnit, cfg: PipelineConfig): string[] {
    switch (unit) {
        case "mul":
            return Array.from({ length: Math.max(1, cfg.mulLatency) }, (_, i) => "M" + (i + 1));
        case "fpu":
            return Array.from({ length: Math.max(1, cfg.fpAddLatency) }, (_, i) => "A" + (i + 1));
        case "div":
            return Array.from({ length: Math.max(1, cfg.divLatency) }, () => "DIV");
        default:
            return ["EX"];
    }
}

/**
 * Schedules an ordered instruction stream through the pipeline and returns the
 * cycle grid + statistics. In-order scalar, WinMIPS64-style (see module header).
 */
export function schedulePipeline(
    instrs: PipeInstr[],
    cfg: PipelineConfig,
): PipelineSchedule {
    const rows: PipeRow[] = [];
    const regReady = new Map<string, number>(); // earliest cycle a consumer's EX can use the value
    const pendingWrite = new Map<string, number>(); // last writer's WB cycle per register (for WAW)
    const forwards: Forward[] = [];
    // latest writer per register, for detecting bypass (forwarding) edges
    const lastWriter = new Map<string, { index: number; fromCycle: number; fromStage: string; wbCycle: number }>();
    const wbBusy = new Set<number>();
    const btbSet = new Set<string>(); // branch PCs seen taken (Branch Target Buffer)
    const pcs = new Set<string>();
    let divFreeAt = 0;
    let nextIf = 1;
    let maxCycle = 0;
    let rawStalls = 0;
    let wawStalls = 0;
    let warStalls = 0; // not produced by an in-order single-issue pipeline; kept for parity
    let structStalls = 0;
    let branchTakenStalls = 0;
    let branchMispredStalls = 0;

    for (const instr of instrs) {
        pcs.add(instr.pc);
        const ifCycle = nextIf;
        const idCycle = ifCycle + 1;
        let exStart = idCycle + 1;
        let stallKind: StallKind | undefined;
        let waitFor: string | undefined;
        let readyCycle: number | undefined;

        // RAW hazard: wait until the latest-ready source operand is available.
        let rawReady = exStart;
        let rawReg: string | undefined;
        for (const r of instr.reads) {
            const ready = regReady.get(r);
            if (ready != null && ready > rawReady) {
                rawReady = ready;
                rawReg = r;
            }
        }
        if (rawReady > exStart) {
            rawStalls += rawReady - exStart;
            exStart = rawReady;
            stallKind = "RAW";
            waitFor = rawReg;
            readyCycle = rawReady;
        }
        // Structural hazard: non-pipelined divider busy.
        if (instr.unit === "div" && divFreeAt > exStart) {
            structStalls += divFreeAt - exStart;
            exStart = divFreeAt;
            stallKind = "Str";
            waitFor = "divider";
            readyCycle = divFreeAt;
        }

        const stages = exStages(instr.unit, cfg);
        const lat = stages.length;

        // WAW hazard: keep write-back in program order when a later (shorter) op
        // would otherwise commit before an earlier in-flight writer of the same reg.
        for (const w of instr.writes) {
            const prev = pendingWrite.get(w);
            if (prev == null) continue;
            const minExStart = prev - lat; // so this WB (exStart+lat+1) > prev
            if (minExStart > exStart) {
                wawStalls += minExStart - exStart;
                exStart = minExStart;
                stallKind = "WAW";
                waitFor = w;
                readyCycle = prev;
            }
        }

        const exEnd = exStart + lat - 1;
        if (instr.unit === "div") divFreeAt = exEnd + 1;

        const memCycle = exEnd + 1;
        let wbCycle = memCycle + 1;
        while (wbBusy.has(wbCycle)) {
            structStalls += 1;
            wbCycle += 1;
        }
        wbBusy.add(wbCycle);

        // Make written values available to later instructions.
        for (const w of instr.writes) {
            const ready = cfg.forwarding
                ? instr.isLoad
                    ? memCycle + 1 // load result forwards from MEM
                    : exEnd + 1 // ALU/FU result forwards from end of EX
                : wbCycle + 1; // no forwarding: read after WB
            // keep the latest writer's readiness
            const prev = regReady.get(w);
            regReady.set(w, prev != null ? Math.max(prev, ready) : ready);
            pendingWrite.set(w, wbCycle);
        }

        // Forwarding (bypass) edges: a still-in-flight producer feeds this EX, so the
        // value is taken from the pipeline (not the register file). Detected against the
        // PREVIOUS writers (before recording this instruction's own writes below).
        if (cfg.forwarding) {
            for (const r of instr.reads) {
                const w = lastWriter.get(r);
                if (w && w.index !== instr.index && w.wbCycle >= exStart) {
                    forwards.push({
                        reg: r,
                        fromIndex: w.index, fromCycle: w.fromCycle, fromStage: w.fromStage,
                        toIndex: instr.index, toCycle: exStart,
                        loadUse: w.fromStage === "MEM",
                    });
                }
            }
        }
        for (const w of instr.writes) {
            lastWriter.set(w, {
                index: instr.index,
                fromCycle: instr.isLoad ? memCycle : exEnd,
                fromStage: instr.isLoad ? "MEM" : stages[stages.length - 1],
                wbCycle,
            });
        }

        // Build the row cells.
        const cells: PipeCell[] = [
            { cycle: ifCycle, stage: "IF", stalled: false },
            { cycle: idCycle, stage: "ID", stalled: false },
        ];
        for (let c = idCycle + 1; c < exStart; c++) {
            cells.push({ cycle: c, stage: "", stalled: true, stallKind: stallKind ?? "RAW", waitFor, readyCycle });
        }
        for (let i = 0; i < lat; i++) {
            cells.push({ cycle: exStart + i, stage: stages[i], stalled: false });
        }
        cells.push({ cycle: memCycle, stage: "MEM", stalled: false });
        cells.push({ cycle: wbCycle, stage: "WB", stalled: false });

        rows.push({ instr, cells, firstCycle: ifCycle, lastCycle: wbCycle });
        maxCycle = Math.max(maxCycle, wbCycle);

        // Next fetch: propagate stalls upstream (younger instr waits in IF while
        // this one stalls in ID), then apply the branch penalty (resolved in EX).
        let nf = Math.max(ifCycle + 1, exStart - 1);
        if (instr.isBranch) {
            // taken-branch penalty = stage where the branch is resolved (predict-not-taken):
            // ID→1, EX→2, MEM→3 (P&H COD). Default "ID" = 1, the textbook optimized pipeline.
            const basePenalty = cfg.branchStage === "MEM" ? 3 : cfg.branchStage === "EX" ? 2 : 1;
            const predicted = !!cfg.btb && btbSet.has(instr.pc);
            let penalty = 0;
            let mispred = false;
            if (instr.branchTaken) {
                penalty = predicted ? 0 : basePenalty; // BTB correct-taken = 0; else flush
                btbSet.add(instr.pc);
            } else if (predicted) {
                penalty = basePenalty; // predicted taken but fell through → misprediction
                mispred = true;
            }
            if (cfg.delaySlot && penalty > 0) penalty -= 1; // delay slot hides one bubble
            if (penalty > 0) {
                if (mispred) branchMispredStalls += penalty;
                else branchTakenStalls += penalty;
                nf += penalty;
            }
        }
        nextIf = nf;
    }

    const instructions = instrs.length;
    const cycles = maxCycle;
    const stats: PipelineStats = {
        cycles,
        instructions,
        cpi: instructions > 0 ? cycles / instructions : 0,
        rawStalls,
        wawStalls,
        warStalls,
        structStalls,
        branchTakenStalls,
        branchMispredStalls,
        codeSize: pcs.size,
    };
    return { rows, stats, maxCycle, forwards };
}
