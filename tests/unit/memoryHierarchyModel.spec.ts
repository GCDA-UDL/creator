/**
 * Unit tests for the SMPcaché-style memory-hierarchy / cache model (UdL T5).
 * Pure functions — no DOM, no engine. Run: `npm run test:unit`.
 */
import { describe, it, expect } from "vitest";
import {
    simulateCache,
    simulateMultilevel,
    cacheGeometry,
    DEFAULT_CACHE_CONFIG,
    type CacheConfig,
} from "@/core/trace/memoryHierarchyModel.mts";

const cfg = (over: Partial<CacheConfig> = {}): CacheConfig => ({ ...DEFAULT_CACHE_CONFIG, ...over });
const reads = (addrs: number[]) => addrs.map(address => ({ address, type: "read" as const }));

describe("simulateCache", () => {
    it("first reference misses (compulsory), repeats hit", () => {
        const t = simulateCache(reads([0, 0, 0]), cfg({ mapping: "direct", numLines: 4, blockSize: 16 }));
        expect(t.stats.misses).toBe(1);
        expect(t.stats.compulsory).toBe(1);
        expect(t.stats.hits).toBe(2);
        expect(t.stats.hitRate).toBeCloseTo(2 / 3, 5);
    });

    it("decodes tag / index / offset", () => {
        const t = simulateCache(reads([0x24]), cfg({ mapping: "direct", numLines: 4, blockSize: 16 }));
        const r = t.results[0];
        expect(r.offset).toBe(4); // 0x24 % 16
        expect(r.index).toBe(2); // block 2 % 4 sets
        expect(r.tag).toBe(0);
        expect(t.geometry).toMatchObject({ numSets: 4, ways: 1, offsetBits: 4, indexBits: 2 });
    });

    it("classifies a conflict miss (would hit in a fully-associative cache)", () => {
        // direct-mapped, 2 lines: blocks 0 and 2 collide in set 0
        const t = simulateCache(reads([0, 32, 0, 32]), cfg({ mapping: "direct", numLines: 2, blockSize: 16 }));
        expect(t.stats.conflict).toBeGreaterThan(0);
    });

    it("classifies a capacity miss (also misses in the fully-associative cache)", () => {
        const t = simulateCache(reads([0, 16, 32, 0]), cfg({ mapping: "fully", numLines: 2, blockSize: 16 }));
        expect(t.stats.capacity).toBeGreaterThan(0);
    });

    it("LRU keeps more than FIFO on a reuse pattern", () => {
        const stream = reads([0, 16, 0, 32, 0]); // 3 blocks into a 2-line fully-set
        const base = { mapping: "set" as const, numLines: 2, ways: 2, blockSize: 16 };
        const lru = simulateCache(stream, cfg({ ...base, replace: "LRU" }));
        const fifo = simulateCache(stream, cfg({ ...base, replace: "FIFO" }));
        expect(lru.stats.hits).toBeGreaterThan(fifo.stats.hits);
    });

    it("write-back writes a dirty victim back; write-through does not", () => {
        const stream = [
            { address: 0, type: "write" as const },
            { address: 16, type: "read" as const }, // evicts block 0
        ];
        const c = { mapping: "direct" as const, numLines: 1, blockSize: 16 };
        const wb = simulateCache(stream, cfg({ ...c, writePolicy: "back" }));
        const wt = simulateCache(stream, cfg({ ...c, writePolicy: "through" }));
        expect(wb.stats.writebacks).toBeGreaterThan(0);
        expect(wt.stats.writebacks).toBe(0);
    });

    it("no-write-allocate: a write miss does not load the block", () => {
        const stream = [
            { address: 0, type: "write" as const },
            { address: 0, type: "read" as const },
        ];
        const t = simulateCache(stream, cfg({ mapping: "direct", numLines: 4, blockSize: 16, writeAllocate: false }));
        expect(t.stats.hits).toBe(0); // both miss (write not allocated)
        expect(t.stats.misses).toBe(2);
    });

    it("AMAT = hitTime + missRate × missPenalty", () => {
        const t = simulateCache(reads([0, 0, 0, 0]), cfg({ mapping: "direct", numLines: 4, blockSize: 16, hitTime: 1, missPenalty: 20 }));
        // 1 miss / 4 → missRate 0.25 → AMAT 1 + 0.25*20 = 6
        expect(t.stats.amat).toBeCloseTo(6, 5);
    });

    it("empty stream → zeroed stats", () => {
        const t = simulateCache([], cfg());
        expect(t.stats.accesses).toBe(0);
        expect(t.stats.hitRate).toBe(0);
        expect(t.results).toHaveLength(0);
    });
});

describe("simulateMultilevel (L1 + L2)", () => {
    it("L2 catches blocks that thrash a tiny L1", () => {
        const L1 = cfg({ mapping: "direct", numLines: 1, blockSize: 16, hitTime: 1 });
        const L2 = cfg({ mapping: "fully", numLines: 4, blockSize: 16, hitTime: 10 });
        const ml = simulateMultilevel(reads([0, 16, 0, 16]), [L1, L2], 100);
        expect(ml.levels[0].stats.misses).toBe(4); // L1 (1 line) misses every time
        expect(ml.levels[1].stats.hits).toBe(2); // L2 holds both blocks → 2 hits
        expect(ml.amat).toBeLessThan(1 + 1 * 100); // better than L1→memory
    });

    it("single-level AMAT = h1 + missRate × memPenalty", () => {
        const L1 = cfg({ mapping: "direct", numLines: 4, blockSize: 16, hitTime: 1 });
        const ml = simulateMultilevel(reads([0, 0, 0, 0]), [L1], 20);
        expect(ml.amat).toBeCloseTo(1 + 0.25 * 20, 5); // 6
    });

    it("two-level AMAT chains the local miss rates", () => {
        const L1 = cfg({ mapping: "direct", numLines: 4, blockSize: 16, hitTime: 1 });
        const L2 = cfg({ mapping: "fully", numLines: 4, blockSize: 16, hitTime: 10 });
        const ml = simulateMultilevel(reads([0]), [L1, L2], 100);
        // both miss once → AMAT = 1 + 1·(10 + 1·100) = 111
        expect(ml.amat).toBeCloseTo(111, 5);
    });
});

describe("cacheGeometry", () => {
    it("direct = 1 way, fully = numLines ways", () => {
        expect(cacheGeometry(cfg({ mapping: "direct", numLines: 8 })).ways).toBe(1);
        expect(cacheGeometry(cfg({ mapping: "fully", numLines: 8 })).ways).toBe(8);
        expect(cacheGeometry(cfg({ mapping: "set", numLines: 8, ways: 2 })).numSets).toBe(4);
    });
});
