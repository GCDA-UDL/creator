/**
 * Datapath trace (UdL extension — T3 "visual Von Neumann / RISC-V datapath").
 *
 * Produces a structured, per-instruction trace of micro-operations and control
 * signals that a UI (DatapathView.vue) can animate, mimicking the KIT Von Neumann
 * datapath but for the *implemented* RISC-V ISA.
 *
 * Design constraints (see creator_riscv_udl_plan/03_visual_von_neumann_design.md):
 *  - Pure, side-effect-free builders: this module does NOT touch the execution
 *    engine. The engine (executor.mjs) only needs to call `buildDatapathTrace()`
 *    with data it already has, and `emitDatapathTrace()` to publish it.
 *  - Functional view, NOT a temporal/pipeline model (that is the T4 module).
 *
 * Licence: LGPL-3.0 (same as CREATOR).
 */

import { coreEvents } from "../events.mts";

/** Conceptual datapath stages (functional view). */
export type Stage = "IF" | "ID" | "EX" | "MEM" | "WB";

/** RISC-V base instruction formats (drive the control-signal mapping). */
export type RvFormat = "R" | "I" | "S" | "B" | "U" | "J" | "SYS" | "UNKNOWN";

/** A read/written datapath element (register, memory, immediate, PC, CSR). */
export interface DataRef {
    kind: "reg" | "mem" | "imm" | "pc" | "csr";
    /** Symbolic id, e.g. "x1"/"ra", a hex address, "imm", "pc". */
    id: string;
    /** Hex string value, when known. */
    value?: string;
}

/** One micro-operation within an instruction (RTL-level, didactic). */
export interface MicroOp {
    stage: Stage;
    /** Human-readable RTL, e.g. "Reg[x5] ← ALU". */
    rtl: string;
    reads?: DataRef[];
    writes?: DataRef[];
    /** Active control signals for this micro-op (RegWrite, ALUSrc, MemRead…). */
    signals?: Record<string, 0 | 1 | number | string>;
    /** Animated bus segments (from → to) with the value travelling. */
    buses?: { from: string; to: string; value?: string }[];
}

/** Full per-instruction datapath trace consumed by the UI. */
export interface DatapathTrace {
    /** Program counter of the instruction (hex). */
    pc: string;
    /** Raw machine code (hex). */
    instructionHex: string;
    /** Disassembled assembly text. */
    asm: string;
    /** Instruction category (matches stats.mts types). */
    type: string;
    /** Decoded base format (R/I/S/B/U/J…). */
    format: RvFormat;
    /** Ordered micro-operations (IF → … → WB). */
    microops: MicroOp[];
    /** For branches/jumps: whether the branch was taken. */
    branchTaken?: boolean;
    /** Exception/trap raised by the instruction, if any. */
    exception?: string;
    /** Active control signals for the instruction (RegWrite, ALUSrc, …). */
    signals?: Record<string, number | string>;
    /** Named operands by role for display, e.g. { rd: "x14", rs1: "x5", imm: "10" }. */
    operands?: Record<string, string>;
}

/** Event name emitted on the shared `coreEvents` bus for each instruction. */
export const DATAPATH_TRACE_EVENT = "datapath-trace" as const;

/**
 * Default control-signal template per RISC-V format. Starting point; refined
 * per-opcode as the datapath UI matures. Values are illustrative defaults.
 */
export const signalMap: Record<RvFormat, Record<string, 0 | 1>> = {
    R: { RegWrite: 1, ALUSrc: 0, MemRead: 0, MemWrite: 0, Branch: 0, MemToReg: 0 },
    I: { RegWrite: 1, ALUSrc: 1, MemRead: 0, MemWrite: 0, Branch: 0, MemToReg: 0 },
    S: { RegWrite: 0, ALUSrc: 1, MemRead: 0, MemWrite: 1, Branch: 0, MemToReg: 0 },
    B: { RegWrite: 0, ALUSrc: 0, MemRead: 0, MemWrite: 0, Branch: 1, MemToReg: 0 },
    U: { RegWrite: 1, ALUSrc: 1, MemRead: 0, MemWrite: 0, Branch: 0, MemToReg: 0 },
    J: { RegWrite: 1, ALUSrc: 0, MemRead: 0, MemWrite: 0, Branch: 1, MemToReg: 0 },
    SYS: { RegWrite: 0, ALUSrc: 0, MemRead: 0, MemWrite: 0, Branch: 0, MemToReg: 0 },
    UNKNOWN: { RegWrite: 0, ALUSrc: 0, MemRead: 0, MemWrite: 0, Branch: 0, MemToReg: 0 },
};

