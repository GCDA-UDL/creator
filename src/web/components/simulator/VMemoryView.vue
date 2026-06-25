<!--
Copyright 2018-2026 CREATOR Team. LGPL-3.0.
UdL extension (PID RISC-V) — Virtual memory view (TLB + paging).
Translates the program's data accesses (virtual addresses) through a configurable
TLB + page table into physical frames; shows the VA→PA decode, TLB/page-table hits,
page faults (with a finite, configurable RAM), the TLB and resident page table, and
step-by-step evolution. Engine unchanged; config recomputes instantly.
-->
<script lang="ts">
import { defineComponent } from "vue";
import { coreEvents } from "@/core/events.mts";
import { getMemoryAccessHistory } from "@/core/trace/memoryAccessHistory.mts";
import {
    simulateVirtualMemory,
    DEFAULT_VM_CONFIG,
    type VmConfig,
    type VmTrace,
} from "@/core/trace/virtualMemoryModel.mts";

const LS_KEY = "creator-vm-config";
const PRESETS: Record<string, Partial<VmConfig>> = {
    "Roomy RAM": { pageSize: 256, tlbEntries: 4, ramFrames: 16, pageReplace: "LRU" },
    "Tight RAM (LRU)": { pageSize: 256, tlbEntries: 4, ramFrames: 3, pageReplace: "LRU" },
    "Tight RAM (FIFO)": { pageSize: 256, tlbEntries: 4, ramFrames: 3, pageReplace: "FIFO" },
};
const hex = (n: number) => "0x" + Math.max(0, Math.floor(n)).toString(16);

