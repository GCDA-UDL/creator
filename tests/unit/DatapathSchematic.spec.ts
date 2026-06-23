/**
 * Component tests for the data-driven datapath renderer (UdL extension).
 * Mounts DatapathSchematic with mock traces and asserts the rendered SVG.
 * Run: `npm run test:unit`.
 */
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import DatapathSchematic from "@/web/components/simulator/DatapathSchematic.vue";

/** A representative RV32IMFD R-type trace: add x7, x5, x6  →  x7 = 11. */
const riscvTrace = {
    pc: "0x0",
    instructionHex: "006283b3",
    asm: "add x7, x5, x6",
    type: "Arithmetic integer",
    format: "R",
    microops: [
        { stage: "IF", rtl: "" },
        { stage: "ID", rtl: "" },
        { stage: "EX", rtl: "" },
        { stage: "WB", rtl: "" },
    ],
    signals: { RegWrite: 1, ALUSrc: 0, MemRead: 0, MemWrite: 0, Branch: 0, MemToReg: 0 },
    operands: { rd: "x7", rs1: "x5", rs2: "x6" },
    operandValues: { rd: "11", rs1: "5", rs2: "6" },
    unit: "alu",
    extensions: ["I", "M", "F", "D"],
    branchTaken: false,
} as any;

const mountWith = (props: Record<string, unknown>) =>
    mount(DatapathSchematic, {
        props,
        global: { stubs: { "font-awesome-icon": true } },
    });

describe("DatapathSchematic — data-driven renderer", () => {
    it("renders the RISC-V datapath with its core blocks and caption", () => {
        const w = mountWith({ trace: riscvTrace, plugin: "riscv" });
        expect(w.find("svg").exists()).toBe(true);
        const txt = w.text();
        for (const label of ["PC", "IMem", "Reg File", "ALU", "DataMem"]) {
            expect(txt).toContain(label);
        }
        expect(txt).toContain("RV32I"); // caption
    });

    it("shows runtime operand values (rs1/rd)", () => {
        const txt = mountWith({ trace: riscvTrace, plugin: "riscv" }).text();
        expect(txt).toContain("rs1: x5 = 5");
        expect(txt).toContain("rd: x7 = 11");
    });

    it("shows the M (multiplier) unit only when the ISA has the M extension", () => {
        expect(mountWith({ trace: riscvTrace, plugin: "riscv" }).text()).toContain("MUL");
        const baseI = { ...riscvTrace, extensions: ["I"] };
        expect(mountWith({ trace: baseI, plugin: "riscv" }).text()).not.toContain("MUL");
    });

    it("marks the active stages coming from the trace", () => {
        const w = mountWith({ trace: riscvTrace, plugin: "riscv" });
        expect(w.findAll(".stage.active").length).toBeGreaterThan(0);
    });

    it("renders the MIPS-32 datapath with rs/rt naming", () => {
        const mipsTrace = {
            ...riscvTrace,
            operands: { rs: "x5", rt: "x6", rd: "x7" },
            operandValues: { rs: "5", rt: "6", rd: "11" },
        };
        const txt = mountWith({ trace: mipsTrace, plugin: "mips" }).text();
        expect(txt).toContain("MIPS-32");
        expect(txt).toContain("rs: x5 = 5");
    });

    it("falls back to a notice for an unsupported ISA (no spec)", () => {
        const w = mountWith({ trace: riscvTrace, plugin: "z80" });
        expect(w.find("svg").exists()).toBe(false);
        expect(w.text()).toContain("No drawn datapath");
    });

    it("renders the structure before any instruction (null trace)", () => {
        const w = mountWith({ trace: null, plugin: "riscv" });
        expect(w.find("svg").exists()).toBe(true);
        expect(w.text()).toContain("Reg File");
    });

    it("uses a custom YAML-style spec when provided", () => {
        const custom = {
            id: "custom",
            plugins: [],
            caption: "My custom CPU datapath",
            viewBox: "0 0 940 430",
            headers: [{ label: "Fetch", x: 95 }],
            separators: [182],
            pipeRegs: [{ x: 176, label: "IF/ID" }],
            wires: [],
            blocks: [
                { id: "pc", stage: "IF", geom: { kind: "rect", x: 26, y: 190, w: 34, h: 44 }, label: "MYPC", labelPos: { x: 43, y: 216 }, color: "green" },
            ],
            help: {},
            values: [],
            destRoles: ["rd"],
            srcRegRole: "rs2",
            wb: { x: 852, y: 360 },
        };
        const txt = mountWith({ trace: null, plugin: "riscv", customSpec: custom }).text();
        expect(txt).toContain("My custom CPU datapath");
        expect(txt).toContain("MYPC");
    });
});
