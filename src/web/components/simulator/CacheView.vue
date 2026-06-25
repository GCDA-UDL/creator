<!--
Copyright 2018-2026 CREATOR Team. LGPL-3.0.
UdL extension (PID RISC-V) — Cache / memory-hierarchy view (SMPcaché-style).
Replays the program's accesses through a configurable hierarchy: L1 (+ optional L2),
unified or split instruction/data caches. Shows hit/miss stats, global AMAT, miss
classification, the tag/index/offset decode of the current access, and the cache
contents (sets×ways) stepped access by access. Engine unchanged; recomputes instantly.
-->
<script lang="ts">
import { defineComponent } from "vue";
import { coreEvents } from "@/core/events.mts";
import { DATAPATH_TRACE_EVENT } from "@/core/trace/datapathTrace.mts";
import { getMemoryAccessHistory } from "@/core/trace/memoryAccessHistory.mts";
import { getExecutionHistory } from "@/core/trace/executionHistory.mts";
import {
    simulateCache,
    simulateMultilevel,
    DEFAULT_CACHE_CONFIG,
    type CacheConfig,
    type CacheTrace,
} from "@/core/trace/memoryHierarchyModel.mts";

const LS_KEY = "creator-cache-config";
type Access = { address: number; type: "read" | "write" };

const PRESETS: Record<string, Partial<CacheConfig>> = {
    "Direct 8×16": { mapping: "direct", numLines: 8, blockSize: 16, replace: "LRU", writePolicy: "back", writeAllocate: true },
    "2-way LRU WB": { mapping: "set", numLines: 8, ways: 2, blockSize: 16, replace: "LRU", writePolicy: "back", writeAllocate: true },
    "Fully LRU WT": { mapping: "fully", numLines: 8, blockSize: 16, replace: "LRU", writePolicy: "through", writeAllocate: false },
};
const hex = (n: number) => "0x" + Math.max(0, Math.floor(n)).toString(16);

interface L2Config {
    mapping: CacheConfig["mapping"];
    numLines: number;
    ways: number;
    hitTime: number;
}

