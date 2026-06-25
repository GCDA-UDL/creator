<!--
Copyright 2018-2026 CREATOR Team. LGPL-3.0.
UdL extension (PID RISC-V) — Cache-coherence view (MESI/MSI, SMPcaché-style).
A snooping write-invalidate coherence simulator over an editable multi-core access
trace (CREATOR runs one core, so the trace is authored / from examples). Shows the
MESI state of every line per core, the bus transactions, coherence misses and
false sharing, stepped operation by operation.
-->
<script lang="ts">
import { defineComponent } from "vue";
import { coreEvents } from "@/core/events.mts";
import { getMemoryAccessHistory } from "@/core/trace/memoryAccessHistory.mts";
import {
    simulateCoherence,
    DEFAULT_COHERENCE_CONFIG,
    type CoherenceConfig,
    type CohOp,
    type CoherenceTrace,
} from "@/core/trace/coherenceModel.mts";

const LS_KEY = "creator-coherence";

const EXAMPLES: Record<string, string> = {
    "True sharing": "0 0 R\n1 0 R\n1 0 W\n0 0 R",
    "False sharing": "0 0 W\n1 4 W\n0 0 W\n1 4 W",
    "MESI E→S→M": "0 0 R\n1 0 R\n0 0 W\n1 0 R",
    "Producer/consumer": "0 0 W\n1 0 R\n0 0 W\n1 0 R\n1 0 R",
};

const STATE_NAME: Record<string, string> = { M: "Modified", E: "Exclusive", S: "Shared", I: "Invalid" };

export default defineComponent({
    props: { dark: { type: Boolean, default: false } },
    data() {
        return {
            config: { ...DEFAULT_COHERENCE_CONFIG } as CoherenceConfig,
            traceText: EXAMPLES["True sharing"],
            showConfig: false,
            cursor: 1,
            live: true,
            examples: EXAMPLES,
            stateName: STATE_NAME,
        };
    },
    mounted() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) {
                const s = JSON.parse(raw);
                if (s.config) this.config = { ...DEFAULT_COHERENCE_CONFIG, ...s.config };
                if (typeof s.traceText === "string") this.traceText = s.traceText;
            }
        } catch {
            /* ignore */
        }
    },
    watch: {
        config: { deep: true, handler() { this.persist(); } },
        traceText() { this.persist(); },
    },
    computed: {
        ops(): CohOp[] {
            const out: CohOp[] = [];
            for (const raw of this.traceText.split(/\n/)) {
                const line = raw.trim();
                if (!line || line.startsWith("#")) continue;
                const m = line.split(/[\s,]+/);
                if (m.length < 3) continue;
                const core = parseInt(m[0], 10);
                const address = m[1].startsWith("0x") ? parseInt(m[1], 16) : parseInt(m[1], 10);
                const t = m[2].toLowerCase();
                const type = t === "w" || t === "write" ? "write" : "read";
                if (Number.isFinite(core) && Number.isFinite(address) && core < this.config.cores) {
                    out.push({ core, address, type });
                }
            }
            return out;
        },
        full(): CoherenceTrace {
            return simulateCoherence(this.ops, this.config);
        },
        hasData(): boolean {
            return this.ops.length > 0;
        },
        total(): number {
            return this.ops.length;
        },
        cursorN(): number {
            if (this.total <= 0) return 0;
            return this.live ? this.total : Math.min(Math.max(this.cursor, 1), this.total);
        },
        stateAtCursor(): CoherenceTrace {
            return simulateCoherence(this.ops.slice(0, this.cursorN), this.config);
        },
        current() {
            return this.cursorN > 0 ? this.full.events[this.cursorN - 1] : null;
        },
        stats() {
            return this.full.stats;
        },
        coreList(): number[] {
            return Array.from({ length: this.config.cores }, (_, i) => i);
        },
    },
    methods: {
        persist() {
            try {
                localStorage.setItem(LS_KEY, JSON.stringify({ config: this.config, traceText: this.traceText }));
            } catch {
                /* ignore */
            }
        },
        loadExample(name: string) {
            this.traceText = EXAMPLES[name] ?? "";
            this.live = true;
        },
        seedFromProgram() {
            const acc = getMemoryAccessHistory();
            if (!acc.length) return;
            this.traceText = acc
                .slice(0, 64)
                .map(a => `0 ${a.address} ${a.type === "write" ? "W" : "R"}`)
                .join("\n");
            this.live = true;
        },
        stepCursor(d: number) {
            const base = this.cursorN;
            this.live = false;
            this.cursor = Math.min(Math.max(base + d, 1), this.total);
        },
        goLive() {
            this.live = true;
        },
    },
});
</script>

