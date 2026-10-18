/**
 * Unit tests for the RISC-V `li` expansion policy (UdL extension).
 *
 * "standard" = the sequence emitted by the RISC-V toolchains (LLVM RISCVMatInt,
 * GNU as load_const) and by Ripes: addi | lui | lui+addi, the lui alone when the low
 * 12 bits are zero. "lui_addi" = always lui+addi above 12 bits (RARS' template,
 * CREATOR's historical behaviour). Run: `npm run test:unit`.
 */
import { describe, it, expect } from "vitest";
import { ARCH, LI_EXPANSION_MODES, DEFAULT_LI_EXPANSION, liExpansionMode } from "@/core/capi/arch/riscv.mjs";
import { architecture } from "@/core/core.mjs";

const li32 = (v: number | bigint, mode?: string) => ARCH.generateLoadImmediate32(v, "t0", mode).split(";");
const li64 = (v: number | bigint, mode?: string) => ARCH.generateLoadImmediate(v, "t0", mode).split(";");

describe("li expansion — standard (toolchain / Ripes)", () => {
    it("12-bit values → a single addi", () => {
        expect(li32(5)).toEqual(["addi t0, x0, 5"]);
        expect(li32(-1)).toEqual(["addi t0, x0, -1"]);
        expect(li32(2047)).toEqual(["addi t0, x0, 2047"]);
        expect(li32(-2048)).toEqual(["addi t0, x0, -2048"]);
        expect(li32(0)).toEqual(["addi t0, x0, 0"]);
    });
    it("low 12 bits zero → lui alone (the Ripes / lab_11 case: 0xFF0000)", () => {
        expect(li32(0xff0000)).toEqual(["lui t0, 0xff0"]);
        expect(li32(0x12345000)).toEqual(["lui t0, 0x12345"]);
    });
    it("general case → lui + addi, upper part rounded when bit 11 is set", () => {
        expect(li32(0x12345678)).toEqual(["lui t0, 0x12345", "addi t0, t0, 1656"]);
        expect(li32(0x7ffff800)).toEqual(["lui t0, 0x80000", "addi t0, t0, -2048"]);
        expect(li32(0xdeadbeef)).toEqual(["lui t0, 0xdeadc", "addi t0, t0, -273"]); // RISC-V asm manual example
    });
    it("RV32 accepts the operand as an unsigned 32-bit pattern (MMIO addresses)", () => {
        expect(li32(0xf00010a8)).toEqual(["lui t0, 0xf0001", "addi t0, t0, 168"]);
        expect(li32(0xf0001000)).toEqual(["lui t0, 0xf0001"]);
    });
    it("RV64 keeps its addiw after a lui and skips it when the low part is zero", () => {
        expect(li64(0x12345678)).toEqual(["lui t0, 0x12345", "addiw t0, t0, 1656"]);
        expect(li64(0xff0000)).toEqual(["lui t0, 0xff0"]);
    });
});

describe("li expansion — lui_addi (RARS-style, always two instructions above 12 bits)", () => {
    it("emits the addi even when the low 12 bits are zero", () => {
        expect(li32(0xff0000, "lui_addi")).toEqual(["lui t0, 0xff0", "addi t0, t0, 0"]);
        expect(li32(0x12345000, "lui_addi")).toEqual(["lui t0, 0x12345", "addi t0, t0, 0"]);
        expect(li64(0xff0000, "lui_addi")).toEqual(["lui t0, 0xff0", "addiw t0, t0, 0"]);
    });
    it("12-bit values are still a single addi; general values unchanged", () => {
        expect(li32(5, "lui_addi")).toEqual(["addi t0, x0, 5"]);
        expect(li32(0x12345678, "lui_addi")).toEqual(["lui t0, 0x12345", "addi t0, t0, 1656"]);
    });
});

describe("li expansion — policy from the architecture config", () => {
    it("defaults to standard; reads config.li_expansion when valid", () => {
        expect(DEFAULT_LI_EXPANSION).toBe("standard");
        expect(LI_EXPANSION_MODES).toEqual(["standard", "lui_addi"]);
        const arch = architecture as unknown as { config?: Record<string, unknown> };
        const saved = arch.config;
        try {
            arch.config = { li_expansion: "lui_addi" };
            expect(liExpansionMode()).toBe("lui_addi");
            expect(li32(0xff0000)).toEqual(["lui t0, 0xff0", "addi t0, t0, 0"]);
            arch.config = { li_expansion: "nonsense" };
            expect(liExpansionMode()).toBe("standard");
            arch.config = {};
            expect(li32(0xff0000)).toEqual(["lui t0, 0xff0"]);
        } finally {
            arch.config = saved;
        }
    });
});
