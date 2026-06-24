/**
 * Unit tests for the WinMIPS64-style pipeline timing model (UdL T4).
 * Pure functions — no DOM, no engine. Run: `npm run test:unit`.
 */
import { describe, it, expect } from "vitest";
import {
    schedulePipeline,
    buildPipeInstr,
    isZeroReg,
    DEFAULT_PIPELINE_CONFIG,
    type PipeInstr,
    type PipelineConfig,
} from "@/core/trace/pipelineModel.mts";

const cfg = (over: Partial<PipelineConfig> = {}): PipelineConfig => ({
    ...DEFAULT_PIPELINE_CONFIG,
    ...over,
});

let _i = 0;
const I = (over: Partial<PipeInstr> = {}): PipeInstr => ({
    index: _i,
    pc: "0x" + (_i++ * 4).toString(16),
    asm: "add x1, x2, x3",
    mnemonic: "add",
    type: "Arithmetic integer",
    unit: "alu",
    reads: [],
    writes: [],
    isLoad: false,
    isStore: false,
    isBranch: false,
    branchTaken: false,
    ...over,
});

const stages = (row: { cells: { stage: string }[] }) => row.cells.map(c => c.stage);

describe("schedulePipeline — núcleo", () => {
    it("independent ALU ops: no stalls, 1 cycle apart", () => {
        const s = schedulePipeline([I({ writes: ["x1"] }), I({ writes: ["x2"] }), I({ writes: ["x3"] })], cfg());
        expect(s.stats.rawStalls).toBe(0);
        expect(s.stats.structStalls).toBe(0);
        expect(s.stats.cycles).toBe(7); // I1 WB=5, then +1 each
        expect(s.stats.instructions).toBe(3);
        expect(s.rows[0].firstCycle).toBe(1);
    });

    it("RAW with forwarding ON → no stall", () => {
        const s = schedulePipeline([I({ writes: ["x1"] }), I({ reads: ["x1"], writes: ["x2"] })], cfg({ forwarding: true }));
        expect(s.stats.rawStalls).toBe(0);
        expect(s.stats.cycles).toBe(6);
    });

    it("RAW with forwarding OFF → stalls, more cycles", () => {
        const on = schedulePipeline([I({ writes: ["x1"] }), I({ reads: ["x1"] })], cfg({ forwarding: true }));
        const off = schedulePipeline([I({ writes: ["x1"] }), I({ reads: ["x1"] })], cfg({ forwarding: false }));
        expect(off.stats.rawStalls).toBeGreaterThan(0);
        expect(off.stats.cycles).toBeGreaterThan(on.stats.cycles);
    });

    it("load-use with forwarding ON → exactly 1 bubble", () => {
        const s = schedulePipeline(
            [I({ isLoad: true, writes: ["x1"], mnemonic: "lw" }), I({ reads: ["x1"], writes: ["x2"] })],
            cfg({ forwarding: true }),
        );
        expect(s.stats.rawStalls).toBe(1);
    });

    it("two divides → structural stall + a 'Str' cell", () => {
        const s = schedulePipeline(
            [I({ unit: "div", mnemonic: "div", writes: ["x1"] }), I({ unit: "div", mnemonic: "div", writes: ["x4"] })],
            cfg({ divLatency: 4 }),
        );
        expect(s.stats.structStalls).toBeGreaterThan(0);
        expect(s.rows[1].cells.some(c => c.stallKind === "Str")).toBe(true);
        expect(stages(s.rows[0])).toContain("DIV");
    });

    it("multiply expands to M1..M{mulLatency}", () => {
        const s = schedulePipeline([I({ unit: "mul", mnemonic: "mul", writes: ["x1"] })], cfg({ mulLatency: 7 }));
        const st = stages(s.rows[0]);
        expect(st).toContain("M1");
        expect(st).toContain("M7");
    });

    it("taken branch → branch-taken stalls", () => {
        const s = schedulePipeline([I({ isBranch: true, branchTaken: true, mnemonic: "beq" }), I({ writes: ["x5"] })], cfg());
        expect(s.stats.branchTakenStalls).toBeGreaterThan(0);
    });

    it("not-taken branch → no branch stalls", () => {
        const s = schedulePipeline([I({ isBranch: true, branchTaken: false, mnemonic: "beq" }), I({ writes: ["x5"] })], cfg());
        expect(s.stats.branchTakenStalls).toBe(0);
    });

    it("RAW stall cell records the awaited register and its ready cycle", () => {
        const s = schedulePipeline(
            [I({ isLoad: true, mnemonic: "lw", writes: ["x1"] }), I({ reads: ["x1"], writes: ["x2"] })],
            cfg({ forwarding: true }),
        );
        const stall = s.rows[1].cells.find(c => c.stalled);
        expect(stall).toBeTruthy();
        expect(stall!.stallKind).toBe("RAW");
        expect(stall!.waitFor).toBe("x1");
        expect(typeof stall!.readyCycle).toBe("number");
    });

    it("structural stall cell points at the divider", () => {
        const s = schedulePipeline(
            [I({ unit: "div", mnemonic: "div", writes: ["x1"] }), I({ unit: "div", mnemonic: "div", writes: ["x4"] })],
            cfg({ divLatency: 4 }),
        );
        const stall = s.rows[1].cells.find(c => c.stallKind === "Str");
        expect(stall?.waitFor).toBe("divider");
    });

    it("empty stream → zeroed stats", () => {
        const s = schedulePipeline([], cfg());
        expect(s.stats.cycles).toBe(0);
        expect(s.stats.cpi).toBe(0);
        expect(s.rows).toHaveLength(0);
    });
});

