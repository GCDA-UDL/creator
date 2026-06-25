/**
 * Data memory-access history (UdL extension — T5 "memory hierarchy / cache").
 *
 * Always-on, framework-free accumulator of the DATA load/store accesses emitted by
 * the CAPI memory helpers (`memory-access` event: instruction fetches are NOT
 * included, so the cache view sees a clean data stream). The cache model
 * (`memoryHierarchyModel`) replays this ordered stream. Cleared on `registers-reset`.
 *
 * Licence: LGPL-3.0 (same as CREATOR).
 */
import { coreEvents } from "../events.mts";

export interface MemAccess {
    address: number;
    bytes: number;
    type: "read" | "write";
}

/** Ring cap so long-running / looping programs cannot grow the buffer unbounded. */
const MAX_HISTORY = 20000;

const history: MemAccess[] = [];
let started = false;

function onAccess(e: { address?: bigint | number; bytes?: number; type?: string }): void {
    try {
        history.push({
            address: Number(e.address ?? 0),
            bytes: Number(e.bytes ?? 0),
            type: e.type === "write" ? "write" : "read",
        });
        if (history.length > MAX_HISTORY) {
            history.splice(0, history.length - MAX_HISTORY);
        }
    } catch {
        /* best-effort */
    }
}

function onReset(): void {
    history.length = 0;
}

/** Starts recording the data memory-access stream (idempotent). Call once at bootstrap. */
export function startMemoryAccessHistory(): void {
    if (started) return;
    started = true;
    const bus = coreEvents as unknown as {
        on: (t: string, h: (e: unknown) => void) => void;
    };
    bus.on("memory-access", onAccess as (e: unknown) => void);
    bus.on("registers-reset", onReset as (e: unknown) => void);
}

/** The ordered data-access stream since the last reset (read-only). */
export function getMemoryAccessHistory(): readonly MemAccess[] {
    return history;
}

export function clearMemoryAccessHistory(): void {
    history.length = 0;
}
