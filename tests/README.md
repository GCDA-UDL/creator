# Tests (UdL extension)

Automated tests for the UdL additions to CREATOR, primarily the **data-driven
datapath** view. Two layers:

| Layer | Tool | Scope | Browser? | Command |
|-------|------|-------|----------|---------|
| Component / unit | **Vitest** + `@vue/test-utils` | Render logic of `DatapathSchematic` (specs, operand values, units, fallbacks) | no (jsdom) | `npm run test:unit` |
| End-to-end / visual | **Playwright** | Real flow in the browser (load ISA → run → Datapath → Schematic) + screenshots | yes (Chromium) | `npm run test:e2e` |

> The project's package manager is Bun, but dev dependencies are declared in
> `package.json`; any of `bun install` / `npm install` will fetch them.

## Layout

```
tests/
  unit/                      # Vitest component tests (jsdom)
    DatapathSchematic.spec.ts
  e2e/                       # Playwright end-to-end tests
    datapath.spec.ts
    fixtures/                # test architectures (e.g. simple8_datapath.yml)
    __screenshots__/         # screenshots captured by the e2e run (visual reference)
  arch/                      # pre-existing CREATOR architecture test utils
```

Config: [`vitest.config.ts`](../vitest.config.ts) · [`playwright.config.ts`](../playwright.config.ts).

## Component tests (Vitest)

Fast, deterministic, no browser. They mount `DatapathSchematic` with a **mock
`DatapathTrace`** and assert the rendered SVG. Covered:

- RISC-V datapath renders its core blocks (PC, IMem, Reg File, ALU, DataMem) and caption.
- Runtime operand values appear (`rs1: x5 = 5`, `rd: x7 = 11`).
- The **M / FPU units** appear only when the ISA exposes the extension.
- Active stages from the trace get the `.stage.active` class.
- **MIPS-32** spec is selected for `plugin: "mips"` (caption + `rs`/`rt`).
- Unsupported ISA (`plugin: "z80"`) → no SVG, "No drawn datapath" notice (use Blocks).
- A **custom spec** (the future YAML `datapath:` block) is honoured when passed.

Run / watch:

```bash
npm run test:unit          # one-off
npm run test:unit:watch    # watch mode
```

## End-to-end tests (Playwright)

Drive the real app, exercise the full flow and capture screenshots (visual
reference for review). They expect the dev server; the Playwright config starts
`npm run dev:web` automatically (or reuses one already running). Covered: RISC-V
and MIPS draw their datapath, student mode, the display settings panel, and a
**custom architecture** (`fixtures/simple8_datapath.yml`) uploaded through the
real engine pipeline that draws entirely from its YAML `datapath:` block.

```bash
npx playwright install chromium   # first time only (downloads the browser)
npm run test:e2e                  # run
npx playwright test --headed      # watch it run
npx playwright show-report        # open the HTML report
npx playwright test --update-snapshots   # refresh screenshot baselines
```

### Note on visual regression

Screenshots are captured for **review**. Strict pixel comparison
(`toHaveScreenshot`) is sensitive to fonts/anti-aliasing across machines, so it
is enabled with a tolerance and the baselines are generated on the reference
machine. If a baseline diff is purely rendering noise, refresh it with
`--update-snapshots`; if it reflects a real visual change, review before committing.

## Conventions

- Unit specs: `tests/unit/**/*.spec.ts`. E2E specs: `tests/e2e/**/*.spec.ts`.
- Keep component tests free of engine/wasm imports — the datapath renderer is
  decoupled (it only takes a `DatapathTrace` + a spec), which keeps these tests fast.
- Prefer **functional assertions** (text/elements/classes) over pixel diffs.