export default defineComponent({
    props: { dark: { type: Boolean, default: false } },
    data() {
        return {
            config: { ...DEFAULT_CACHE_CONFIG } as CacheConfig, // L1
            l2: { mapping: "set", numLines: 32, ways: 4, hitTime: 10 } as L2Config,
            levels: 1, // 1 = L1 only, 2 = L1 + L2
            splitID: false, // separate instruction / data caches
            show: "D" as "D" | "I", // which cache the detailed grid shows (when split)
            version: 0,
            showConfig: false,
            cursor: 1,
            live: true,
            presets: PRESETS,
        };
    },
    mounted() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) {
                const s = JSON.parse(raw);
                this.config = { ...DEFAULT_CACHE_CONFIG, ...(s.config ?? s) };
                if (s.l2) this.l2 = { ...this.l2, ...s.l2 };
                if (s.levels) this.levels = s.levels;
                if (typeof s.splitID === "boolean") this.splitID = s.splitID;
            }
        } catch {
            /* ignore */
        }
        (coreEvents as any).on("memory-access", this.onChange);
        (coreEvents as any).on(DATAPATH_TRACE_EVENT, this.onChange);
        (coreEvents as any).on("registers-reset", this.onChange);
    },
    beforeUnmount() {
        (coreEvents as any).off("memory-access", this.onChange);
        (coreEvents as any).off(DATAPATH_TRACE_EVENT, this.onChange);
        (coreEvents as any).off("registers-reset", this.onChange);
    },
    watch: {
        config: { deep: true, handler() { this.persist(); } },
        l2: { deep: true, handler() { this.persist(); } },
        levels() { this.persist(); },
        splitID() { this.persist(); },
    },
    computed: {
        dStream(): Access[] {
            void this.version;
            return getMemoryAccessHistory().map(a => ({ address: a.address, type: a.type }));
        },
        iStream(): Access[] {
            void this.version;
            return getExecutionHistory()
                .map(t => ({ address: Number(t.pc), type: "read" as const }))
                .filter(a => Number.isFinite(a.address));
        },
        l1cfg(): CacheConfig {
            return { ...this.config };
        },
        l2cfg(): CacheConfig {
            // L2 inherits block size / replacement / write policy from L1
            return { ...this.config, mapping: this.l2.mapping, numLines: this.l2.numLines, ways: this.l2.ways, hitTime: this.l2.hitTime };
        },
        levelsArr(): CacheConfig[] {
            return this.levels === 2 ? [this.l1cfg, this.l2cfg] : [this.l1cfg];
        },
        shownStream(): Access[] {
            return this.splitID && this.show === "I" ? this.iStream : this.dStream;
        },
        ml() {
            return simulateMultilevel(this.shownStream, this.levelsArr, this.config.missPenalty);
        },
        l1(): CacheTrace {
            return this.ml.levels[0];
        },
        l2trace(): CacheTrace | null {
            return this.ml.levels[1] ?? null;
        },
        hasData(): boolean {
            return this.shownStream.length > 0 || this.dStream.length > 0;
        },
        total(): number {
            return this.shownStream.length;
        },
        cursorN(): number {
            if (this.total <= 0) return 0;
            return this.live ? this.total : Math.min(Math.max(this.cursor, 1), this.total);
        },
        stateAtCursor(): CacheTrace {
            return simulateCache(this.shownStream.slice(0, this.cursorN), this.l1cfg);
        },
        current() {
            return this.cursorN > 0 ? this.l1.results[this.cursorN - 1] : null;
        },
        stats() {
            return this.l1.stats;
        },
        amat(): number {
            return this.ml.amat;
        },
        geometry() {
            return this.l1.geometry;
        },
        hitPct(): string {
            return this.total > 0 ? (this.stats.hitRate * 100).toFixed(1) + "%" : "—";
        },
        l2Pct(): string {
            return this.l2trace && this.l2trace.stats.accesses > 0 ? (this.l2trace.stats.hitRate * 100).toFixed(1) + "%" : "—";
        },
        // split summary (independent of which cache is shown)
        splitSummary(): { i: string; d: string } {
            const d = simulateMultilevel(this.dStream, this.levelsArr, this.config.missPenalty);
            const i = simulateMultilevel(this.iStream, this.levelsArr, this.config.missPenalty);
            const pct = (t: typeof d) => (t.levels[0]?.stats.accesses ? (t.levels[0].stats.hitRate * 100).toFixed(0) + "%" : "—");
            return { i: pct(i), d: pct(d) };
        },
    },
    methods: {
        hex,
        onChange() {
            this.version++;
        },
        persist() {
            try {
                localStorage.setItem(LS_KEY, JSON.stringify({ config: this.config, l2: this.l2, levels: this.levels, splitID: this.splitID }));
            } catch {
                /* ignore */
            }
        },
        applyPreset(name: string) {
            this.config = { ...this.config, ...(PRESETS[name] ?? {}) };
        },
        resetConfig() {
            this.config = { ...DEFAULT_CACHE_CONFIG };
            this.levels = 1;
            this.splitID = false;
        },
        stepCursor(d: number) {
            const base = this.cursorN;
            this.live = false;
            this.cursor = Math.min(Math.max(base + d, 1), this.total);
        },
        goLive() {
            this.live = true;
        },
        lineFor(index: number, way: number) {
            return this.stateAtCursor.finalSets[index]?.[way];
        },
        isCurrentLine(index: number, way: number): boolean {
            const c = this.current;
            if (!c || c.index !== index) return false;
            const line = this.lineFor(index, way);
            return !!line && line.valid && line.tag === c.tag;
        },
    },
});
</script>

