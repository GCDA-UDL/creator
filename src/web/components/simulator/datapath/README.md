# Datapath drawings (UdL extension)

The simulator's **Datapath → Schematic** view draws the datapath of the loaded
architecture and animates it from the live execution trace (active stages,
operand values, MUX source, branch path, optional M/FPU units).

The drawing is **pure data** (a `DatapathSpec`). It is resolved in this order:

1. **`datapath:` block in the architecture YAML** — a *custom* drawing.
2. Built-in spec by architecture `plugin` — [`riscv.ts`](./riscv.ts), [`mips.ts`](./mips.ts).
3. None → the UI shows the generic **Blocks** view (works for any ISA).

So **standard ISAs need nothing** (RISC-V and MIPS draw automatically). Authoring
a `datapath:` block lets a **custom architecture** ship its own drawing.

## Where it lives

The renderer ([`DatapathSchematic.vue`](../DatapathSchematic.vue)) is generic and
decoupled: it only takes a `DatapathSpec` + a `DatapathTrace`. Specs are plain
data, so the SAME shape is used in TypeScript (built-ins) and in YAML (custom).
Types: [`spec.ts`](./spec.ts). JSON schema for editors/validation:
[`/docs/schema/datapath.json`](../../../../docs/schema/datapath.json).

## How the drawing binds to execution

- **Stages**: every block/wire may declare a `stage` (`IF`/`ID`/`EX`/`MEM`/`WB`).
  It lights up when the current instruction passes through that stage.
- **Operand values**: `values` anchors reference operand **roles by the names the
  decoder produces** — e.g. RISC-V uses `rs1`/`rs2`/`rd`/`imm`, MIPS uses
  `rs`/`rt`/`rd`/`imm`. A custom ISA uses whatever its instruction fields are named.
- **`destRoles`**: destination roles tried in order for the write-back / ALU-result
  value (RISC-V `["rd"]`, MIPS `["rd","rt"]`).
- **`srcRegRole`**: the second ALU source register role for the MUX label (`rs2`/`rt`).
- **`units`**: optional `M` (multiplier) / `FP` (FPU) blocks, drawn only when the
  loaded ISA exposes that extension and lit when the instruction uses it.
- **Coordinates**: SVG user units inside `viewBox` (built-ins use `0 0 940 430`).
- **Colors**: tokens `green greenlt red blue cyan yellow gray white` (theme-aware).

A custom spec may be **partial**: if the architecture's `plugin` matches a built-in
(e.g. `riscv`), your `datapath:` fields are merged **onto that baseline**, so you can
override just the caption or a few labels and inherit the rest. Missing fields are
filled with safe defaults, so a partial block never breaks the view.

## Minimal example (custom architecture YAML)

Add a top-level `datapath:` block to your `architecture.yml`:

```yaml
# … your existing config, register_files, instructions, memory_layout …

datapath:
  caption: "MyCPU — single-cycle datapath"
  viewBox: "0 0 940 430"
  headers:
    - { label: "Fetch", x: 95 }
    - { label: "Execute", x: 485 }
    - { label: "Write Back", x: 855 }
  separators: [182, 592]
  pipeRegs:
    - { x: 176, label: "IF/EX" }
    - { x: 586, label: "EX/WB" }
  wires:
    - { points: "58,210 78,210", stage: "IF" }
    - { points: "148,210 470,210", stage: "EX" }
    - { points: "540,210 800,210", stage: "WB" }
  blocks:
    - id: pc
      stage: IF
      geom: { kind: rect, x: 26, y: 190, w: 34, h: 44, rx: 3 }
      label: PC
      labelPos: { x: 43, y: 216 }
      color: green
      qmark: { x: 64, y: 186 }
    - id: imem
      stage: IF
      geom: { kind: rect, x: 78, y: 178, w: 70, h: 68, rx: 4 }
      label: IMem
      labelPos: { x: 113, y: 216 }
      color: red
    - id: alu
      stage: EX
      geom: { kind: polygon, points: "470,175 540,195 540,215 470,235 488,205" }
      label: ALU
      labelPos: { x: 500, y: 209 }
      color: cyan
      qmark: { x: 544, y: 178 }
    - id: regfile
      stage: WB
      geom: { kind: rect, x: 760, y: 160, w: 90, h: 90, rx: 4 }
      label: Reg File
      labelPos: { x: 805, y: 208 }
      color: greenlt
  help:
    pc:  { title: "PC", desc: "Holds the current instruction address.", look: "It advances each step." }
    alu: { title: "ALU", desc: "Computes the result.", look: "Lights up in EX." }
  values:
    - { kind: operand, role: rs1, x: 196, y: 150 }
    - { kind: operand, role: rs2, x: 196, y: 170 }
    - { kind: imm,     role: imm, x: 196, y: 330 }
  destRoles: ["rd"]
  srcRegRole: "rs2"
  wb: { x: 805, y: 270 }
  aluResult: { x: 556, y: 200 }
```

> The quickest way to author a full drawing is to copy [`riscv.ts`](./riscv.ts)
> as a starting layout and translate it to YAML, adjusting labels, operand
> `role` names and `destRoles`/`srcRegRole` to your ISA.

## Testing

- Component tests: [`/tests/unit/DatapathSchematic.spec.ts`](../../../../tests/unit/DatapathSchematic.spec.ts)
  and `datapathSpec.spec.ts` (resolver/normalisation, including a custom spec).
- See [`/tests/README.md`](../../../../tests/README.md) for how to run unit + e2e tests.
