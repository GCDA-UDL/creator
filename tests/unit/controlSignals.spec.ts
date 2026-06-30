/**
 * Unit tests for deriveControlSignals — the P&H single-cycle control signals
 * derived from the mnemonic (robust, ISA-type-independent). Pure function.
 */
import { describe, it, expect } from "vitest";
import { deriveControlSignals } from "@/core/trace/datapathTrace.mts";

describe("deriveControlSignals (P&H control signals)", () => {
    it("R-type (add): RegWrite, ALUSrc=0 (operands are registers)", () => {
        expect(deriveControlSignals("add x1, x2, x3")).toEqual({
            RegWrite: 1, ALUSrc: 0, MemRead: 0, MemWrite: 0, MemToReg: 0, Branch: 0,
        });
    });

    it("I-type ALU (addi): RegWrite=1 AND ALUSrc=1 (immediate feeds the ALU)", () => {
        const s = deriveControlSignals("addi t0, x0, 10");
        expect(s.RegWrite).toBe(1);
        expect(s.ALUSrc).toBe(1); // the textbook value the coarse CREATOR type got wrong
        expect(s.MemRead).toBe(0);
    });

    it("load (lw): RegWrite, ALUSrc, MemRead, MemToReg", () => {
        expect(deriveControlSignals("lw a2, 0(a1)")).toEqual({
            RegWrite: 1, ALUSrc: 1, MemRead: 1, MemWrite: 0, MemToReg: 1, Branch: 0,
        });
    });

    it("store (sw): ALUSrc + MemWrite, no RegWrite", () => {
        expect(deriveControlSignals("sw t2, 4(a1)")).toEqual({
            RegWrite: 0, ALUSrc: 1, MemRead: 0, MemWrite: 1, MemToReg: 0, Branch: 0,
        });
    });

    it("branch (beq): Branch=1, no RegWrite, ALUSrc=0", () => {
        const s = deriveControlSignals("beq t0, t1, label");
        expect(s.Branch).toBe(1);
        expect(s.RegWrite).toBe(0);
        expect(s.ALUSrc).toBe(0);
        expect(deriveControlSignals("bne a0, a1, L").Branch).toBe(1);
    });

    it("jump (jal): RegWrite + Branch", () => {
        const s = deriveControlSignals("jal ra, fin");
        expect(s.RegWrite).toBe(1);
        expect(s.Branch).toBe(1);
    });

    it("upper immediate (lui/auipc): RegWrite + ALUSrc", () => {
        for (const m of ["lui s0, 0x12345", "auipc t1, 0"]) {
            const s = deriveControlSignals(m);
            expect(s.RegWrite).toBe(1);
            expect(s.ALUSrc).toBe(1);
        }
    });

    it("system (ecall): all signals deasserted", () => {
        expect(deriveControlSignals("ecall")).toEqual({
            RegWrite: 0, ALUSrc: 0, MemRead: 0, MemWrite: 0, MemToReg: 0, Branch: 0,
        });
    });

    it("FP arithmetic (fadd.d) and mul behave as R-type (RegWrite, ALUSrc=0)", () => {
        expect(deriveControlSignals("fadd.d f4, f0, f2").RegWrite).toBe(1);
        expect(deriveControlSignals("fadd.d f4, f0, f2").ALUSrc).toBe(0);
        expect(deriveControlSignals("mul t5, t0, t1")).toEqual({
            RegWrite: 1, ALUSrc: 0, MemRead: 0, MemWrite: 0, MemToReg: 0, Branch: 0,
        });
    });
});