describe("buildPipeInstr — ISA-agnostic derivation", () => {
    const T = (over: Record<string, unknown>) =>
        buildPipeInstr(
            {
                pc: "0x0",
                instructionHex: "0",
                asm: "add x7, x5, x6",
                type: "Arithmetic integer",
                format: "R",
                microops: [],
                signals: { RegWrite: 1 },
                operands: { rd: "x7", rs1: "x5", rs2: "x6" },
                unit: "alu",
                ...over,
            } as any,
            0,
        );

    it("RISC-V R-type: rd write, rs1/rs2 reads", () => {
        const p = T({});
        expect(p.writes).toEqual(["x7"]);
        expect(p.reads.sort()).toEqual(["x5", "x6"]);
        expect(p.isBranch).toBe(false);
    });

    it("load: isLoad, writes rd, reads base only (not imm)", () => {
        const p = T({ asm: "lw x5, 0(x6)", format: "I", signals: { RegWrite: 1, MemRead: 1 }, operands: { rd: "x5", rs1: "x6", imm: "0" } });
        expect(p.isLoad).toBe(true);
        expect(p.writes).toEqual(["x5"]);
        expect(p.reads).toEqual(["x6"]);
    });

    it("store: no writes, isStore, reads both regs", () => {
        const p = T({ asm: "sw x5, 0(x6)", format: "S", signals: { MemWrite: 1 }, operands: { rs1: "x6", rs2: "x5", imm: "0" } });
        expect(p.writes).toEqual([]);
        expect(p.isStore).toBe(true);
        expect(p.reads.sort()).toEqual(["x5", "x6"]);
    });

    it("branch: isBranch + branchTaken, no writes", () => {
        const p = T({ asm: "beq x5, x6, L", format: "B", signals: { Branch: 1 }, operands: { rs1: "x5", rs2: "x6", imm: "8" }, branchTaken: true });
        expect(p.isBranch).toBe(true);
        expect(p.branchTaken).toBe(true);
        expect(p.writes).toEqual([]);
    });

    it("zero register excluded from reads/writes", () => {
        const p = T({ operands: { rd: "x0", rs1: "x0", rs2: "x6" }, signals: { RegWrite: 1 } });
        expect(p.writes).toEqual([]);
        expect(p.reads).toEqual(["x6"]);
    });

    it("MIPS load writes rt (no rd), reads rs", () => {
        const p = T({ asm: "lw $5, 0($6)", format: "I", signals: { RegWrite: 1, MemRead: 1 }, operands: { rt: "$5", rs: "$6", imm: "0" } });
        expect(p.writes).toEqual(["$5"]);
        expect(p.reads).toEqual(["$6"]);
    });

    it("divide mnemonic refines unit to 'div'", () => {
        const p = T({ asm: "div x5, x6, x7", unit: "mul", operands: { rd: "x5", rs1: "x6", rs2: "x7" } });
        expect(p.unit).toBe("div");
    });

    it("toggling forwarding changes total cycles (instant recompute)", () => {
        const stream = [T({ operands: { rd: "x1", rs1: "x2", rs2: "x3" } }), T({ operands: { rd: "x4", rs1: "x1", rs2: "x3" } })];
        const on = schedulePipeline(stream, cfg({ forwarding: true })).stats.cycles;
        const off = schedulePipeline(stream, cfg({ forwarding: false })).stats.cycles;
        expect(off).toBeGreaterThan(on);
    });
});

describe("isZeroReg", () => {
    it("recognises zero registers across ISAs", () => {
        for (const z of ["x0", "$zero", "zero", "$0", "R0"]) expect(isZeroReg(z)).toBe(true);
        for (const r of ["x1", "$5", "t0", "ra"]) expect(isZeroReg(r)).toBe(false);
    });
});