/** Maps a CREATOR instruction category (stats type) to a base RISC-V format. */
export function formatFromType(type: string): RvFormat {
    switch (type) {
        case "Arithmetic integer":
        case "Arithmetic floating point":
        case "Logic":
        case "Comparison":
        case "Transfer between registers":
            return "R";
        case "Memory access":
            return "I"; // refined to "S" for stores by the caller
        case "Conditional bifurcation":
            return "B";
        case "Unconditional bifurcation":
        case "Function call":
            return "J";
        case "Control":
        case "Syscall":
        case "I/O":
            return "SYS";
        default:
            return "UNKNOWN";
    }
}

/** Minimal data the engine passes in (all already available in executor.mjs). */
export interface TraceInput {
    pc: bigint | string;
    instructionHex: string;
    asm: string;
    type: string;
    /** Optional explicit format; otherwise derived from `type`. */
    format?: RvFormat;
    reads?: DataRef[];
    writes?: DataRef[];
    branchTaken?: boolean;
    exception?: string;
    /** Decoded named fields from the engine (name/type/value). */
    fields?: { name?: string; type?: string; value?: unknown }[];
}

const toHex = (v: bigint | string): string =>
    typeof v === "bigint" ? "0x" + v.toString(16) : v;

/** Renders a register operand with its ISA prefix (x for int, f for float). */
function regName(type: string | undefined, value: unknown): string {
    const v = String(value);
    if (type === "INT-Reg") return "x" + v;
    if (type === "SFP-Reg" || type === "DFP-Reg") return "f" + v;
    return v;
}

/** Builds a { role: rendered } operand map (rd/rs1/rs2/imm) from decoded fields. */
function buildOperands(
    fields?: { name?: string; type?: string; value?: unknown }[],
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of fields ?? []) {
        if (!f.name) continue;
        const isReg = ["INT-Reg", "Ctrl-Reg", "SFP-Reg", "DFP-Reg"].includes(
            f.type ?? "",
        );
        out[f.name] = isReg ? regName(f.type, f.value) : String(f.value);
    }
    return out;
}

/**
 * Builds a DatapathTrace from the data available at fetch-decode-execute time.
 * Generates a default F-D-E-M-WB micro-op skeleton; per-opcode refinement can
 * extend `microops` later without changing this signature.
 */
export function buildDatapathTrace(input: TraceInput): DatapathTrace {
    const format = input.format ?? formatFromType(input.type);
    const signals = signalMap[format] ?? signalMap.UNKNOWN;
    const pc = toHex(input.pc);
    const operands = buildOperands(input.fields);
    const rd = operands.rd ?? "rd";
    const src2 = signals.ALUSrc ? operands.imm ?? "imm" : operands.rs2 ?? "rs2";

    const microops: MicroOp[] = [
        { stage: "IF", rtl: `IR ← Mem[PC]; PC ← PC + 4`, reads: [{ kind: "pc", id: "pc", value: pc }] },
        { stage: "ID", rtl: `decode ${input.asm}`, reads: input.reads, signals },
        { stage: "EX", rtl: `ALU ← ${operands.rs1 ?? "rs1"} op ${src2}`, signals },
    ];
    if (signals.MemRead || signals.MemWrite) {
        microops.push({ stage: "MEM", rtl: signals.MemWrite ? `Mem[ALU] ← ${operands.rs2 ?? "rs2"}` : "MDR ← Mem[ALU]" });
    }
    if (signals.RegWrite) {
        microops.push({ stage: "WB", rtl: `Reg[${rd}] ← result`, writes: input.writes });
    }

    return {
        pc,
        instructionHex: input.instructionHex,
        asm: input.asm,
        type: input.type,
        format,
        microops,
        signals,
        operands,
        branchTaken: input.branchTaken,
        exception: input.exception,
    };
}

/** Publishes a datapath trace on the shared event bus for the UI to consume. */
export function emitDatapathTrace(trace: DatapathTrace): void {
    // mitt accepts arbitrary event keys; cast keeps it decoupled from the core's
    // typed CoreEvents map until the event is promoted there (next slice).
    (coreEvents as unknown as { emit: (t: string, e: unknown) => void }).emit(
        DATAPATH_TRACE_EVENT,
        trace,
    );
}
