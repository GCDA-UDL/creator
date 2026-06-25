/**
 * Memory-hierarchy / cache model (UdL extension — T5, SMPcaché-style).
 *
 * PURE, engine-independent L1 data-cache simulator. Given the ordered stream of
 * data accesses (from `memoryAccessHistory`) plus a cache configuration, it
 * replays each access and produces a per-access trace (tag / index / offset,
 * hit/miss, miss classification, eviction) plus aggregate statistics (hit rate,
 * AMAT, compulsory/capacity/conflict misses, write-backs) and the final cache
 * contents. Supports direct / set-associative / fully-associative mapping, LRU and
 * FIFO replacement, and write-through / write-back (+ write-allocate) policies.
 *
 * Miss classification uses a same-size fully-associative LRU shadow cache (the
 * classic technique): a non-compulsory miss is a CONFLICT miss if the fully-
 * associative cache would have hit, otherwise a CAPACITY miss.
 *
 * Licence: LGPL-3.0 (same as CREATOR).
 */

export type CacheMapping = "direct" | "set" | "fully";
export type CacheReplace = "LRU" | "FIFO";
export type CacheWritePolicy = "through" | "back";
export type MissType = "compulsory" | "capacity" | "conflict";

export interface CacheConfig {
    mapping: CacheMapping;
    numLines: number; // total cache lines (blocks)
    blockSize: number; // bytes per block (power of two)
    ways: number; // lines per set (set-associative); ignored for direct/fully
    replace: CacheReplace;
    writePolicy: CacheWritePolicy;
    writeAllocate: boolean;
    hitTime: number; // cycles
    missPenalty: number; // cycles
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
    mapping: "set",
    numLines: 8,
    blockSize: 16,
    ways: 2,
    replace: "LRU",
    writePolicy: "back",
    writeAllocate: true,
    hitTime: 1,
    missPenalty: 20,
};

export interface AccessResult {
    address: number;
    type: "read" | "write";
    tag: number;
    index: number; // set index
    offset: number;
    hit: boolean;
    missType?: MissType;
    evictedTag?: number | null;
    writeback: boolean; // a dirty line was written back to memory on this access
}

export interface CacheLineState {
    valid: boolean;
    tag: number;
    dirty: boolean;
    lastUsed: number;
    loadedAt: number;
}

export interface CacheStats {
    accesses: number;
    hits: number;
    misses: number;
    hitRate: number;
    missRate: number;
    amat: number;
    compulsory: number;
    capacity: number;
    conflict: number;
    readMisses: number;
    writeMisses: number;
    writebacks: number;
}

export interface CacheGeometry {
    numSets: number;
    ways: number;
    offsetBits: number;
    indexBits: number;
    tagBits: number;
    blockSize: number;
}

export interface CacheTrace {
    results: AccessResult[];
    stats: CacheStats;
    geometry: CacheGeometry;
    finalSets: CacheLineState[][];
}

const log2 = (n: number) => Math.max(0, Math.round(Math.log2(Math.max(1, n))));

/** Effective geometry from the config (direct=1 way, fully=numLines ways). */
export function cacheGeometry(cfg: CacheConfig): CacheGeometry {
    const ways =
        cfg.mapping === "direct"
            ? 1
            : cfg.mapping === "fully"
              ? Math.max(1, cfg.numLines)
              : Math.max(1, cfg.ways);
    const numSets = Math.max(1, Math.floor(cfg.numLines / ways));
    const offsetBits = log2(cfg.blockSize);
    const indexBits = log2(numSets);
    return { numSets, ways, offsetBits, indexBits, tagBits: 32 - offsetBits - indexBits, blockSize: cfg.blockSize };
}

function freshLine(): CacheLineState {
    return { valid: false, tag: 0, dirty: false, lastUsed: 0, loadedAt: 0 };
}

