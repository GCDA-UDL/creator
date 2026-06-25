/**
 * Unit tests for the virtual-memory (TLB + paging) model (UdL T5 Fase 5).
 * Run: `npm run test:unit`.
 */
import { describe, it, expect } from "vitest";
import {
    simulateVirtualMemory,
    DEFAULT_VM_CONFIG,
    type VmConfig,
} from "@/core/trace/virtualMemoryModel.mts";

const cfg = (over: Partial<VmConfig> = {}): VmConfig => ({ ...DEFAULT_VM_CONFIG, ...over });

describe("simulateVirtualMemory", () => {
    it("first reference to a page faults, then the TLB hits", () => {
        const t = simulateVirtualMemory([0, 0, 0], cfg({ pageSize: 256 }));
        expect(t.stats.pageFaults).toBe(1);
        expect(t.stats.tlbMisses).toBe(1);
        expect(t.stats.tlbHits).toBe(2);
        expect(t.results[0].pageFault).toBe(true);
        expect(t.results[1].tlbHit).toBe(true);
    });

    it("translates VA → PA (pfn × pageSize + offset)", () => {
        const t = simulateVirtualMemory([0x130], cfg({ pageSize: 256 }));
        const r = t.results[0];
        expect(r.vpn).toBe(1); // 0x130 = 304 → page 1
        expect(r.offset).toBe(48);
        expect(r.pfn).toBe(0); // first free frame
        expect(r.physical).toBe(48); // 0*256 + 48
    });

    it("TLB miss on a resident page is a page-table hit (no fault)", () => {
        // TLB holds 2 entries; touching 3 pages evicts page 0 from the TLB,
        // but it is still resident in RAM → re-access = TLB miss + page-table hit.
        const t = simulateVirtualMemory([0, 256, 512, 0], cfg({ pageSize: 256, tlbEntries: 2, ramFrames: 8, tlbReplace: "FIFO" }));
        const last = t.results[3];
        expect(last.tlbHit).toBe(false);
        expect(last.pageTableHit).toBe(true);
        expect(last.pageFault).toBe(false);
        expect(t.stats.pageTableHits).toBeGreaterThanOrEqual(1);
    });

    it("page fault evicts a frame when RAM is full (thrashing)", () => {
        const t = simulateVirtualMemory([0, 256, 512, 0], cfg({ pageSize: 256, ramFrames: 2, tlbEntries: 4 }));
        // 0,1 fill RAM; page 2 evicts; page 0 faults again
        expect(t.stats.pageFaults).toBe(4);
        expect(t.results.some(r => r.evictedVpn !== null)).toBe(true);
    });

    it("LRU causes fewer page faults than FIFO on a reuse pattern", () => {
        const stream = [0, 256, 0, 512, 0]; // pages 0,1,0,2,0 into 2 frames
        const base = { pageSize: 256, ramFrames: 2, tlbEntries: 4 } as const;
        const lru = simulateVirtualMemory(stream, cfg({ ...base, pageReplace: "LRU" }));
        const fifo = simulateVirtualMemory(stream, cfg({ ...base, pageReplace: "FIFO" }));
        expect(lru.stats.pageFaults).toBeLessThan(fifo.stats.pageFaults);
    });

    it("reports TLB hit rate and page-fault rate", () => {
        const t = simulateVirtualMemory([0, 0, 0, 0], cfg({ pageSize: 256 }));
        expect(t.stats.tlbHitRate).toBeCloseTo(3 / 4, 5);
        expect(t.stats.pageFaultRate).toBeCloseTo(1 / 4, 5);
    });

    it("empty stream → zeroed stats", () => {
        const t = simulateVirtualMemory([], cfg());
        expect(t.stats.accesses).toBe(0);
        expect(t.stats.tlbHitRate).toBe(0);
        expect(t.results).toHaveLength(0);
    });
});
