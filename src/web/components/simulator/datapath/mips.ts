/**
 * MIPS-32 datapath spec — the canonical single-cycle MIPS datapath (Patterson &
 * Hennessy). Same five-stage layout as RISC-V, with MIPS register naming
 * (rs/rt/rd, $0–$31). Licence: LGPL-3.0.
 */
import type { DatapathSpec } from "./spec";

export const mipsSpec: DatapathSpec = {
    id: "mips",
    plugins: ["mips"],
    caption:
        "MIPS-32 single-cycle datapath — the stage the current instruction goes through is highlighted.",
    viewBox: "0 0 940 430",
    headers: [
        { label: "Instruction Fetch", x: 95 },
        { label: "Instr. Decode / Reg Fetch", x: 285 },
        { label: "Execute / Addr. Calc", x: 485 },
        { label: "Memory Access", x: 680 },
        { label: "Write Back", x: 855 },
    ],
    separators: [182, 382, 592, 772],
    pipeRegs: [
        { x: 176, label: "IF/ID" },
        { x: 376, label: "ID/EX" },
        { x: 586, label: "EX/MEM" },
        { x: 766, label: "MEM/WB" },
    ],
    notes: [{ text: "Next PC", x: 30, y: 70 }],
    wires: [
        { points: "58,210 78,210", stage: "IF" },
        { points: "148,210 176,210", stage: "IF" },
        { points: "58,150 40,150 40,90 60,90", stage: "IF" },
        { points: "189,150 228,150", stage: "ID" },
        { points: "189,330 268,330", stage: "ID" },
        { points: "318,170 376,170", stage: "EX" },
        { points: "389,175 412,175", stage: "EX" },
        { points: "335,330 389,300 412,250", stage: "EX", selImm: true },
        { points: "452,205 470,205", stage: "EX" },
        { points: "540,205 586,205", stage: "EX" },
        { points: "599,210 628,210", stage: "MEM" },
        { points: "712,210 766,210", stage: "MEM" },
        { points: "779,210 800,210", stage: "WB" },
        { points: "840,210 880,210 880,360 250,360 250,240", stage: "WB", dashed: true },
    ],
    blocks: [
        { id: "pc", stage: "IF", geom: { kind: "rect", x: 26, y: 190, w: 34, h: 44, rx: 3 }, label: "PC", labelPos: { x: 43, y: 216 }, color: "green", qmark: { x: 64, y: 186 } },
        { id: "imem", stage: "IF", geom: { kind: "rect", x: 78, y: 178, w: 70, h: 68, rx: 4 }, label: "IMem", labelPos: { x: 113, y: 216 }, color: "red", qmark: { x: 150, y: 174 } },
        { id: "add", stage: "IF", geom: { kind: "polygon", points: "60,70 96,84 96,116 60,130 70,100" }, label: "Add", labelPos: { x: 80, y: 104 }, color: "blue", small: true, qmark: { x: 100, y: 64 } },
        { id: "regfile", stage: "ID", geom: { kind: "rect", x: 228, y: 135, w: 90, h: 95, rx: 4 }, label: "Reg File", labelPos: { x: 273, y: 186 }, color: "greenlt", qmark: { x: 322, y: 131 } },
        { id: "signext", stage: "ID", geom: { kind: "ellipse", cx: 300, cy: 330, rx: 34, ry: 22 }, label: "SignExt", labelPos: { x: 300, y: 334 }, color: "yellow", small: true, dark: true, qmark: { x: 336, y: 312 } },
        { id: "muxex", stage: "EX", geom: { kind: "ellipse", cx: 430, cy: 200, rx: 20, ry: 30 }, label: "MUX", labelPos: { x: 430, y: 204 }, color: "gray", small: true, qmark: { x: 448, y: 174 } },
        { id: "alu", stage: "EX", geom: { kind: "polygon", points: "470,175 540,195 540,215 470,235 488,205" }, label: "ALU", labelPos: { x: 500, y: 209 }, color: "cyan", qmark: { x: 544, y: 178 } },
        { id: "zero", stage: "EX", geom: { kind: "rect", x: 470, y: 120, w: 46, h: 26, rx: 3 }, label: "ZERO?", labelPos: { x: 493, y: 137 }, color: "white", small: true, dark: true, qmark: { x: 520, y: 118 } },
        { id: "datamem", stage: "MEM", geom: { kind: "rect", x: 628, y: 176, w: 84, h: 68, rx: 4 }, label: "DataMem", labelPos: { x: 670, y: 214 }, color: "red", qmark: { x: 716, y: 172 } },
        { id: "muxmem", stage: "MEM", geom: { kind: "ellipse", cx: 700, cy: 78, rx: 20, ry: 26 }, label: "MUX", labelPos: { x: 700, y: 82 }, color: "gray", small: true, qmark: { x: 722, y: 56 } },
        { id: "muxwb", stage: "WB", geom: { kind: "ellipse", cx: 820, cy: 210, rx: 20, ry: 30 }, label: "MUX", labelPos: { x: 820, y: 214 }, color: "gray", small: true, qmark: { x: 840, y: 186 } },
    ],
    help: {
        pc: { title: "PC — Program Counter", desc: "Holds the address of the instruction being executed.", look: "It increases by 4 each step, or jumps to a target on branches/jumps." },
        imem: { title: "Instruction Memory", desc: "Stores the program. The PC indexes it to fetch the 32-bit instruction (IF stage).", look: "The 'Instruction' field at the top shows the fetched instruction." },
        add: { title: "Adder (Next PC)", desc: "Computes PC + 4 and the branch target (PC + 4 + offset×4).", look: "The branch target path is used when a branch is taken." },
        regfile: { title: "Register File ($0–$31)", desc: "Reads source registers rs/rt in ID and writes the destination (rd or rt) in WB.", look: "rs/rt feed the ALU; the result is written back at the end (WB)." },
        signext: { title: "Sign Extend", desc: "Extends the 16-bit immediate/offset to 32 bits.", look: "Used when ALUSrc = 1 (the immediate goes into the ALU instead of rt)." },
        muxex: { title: "ALU source MUX", desc: "Selects the ALU's second operand: rt (R-type) or the sign-extended immediate (I-type).", look: "Controlled by ALUSrc — the highlighted label shows which one is chosen." },
        alu: { title: "ALU", desc: "Arithmetic-Logic Unit: add/sub/and/or/slt… or the effective address for lw/sw.", look: "Its result goes to Write-Back, or to Data Memory for load/store." },
        zero: { title: "ZERO? (branch test)", desc: "Zero flag from the ALU used to decide if a conditional branch is taken.", look: "Relevant for beq/bne." },
        datamem: { title: "Data Memory", desc: "Main data memory. lw reads it (MemRead); sw writes it (MemWrite), in the MEM stage.", look: "Only active for load/store instructions." },
        muxmem: { title: "Next-PC MUX", desc: "Chooses the next PC: PC + 4 or the branch/jump target.", look: "Switches to the target when a branch is taken." },
        muxwb: { title: "Write-Back MUX", desc: "Chooses what is written to the destination register: the ALU result or the value loaded from memory (MemToReg).", look: "For lw it picks memory data; otherwise the ALU result." },
        pipereg: { title: "Stage registers (IF/ID … MEM/WB)", desc: "Boundaries between the five stages (Fetch, Decode, Execute, Memory, Write-Back).", look: "In this functional view they delimit the phases the instruction goes through." },
    },
    extraQmarks: [{ id: "pipereg", x: 190, y: 46 }],
    values: [
        { kind: "operand", role: "rs", x: 196, y: 146 },
        { kind: "operand", role: "rt", x: 196, y: 166 },
        { kind: "imm", role: "imm", x: 196, y: 326 },
    ],
    destRoles: ["rd", "rt"],
    srcRegRole: "rt",
    wb: { x: 852, y: 360 },
    aluResult: { x: 556, y: 200 },
    muxSrc: { x: 430, y: 252 },
    branchPath: { points: "540,188 566,92 678,84", x: 568, y: 74 },
};