<template>
    <div class="coh-view">
        <div class="coh-toolbar">
            <button class="coh-gear" :class="{ active: showConfig }" title="Coherence configuration" @click="showConfig = !showConfig">
                <font-awesome-icon :icon="['fas', 'gear']" /> Config
            </button>
            <span class="coh-ex-lbl">Examples:</span>
            <button v-for="(t, name) in examples" :key="name" class="coh-ex" @click="loadExample(name)">{{ name }}</button>
            <button class="coh-ex" title="Use the program's data accesses as core 0" @click="seedFromProgram">From program</button>
        </div>

        <div v-if="showConfig" class="coh-settings">
            <div class="co-row">
                <label>Cores</label>
                <input type="number" min="1" max="8" v-model.number="config.cores" />
                <label>Protocol</label>
                <select v-model="config.protocol"><option value="MESI">MESI</option><option value="MSI">MSI</option></select>
                <label>Block (bytes)</label>
                <input type="number" min="4" max="256" step="4" v-model.number="config.blockSize" />
                <label>Lines/core</label>
                <input type="number" min="1" max="32" v-model.number="config.linesPerCore" />
            </div>
        </div>

        <div class="coh-main">
            <!-- Trace editor -->
            <div class="coh-trace">
                <div class="ct-h">Access trace · <span class="muted">"core addr R/W" per line</span></div>
                <textarea v-model="traceText" class="ct-area" spellcheck="false" rows="8"></textarea>
            </div>

            <div class="coh-right">
                <p v-if="!hasData" class="coh-empty">Enter a trace or pick an example.</p>
                <template v-else>
                    <!-- Stats -->
                    <div class="coh-stats">
                        <div class="stat"><div class="n">{{ stats.hits }}</div><div class="l">Hits</div></div>
                        <div class="stat"><div class="n">{{ stats.misses }}</div><div class="l">Misses</div></div>
                        <div class="stat hi"><div class="n">{{ stats.coherenceMisses }}</div><div class="l">Coherence misses</div></div>
                        <div class="stat hi"><div class="n">{{ stats.falseSharing }}</div><div class="l">False sharing</div></div>
                        <div class="stat"><div class="n">{{ stats.invalidations }}</div><div class="l">Invalidations</div></div>
                        <div class="stat"><div class="n">{{ stats.busTransactions }}</div><div class="l">Bus txns</div></div>
                    </div>
                    <div class="coh-bus">
                        <span>BusRd {{ stats.busRd }}</span><span>BusRdX {{ stats.busRdX }}</span>
                        <span>BusUpgr {{ stats.busUpgr }}</span><span>Flushes {{ stats.flushes }}</span>
                    </div>

                    <!-- cursor -->
                    <div class="coh-cursor">
                        <span class="cc-lbl">Op</span>
                        <button class="cc-btn" :disabled="cursorN <= 1" @click="stepCursor(-1)">◀</button>
                        <span class="cc-now">{{ cursorN }} / {{ total }}</span>
                        <button class="cc-btn" :disabled="cursorN >= total" @click="stepCursor(1)">▶</button>
                        <button class="cc-btn cc-live" :class="{ active: live }" @click="goLive">Live</button>
                        <template v-if="current">
                            <span class="cur">C{{ current.core }} {{ current.type === 'write' ? 'W' : 'R' }} @{{ current.address }}</span>
                            <span class="badge tx" v-if="current.transaction !== '—'">{{ current.transaction }}</span>
                            <span class="badge" :class="current.hit ? 'h' : 'm'">{{ current.hit ? 'hit' : 'miss' }}</span>
                            <span class="badge st" :class="'s-' + current.toState">{{ current.fromState }}→{{ current.toState }}</span>
                            <span v-if="current.coherenceMiss" class="badge coh">coherence</span>
                            <span v-if="current.falseSharing" class="badge fs">false sharing</span>
                            <span v-if="current.invalidated.length" class="badge inv">inval C{{ current.invalidated.join(',C') }}</span>
                        </template>
                    </div>

                    <!-- per-core MESI state -->
                    <div class="coh-cores">
                        <div v-for="c in coreList" :key="'core' + c" class="coh-core" :class="{ active: current && current.core === c }">
                            <div class="cc-title">Core {{ c }}</div>
                            <div class="cc-lines">
                                <div v-for="ln in stateAtCursor.finalStates[c]" :key="c + '-' + ln.block"
                                     class="cc-line" :class="'s-' + ln.state" :title="stateName[ln.state]">
                                    blk {{ ln.block }} · {{ ln.state }}
                                </div>
                                <div v-if="!stateAtCursor.finalStates[c] || !stateAtCursor.finalStates[c].length" class="cc-empty">— invalid —</div>
                            </div>
                        </div>
                    </div>
                </template>
            </div>
        </div>
    </div>
