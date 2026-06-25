/**
 * Unit tests for the MESI/MSI cache-coherence model (UdL T5 Fase 5).
 * Classic textbook sequences. Run: `npm run test:unit`.
 */
import { describe, it, expect } from "vitest";
import {
    simulateCoherence,
    DEFAULT_COHERENCE_CONFIG,
    type CoherenceConfig,
    type CohOp,
} from "@/core/trace/coherenceModel.mts";

const cfg = (over: Partial<CoherenceConfig> = {}): CoherenceConfig => ({ ...DEFAULT_COHERENCE_CONFIG, ...over });
const op = (core: number, address: number, type: "read" | "write"): CohOp => ({ core, address, type });

describe("simulateCoherence — MESI", () => {
    it("two cores reading the same block end in Shared", () => {
        const t = simulateCoherence([op(0, 0, "read"), op(1, 0, "read")], cfg({ cores: 2 }));
        expect(t.events[0].toState).toBe("E"); // first reader, no sharers → Exclusive
        expect(t.events[1].toState).toBe("S"); // second reader → Shared
        expect(t.finalStates[0][0].state).toBe("S"); // first downgraded E→S
        expect(t.finalStates[1][0].state).toBe("S");
        expect(t.stats.busRd).toBe(2);
    });

    it("E→M is silent (no bus transaction on write to an Exclusive line)", () => {
        const t = simulateCoherence([op(0, 0, "read"), op(0, 0, "write")], cfg());
        expect(t.events[0].toState).toBe("E");
        expect(t.events[1].transaction).toBe("—");
        expect(t.events[1].toState).toBe("M");
        expect(t.stats.busRdX).toBe(0);
        expect(t.stats.busUpgr).toBe(0);
    });

    it("a remote write invalidates and causes a coherence miss", () => {
        const t = simulateCoherence(
            [op(0, 0, "read"), op(1, 0, "write"), op(0, 0, "read")],
            cfg({ cores: 2 }),
        );
        expect(t.events[1].transaction).toBe("BusRdX");
        expect(t.events[1].invalidated).toContain(0);
        expect(t.events[1].toState).toBe("M");
        expect(t.events[2].coherenceMiss).toBe(true); // C0 re-reads an invalidated block
        expect(t.stats.coherenceMisses).toBeGreaterThan(0);
    });

    it("write to a Shared line issues BusUpgr and invalidates sharers", () => {
        const t = simulateCoherence(
            [op(0, 0, "read"), op(1, 0, "read"), op(1, 0, "write")],
            cfg({ cores: 2 }),
        );
        expect(t.events[2].transaction).toBe("BusUpgr");
        expect(t.events[2].invalidated).toContain(0);
        expect(t.stats.busUpgr).toBe(1);
    });

    it("detects FALSE sharing (different words, same block)", () => {
        // block size 16: addr 0 and addr 4 are different words of the same block
        const t = simulateCoherence(
            [op(0, 0, "write"), op(1, 4, "write"), op(0, 0, "write")],
            cfg({ cores: 2, blockSize: 16 }),
        );
        expect(t.stats.falseSharing).toBeGreaterThan(0);
    });

    it("TRUE sharing (same word) is a coherence miss but NOT false sharing", () => {
        const t = simulateCoherence(
            [op(0, 0, "write"), op(1, 0, "write"), op(0, 0, "read")],
            cfg({ cores: 2, blockSize: 16 }),
        );
        expect(t.events[2].coherenceMiss).toBe(true);
        expect(t.events[2].falseSharing).toBe(false);
        expect(t.stats.falseSharing).toBe(0);
    });

    it("invalidations and bus-transaction counters add up", () => {
        const t = simulateCoherence(
            [op(0, 0, "read"), op(1, 0, "write"), op(0, 0, "read"), op(1, 0, "write")],
            cfg({ cores: 2 }),
        );
        expect(t.stats.invalidations).toBeGreaterThan(0);
        expect(t.stats.busTransactions).toBe(t.stats.busRd + t.stats.busRdX + t.stats.busUpgr);
    });
});

describe("simulateCoherence — MSI", () => {
    it("read miss with no sharers goes to Shared (no Exclusive state)", () => {
        const t = simulateCoherence([op(0, 0, "read"), op(0, 0, "write")], cfg({ protocol: "MSI" }));
        expect(t.events[0].toState).toBe("S");
        expect(t.events[1].transaction).toBe("BusUpgr"); // S→M needs the bus
    });
});
