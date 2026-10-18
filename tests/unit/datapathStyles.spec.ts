/**
 * Unit + component tests for the datapath drawing styles (UdL extension):
 * spec resolution by style, the Ripes RV5S spec shape, and the Schematic's
 * style selector / branch badge / live hazard-forwarding state.
 * Run: `npm run test:unit`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import DatapathSchematic from "@/web/components/simulator/DatapathSchematic.vue";
import {
    resolveDatapathSpec,
    builtinSpecForPlugin,
    builtinSpecsForPlugin,
    normalizeSpec,
    riscvSpec,
    mipsSpec,
    ripesSpec,
    DEFAULT_STYLE,
} from "@/web/components/simulator/datapath/index";
import { CYCLES_CONFIG_KEY, loadCyclesConfig, saveCyclesConfig } from "@/web/components/simulator/pipelineConfigStore.mts";
import { RIPES_PIPELINE_CONFIG } from "@/core/trace/pipelineModel.mts";
import { clearExecutionHistory } from "@/core/trace/executionHistory.mts";
import type { DatapathTrace } from "@/core/trace/datapathTrace.mts";

type Emitter = { emit: (type: string, event: unknown) => void };

const trace = (asm: string, operands: Record<string, string>, values: Record<string, string>, extra: Record<string, unknown> = {}) =>
    ({
        pc: "0x0",
        instructionHex: "0",
        asm,
        type: "Arithmetic integer",
        format: "I",
        microops: [{ stage: "IF", rtl: "" }, { stage: "ID", rtl: "" }, { stage: "EX", rtl: "" }, { stage: "WB", rtl: "" }],
        signals: { RegWrite: 1 },
        operands,
        operandValues: values,
        unit: "alu",
        extensions: ["I", "M"],
        branchTaken: false,
        ...extra,
    }) as unknown as DatapathTrace;

const mountWith = (props: Record<string, unknown>) =>
    mount(DatapathSchematic, { props, global: { stubs: { "font-awesome-icon": true } } });

beforeEach(() => {
    localStorage.clear();
    clearExecutionHistory();
});

describe("style resolution", () => {
    it("RISC-V ships two styles (creator default, ripes); MIPS one", () => {
        expect(builtinSpecsForPlugin("riscv").map(s => s.style)).toEqual(["creator", "ripes"]);
        expect(builtinSpecsForPlugin("mips").map(s => s.style)).toEqual(["creator"]);
        expect(DEFAULT_STYLE).toBe("creator");
    });
    it("picks the spec by style and falls back to the plugin default", () => {
        expect(builtinSpecForPlugin("riscv")).toBe(riscvSpec);
        expect(builtinSpecForPlugin("riscv", "ripes")).toBe(ripesSpec);
        expect(builtinSpecForPlugin("riscv", "no-such-style")).toBe(riscvSpec);
        expect(builtinSpecForPlugin("mips", "ripes")).toBe(mipsSpec); // no Ripes drawing for MIPS
        expect(resolveDatapathSpec("riscv", null, "ripes")).toBe(ripesSpec);
    });
    it("a custom YAML drawing still wins over the style", () => {
        const custom = { blocks: [{ id: "a", geom: { kind: "rect" as const, x: 0, y: 0, w: 1, h: 1 }, label: "A", labelPos: { x: 0, y: 0 } }] };
        const r = resolveDatapathSpec("riscv", custom, "ripes");
        expect(r?.blocks[0]?.id).toBe("a");
    });
    it("normalizeSpec keeps the new fields", () => {
        const n = normalizeSpec({ style: "x", styleLabel: "X", theme: "ripes", branchStage: "EX" });
        expect(n.style).toBe("x");
        expect(n.theme).toBe("ripes");
        expect(n.branchStage).toBe("EX");
    });
});

describe("Ripes RV5S spec", () => {
    it("declares its style, theme and branch stage, and the live units", () => {
        expect(ripesSpec.plugins).toEqual(["riscv"]);
        expect(ripesSpec.style).toBe("ripes");
        expect(ripesSpec.theme).toBe("ripes");
        expect(ripesSpec.branchStage).toBe("EX");
        expect(ripesSpec.blocks.find(b => b.id === "hzunit")?.unitState).toBe("hazard");
        expect(ripesSpec.blocks.find(b => b.id === "funit")?.unitState).toBe("forwarding");
        // two forwarding MUXes, each fed from MEM and WB
        const fwd = ripesSpec.wires.filter(w => w.fwd).map(w => `${w.fwd!.role}:${w.fwd!.from}`).sort();
        expect(fwd).toEqual(["rs1:MEM", "rs1:WB", "rs2:MEM", "rs2:WB"]);
        expect(ripesSpec.values.some(v => v.kind === "fwd" && v.role === "rs1")).toBe(true);
        expect(ripesSpec.units).toEqual([]); // Ripes' ALU does mul/div in one cycle
    });
    it("every drawn block has a student-mode explanation", () => {
        for (const b of ripesSpec.blocks) expect(ripesSpec.help[b.id], b.id).toBeTruthy();
    });
    it("textbook specs document the stage their drawing resolves branches in", () => {
        expect(riscvSpec.branchStage).toBe("MEM");
        expect(mipsSpec.branchStage).toBe("MEM");
    });
});

describe("pipelineConfigStore", () => {
    it("round-trips through localStorage and notifies listeners", () => {
        let notified = 0;
        window.addEventListener("creator-cycles-config-changed", () => notified++);
        saveCyclesConfig({ branchStage: "EX", ecallDrain: true });
        expect(JSON.parse(localStorage.getItem(CYCLES_CONFIG_KEY) ?? "{}").branchStage).toBe("EX");
        expect(loadCyclesConfig().ecallDrain).toBe(true);
        expect(notified).toBe(1);
    });
});

describe("DatapathSchematic — styles", () => {
    it("RISC-V shows the style selector with both options; MIPS does not", () => {
        const w = mountWith({ trace: trace("add x7, x5, x6", { rd: "x7", rs1: "x5", rs2: "x6" }, {}), plugin: "riscv" });
        const opts = w.findAll(".dp-style option").map(o => o.text());
        expect(opts).toEqual(["CREATOR (P&H)", "Ripes (RV5S)"]);
        const m = mountWith({ trace: null, plugin: "mips" });
        expect(m.find(".dp-style").exists()).toBe(false);
    });

    it("the branch badge reflects the drawing and flags a different Cycles configuration", () => {
        const w = mountWith({ trace: null, plugin: "riscv" });
        expect(w.find(".dp-branchinfo").text()).toContain("MEM"); // P&H drawing
        expect(w.find(".dp-bi-mismatch").exists()).toBe(true); // Cycles default = ID
        saveCyclesConfig({ branchStage: "MEM" });
        return w.vm.$nextTick().then(() => {
            expect(w.find(".dp-bi-mismatch").exists()).toBe(false);
        });
    });

    it("selecting the Ripes style redraws with its units and offers the cycles preset", async () => {
        const w = mountWith({ trace: null, plugin: "riscv" });
        await w.find(".dp-style select").setValue("ripes");
        const txt = w.text();
        for (const label of ["Registers", "Hazard unit", "Forwarding unit", "Branch"]) expect(txt).toContain(label);
        expect(w.find("svg").classes()).toContain("theme-ripes");
        expect(w.find(".dp-branchinfo").text()).toContain("EX");
        expect(localStorage.getItem("creator-dp-style")).toBe("ripes");

        await w.find(".dp-ripes-preset").trigger("click");
        const cfg = loadCyclesConfig();
        expect(cfg.branchStage).toBe("EX");
        expect(cfg.ecallDrain).toBe(true);
        expect(cfg.mulLatency).toBe(RIPES_PIPELINE_CONFIG.mulLatency);
        expect(w.find(".dp-bi-mismatch").exists()).toBe(false);
    });

    it("Ripes drawing: forwarding + hazard state come from the executed-instruction history", async () => {
        localStorage.setItem("creator-dp-style", "ripes");
        // history: addi x5 ← …  ;  lw x6, 0(x5)  ;  addi x7, x6, 1 (load-use on x6)
        const { coreEvents } = await import("@/core/events.mts");
        const { startExecutionHistory } = await import("@/core/trace/executionHistory.mts");
        const { DATAPATH_TRACE_EVENT } = await import("@/core/trace/datapathTrace.mts");
        startExecutionHistory();
        const t1 = trace("addi x5, x0, 8", { rd: "x5", rs1: "x0", imm: "8" }, { rd: "8" });
        const t2 = trace("lw x6, 0(x5)", { rd: "x6", rs1: "x5", imm: "0" }, { rd: "42", rs1: "8" }, { type: "Memory access" });
        const t3 = trace("addi x7, x6, 1", { rd: "x7", rs1: "x6", imm: "1" }, { rd: "43", rs1: "42" });
        const bus = coreEvents as unknown as Emitter;
        bus.emit(DATAPATH_TRACE_EVENT, t1);
        bus.emit(DATAPATH_TRACE_EVENT, t2);
        const w = mountWith({ trace: t2, plugin: "riscv" });
        await w.vm.$nextTick(); // mounted() restores the stored style → re-render
        expect(w.text()).toContain("rs1 ← MEM"); // lw takes x5 from the EX/MEM result
        expect(w.findAll(".dp-wires .wfwd").length).toBe(1);

        bus.emit(DATAPATH_TRACE_EVENT, t3);
        await w.setProps({ trace: t3 });
        const txt = w.text();
        expect(txt).toContain("stall ×1"); // load-use bubble
        expect(txt).toContain("rs1 ← WB"); // then bypassed from MEM/WB
    });
});