</template>

<style scoped>
.coh-view { width: 100%; display: flex; flex-direction: column; gap: 8px; }
.coh-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.coh-gear { display: inline-flex; align-items: center; gap: 6px; border: 1px solid rgba(var(--bs-secondary-rgb), 0.45); background: rgba(var(--bs-secondary-rgb), 0.12); color: rgba(var(--bs-body-color-rgb), 0.9); border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 0.75rem; font-weight: 600; }
.coh-gear:hover, .coh-gear.active { background: rgba(var(--bs-primary-rgb), 0.15); color: rgba(var(--bs-primary-rgb), 1); }
.coh-ex-lbl { font-size: 0.72rem; color: rgba(var(--bs-body-color-rgb), 0.6); font-weight: 700; }
.coh-ex { border: 1px solid rgba(var(--bs-secondary-rgb), 0.4); background: rgba(var(--bs-secondary-rgb), 0.1); color: rgba(var(--bs-body-color-rgb), 0.9); border-radius: 4px; padding: 2px 9px; cursor: pointer; font-size: 0.72rem; font-weight: 600; }
.coh-ex:hover { background: rgba(var(--bs-primary-rgb), 0.15); color: rgba(var(--bs-primary-rgb), 1); }

.coh-settings { padding: 10px; border: 1px solid rgba(var(--bs-secondary-rgb), 0.3); border-radius: 8px; background: rgba(var(--bs-secondary-rgb), 0.06); }
.co-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 0.75rem; }
.co-row label { color: rgba(var(--bs-body-color-rgb), 0.85); font-weight: 600; }
.co-row input[type="number"] { width: 60px; font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(var(--bs-secondary-rgb), 0.4); }
.co-row select { font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; }

