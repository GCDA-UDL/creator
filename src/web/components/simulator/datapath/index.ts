/**
 * Datapath spec registry + resolver (UdL extension).
 *
 * Resolution order for the loaded architecture:
 *   1. A custom spec authored in the architecture YAML (`datapath:` block).
 *   2. The built-in spec keyed by the architecture `plugin` (riscv, mips).
 *   3. null — the UI falls back to the data-driven "Blocks" view.
 *
 * Licence: LGPL-3.0.
 */
import type { DatapathSpec } from "./spec";
import { riscvSpec } from "./riscv";
import { mipsSpec } from "./mips";

const BUILTIN: DatapathSpec[] = [riscvSpec, mipsSpec];

/** Built-in spec for a given architecture `plugin` (e.g. "riscv", "mips"). */
export function builtinSpecForPlugin(plugin?: string | null): DatapathSpec | null {
    if (!plugin) return null;
    const p = String(plugin).toLowerCase();
    return BUILTIN.find(s => s.plugins.includes(p)) ?? null;
}

/**
 * Fills a (possibly partial / author-supplied) spec with safe defaults so a
 * hand-written YAML `datapath:` block renders without crashing the view.
 */
export function normalizeSpec(s: Partial<DatapathSpec>): DatapathSpec {
    return {
        id: s.id ?? "custom",
        plugins: s.plugins ?? [],
        caption: s.caption ?? "Datapath",
        viewBox: s.viewBox ?? "0 0 940 430",
        headers: s.headers ?? [],
        separators: s.separators ?? [],
        pipeRegs: s.pipeRegs ?? [],
        notes: s.notes ?? [],
        wires: s.wires ?? [],
        blocks: s.blocks ?? [],
        help: s.help ?? {},
        extraQmarks: s.extraQmarks ?? [],
        values: s.values ?? [],
        destRoles: s.destRoles && s.destRoles.length ? s.destRoles : ["rd"],
        srcRegRole: s.srcRegRole ?? "rs2",
        wb: s.wb ?? { x: 0, y: 0 },
        aluResult: s.aluResult,
        muxSrc: s.muxSrc,
        branchPath: s.branchPath,
        units: s.units,
    };
}

/**
 * Resolves the datapath spec for the loaded architecture. A YAML-authored custom
 * spec wins; it may be partial and is merged onto the plugin baseline so an author
 * can override just a few fields (e.g. labels) and inherit the rest. The custom
 * result is normalised so missing fields never break the renderer.
 */
export function resolveDatapathSpec(
    plugin?: string | null,
    custom?: Partial<DatapathSpec> | null,
): DatapathSpec | null {
    if (custom && Array.isArray(custom.blocks) && custom.blocks.length > 0) {
        const base = builtinSpecForPlugin(plugin);
        return normalizeSpec(base ? { ...base, ...custom } : custom);
    }
    return builtinSpecForPlugin(plugin);
}

export type { DatapathSpec } from "./spec";
export { riscvSpec, mipsSpec };
