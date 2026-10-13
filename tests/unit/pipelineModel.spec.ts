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
    RIPES_PIPELINE_CONFIG,
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

    it("forwarding ON: ALU→ALU RAW yields a bypass edge (EX→EX) and no stall", () => {
        const s = schedulePipeline([I({ writes: ["x5"] }), I({ reads: ["x5"], writes: ["x6"] })], cfg({ forwarding: true }));
        expect(s.stats.rawStalls).toBe(0);
        const f = s.forwards.find(e => e.reg === "x5");
        expect(f).toBeTruthy();
        expect(f!.toIndex).toBe(f!.fromIndex + 1); // consumer is the next instruction
        expect(f!.fromStage).toBe("EX");
        expect(f!.loadUse).toBe(false);
    });

    it("load-use forward comes from MEM and is flagged loadUse", () => {
        const s = schedulePipeline(
            [I({ isLoad: true, writes: ["x5"], mnemonic: "lw" }), I({ reads: ["x5"], writes: ["x6"] })],
            cfg({ forwarding: true }),
        );
        const f = s.forwards.find(e => e.reg === "x5");
        expect(f).toBeTruthy();
        expect(f!.fromStage).toBe("MEM");
        expect(f!.loadUse).toBe(true);
    });

    it("no forwarding edges when forwarding is OFF", () => {
        const s = schedulePipeline([I({ writes: ["x5"] }), I({ reads: ["x5"] })], cfg({ forwarding: false }));
        expect(s.forwards.length).toBe(0);
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

    it("default branch resolution is ID → 1-cycle penalty (P&H COD textbook)", () => {
        const s = schedulePipeline([I({ isBranch: true, branchTaken: true, mnemonic: "beq" }), I({ writes: ["x5"] })], cfg());
        expect(DEFAULT_PIPELINE_CONFIG.branchStage).toBe("ID");
        expect(s.stats.branchTakenStalls).toBe(1);
    });

    it("taken-branch penalty follows the resolution stage: ID=1, EX=2, MEM=3", () => {
        const prog = () => [I({ isBranch: true, branchTaken: true, mnemonic: "beq" }), I({ writes: ["x5"] })];
        expect(schedulePipeline(prog(), cfg({ branchStage: "ID" })).stats.branchTakenStalls).toBe(1);
        expect(schedulePipeline(prog(), cfg({ branchStage: "EX" })).stats.branchTakenStalls).toBe(2);
        expect(schedulePipeline(prog(), cfg({ branchStage: "MEM" })).stats.branchTakenStalls).toBe(3);
    });

    it("not-taken branch → no branch stalls", () => {
        const s = schedulePipeline([I({ isBranch: true, branchTaken: false, mnemonic: "beq" }), I({ writes: ["x5"] })], cfg());
        expect(s.stats.branchTakenStalls).toBe(0);
    });

    it("WAW: a short op after a long multiply stalls to keep WB in order", () => {
        const s = schedulePipeline(
            [I({ unit: "mul", mnemonic: "mul", writes: ["x1"] }), I({ writes: ["x1"], reads: ["x9"] })],
            cfg({ mulLatency: 7 }),
        );
        expect(s.stats.wawStalls).toBeGreaterThan(0);
        expect(s.rows[1].cells.some(c => c.stallKind === "WAW")).toBe(true);
    });

    it("delay slot hides one branch-taken bubble", () => {
        const noDS = schedulePipeline([I({ isBranch: true, branchTaken: true, mnemonic: "beq" }), I({ writes: ["x5"] })], cfg());
        const ds = schedulePipeline([I({ isBranch: true, branchTaken: true, mnemonic: "beq" }), I({ writes: ["x5"] })], cfg({ delaySlot: true }));
        expect(ds.stats.branchTakenStalls).toBe(noDS.stats.branchTakenStalls - 1);
    });

    it("BTB removes the penalty on a repeated taken branch", () => {
        const stream = [
            I({ isBranch: true, branchTaken: true, mnemonic: "beq", pc: "0x4" }),
            I({ writes: ["x5"] }),
            I({ isBranch: true, branchTaken: true, mnemonic: "beq", pc: "0x4" }),
        ];
        const off = schedulePipeline(stream, cfg({ btb: false }));
        const on = schedulePipeline(stream, cfg({ btb: true }));
        expect(on.stats.branchTakenStalls).toBeLessThan(off.stats.branchTakenStalls);
    });

    it("BTB misprediction when a learned-taken branch falls through", () => {
        const stream = [
            I({ isBranch: true, branchTaken: true, mnemonic: "beq", pc: "0x8" }),
            I({ writes: ["x5"] }),
            I({ isBranch: true, branchTaken: false, mnemonic: "beq", pc: "0x8" }),
        ];
        const s = schedulePipeline(stream, cfg({ btb: true }));
        expect(s.stats.branchMispredStalls).toBeGreaterThan(0);
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

describe("Ripes parity — ecall drain, link register, Sys stalls", () => {
    // t7 of the Ripes comparison (Ripes/tests): addi a0 · addi a7 · ecall · addi a7 · ecall
    const t7 = () => {
        _i = 0;
        return [
            I({ asm: "addi x10, x0, 42", mnemonic: "addi", writes: ["x10"] }),
            I({ asm: "addi x17, x0, 1", mnemonic: "addi", writes: ["x17"] }),
            I({ asm: "ecall", mnemonic: "ecall", type: "Syscall" }),
            I({ asm: "addi x17, x0, 10", mnemonic: "addi", writes: ["x17"] }),
            I({ asm: "ecall", mnemonic: "ecall", type: "Syscall" }),
        ];
    };

    it("ecallDrain OFF (textbook): the ecall is a plain instruction → 9 cycles", () => {
        const s = schedulePipeline(t7(), cfg({ ecallDrain: false }));
        expect(s.stats.cycles).toBe(9);
        expect(s.stats.syscallStalls).toBe(0);
    });

    it("ecallDrain ON reproduces Ripes RV32_5S on t7: 13 cycles, ecall held in EX", () => {
        const s = schedulePipeline(t7(), cfg({ ecallDrain: true }));
        expect(s.stats.cycles).toBe(13); // Ripes CLI: cycles=13
        // first ecall: IF3 ID4 EX5 then held 6,7 (addi x17 writes back in 6) → MEM 8, WB 9
        const e1 = s.rows[2];
        expect(stages(e1)).toEqual(["IF", "ID", "EX", "", "", "MEM", "WB"]);
        const held = e1.cells.filter(c => c.stalled);
        expect(held.every(c => c.stallKind === "Sys" && c.holdStage === "EX" && c.waitFor === "x17")).toBe(true);
        expect(held[0].readyCycle).toBe(7);
        // the next addi waits in ID while EX is held (Ripes: "-" in ID) → EX at 8
        const a2 = s.rows[3];
        expect(a2.cells.find(c => c.stage === "EX")?.cycle).toBe(8);
        expect(a2.cells.filter(c => c.stalled).every(c => c.stallKind === "Sys" && c.waitFor === "ecall")).toBe(true);
        // second ecall: EX 9, held 10,11, MEM 12, WB 13
        const e2 = s.rows[4];
        expect(e2.cells.find(c => c.stage === "WB")?.cycle).toBe(13);
        expect(s.stats.syscallStalls).toBeGreaterThan(0);
    });

    it("ecallDrain ON with nothing in flight → no hold", () => {
        _i = 0;
        const s = schedulePipeline(
            [I({ writes: ["x5"] }), I({ writes: ["x6"] }), I(), I(), I({ asm: "ecall", mnemonic: "ecall" })],
            cfg({ ecallDrain: true }),
        );
        expect(s.stats.syscallStalls).toBe(0);
        expect(s.stats.cycles).toBe(9);
    });

    it("RIPES_PIPELINE_CONFIG: branch in EX, single-cycle units, ecall drain", () => {
        expect(RIPES_PIPELINE_CONFIG.branchStage).toBe("EX");
        expect(RIPES_PIPELINE_CONFIG.mulLatency).toBe(1);
        expect(RIPES_PIPELINE_CONFIG.ecallDrain).toBe(true);
    });
});

describe("buildPipeInstr — link register of jal/jalr", () => {
    const T = (over: Record<string, unknown>) =>
        buildPipeInstr({ pc: "0x0", instructionHex: "0", asm: "", type: "", format: "J", microops: [], signals: {}, operands: {}, unit: "alu", ...over } as any, 0);

    it("jal rd, label writes rd (and reads nothing)", () => {
        const p = T({ asm: "jal x1, func", operands: { rd: "x1", imm: "16" }, branchTaken: true });
        expect(p.isBranch).toBe(true);
        expect(p.writes).toEqual(["x1"]);
        expect(p.reads).toEqual([]);
    });
    it("jalr rd, imm(rs1) writes rd and reads rs1; x0 destination is dropped", () => {
        const p = T({ asm: "jalr x0, 0(x1)", format: "I", operands: { rd: "x0", rs1: "x1", imm: "0" } });
        expect(p.writes).toEqual([]);
        expect(p.reads).toEqual(["x1"]);
    });
    it("a jal→ret pair yields a forwarding edge on the link register (branch in ID)", () => {
        // With the 1-cycle (ID) penalty the ret reaches EX while the jal is in WB → bypass.
        // (In EX the 2-cycle flush lets the jal retire first: no bypass needed, correctly.)
        _i = 0;
        const pair = () => [
            I({ asm: "jal x1, f", mnemonic: "jal", isBranch: true, branchTaken: true, writes: ["x1"] }),
            I({ asm: "jalr x0, 0(x1)", mnemonic: "jalr", isBranch: true, branchTaken: true, reads: ["x1"] }),
        ];
        expect(schedulePipeline(pair(), cfg({ branchStage: "ID" })).forwards.some(f => f.reg === "x1")).toBe(true);
        _i = 0;
        expect(schedulePipeline(pair(), cfg({ branchStage: "EX" })).forwards.some(f => f.reg === "x1")).toBe(false);
    });
});