.coh-main { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
.coh-trace { flex: 0 0 200px; }
.ct-h { font-size: 0.68rem; font-weight: 700; color: rgba(var(--bs-body-color-rgb), 0.8); margin-bottom: 4px; }
.ct-h .muted { color: rgba(var(--bs-body-color-rgb), 0.5); font-weight: 400; }
.ct-area { width: 100%; font-family: ui-monospace, "Cascadia Code", monospace; font-size: 0.78rem; padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(var(--bs-secondary-rgb), 0.4); background: rgba(var(--bs-secondary-rgb), 0.05); color: rgba(var(--bs-body-color-rgb), 0.95); resize: vertical; }
.coh-right { flex: 1; min-width: 280px; display: flex; flex-direction: column; gap: 8px; }
.coh-empty { font-size: 0.85rem; color: rgba(var(--bs-body-color-rgb), 0.6); }

.coh-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 6px; }
.stat { padding: 7px 9px; border-radius: 6px; background: rgba(var(--bs-secondary-rgb), 0.08); border: 1px solid rgba(0, 0, 0, 0.1); text-align: center; }
.stat .n { font-size: 1.05rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.stat .l { font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.03em; color: rgba(var(--bs-body-color-rgb), 0.65); margin-top: 2px; }
.stat.hi .n { color: rgba(var(--bs-primary-rgb), 1); }
.coh-bus { display: flex; gap: 10px; flex-wrap: wrap; font-size: 0.7rem; font-family: ui-monospace, monospace; color: rgba(var(--bs-body-color-rgb), 0.7); }

.coh-cursor { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.cc-lbl { font-size: 0.72rem; font-weight: 700; color: rgba(var(--bs-body-color-rgb), 0.8); }
.cc-btn { border: 1px solid rgba(var(--bs-secondary-rgb), 0.4); background: rgba(var(--bs-secondary-rgb), 0.1); color: rgba(var(--bs-body-color-rgb), 0.9); border-radius: 4px; padding: 2px 9px; cursor: pointer; font-weight: 700; font-size: 0.78rem; }
.cc-btn:hover:not(:disabled) { background: rgba(var(--bs-primary-rgb), 0.15); color: rgba(var(--bs-primary-rgb), 1); }
.cc-btn:disabled { opacity: 0.4; cursor: default; }
.cc-live.active { background: rgba(var(--bs-primary-rgb), 0.85); color: #fff; border-color: transparent; }
.cc-now { font-variant-numeric: tabular-nums; font-weight: 700; min-width: 50px; text-align: center; font-size: 0.78rem; }
.cur { font-family: ui-monospace, monospace; font-weight: 700; font-size: 0.74rem; }
.badge { font-size: 0.64rem; font-weight: 800; padding: 1px 7px; border-radius: 10px; }
.badge.tx { background: rgba(25,107,222,.15); color: #196BDE; }
.badge.h { background: rgba(31,157,87,.18); color: #1f9d57; }
.badge.m { background: rgba(229,57,53,.18); color: #E53935; }
.badge.coh { background: rgba(232,161,0,.2); color: #9a6c00; }
.badge.fs { background: rgba(216,27,96,.18); color: #D81B60; }
.badge.inv { background: rgba(123,0,81,.14); color: #830051; }
.badge.st { font-family: ui-monospace, monospace; background: rgba(var(--bs-secondary-rgb),.15); }

.coh-cores { display: flex; gap: 8px; flex-wrap: wrap; }
.coh-core { flex: 1; min-width: 120px; border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; overflow: hidden; }
.coh-core.active { outline: 2px solid rgba(var(--bs-primary-rgb), 0.7); }
.cc-title { font-size: 0.68rem; font-weight: 800; padding: 4px 8px; background: rgba(var(--bs-secondary-rgb), 0.1); }
.cc-lines { padding: 6px; display: flex; flex-direction: column; gap: 4px; min-height: 40px; }
.cc-line { font-family: ui-monospace, monospace; font-size: 0.7rem; font-weight: 700; padding: 2px 7px; border-radius: 4px; color: #fff; }
.s-M { background: #E53935; } .s-E { background: #1f9d57; } .s-S { background: #196BDE; } .s-I { background: #9E9E9E; }
.cc-empty { font-size: 0.68rem; color: rgba(var(--bs-body-color-rgb), 0.4); font-style: italic; }
</style>