export default defineComponent({
    props: { dark: { type: Boolean, default: false } },
    data() {
        return {
            config: { ...DEFAULT_VM_CONFIG } as VmConfig,
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
            if (raw) this.config = { ...DEFAULT_VM_CONFIG, ...JSON.parse(raw) };
        } catch {
            /* ignore */
        }
        (coreEvents as any).on("memory-access", this.onChange);
        (coreEvents as any).on("registers-reset", this.onChange);
    },
    beforeUnmount() {
        (coreEvents as any).off("memory-access", this.onChange);
        (coreEvents as any).off("registers-reset", this.onChange);
    },
    watch: {
        config: {
            deep: true,
            handler(v: VmConfig) {
                try {
                    localStorage.setItem(LS_KEY, JSON.stringify(v));
                } catch {
                    /* ignore */
                }
            },
        },
    },
    computed: {
        addresses(): number[] {
            void this.version;
            return getMemoryAccessHistory().map(a => a.address);
        },
        cfg(): VmConfig {
            return {
                pageSize: this.config.pageSize,
                tlbEntries: this.config.tlbEntries,
                ramFrames: this.config.ramFrames,
                tlbReplace: this.config.tlbReplace,
                pageReplace: this.config.pageReplace,
            };
        },
        full(): VmTrace {
            return simulateVirtualMemory(this.addresses, this.cfg);
        },
        hasData(): boolean {
            return this.addresses.length > 0;
        },
        total(): number {
            return this.addresses.length;
        },
        cursorN(): number {
            if (this.total <= 0) return 0;
            return this.live ? this.total : Math.min(Math.max(this.cursor, 1), this.total);
        },
        stateAtCursor(): VmTrace {
            return simulateVirtualMemory(this.addresses.slice(0, this.cursorN), this.cfg);
        },
        current() {
            return this.cursorN > 0 ? this.full.results[this.cursorN - 1] : null;
        },
        stats() {
            return this.full.stats;
        },
        tlbPct(): string {
            return this.total > 0 ? (this.stats.tlbHitRate * 100).toFixed(1) + "%" : "—";
        },
    },
    methods: {
        hex,
        onChange() {
            this.version++;
        },
        applyPreset(name: string) {
            this.config = { ...this.config, ...(PRESETS[name] ?? {}) };
        },
        resetConfig() {
            this.config = { ...DEFAULT_VM_CONFIG };
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
    <div class="vm-view">
        <div class="vm-toolbar">
            <button class="vm-gear" :class="{ active: showConfig }" title="Virtual-memory configuration" @click="showConfig = !showConfig">
                <font-awesome-icon :icon="['fas', 'gear']" /> Memory config
            </button>
            <span class="vm-hint">Recomputes instantly — no re-run needed.</span>
        </div>

        <div v-if="showConfig" class="vm-settings">
            <div class="v-row">
                <label>Page size (bytes)</label>
                <input type="number" min="16" max="4096" step="16" v-model.number="config.pageSize" />
                <label>TLB entries</label>
                <input type="number" min="1" max="64" v-model.number="config.tlbEntries" />
                <label>RAM frames</label>
                <input type="number" min="1" max="64" v-model.number="config.ramFrames" />
            </div>
            <div class="v-row">
                <label>TLB replacement</label>
                <select v-model="config.tlbReplace"><option value="LRU">LRU</option><option value="FIFO">FIFO</option></select>
                <label>Page replacement</label>
                <select v-model="config.pageReplace"><option value="LRU">LRU</option><option value="FIFO">FIFO</option></select>
                <button v-for="(p, name) in presets" :key="name" class="v-preset" @click="applyPreset(name)">{{ name }}</button>
                <button class="v-reset" @click="resetConfig">Reset</button>
            </div>
        </div>

        <p v-if="!hasData" class="vm-empty">Run a program with <b>loads/stores</b> to see address translation.</p>

        <template v-else>
            <div class="vm-stats">
                <div class="stat"><div class="n">{{ stats.accesses }}</div><div class="l">Accesses</div></div>
                <div class="stat hi"><div class="n">{{ tlbPct }}</div><div class="l">TLB hit rate</div></div>
                <div class="stat"><div class="n">{{ stats.tlbHits }}</div><div class="l">TLB hits</div></div>
                <div class="stat"><div class="n">{{ stats.pageTableHits }}</div><div class="l">Page-table hits</div></div>
                <div class="stat"><div class="n">{{ stats.pageFaults }}</div><div class="l">Page faults</div></div>
                <div class="stat"><div class="n">{{ config.ramFrames }}</div><div class="l">RAM frames</div></div>
            </div>

            <!-- Current translation + cursor -->
            <div class="vm-cursor">
                <span class="vc-lbl">Access</span>
                <button class="vc-btn" :disabled="cursorN <= 1" @click="stepCursor(-1)">◀</button>
                <span class="vc-now">{{ cursorN }} / {{ total }}</span>
                <button class="vc-btn" :disabled="cursorN >= total" @click="stepCursor(1)">▶</button>
                <button class="vc-btn vc-live" :class="{ active: live }" @click="goLive">Live</button>
            </div>
            <div v-if="current" class="vm-xlate">
                <span class="xa">VA {{ hex(current.address) }}</span>
                <span class="arrow">→</span>
                <span class="xv">VPN {{ current.vpn }}</span><span class="xo">off {{ current.offset }}</span>
                <span class="arrow">→</span>
                <span class="badge" :class="current.tlbHit ? 'ok' : 'no'">TLB {{ current.tlbHit ? 'hit' : 'miss' }}</span>
                <span v-if="!current.tlbHit" class="badge" :class="current.pageFault ? 'fault' : 'ok'">{{ current.pageFault ? 'PAGE FAULT' : 'page-table hit' }}</span>
                <span v-if="current.evictedVpn !== null" class="badge evict">evict VPN {{ current.evictedVpn }}</span>
                <span class="arrow">→</span>
                <span class="xp">PFN {{ current.pfn }}</span>
                <span class="xpa">PA {{ current.physical !== null ? hex(current.physical) : '—' }}</span>
            </div>

            <div class="vm-tables">
                <!-- TLB -->
                <div class="vm-tbl">
                    <div class="tbl-h">TLB ({{ stateAtCursor.finalTlb.length }}/{{ config.tlbEntries }})</div>
                    <table>
                        <thead><tr><th>VPN</th><th>PFN</th></tr></thead>
                        <tbody>
                            <tr v-for="e in stateAtCursor.finalTlb" :key="'t' + e.vpn" :class="{ now: current && current.vpn === e.vpn }">
                                <td>{{ e.vpn }}</td><td>{{ e.pfn }}</td>
                            </tr>
                            <tr v-if="!stateAtCursor.finalTlb.length"><td colspan="2" class="muted">empty</td></tr>
                        </tbody>
                    </table>
                </div>
                <!-- Page table / RAM frames -->
                <div class="vm-tbl">
                    <div class="tbl-h">Resident pages — RAM ({{ stateAtCursor.finalPageTable.length }}/{{ config.ramFrames }} frames)</div>
                    <table>
                        <thead><tr><th>VPN</th><th>Frame (PFN)</th></tr></thead>
                        <tbody>
                            <tr v-for="e in stateAtCursor.finalPageTable" :key="'p' + e.vpn" :class="{ now: current && current.vpn === e.vpn }">
                                <td>{{ e.vpn }}</td><td>{{ e.pfn }}</td>
                            </tr>
                            <tr v-if="!stateAtCursor.finalPageTable.length"><td colspan="2" class="muted">empty</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </template>
    </div>
</template>

<style scoped>
.vm-view { width: 100%; display: flex; flex-direction: column; gap: 8px; }
.vm-toolbar { display: flex; align-items: center; gap: 10px; }
.vm-gear { display: inline-flex; align-items: center; gap: 6px; border: 1px solid rgba(var(--bs-secondary-rgb), 0.45); background: rgba(var(--bs-secondary-rgb), 0.12); color: rgba(var(--bs-body-color-rgb), 0.9); border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 0.75rem; font-weight: 600; }
.vm-gear:hover, .vm-gear.active { background: rgba(var(--bs-primary-rgb), 0.15); color: rgba(var(--bs-primary-rgb), 1); }
.vm-hint { font-size: 0.72rem; color: rgba(var(--bs-body-color-rgb), 0.6); font-style: italic; }

.vm-settings { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid rgba(var(--bs-secondary-rgb), 0.3); border-radius: 8px; background: rgba(var(--bs-secondary-rgb), 0.06); }
.v-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 0.75rem; }
.v-row label { color: rgba(var(--bs-body-color-rgb), 0.85); font-weight: 600; }
.v-row input[type="number"] { width: 64px; font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(var(--bs-secondary-rgb), 0.4); }
.v-row select { font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; }
.v-preset, .v-reset { border: 1px solid rgba(var(--bs-secondary-rgb), 0.4); background: rgba(var(--bs-secondary-rgb), 0.1); color: rgba(var(--bs-body-color-rgb), 0.9); border-radius: 4px; padding: 2px 9px; cursor: pointer; font-size: 0.72rem; font-weight: 600; }
.v-preset:hover, .v-reset:hover { background: rgba(var(--bs-primary-rgb), 0.15); color: rgba(var(--bs-primary-rgb), 1); }
.v-reset { margin-left: auto; }

.vm-empty { font-size: 0.85rem; color: rgba(var(--bs-body-color-rgb), 0.6); padding: 16px 4px; }

.vm-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 6px; }
.stat { padding: 8px 10px; border-radius: 6px; background: rgba(var(--bs-secondary-rgb), 0.08); border: 1px solid rgba(0, 0, 0, 0.1); text-align: center; }
.stat .n { font-size: 1.1rem; font-weight: 800; font-variant-numeric: tabular-nums; color: rgba(var(--bs-body-color-rgb), 1); }
.stat .l { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.04em; color: rgba(var(--bs-body-color-rgb), 0.65); margin-top: 2px; }
.stat.hi .n { color: rgba(var(--bs-primary-rgb), 1); }

.vm-cursor { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.vc-lbl { font-size: 0.72rem; font-weight: 700; color: rgba(var(--bs-body-color-rgb), 0.8); }
.vc-btn { border: 1px solid rgba(var(--bs-secondary-rgb), 0.4); background: rgba(var(--bs-secondary-rgb), 0.1); color: rgba(var(--bs-body-color-rgb), 0.9); border-radius: 4px; padding: 2px 9px; cursor: pointer; font-weight: 700; font-size: 0.78rem; }
.vc-btn:hover:not(:disabled) { background: rgba(var(--bs-primary-rgb), 0.15); color: rgba(var(--bs-primary-rgb), 1); }
.vc-btn:disabled { opacity: 0.4; cursor: default; }
.vc-live.active { background: rgba(var(--bs-primary-rgb), 0.85); color: #fff; border-color: transparent; }
.vc-now { font-variant-numeric: tabular-nums; font-weight: 700; min-width: 54px; text-align: center; font-size: 0.78rem; }

.vm-xlate { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-family: ui-monospace, monospace; font-size: 0.72rem; }
.vm-xlate .arrow { color: rgba(var(--bs-primary-rgb), 1); font-weight: 800; }
.xa, .xpa { font-weight: 700; }
.xv { background: #1f9d57; color: #fff; padding: 2px 7px; border-radius: 5px 0 0 5px; font-weight: 700; }
.xo { background: #830051; color: #fff; padding: 2px 7px; border-radius: 0 5px 5px 0; font-weight: 700; }
.xp { background: #196BDE; color: #fff; padding: 2px 7px; border-radius: 5px; font-weight: 700; }
.badge { font-size: 0.66rem; font-weight: 800; padding: 1px 8px; border-radius: 10px; }
.badge.ok { background: rgba(31,157,87,.18); color: #1f9d57; }
.badge.no { background: rgba(232,161,0,.2); color: #9a6c00; }
.badge.fault { background: rgba(229,57,53,.18); color: #E53935; }
.badge.evict { background: rgba(123,0,81,.15); color: #830051; }

.vm-tables { display: flex; gap: 10px; flex-wrap: wrap; }
.vm-tbl { flex: 1; min-width: 180px; border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; overflow: hidden; }
.tbl-h { font-size: 0.68rem; font-weight: 700; padding: 5px 8px; background: rgba(var(--bs-secondary-rgb), 0.1); color: rgba(var(--bs-body-color-rgb), 0.85); }
.vm-tbl table { width: 100%; border-collapse: collapse; font-family: ui-monospace, monospace; font-size: 0.72rem; }
.vm-tbl th, .vm-tbl td { border-top: 1px solid rgba(var(--bs-body-color-rgb), 0.08); padding: 3px 8px; text-align: center; }
.vm-tbl th { color: rgba(var(--bs-body-color-rgb), 0.6); font-size: 0.64rem; }
.vm-tbl tr.now td { background: rgba(var(--bs-primary-rgb), 0.15); font-weight: 800; }
.vm-tbl .muted { color: rgba(var(--bs-body-color-rgb), 0.4); }
</style>
