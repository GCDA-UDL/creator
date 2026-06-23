/**
 * Unit tests for the datapath spec resolver + normaliser (UdL extension).
 * Pure functions — no DOM, no engine. Run: `npm run test:unit`.
 */
import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import {
    resolveDatapathSpec,
    builtinSpecForPlugin,
    normalizeSpec,
    riscvSpec,
    mipsSpec,
} from "@/web/components/simulator/datapath/index";

describe("builtinSpecForPlugin", () => {
    it("maps known plugins to built-in specs", () => {
        expect(builtinSpecForPlugin("riscv")).toBe(riscvSpec);
        expect(builtinSpecForPlugin("RISCV")).toBe(riscvSpec); // case-insensitive
        expect(builtinSpecForPlugin("mips")).toBe(mipsSpec);
    });
    it("returns null for unknown / empty plugins", () => {
        expect(builtinSpecForPlugin("z80")).toBeNull();
        expect(builtinSpecForPlugin("")).toBeNull();
        expect(builtinSpecForPlugin(undefined)).toBeNull();
    });
});

describe("resolveDatapathSpec", () => {
    it("uses the built-in spec when there is no custom block", () => {
        expect(resolveDatapathSpec("riscv", null)).toBe(riscvSpec);
        expect(resolveDatapathSpec("z80", null)).toBeNull();
    });

    it("merges a partial custom spec onto the matching plugin baseline", () => {
        const custom = { caption: "My RV", blocks: [{ id: "pc", geom: { kind: "rect", x: 0, y: 0, w: 10, h: 10 }, label: "PC", labelPos: { x: 5, y: 8 } }] } as any;
        const spec = resolveDatapathSpec("riscv", custom)!;
        expect(spec.caption).toBe("My RV"); // overridden
        expect(spec.srcRegRole).toBe("rs2"); // inherited from riscv baseline
        expect(spec.blocks).toHaveLength(1); // replaced by custom
    });

    it("accepts a standalone custom spec for an unknown ISA", () => {
        const custom = { caption: "MyCPU", blocks: [{ id: "alu", geom: { kind: "rect", x: 0, y: 0, w: 10, h: 10 }, label: "ALU", labelPos: { x: 5, y: 8 } }] } as any;
        const spec = resolveDatapathSpec("acme", custom)!;
        expect(spec.caption).toBe("MyCPU");
        expect(spec.destRoles).toEqual(["rd"]); // default filled
        expect(spec.viewBox).toBe("0 0 940 430"); // default filled
    });

    it("ignores a custom block with no blocks (falls back to built-in)", () => {
        expect(resolveDatapathSpec("riscv", { caption: "x" } as any)).toBe(riscvSpec);
    });
});

describe("normalizeSpec", () => {
    it("fills safe defaults for a near-empty spec", () => {
        const s = normalizeSpec({} as any);
        expect(s.headers).toEqual([]);
        expect(s.blocks).toEqual([]);
        expect(s.destRoles).toEqual(["rd"]);
        expect(s.srcRegRole).toBe("rs2");
        expect(s.viewBox).toBe("0 0 940 430");
    });
});

describe("YAML `datapath:` block", () => {
    it("survives YAML parsing as plain data (numbers stay numbers)", () => {
        const archYaml = `
config:
  name: MyCPU
  plugin: acme
datapath:
  caption: "MyCPU datapath"
  blocks:
    - id: pc
      stage: IF
      geom: { kind: rect, x: 26, y: 190, w: 34, h: 44 }
      label: PC
      labelPos: { x: 43, y: 216 }
      color: green
  destRoles: ["rd"]
`;
        const obj = yaml.load(archYaml) as any;
        expect(obj.datapath).toBeTruthy();
        expect(obj.datapath.blocks[0].label).toBe("PC");
        expect(typeof obj.datapath.blocks[0].geom.x).toBe("number");

        // and it resolves + renders through the same path the app uses
        const spec = resolveDatapathSpec(obj.config.plugin, obj.datapath)!;
        expect(spec.caption).toBe("MyCPU datapath");
        expect(spec.blocks[0].label).toBe("PC");
    });
});