<template>
    <div class="cache-view">
        <div class="cache-toolbar">
            <button class="cache-gear" :class="{ active: showConfig }" title="Cache configuration" @click="showConfig = !showConfig">
                <font-awesome-icon :icon="['fas', 'gear']" /> Cache config
            </button>
            <span class="cache-hint">Recomputes instantly — no re-run needed.</span>
            <template v-if="splitID">
                <span class="cache-split">I-cache {{ splitSummary.i }} · D-cache {{ splitSummary.d }}</span>
                <span class="cache-seg">
                    <button class="seg" :class="{ on: show === 'D' }" @click="show = 'D'">Data</button>
                    <button class="seg" :class="{ on: show === 'I' }" @click="show = 'I'">Instr</button>
                </span>
            </template>
        </div>

        <!-- Configuration -->
        <div v-if="showConfig" class="cache-settings">
            <div class="c-row">
                <label>Mapping</label>
                <select v-model="config.mapping">
                    <option value="direct">Direct</option>
                    <option value="set">Set-associative</option>
                    <option value="fully">Fully associative</option>
                </select>
                <label>Lines</label>
                <input type="number" min="1" max="2048" v-model.number="config.numLines" />
                <label v-if="config.mapping === 'set'">Ways</label>
                <input v-if="config.mapping === 'set'" type="number" min="1" max="32" v-model.number="config.ways" />
                <label>Block (bytes)</label>
                <input type="number" min="4" max="256" step="4" v-model.number="config.blockSize" />
            </div>
            <div class="c-row">
                <label>Replacement</label>
                <select v-model="config.replace"><option value="LRU">LRU</option><option value="FIFO">FIFO</option></select>
                <label>Write policy</label>
                <select v-model="config.writePolicy"><option value="back">Write-back</option><option value="through">Write-through</option></select>
                <label class="c-chk"><input type="checkbox" v-model="config.writeAllocate" /> Write-allocate</label>
                <label class="c-chk"><input type="checkbox" v-model="splitID" /> Split I/D</label>
            </div>
            <div class="c-row">
                <label>Levels</label>
                <select v-model.number="levels"><option :value="1">L1 only</option><option :value="2">L1 + L2</option></select>
                <template v-if="levels === 2">
                    <label>L2 map</label>
                    <select v-model="l2.mapping"><option value="direct">Direct</option><option value="set">Set</option><option value="fully">Fully</option></select>
                    <label>L2 lines</label>
                    <input type="number" min="1" max="4096" v-model.number="l2.numLines" />
                    <label v-if="l2.mapping === 'set'">L2 ways</label>
                    <input v-if="l2.mapping === 'set'" type="number" min="1" max="32" v-model.number="l2.ways" />
                    <label>L2 hit</label>
                    <input type="number" min="1" max="50" v-model.number="l2.hitTime" />
                </template>
            </div>
            <div class="c-row">
                <label>L1 hit time</label>
                <input type="number" min="1" max="10" v-model.number="config.hitTime" />
                <label>Memory penalty</label>
                <input type="number" min="1" max="400" v-model.number="config.missPenalty" />
                <button v-for="(p, name) in presets" :key="name" class="c-preset" @click="applyPreset(name)">{{ name }}</button>
                <button class="c-reset" @click="resetConfig">Reset</button>
            </div>
        </div>

        <p v-if="!hasData" class="cache-empty">
            Run a program (Step or Run) to see the cache behaviour.
        </p>

        <template v-else>
            <!-- Statistics -->
            <div class="cache-stats">
                <div class="stat"><div class="n">{{ stats.accesses }}</div><div class="l">Accesses</div></div>
                <div class="stat"><div class="n">{{ stats.hits }}</div><div class="l">L1 hits</div></div>
                <div class="stat"><div class="n">{{ stats.misses }}</div><div class="l">L1 misses</div></div>
                <div class="stat hi"><div class="n">{{ hitPct }}</div><div class="l">L1 hit rate</div></div>
                <div v-if="l2trace" class="stat"><div class="n">{{ l2trace.stats.hits }}</div><div class="l">L2 hits</div></div>
                <div v-if="l2trace" class="stat hi"><div class="n">{{ l2Pct }}</div><div class="l">L2 hit rate</div></div>
                <div class="stat hi"><div class="n">{{ amat.toFixed(2) }}</div><div class="l">AMAT (cyc)</div></div>
                <div class="stat"><div class="n">{{ stats.compulsory }}</div><div class="l">Compulsory</div></div>
                <div class="stat"><div class="n">{{ stats.capacity }}</div><div class="l">Capacity</div></div>
                <div class="stat"><div class="n">{{ stats.conflict }}</div><div class="l">Conflict</div></div>
                <div class="stat"><div class="n">{{ stats.writebacks }}</div><div class="l">Write-backs</div></div>
            </div>

            <!-- Current access decode + cursor -->
            <div class="cache-cursor">
                <span class="cc-lbl">{{ splitID ? (show === 'I' ? 'I-access' : 'D-access') : 'Access' }}</span>
                <button class="cc-btn" :disabled="cursorN <= 1" @click="stepCursor(-1)">◀</button>
                <span class="cc-now">{{ cursorN }} / {{ total }}</span>
                <button class="cc-btn" :disabled="cursorN >= total" @click="stepCursor(1)">▶</button>
                <button class="cc-btn cc-live" :class="{ active: live }" @click="goLive">Live</button>
                <template v-if="current">
                    <span class="cc-addr">{{ hex(current.address) }}</span>
                    <span class="cc-rw" :class="current.type">{{ current.type === 'write' ? 'W' : 'R' }}</span>
                    <span class="addr-strip">
                        <span class="a-tag">tag {{ current.tag }}</span><span class="a-idx">set {{ current.index }}</span><span class="a-off">off {{ current.offset }}</span>
                    </span>
                    <span class="cc-res" :class="current.hit ? 'h' : 'm'">{{ current.hit ? 'HIT' : 'MISS · ' + current.missType }}</span>
                </template>
            </div>

            <!-- Cache contents: sets × ways (L1 of the shown cache) -->
            <div class="cache-scroll">
                <table class="cache-grid">
                    <thead>
                        <tr>
                            <th class="cg-corner">Set</th>
                            <th v-for="w in geometry.ways" :key="'w' + w" class="cg-way">Way {{ w - 1 }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="s in geometry.numSets" :key="'s' + s">
                            <th class="cg-set" :class="{ now: current && current.index === s - 1 }">{{ s - 1 }}</th>
                            <td v-for="w in geometry.ways" :key="s + '-' + w" class="cg-cell">
                                <div v-if="lineFor(s - 1, w - 1) && lineFor(s - 1, w - 1).valid"
                                     class="cline" :class="{ dirty: lineFor(s - 1, w - 1).dirty, now: isCurrentLine(s - 1, w - 1) }">
                                    <span class="ct-tag">tag {{ lineFor(s - 1, w - 1).tag }}</span>
                                    <span v-if="lineFor(s - 1, w - 1).dirty" class="ct-d">D</span>
                                </div>
                                <div v-else class="cline empty">—</div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </template>
    </div>
</template>

<style scoped>
.cache-view { width: 100%; display: flex; flex-direction: column; gap: 8px; }
.cache-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cache-gear { display: inline-flex; align-items: center; gap: 6px; border: 1px solid rgba(var(--bs-secondary-rgb), 0.45); background: rgba(var(--bs-secondary-rgb), 0.12); color: rgba(var(--bs-body-color-rgb), 0.9); border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 0.75rem; font-weight: 600; }
.cache-gear:hover, .cache-gear.active { background: rgba(var(--bs-primary-rgb), 0.15); color: rgba(var(--bs-primary-rgb), 1); }
.cache-hint { font-size: 0.72rem; color: rgba(var(--bs-body-color-rgb), 0.6); font-style: italic; }
.cache-split { font-size: 0.72rem; font-family: ui-monospace, monospace; color: rgba(var(--bs-body-color-rgb), 0.8); }
.cache-seg { display: inline-flex; border: 1px solid rgba(var(--bs-secondary-rgb), 0.4); border-radius: 5px; overflow: hidden; }
.seg { border: none; background: transparent; padding: 2px 10px; font-size: 0.72rem; font-weight: 700; cursor: pointer; color: rgba(var(--bs-body-color-rgb), 0.7); }
.seg.on { background: rgba(var(--bs-primary-rgb), 0.85); color: #fff; }

.cache-settings { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid rgba(var(--bs-secondary-rgb), 0.3); border-radius: 8px; background: rgba(var(--bs-secondary-rgb), 0.06); }
.c-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 0.75rem; }
.c-row label { color: rgba(var(--bs-body-color-rgb), 0.85); font-weight: 600; }
.c-row input[type="number"] { width: 60px; font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(var(--bs-secondary-rgb), 0.4); }
.c-row select { font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; }
.c-chk { display: inline-flex; align-items: center; gap: 5px; }
.c-preset, .c-reset { border: 1px solid rgba(var(--bs-secondary-rgb), 0.4); background: rgba(var(--bs-secondary-rgb), 0.1); color: rgba(var(--bs-body-color-rgb), 0.9); border-radius: 4px; padding: 2px 9px; cursor: pointer; font-size: 0.72rem; font-weight: 600; }
.c-preset:hover, .c-reset:hover { background: rgba(var(--bs-primary-rgb), 0.15); color: rgba(var(--bs-primary-rgb), 1); }
.c-reset { margin-left: auto; }

.cache-empty { font-size: 0.85rem; color: rgba(var(--bs-body-color-rgb), 0.6); padding: 16px 4px; }

.cache-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(88px, 1fr)); gap: 6px; }
.stat { padding: 8px 10px; border-radius: 6px; background: rgba(var(--bs-secondary-rgb), 0.08); border: 1px solid rgba(0, 0, 0, 0.1); text-align: center; }
.stat .n { font-size: 1.05rem; font-weight: 800; font-variant-numeric: tabular-nums; color: rgba(var(--bs-body-color-rgb), 1); }
.stat .l { font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.04em; color: rgba(var(--bs-body-color-rgb), 0.65); margin-top: 2px; }
.stat.hi .n { color: rgba(var(--bs-primary-rgb), 1); }

