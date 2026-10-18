/**
 * Unit tests for the executed-instruction history cap (UdL extension).
 * The Cycles / Schematic views recompute over this history; the cap bounds memory
 * and is user-configurable ("Historial máx." in Pipeline config). Run: `npm run test:unit`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
    startExecutionHistory,
    getExecutionHistory,
    clearExecutionHistory,
    setExecutionHistoryLimit,
    getExecutionHistoryLimit,
    DEFAULT_HISTORY_LIMIT,
    MIN_HISTORY_LIMIT,
    MAX_HISTORY_LIMIT,
} from "@/core/trace/executionHistory.mts";
import { coreEvents } from "@/core/events.mts";
import { DATAPATH_TRACE_EVENT } from "@/core/trace/datapathTrace.mts";

const bus = coreEvents as unknown as { emit: (type: string, event: unknown) => void };
const trace = (i: number) => ({ pc: "0x" + (i * 4).toString(16), asm: `addi x5, x0, ${i}`, microops: [], operands: {} });

beforeEach(() => {
    startExecutionHistory();
    clearExecutionHistory();
    setExecutionHistoryLimit(DEFAULT_HISTORY_LIMIT);
});

describe("execution history limit", () => {
    it("defaults to 5000 and keeps only the most recent traces", () => {
        expect(getExecutionHistoryLimit()).toBe(5000);
        setExecutionHistoryLimit(300);
        for (let i = 0; i < 350; i++) bus.emit(DATAPATH_TRACE_EVENT, trace(i));
        const h = getExecutionHistory();
        expect(h.length).toBe(300);
        expect(h[0]?.asm).toBe("addi x5, x0, 50"); // the 50 oldest were dropped
        expect(h[h.length - 1]?.asm).toBe("addi x5, x0, 349");
    });

    it("lowering the limit trims the existing history immediately", () => {
        setExecutionHistoryLimit(1000);
        for (let i = 0; i < 600; i++) bus.emit(DATAPATH_TRACE_EVENT, trace(i));
        setExecutionHistoryLimit(250);
        expect(getExecutionHistory().length).toBe(250);
        expect(getExecutionHistory()[0]?.asm).toBe("addi x5, x0, 350");
    });

    it("clamps to [250, 500000] and ignores garbage", () => {
        setExecutionHistoryLimit(1);
        expect(getExecutionHistoryLimit()).toBe(MIN_HISTORY_LIMIT);
        setExecutionHistoryLimit(10_000_000);
        expect(getExecutionHistoryLimit()).toBe(MAX_HISTORY_LIMIT);
        setExecutionHistoryLimit(Number.NaN);
        expect(getExecutionHistoryLimit()).toBe(DEFAULT_HISTORY_LIMIT);
        setExecutionHistoryLimit(20000.7);
        expect(getExecutionHistoryLimit()).toBe(20000);
    });

    it("a raised limit lets a long program be recorded whole (Ripes comparison of 15k-instruction examples)", () => {
        setExecutionHistoryLimit(20000);
        for (let i = 0; i < 15009; i++) bus.emit(DATAPATH_TRACE_EVENT, trace(i));
        expect(getExecutionHistory().length).toBe(15009);
    });
});
