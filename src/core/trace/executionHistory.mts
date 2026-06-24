/**
 * Executed-instruction history (UdL extension — T4 "cycle/pipeline timeline").
 *
 * Always-on, framework-free accumulator of the datapath traces emitted by the
 * engine on every executed step. The pipeline/cycles view reads this ordered
 * stream (so it shows the whole run even if the tab is opened *after* running) and
 * runs the pure `pipelineModel` scheduler over it. Cleared on `registers-reset`.
 *
 * It never mutates engine state; it only listens to the shared event bus.
 *
 * Licence: LGPL-3.0 (same as CREATOR).
 */
import { coreEvents } from "../events.mts";
import { DATAPATH_TRACE_EVENT, type DatapathTrace } from "./datapathTrace.mts";

/** Ring cap so long-running / looping programs cannot grow the buffer unbounded. */
const MAX_HISTORY = 5000;

const history: DatapathTrace[] = [];
let started = false;

function onTrace(trace: DatapathTrace): void {
    history.push(trace);
    if (history.length > MAX_HISTORY) {
        history.splice(0, history.length - MAX_HISTORY);
    }
}

function onReset(): void {
    history.length = 0;
}

/** Starts recording the executed-instruction stream (idempotent). Call once at bootstrap. */
export function startExecutionHistory(): void {
    if (started) return;
    started = true;
    const bus = coreEvents as unknown as {
        on: (t: string, h: (e: unknown) => void) => void;
    };
    bus.on(DATAPATH_TRACE_EVENT, onTrace as (e: unknown) => void);
    bus.on("registers-reset", onReset as (e: unknown) => void);
}

/** The ordered stream of executed instructions since the last reset (read-only). */
export function getExecutionHistory(): readonly DatapathTrace[] {
    return history;
}

/** Clears the recorded history (e.g. on an explicit user action). */
export function clearExecutionHistory(): void {
    history.length = 0;
}
