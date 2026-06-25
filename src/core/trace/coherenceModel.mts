/**
 * Cache-coherence model (UdL extension — T5 Fase 5, SMPcaché-style multiprocessor).
 *
 * PURE, engine-independent simulator of a snooping write-invalidate cache-coherence
 * protocol (MESI, or MSI without the Exclusive state) over a shared bus. Each core
 * has a private fully-associative cache (LRU); a sequence of (core, address, R/W)
 * operations is replayed and every bus transaction, state transition, invalidation,
 * coherence miss and false-sharing event is recorded.
 *
 * This is the academic centrepiece for AC (Arquitectura de Computadors): it
 * reproduces what SMPcaché teaches — MESI states per line, snooping, coherence
 * misses and false sharing — fed by a multi-core access trace (CREATOR runs a
 * single core, so the trace is authored / from examples, exactly like SMPcaché).
 *
 * Licence: LGPL-3.0 (same as CREATOR).
 */

export type MesiState = "M" | "E" | "S" | "I";
export type CoherenceProtocol = "MESI" | "MSI";

export interface CoherenceConfig {
    cores: number;
    blockSize: number; // bytes per block
    linesPerCore: number; // fully-associative lines per core (LRU)
    protocol: CoherenceProtocol;
}

export const DEFAULT_COHERENCE_CONFIG: CoherenceConfig = {
    cores: 2,
    blockSize: 16,
    linesPerCore: 4,
    protocol: "MESI",
};

export interface CohOp {
    core: number;
    address: number;
    type: "read" | "write";
}

export type BusTransaction = "—" | "BusRd" | "BusRdX" | "BusUpgr";

export interface CohEvent {
    index: number;
    core: number;
    address: number;
    type: "read" | "write";
    block: number;
    word: number;
    hit: boolean;
    miss: boolean;
    coherenceMiss: boolean;
    falseSharing: boolean;
    transaction: BusTransaction;
    fromState: MesiState;
    toState: MesiState;
    flushFrom: number | null; // core that flushed a Modified block
    invalidated: number[]; // cores whose copy was invalidated
}

export interface CoherenceStats {
    perCore: { hits: number; misses: number }[];
    accesses: number;
    hits: number;
    misses: number;
    coherenceMisses: number;
    falseSharing: number;
    busRd: number;
    busRdX: number;
    busUpgr: number;
    flushes: number;
    invalidations: number;
    busTransactions: number;
}

export interface CoreLineState {
    block: number;
    state: MesiState;
}

export interface CoherenceTrace {
    events: CohEvent[];
    stats: CoherenceStats;
    /** Final cache contents per core (present blocks + MESI state). */
    finalStates: CoreLineState[][];
}

interface Line {
    block: number;
    state: MesiState;
    lastUsed: number;
}

