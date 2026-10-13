/**
 * Shared persistence of the pipeline ("Set Architecture") configuration used by the
 * Cycles view and read by the Schematic view (UdL extension).
 *
 * The configuration lives in localStorage; every save also dispatches a window
 * event so that a sibling view (e.g. the Schematic applying the "Ripes (RV5S)"
 * preset) can refresh without a page reload. Pure browser glue — no engine access.
 *
 * Licence: LGPL-3.0 (same as CREATOR).
 */
import type { PipelineConfig } from "@/core/trace/pipelineModel.mts";

export const CYCLES_CONFIG_KEY = "creator-cycles-config";
export const CYCLES_CONFIG_EVENT = "creator-cycles-config-changed";

/** Reads the stored configuration (partial: only the fields that were saved). */
export function loadCyclesConfig(): Partial<PipelineConfig> {
    try {
        const raw = localStorage.getItem(CYCLES_CONFIG_KEY);
        return raw ? (JSON.parse(raw) as Partial<PipelineConfig>) : {};
    } catch {
        return {};
    }
}

/** Persists the configuration and notifies the other views. */
export function saveCyclesConfig(cfg: Partial<PipelineConfig>): void {
    try {
        localStorage.setItem(CYCLES_CONFIG_KEY, JSON.stringify(cfg));
    } catch {
        /* storage unavailable: the in-memory config still works */
    }
    try {
        window.dispatchEvent(new CustomEvent(CYCLES_CONFIG_EVENT));
    } catch {
        /* non-browser environment */
    }
}
