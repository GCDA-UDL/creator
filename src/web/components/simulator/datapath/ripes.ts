/**
 * RISC-V datapath spec in the style of Ripes' "5-Stage RISC-V Processor" (RV32_5S).
 *
 * Geometry follows Ripes' `rv5s_standard_layout.json` (component positions scaled
 * ×0.6 into our 940×430 viewBox) and the wiring follows the real netlist in
 * `rv5s.h`: two forwarding MUXes in front of the ALU, the branch comparator in EX
 * (branches resolved in EX, 2-cycle flush), a 3-input write-back MUX
 * (ALU / memory / PC+4), and the Hazard + Forwarding units drawn with live state.
 * Units Ripes does not have (multi-cycle M/FPU) are not drawn: its ALU does
 * everything in one cycle — pair this drawing with the "Ripes (RV5S)" cycles preset.
 *
 * Licence: LGPL-3.0 (same as CREATOR). Ripes itself is MIT (github.com/mortbopet/Ripes).
 */
import type { DatapathSpec, DpBlock, DpGeom } from "./spec";

/** A MUX drawn as a trapezoid (inputs on the wide left side), like VSRTL. */
const mux = (x: number, y: number, w = 24, h = 40): DpGeom => ({
    kind: "polygon",
    points: `${x},${y} ${x + w},${y + h * 0.2} ${x + w},${y + h * 0.8} ${x},${y + h}`,
});

const muxBlock = (id: string, stage: DpBlock["stage"], x: number, y: number, qx: number, qy: number): DpBlock => ({
    id,
    stage,
    geom: mux(x, y),
    label: "M",
    labelPos: { x: x + 11, y: y + 24 },
    color: "gray",
    small: true,
    qmark: { x: qx, y: qy },
});