/** Simulates the coherence protocol over an ordered multi-core access trace. */
export function simulateCoherence(ops: CohOp[], cfg: CoherenceConfig): CoherenceTrace {
    const N = Math.max(1, cfg.cores);
    const caches: Map<number, Line>[] = Array.from({ length: N }, () => new Map());
    // per (core, block) → the word a remote write touched when invalidating it (false-sharing cause)
    const invalCause: Map<number, number>[] = Array.from({ length: N }, () => new Map());

    const events: CohEvent[] = [];
    const perCore = Array.from({ length: N }, () => ({ hits: 0, misses: 0 }));
    let hits = 0,
        misses = 0,
        coherenceMisses = 0,
        falseSharing = 0,
        busRd = 0,
        busRdX = 0,
        busUpgr = 0,
        flushes = 0,
        invalidations = 0;
    let clock = 0;

    const evictIfNeeded = (c: number) => {
        const cache = caches[c];
        if (cache.size < cfg.linesPerCore) return;
        let lru: Line | null = null;
        for (const l of cache.values()) if (!lru || l.lastUsed < lru.lastUsed) lru = l;
        if (lru) cache.delete(lru.block);
    };

    for (const op of ops) {
        clock++;
        const c = op.core;
        const block = Math.floor(op.address / cfg.blockSize);
        const word = op.address % cfg.blockSize;
        const cache = caches[c];
        const line = cache.get(block);
        const present = !!line && line.state !== "I";
        const fromState: MesiState = present ? line!.state : "I";

        let transaction: BusTransaction = "—";
        let flushFrom: number | null = null;
        const invalidated: number[] = [];
        let toState: MesiState = fromState;
        let hit = present;
        let coherenceMiss = false;
        let falseShare = false;

        // Did this block get invalidated remotely while we were away?
        const causeWord = invalCause[c].get(block);
        const wasInvalidated = causeWord !== undefined;

        if (op.type === "read") {
            if (present) {
                hit = true;
                line!.lastUsed = clock;
                toState = line!.state; // unchanged
            } else {
                hit = false;
                transaction = "BusRd";
                busRd++;
                // snoop: other cores supply / downgrade
                let sharers = false;
                for (let o = 0; o < N; o++) {
                    if (o === c) continue;
                    const ol = caches[o].get(block);
                    if (!ol || ol.state === "I") continue;
                    sharers = true;
                    if (ol.state === "M") {
                        flushFrom = o;
                        flushes++;
                        ol.state = "S";
                    } else if (ol.state === "E") {
                        ol.state = "S";
                    } // S stays S
                }
                toState = sharers ? "S" : cfg.protocol === "MESI" ? "E" : "S";
                if (wasInvalidated) {
                    coherenceMiss = true;
                    coherenceMisses++;
                    if (causeWord !== word) {
                        falseShare = true;
                        falseSharing++;
                    }
                }
                evictIfNeeded(c);
                cache.set(block, { block, state: toState, lastUsed: clock });
                invalCause[c].delete(block);
            }
        } else {
            // write
            if (present && (line!.state === "M" || line!.state === "E")) {
                hit = true;
                if (line!.state === "E") toState = "M"; // silent E→M, no bus
                else toState = "M";
                line!.state = "M";
                line!.lastUsed = clock;
            } else if (present && line!.state === "S") {
                hit = true;
                transaction = "BusUpgr";
                busUpgr++;
                for (let o = 0; o < N; o++) {
                    if (o === c) continue;
                    const ol = caches[o].get(block);
                    if (ol && ol.state !== "I") {
                        invalidated.push(o);
                        invalidations++;
                        caches[o].delete(block);
                        invalCause[o].set(block, word);
                    }
                }
                toState = "M";
                line!.state = "M";
                line!.lastUsed = clock;
            } else {
                // write miss
                hit = false;
                transaction = "BusRdX";
                busRdX++;
                for (let o = 0; o < N; o++) {
                    if (o === c) continue;
                    const ol = caches[o].get(block);
                    if (!ol || ol.state === "I") continue;
                    invalidated.push(o);
                    invalidations++;
                    if (ol.state === "M") {
                        flushFrom = o;
                        flushes++;
                    }
                    caches[o].delete(block);
                    invalCause[o].set(block, word);
                }
                toState = "M";
                if (wasInvalidated) {
                    coherenceMiss = true;
                    coherenceMisses++;
                    if (causeWord !== word) {
                        falseShare = true;
                        falseSharing++;
                    }
                }
                evictIfNeeded(c);
                cache.set(block, { block, state: "M", lastUsed: clock });
                invalCause[c].delete(block);
            }
        }

        if (hit) {
            hits++;
            perCore[c].hits++;
        } else {
            misses++;
            perCore[c].misses++;
        }

        events.push({
            index: clock,
            core: c,
            address: op.address,
            type: op.type,
            block,
            word,
            hit,
            miss: !hit,
            coherenceMiss,
            falseSharing: falseShare,
            transaction,
            fromState,
            toState,
            flushFrom,
            invalidated,
        });
    }

    const finalStates: CoreLineState[][] = caches.map(cache =>
        Array.from(cache.values())
            .filter(l => l.state !== "I")
            .sort((a, b) => a.block - b.block)
            .map(l => ({ block: l.block, state: l.state })),
    );

    const stats: CoherenceStats = {
        perCore,
        accesses: ops.length,
        hits,
        misses,
        coherenceMisses,
        falseSharing,
        busRd,
        busRdX,
        busUpgr,
        flushes,
        invalidations,
        busTransactions: busRd + busRdX + busUpgr,
    };
    return { events, stats, finalStates };
}