.cache-cursor { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cc-lbl { font-size: 0.72rem; font-weight: 700; color: rgba(var(--bs-body-color-rgb), 0.8); }
.cc-btn { border: 1px solid rgba(var(--bs-secondary-rgb), 0.4); background: rgba(var(--bs-secondary-rgb), 0.1); color: rgba(var(--bs-body-color-rgb), 0.9); border-radius: 4px; padding: 2px 9px; cursor: pointer; font-weight: 700; font-size: 0.78rem; }
.cc-btn:hover:not(:disabled) { background: rgba(var(--bs-primary-rgb), 0.15); color: rgba(var(--bs-primary-rgb), 1); }
.cc-btn:disabled { opacity: 0.4; cursor: default; }
.cc-live.active { background: rgba(var(--bs-primary-rgb), 0.85); color: #fff; border-color: transparent; }
.cc-now { font-variant-numeric: tabular-nums; font-weight: 700; min-width: 54px; text-align: center; font-size: 0.78rem; }
.cc-addr { font-family: ui-monospace, monospace; font-weight: 700; font-size: 0.78rem; }
.cc-rw { font-size: 0.66rem; font-weight: 800; padding: 1px 6px; border-radius: 4px; color: #fff; }
.cc-rw.read { background: #196BDE; } .cc-rw.write { background: #830051; }
.addr-strip { display: inline-flex; font-family: ui-monospace, monospace; font-size: 0.66rem; border-radius: 5px; overflow: hidden; }
.addr-strip span { padding: 2px 7px; color: #fff; font-weight: 700; }
.a-tag { background: #196BDE; } .a-idx { background: #1f9d57; } .a-off { background: #830051; }
.cc-res { font-size: 0.7rem; font-weight: 800; padding: 1px 8px; border-radius: 10px; }
.cc-res.h { background: rgba(31,157,87,.18); color: #1f9d57; }
.cc-res.m { background: rgba(229,57,53,.18); color: #E53935; }

.cache-scroll { overflow: auto; max-height: 44vh; border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; }
.cache-grid { border-collapse: collapse; width: 100%; font-family: ui-monospace, "Cascadia Code", monospace; }
.cache-grid th, .cache-grid td { border: 1px solid rgba(var(--bs-body-color-rgb), 0.08); padding: 0; }
.cg-corner, .cg-way { font-size: 0.64rem; font-weight: 700; color: rgba(var(--bs-body-color-rgb), 0.65); padding: 4px 8px; text-align: left; position: sticky; top: 0; background: rgba(var(--bs-body-bg-rgb), 1); }
.cg-set { font-size: 0.66rem; font-weight: 700; padding: 4px 8px; text-align: center; background: rgba(var(--bs-secondary-rgb), 0.08); color: rgba(var(--bs-body-color-rgb), 0.8); }
.cg-set.now { background: rgba(var(--bs-primary-rgb), 0.18); color: rgba(var(--bs-primary-rgb), 1); }
.cg-cell { padding: 2px; }
.cline { display: flex; align-items: center; justify-content: space-between; gap: 4px; font-size: 0.66rem; padding: 3px 6px; border-radius: 4px; background: rgba(31,157,87,.12); color: rgba(var(--bs-body-color-rgb), 0.9); }
.cline.empty { background: transparent; color: rgba(var(--bs-body-color-rgb), 0.3); justify-content: center; }
.cline.dirty { background: rgba(232,161,0,.18); }
.cline.now { outline: 2px solid rgba(var(--bs-primary-rgb), 0.9); outline-offset: -2px; font-weight: 800; }
.ct-d { font-weight: 800; color: #E8A100; }

[data-bs-theme="dark"] { .cg-corner, .cg-way { background: #1b1f24; } }
</style>
