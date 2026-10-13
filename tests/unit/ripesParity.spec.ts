/**
 * Cycle-exact parity of CREATOR's pipeline model against Ripes (UdL extension).
 *
 * Fixtures in ./fixtures/ripes-rv5s/*.json were captured from the Ripes CLI
 * (`Ripes --mode cli --proc RV32_5S --pipeline`) for small RV32I programs that
 * exercise each hazard: RAW chains, load-use, taken / not-taken branches, loops,
 * jal/ret, ecall after a write, lw→sw. Each fixture lists the retired dynamic
 * instructions with Ripes' IF/WB cycles (0-based) and the total cycle count.
 *
 * With the "Ripes (RV5S)" configuration (branch in EX, single-cycle units,
 * forwarding, ecall drain) `schedulePipeline` must reproduce the same total cycles
 * and the same write-back cycle for every instruction. (Ripes draws an instruction
 * held in IF as "-" cells; CREATOR fetches it later — same timing, so IF cycles are
 * not compared, WB cycles are.)
 *
 * Regenerate the fixtures with Ripes/tests/make_fixtures.py (see that folder's README).
 * Run: `npm run test:unit`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { schedulePipeline, RIPES_PIPELINE_CONFIG, type PipeInstr } from "@/core/trace/pipelineModel.mts";

interface Fixture {
    program: string;
    cycles: number;
    retired: number;
    instrs: { asm: string; taken: boolean; if: number; wb: number; stalls: number }[];
}

const DIR = join(process.cwd(), "tests/unit/fixtures/ripes-rv5s");
const fixtures: Fixture[] = readdirSync(DIR)
    .filter(f => f.endsWith(".json"))
    .sort()
    .map(f => JSON.parse(readFileSync(join(DIR, f), "utf8")));

const LOAD = /^l[bhw]u?$/;
const STORE = /^s[bhw]$/;
const BRANCH = /^(b[a-z]+|j|jal|jalr|ret|jr)$/;

function unitOf(mnemonic: string): PipeInstr["unit"] {
    if (/^(mul|mulh|mulhu|mulhsu)$/.test(mnemonic)) return "mul";
    if (/^(div|divu|rem|remu)$/.test(mnemonic)) return "div";
    return "alu";
}

/** Ripes prints "lw x2 0 x1" / "beq x9 x6 12 <target>": mnemonic + space-separated operands. */
function pipeInstrFromRipes(asm: string, taken: boolean, index: number): PipeInstr {
    const tok = asm.trim().split(/\s+/);
    const mnemonic = tok[0]?.toLowerCase() ?? "";
    const regs = tok.slice(1).filter(t => /^x\d+$/.test(t));
    const isLoad = LOAD.test(mnemonic);
    const isStore = STORE.test(mnemonic);
    const isBranch = BRANCH.test(mnemonic);
    const nz = (r: string) => r !== "x0";
    let writes: string[] = [];
    let reads: string[] = [];
    if (mnemonic === "jal" || mnemonic === "jalr") {
        writes = regs.slice(0, 1).filter(nz);
        reads = regs.slice(1).filter(nz);
    } else if (isStore || isBranch) {
        reads = regs.filter(nz);
    } else if (regs.length) {
        writes = regs.slice(0, 1).filter(nz);
        reads = regs.slice(1).filter(nz);
    }
    return {
        index,
        pc: "0x" + (index * 4).toString(16),
        asm,
        mnemonic,
        type: mnemonic === "ecall" ? "Syscall" : "",
        unit: unitOf(mnemonic),
        reads,
        writes,
        isLoad,
        isStore,
        isBranch,
        branchTaken: taken,
    };
}

describe("Ripes RV32_5S parity (fixtures from Ripes CLI)", () => {
    it("has the eight comparison programs", () => {
        expect(fixtures.length).toBeGreaterThanOrEqual(8);
    });

    for (const fx of fixtures) {
        it(`${fx.program}: ${fx.cycles} cycles, same WB cycle for all ${fx.retired} retired instructions`, () => {
            const instrs = fx.instrs.map((i, k) => pipeInstrFromRipes(i.asm, i.taken, k));
            const s = schedulePipeline(instrs, { ...RIPES_PIPELINE_CONFIG });
            expect(s.stats.instructions).toBe(fx.retired);
            // Ripes counts cycles from 0 (the diagram's last WB column + 1); CREATOR from 1 (= last WB).
            expect(s.stats.cycles).toBe(fx.cycles);
            const if0 = fx.instrs[0]!.if;
            const c0 = s.rows[0]!.firstCycle;
            fx.instrs.forEach((i, k) => {
                const wb = s.rows[k]!.cells.find(c => c.stage === "WB")!.cycle;
                expect(wb - c0, `${fx.program} #${k} ${i.asm}`).toBe(i.wb - if0);
            });
        });
    }

    it("without the Ripes knobs the textbook model differs on the ecall program (documented difference)", () => {
        const fx = fixtures.find(f => f.program === "t7_ecall_stall");
        if (!fx) return;
        const instrs = fx.instrs.map((i, k) => pipeInstrFromRipes(i.asm, i.taken, k));
        const s = schedulePipeline(instrs, { ...RIPES_PIPELINE_CONFIG, ecallDrain: false });
        expect(s.stats.cycles).toBe(fx.cycles - 4); // two ecalls × 2 drain cycles
    });
});