/** Same-size fully-associative LRU shadow, for compulsory/capacity/conflict classification. */
class ShadowCache {
    private order: number[] = []; // block numbers, MRU last
    constructor(private capacity: number) {}
    /** Records an access; returns whether the block was already present (a hit). */
    access(block: number): boolean {
        const i = this.order.indexOf(block);
        if (i >= 0) {
            this.order.splice(i, 1);
            this.order.push(block);
            return true;
        }
        this.order.push(block);
        if (this.order.length > this.capacity) this.order.shift();
        return false;
    }
}

/** Simulates the cache over an ordered access stream. */
export function simulateCache(
    accesses: { address: number; type: "read" | "write" }[],
    cfg: CacheConfig,
): CacheTrace {
    const geo = cacheGeometry(cfg);
    const sets: CacheLineState[][] = Array.from({ length: geo.numSets }, () =>
        Array.from({ length: geo.ways }, freshLine),
    );
    const shadow = new ShadowCache(Math.max(1, cfg.numLines));
    const seen = new Set<number>();
    const results: AccessResult[] = [];
    let clock = 0;
    let hits = 0,
        misses = 0,
        compulsory = 0,
        capacity = 0,
        conflict = 0,
        readMisses = 0,
        writeMisses = 0,
        writebacks = 0;

    for (const acc of accesses) {
        clock++;
        const addr = acc.address;
        const blockNum = Math.floor(addr / cfg.blockSize);
        const offset = addr % cfg.blockSize;
        const index = blockNum % geo.numSets;
        const tag = Math.floor(blockNum / geo.numSets);
        const set = sets[index];

        // shadow access (every access, to keep its LRU state correct)
        const shadowHadIt = shadow.access(blockNum);

        let wayIdx = set.findIndex(l => l.valid && l.tag === tag);
        const hit = wayIdx >= 0;
        let missType: MissType | undefined;
        let evictedTag: number | null | undefined = null;
        let writeback = false;

        if (hit) {
            hits++;
            set[wayIdx].lastUsed = clock;
            if (acc.type === "write" && cfg.writePolicy === "back") set[wayIdx].dirty = true;
        } else {
            misses++;
            if (acc.type === "read") readMisses++;
            else writeMisses++;

            // classify the miss
            if (!seen.has(blockNum)) {
                missType = "compulsory";
                compulsory++;
            } else if (shadowHadIt) {
                missType = "conflict";
                conflict++;
            } else {
                missType = "capacity";
                capacity++;
            }

            const allocate = acc.type === "read" || cfg.writeAllocate;
            if (allocate) {
                // choose a victim way (prefer an invalid line)
                let v = set.findIndex(l => !l.valid);
                if (v < 0) {
                    v = 0;
                    for (let i = 1; i < set.length; i++) {
                        const key = cfg.replace === "FIFO" ? "loadedAt" : "lastUsed";
                        if (set[i][key] < set[v][key]) v = i;
                    }
                }
                if (set[v].valid) {
                    evictedTag = set[v].tag;
                    if (set[v].dirty) {
                        writeback = true;
                        writebacks++;
                    }
                }
                set[v] = {
                    valid: true,
                    tag,
                    dirty: acc.type === "write" && cfg.writePolicy === "back",
                    lastUsed: clock,
                    loadedAt: clock,
                };
            }
            // (no-write-allocate write miss writes straight to memory; no cache change)
        }

        seen.add(blockNum);
        results.push({ address: addr, type: acc.type, tag, index, offset, hit, missType, evictedTag, writeback });
    }

    const accessesN = accesses.length;
    const hitRate = accessesN > 0 ? hits / accessesN : 0;
    const missRate = accessesN > 0 ? misses / accessesN : 0;
    const stats: CacheStats = {
        accesses: accessesN,
        hits,
        misses,
        hitRate,
        missRate,
        amat: cfg.hitTime + missRate * cfg.missPenalty,
        compulsory,
        capacity,
        conflict,
        readMisses,
        writeMisses,
        writebacks,
    };
    return { results, stats, geometry: geo, finalSets: sets };
}