export const ripesSpec: DatapathSpec = {
    id: "riscv-ripes",
    plugins: ["riscv"],
    style: "ripes",
    styleLabel: "Ripes (RV5S)",
    theme: "ripes",
    branchStage: "EX",
    caption:
        "RV32I datapath drawn like Ripes' 5-stage processor (RV5S): forwarding MUXes, branch resolved in EX, hazard & forwarding units.",
    viewBox: "0 0 940 430",
    headers: [
        { label: "IF", x: 110 },
        { label: "ID", x: 305 },
        { label: "EX", x: 536 },
        { label: "MEM", x: 738 },
        { label: "WB", x: 880 },
    ],
    separators: [202, 421, 664, 824],
    pipeRegs: [
        { x: 196, label: "IF/ID" },
        { x: 415, label: "ID/EX" },
        { x: 658, label: "EX/MEM" },
        { x: 818, label: "MEM/WB" },
    ],
    notes: [
        { text: "PC+4", x: 108, y: 108 },
        { text: "target", x: 640, y: 56 },
        { text: "WB data", x: 884, y: 366 },
    ],
    wires: [
        // ---- IF: next-PC loop, fetch
        { points: "44,208 54,208", stage: "IF" },
        { points: "88,208 112,208", stage: "IF" },
        { points: "96,188 96,130 104,130", stage: "IF" },
        { points: "128,130 196,130", stage: "IF" },
        { points: "128,122 140,122 140,96 10,96 10,198 20,198", stage: "IF" },
        { points: "179,196 196,196", stage: "IF" },
        // branch/jump target: ALU result back to the PC MUX (lit by branchPath when taken)
        { points: "634,221 648,221 648,60 10,60 10,216 20,216" },
        // ---- ID: decode, immediate, register read
        { points: "209,225 238,225", stage: "ID" },
        { points: "209,280 306,280", stage: "ID" },
        { points: "280,205 306,205", stage: "ID" },
        { points: "280,215 306,215", stage: "ID" },
        { points: "398,190 415,190", stage: "ID" },
        { points: "398,215 415,215", stage: "ID" },
        { points: "346,280 415,280", stage: "ID" },
        { points: "280,235 290,235 290,160 415,160", stage: "ID" },
        // decode → hazard unit (register indexes)
        { points: "280,250 296,250 296,336 690,336 690,132 709,132", dashed: true },
        // ---- EX: forwarding MUXes (rs1 / rs2), ALU-source MUXes, ALU, branch comparator
        { points: "428,190 450,190 450,181 482,181", stage: "EX" },
        { points: "671,166 680,166 680,150 468,150 468,191 482,191", fwd: { role: "rs1", from: "MEM" } },
        { points: "892,216 900,216 900,140 462,140 462,201 482,201", fwd: { role: "rs1", from: "WB" } },
        { points: "428,215 450,215 450,221 474,221", stage: "EX" },
        { points: "671,172 684,172 684,154 456,154 456,233 474,233", fwd: { role: "rs2", from: "MEM" } },
        { points: "892,216 904,216 904,136 450,136 450,245 474,245", fwd: { role: "rs2", from: "WB" } },
        { points: "506,191 510,191 510,171 516,171", stage: "EX" },
        { points: "428,165 504,165 504,195 516,195", stage: "EX" },
        { points: "540,183 550,183 550,190 558,190", stage: "EX" },
        { points: "498,233 508,233 508,255 524,255", stage: "EX" },
        { points: "428,280 516,280 516,279 524,279", stage: "EX", selImm: true },
        { points: "548,267 552,267 552,252 558,252", stage: "EX" },
        { points: "634,221 658,221", stage: "EX" },
        { points: "506,197 512,197 512,305 524,305", stage: "EX" },
        { points: "498,239 504,239 504,323 524,323", stage: "EX" },
        // branch decision → PC MUX select (control)
        { points: "566,314 580,314 580,345 12,345 12,224 20,224", stage: "EX", dashed: true },
        // store data (rs2) straight to EX/MEM
        { points: "498,239 506,239 506,286 652,286 652,236 658,236", stage: "EX" },
        // forwarding unit → MUX selects (control)
        { points: "709,300 700,300 700,352 490,352 490,253", dashed: true },
        // ---- MEM
        { points: "671,221 709,221", stage: "MEM" },
        { points: "671,236 700,236 700,250 709,250", stage: "MEM" },
        { points: "801,230 818,230", stage: "MEM" },
        { points: "671,221 684,221 684,186 818,186", stage: "MEM" },
        { points: "671,152 818,152", stage: "MEM" },
        // ---- WB: 3-way MUX (ALU / memory / PC+4) and the write-back bus
        { points: "831,152 850,152 850,204 868,204", stage: "WB" },
        { points: "831,186 850,186 850,216 868,216", stage: "WB" },
        { points: "831,230 850,230 850,228 868,228", stage: "WB" },
        { points: "892,216 912,216 912,370 330,370 330,238", stage: "WB", dashed: true },
        // hazard unit → front-end stall (PC / IF/ID enable, ID/EX clear) (control)
        { points: "709,120 690,120 690,100 70,100 70,188", dashed: true },
    ],
    blocks: [
        // IF
        muxBlock("pc_src", "IF", 20, 188, 50, 184),
        { id: "pc_reg", stage: "IF", geom: { kind: "rect", x: 54, y: 188, w: 34, h: 42, rx: 2 }, label: "PC", labelPos: { x: 71, y: 213 }, color: "gray", qmark: { x: 92, y: 184 } },
        { id: "pc_4", stage: "IF", geom: { kind: "polygon", points: "104,112 128,120 128,140 104,148 110,130" }, label: "+", labelPos: { x: 118, y: 134 }, color: "gray", small: true, qmark: { x: 134, y: 108 } },
        { id: "instr_mem", stage: "IF", geom: { kind: "rect", x: 112, y: 163, w: 67, h: 67, rx: 2 }, label: "Instr. mem", labelPos: { x: 145, y: 200 }, color: "gray", small: true, qmark: { x: 182, y: 160 } },
        // ID
        { id: "decode", stage: "ID", geom: { kind: "rect", x: 238, y: 196, w: 42, h: 59, rx: 2 }, label: "Decode", labelPos: { x: 259, y: 229 }, color: "gray", small: true, qmark: { x: 283, y: 192 } },
        { id: "registerFile", stage: "ID", geom: { kind: "rect", x: 306, y: 171, w: 92, h: 67, rx: 2 }, label: "Registers", labelPos: { x: 352, y: 208 }, color: "gray", qmark: { x: 402, y: 167 } },
        { id: "immediate", stage: "ID", geom: { kind: "rect", x: 306, y: 263, w: 40, h: 34, rx: 2 }, label: "Imm.", labelPos: { x: 326, y: 284 }, color: "gray", small: true, qmark: { x: 350, y: 259 } },
        // EX
        muxBlock("reg1_fw_src", "EX", 482, 171, 512, 167),
        muxBlock("reg2_fw_src", "EX", 474, 213, 504, 258),
        muxBlock("alu_op1_src", "EX", 516, 163, 546, 159),
        muxBlock("alu_op2_src", "EX", 524, 247, 554, 243),
        { id: "alu", stage: "EX", geom: { kind: "polygon", points: "558,171 634,196 634,247 558,272 574,221" }, label: "ALU", labelPos: { x: 604, y: 225 }, color: "gray", qmark: { x: 638, y: 190 } },
        { id: "branch", stage: "EX", geom: { kind: "rect", x: 524, y: 297, w: 42, h: 34, rx: 2 }, label: "Branch", labelPos: { x: 545, y: 318 }, color: "gray", small: true, qmark: { x: 570, y: 293 } },
        // MEM
        { id: "data_mem", stage: "MEM", geom: { kind: "rect", x: 709, y: 196, w: 92, h: 67, rx: 2 }, label: "Data mem", labelPos: { x: 755, y: 233 }, color: "gray", qmark: { x: 805, y: 192 } },
        { id: "hzunit", geom: { kind: "rect", x: 709, y: 112, w: 92, h: 40, rx: 2 }, label: "Hazard unit", labelPos: { x: 755, y: 136 }, color: "gray", small: true, qmark: { x: 805, y: 108 }, unitState: "hazard" },
        { id: "funit", geom: { kind: "rect", x: 709, y: 280, w: 92, h: 40, rx: 2 }, label: "Forwarding unit", labelPos: { x: 755, y: 304 }, color: "gray", small: true, qmark: { x: 805, y: 276 }, unitState: "forwarding" },
        // WB
        muxBlock("reg_wr_src", "WB", 868, 196, 898, 192),
    ],
    help: {
        pc_src: { title: "PC source MUX", desc: "Chooses the next PC: PC+4, or the branch/jump target computed by the ALU in EX (controlled by the branch unit / jump flag).", look: "In Ripes the taken decision is made in EX, so two already-fetched instructions are flushed (2-cycle penalty)." },
        pc_reg: { title: "PC — Program Counter", desc: "Holds the address of the instruction being fetched. The Hazard unit can freeze it (load-use / ecall stall).", look: "Its value appears as the 'pc' label." },
        pc_4: { title: "+4 adder", desc: "Computes PC + 4: the next sequential instruction (also carried down the pipeline as the link value for jal/jalr).", look: "Feeds both the PC MUX and the IF/ID register." },
        instr_mem: { title: "Instruction memory", desc: "Read-only program memory indexed by the PC.", look: "The fetched word goes into IF/ID." },
        decode: { title: "Decode", desc: "Extracts opcode, rs1, rs2, rd and the instruction type; also feeds the register indexes to the Hazard unit.", look: "In Ripes the control unit is a separate (hidden) block; CREATOR shows its signals in the strip above." },
        registerFile: { title: "Registers (x0–x31)", desc: "Reads rs1/rs2 in ID; written in WB. Ripes' register file has read-bypass: a value written in WB is visible to a read in ID of the same cycle.", look: "Operand values are shown next to the block." },
        immediate: { title: "Immediate", desc: "Builds the sign-extended immediate for I/S/B/U/J formats.", look: "Goes into ID/EX and reaches the ALU through the op2 MUX." },
        reg1_fw_src: { title: "Forwarding MUX (rs1)", desc: "Picks rs1 from the register file (ID), from the EX/MEM result (MEM) or from the write-back MUX (WB), as decided by the Forwarding unit.", look: "The label shows the chosen source; the matching bypass wire lights." },
        reg2_fw_src: { title: "Forwarding MUX (rs2)", desc: "Same as rs1, for the second operand (also the store data).", look: "lw→sw: the store's rs2 is a load-use hazard in Ripes (1 stall), not a bypass." },
        alu_op1_src: { title: "ALU op1 MUX", desc: "Selects rs1 or the PC (auipc / jal / branches) as the first ALU operand.", look: "PC for address-relative instructions." },
        alu_op2_src: { title: "ALU op2 MUX", desc: "Selects rs2 or the immediate as the second ALU operand (ALUSrc).", look: "The highlighted label shows which one is chosen." },
        alu: { title: "ALU", desc: "Arithmetic/logic, address computation and (in Ripes) multiply/divide — all in one cycle.", look: "Its result goes to EX/MEM, and back to the PC MUX as the branch/jump target." },
        branch: { title: "Branch comparator", desc: "Compares the (forwarded) operands in EX: eq/ne/lt/ge/ltu/geu. With the jump flag it selects the PC source.", look: "Branches are resolved in EX → taken branches flush IF/ID and ID/EX (2 cycles)." },
        data_mem: { title: "Data memory", desc: "Loads read it, stores write it, in the MEM stage.", look: "Address from EX/MEM (ALU result), store data from the rs2 forwarding MUX." },
        hzunit: { title: "Hazard detection unit", desc: "Stalls the front-end on a load-use hazard (load in EX whose rd is read in ID) and holds an ecall in EX until older register writes retire.", look: "Lights when the current instruction stalled; the Cycles view shows the same bubble." },
        funit: { title: "Forwarding unit", desc: "Compares rs1/rs2 in EX with the destination registers in MEM and WB and drives the two forwarding MUXes.", look: "Lights when an operand is bypassed; see the Cycles view's green forwarding marks." },
        reg_wr_src: { title: "Write-back MUX", desc: "Chooses what is written to rd: the ALU result, the loaded value, or PC+4 (jal/jalr link).", look: "Its output also feeds the forwarding MUXes (WB source)." },
        pipereg: { title: "Stage registers (IF/ID … MEM/WB)", desc: "Boundaries between the five stages. The Hazard unit can hold or clear them (stall / flush).", look: "Each holds the data and control of the instruction in that stage." },
    },
    extraQmarks: [{ id: "pipereg", x: 210, y: 46 }],
    values: [
        { kind: "port", role: "pc", x: 54, y: 178 },
        { kind: "operand", role: "rs1", x: 306, y: 166 },
        { kind: "operand", role: "rs2", x: 300, y: 252 },
        { kind: "imm", role: "imm", x: 350, y: 258 },
        { kind: "fwd", role: "rs1", x: 440, y: 166 },
        { kind: "fwd", role: "rs2", x: 440, y: 266 },
    ],
    destRoles: ["rd"],
    srcRegRole: "rs2",
    wb: { x: 736, y: 396 },
    aluResult: { x: 592, y: 165 },
    muxSrc: { x: 548, y: 243 },
    branchPath: { points: "634,221 648,221 648,60 10,60 10,216 20,216", x: 652, y: 76 },
    units: [],
};
