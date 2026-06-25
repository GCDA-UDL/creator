/**
 * Virtual-memory model (UdL extension — T5 Fase 5).
 *
 * PURE, engine-independent simulator of address translation: virtual address →
 * (VPN, offset) → TLB lookup → page-table walk → physical frame. Models a fully-
 * associative TLB (LRU/FIFO) and a configurable physical memory (a finite number
 * of RAM frames) so page faults and replacement (LRU/FIFO, thrashing) can be
 * demonstrated. Fed by the program's access stream (virtual addresses).
 *
 * Licence: LGPL-3.0 (same as CREATOR).
 */

export type VmReplace = "LRU" | "FIFO";

export interface VmConfig {
    pageSize: number; // bytes per page (power of two)
    tlbEntries: number; // fully-associative TLB size
    ramFrames: number; // physical frames available (RAM size)
    tlbReplace: VmReplace;
    pageReplace: VmReplace; // frame eviction policy on a page fault
}

export const DEFAULT_VM_CONFIG: VmConfig = {
    pageSize: 256,
    tlbEntries: 4,
    ramFrames: 8,
    tlbReplace: "LRU",
    pageReplace: "LRU",
};

export interface VmResult {
    address: number;
    vpn: number;
    offset: number;
    tlbHit: boolean;
    pageTableHit: boolean; // TLB miss but page resident (no fault)
    pageFault: boolean;
    pfn: number | null;
    physical: number | null;
    evictedVpn: number | null;
}

export interface VmStats {
    accesses: number;
    tlbHits: number;
    tlbMisses: number;
    pageTableHits: number;
    pageFaults: number;
    tlbHitRate: number;
    pageFaultRate: number;
}

export interface VmGeometry {
    pageSize: number;
    offsetBits: number;
    ramFrames: number;
    tlbEntries: number;
}

export interface VmTrace {
    results: VmResult[];
    stats: VmStats;
    geometry: VmGeometry;
    finalPageTable: { vpn: number; pfn: number }[];
    finalTlb: { vpn: number; pfn: number }[];
}

const log2 = (n: number) => Math.max(0, Math.round(Math.log2(Math.max(1, n))));

/** Simple fully-associative table with LRU/FIFO replacement, keyed by VPN. */
class AssocTable {
    private order: number[] = []; // vpns, victim end = front
    map = new Map<number, number>(); // vpn → value (pfn)
    constructor(
        private capacity: number,
        private policy: VmReplace,
    ) {}
    has(vpn: number) {
        return this.map.has(vpn);
    }
    get(vpn: number) {
        return this.map.get(vpn);
    }
    touch(vpn: number) {
        if (this.policy !== "LRU") return;
        const i = this.order.indexOf(vpn);
        if (i >= 0) {
            this.order.splice(i, 1);
            this.order.push(vpn);
        }
    }
    /** Inserts vpn→value; returns the evicted vpn (or null). */
    insert(vpn: number, value: number): number | null {
        if (this.map.has(vpn)) {
            this.map.set(vpn, value);
            this.touch(vpn);
            return null;
        }
        let evicted: number | null = null;
        if (this.capacity > 0 && this.map.size >= this.capacity) {
            evicted = this.order.shift() ?? null;
            if (evicted !== null) this.map.delete(evicted);
        }
        this.map.set(vpn, value);
        this.order.push(vpn);
        return evicted;
    }
    remove(vpn: number) {
        if (!this.map.has(vpn)) return;
        this.map.delete(vpn);
        const i = this.order.indexOf(vpn);
        if (i >= 0) this.order.splice(i, 1);
    }
    entries() {
        return Array.from(this.map.entries()).map(([vpn, pfn]) => ({ vpn, pfn }));
    }
}

/** Simulates virtual-to-physical translation over a stream of virtual addresses. */
export function simulateVirtualMemory(addresses: number[], cfg: VmConfig): VmTrace {
    const ramFrames = Math.max(1, cfg.ramFrames);
    const tlb = new AssocTable(Math.max(0, cfg.tlbEntries), cfg.tlbReplace);
    const pageTable = new Map<number, number>(); // resident vpn → pfn
    const residentOrder: number[] = []; // resident vpns; victim = front
    const freeFrames: number[] = Array.from({ length: ramFrames }, (_, i) => i);

    const touchPage = (vpn: number) => {
        if (cfg.pageReplace !== "LRU") return;
        const i = residentOrder.indexOf(vpn);
        if (i >= 0) {
            residentOrder.splice(i, 1);
            residentOrder.push(vpn);
        }
    };

    const results: VmResult[] = [];
    let tlbHits = 0,
        tlbMisses = 0,
        pageTableHits = 0,
        pageFaults = 0;

    for (const address of addresses) {
        const vpn = Math.floor(address / cfg.pageSize);
        const offset = address % cfg.pageSize;

        let tlbHit = false;
        let pageTableHit = false;
        let pageFault = false;
        let pfn: number | null = null;
        let evictedVpn: number | null = null;

        if (tlb.has(vpn)) {
            tlbHit = true;
            tlbHits++;
            pfn = tlb.get(vpn)!;
            tlb.touch(vpn);
            touchPage(vpn);
        } else {
            tlbMisses++;
            if (pageTable.has(vpn)) {
                pageTableHit = true;
                pageTableHits++;
                pfn = pageTable.get(vpn)!;
                touchPage(vpn);
            } else {
                pageFault = true;
                pageFaults++;
                if (freeFrames.length > 0) {
                    pfn = freeFrames.shift()!;
                } else {
                    const victim = residentOrder.shift()!;
                    evictedVpn = victim;
                    pfn = pageTable.get(victim)!;
                    pageTable.delete(victim);
                    tlb.remove(victim);
                }
                pageTable.set(vpn, pfn);
                residentOrder.push(vpn);
            }
            tlb.insert(vpn, pfn);
        }

        results.push({
            address,
            vpn,
            offset,
            tlbHit,
            pageTableHit,
            pageFault,
            pfn,
            physical: pfn !== null ? pfn * cfg.pageSize + offset : null,
            evictedVpn,
        });
    }

    const accesses = addresses.length;
    const stats: VmStats = {
        accesses,
        tlbHits,
        tlbMisses,
        pageTableHits,
        pageFaults,
        tlbHitRate: accesses > 0 ? tlbHits / accesses : 0,
        pageFaultRate: accesses > 0 ? pageFaults / accesses : 0,
    };
    return {
        results,
        stats,
        geometry: { pageSize: cfg.pageSize, offsetBits: log2(cfg.pageSize), ramFrames, tlbEntries: cfg.tlbEntries },
        finalPageTable: Array.from(pageTable.entries())
            .map(([vpn, pfn]) => ({ vpn, pfn }))
            .sort((a, b) => a.vpn - b.vpn),
        finalTlb: tlb.entries().sort((a, b) => a.vpn - b.vpn),
    };
}
