import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Structural validation of the UdL test example sets (manifest wiring):
 *  - the 4 groups are registered for RV32IMFD and point to existing list files,
 *  - every list entry resolves to an existing .s that has `main:` and `ecall`,
 *  - each group ships a "_completo" (all-in-one) example,
 *  - no orphan .s files (every program is referenced by a manifest).
 * The actual assembly is checked end-to-end in tests/e2e/examples-udl.spec.ts.
 */

const ROOT = process.cwd();
const ex = (p: string) => join(ROOT, p);

interface SetEntry { name: string; id: string; architecture: string; url: string; description: string }
interface Example { name: string; id: string; url: string; description: string }

const allSets: SetEntry[] = JSON.parse(readFileSync(ex("examples/example_set.json"), "utf8"));
const udlSets = allSets.filter(s => s.id.startsWith("udl-"));

describe("UdL example sets — registration", () => {
    it("registers exactly 4 UdL groups, all for RISC-V (RV32IMFD)", () => {
        expect(udlSets.length).toBe(4);
        for (const s of udlSets) {
            expect(s.architecture).toBe("RISC-V (RV32IMFD)");
            expect(existsSync(ex(s.url))).toBe(true); // list file exists
        }
    });
});

const referenced = new Set<string>();

for (const set of udlSets) {
    describe(`group: ${set.name}`, () => {
        const list: Example[] = JSON.parse(readFileSync(ex(set.url), "utf8"));
        list.forEach(e => referenced.add(e.url.replace(/\\/g, "/"))); // eager (collection time)

        it("has a non-empty list with unique ids", () => {
            expect(list.length).toBeGreaterThan(1);
            const ids = list.map(e => e.id);
            expect(new Set(ids).size).toBe(ids.length);
        });

        it("ships an all-in-one '_completo' example", () => {
            expect(list.some(e => e.url.includes("_completo"))).toBe(true);
        });

        for (const e of list) {
            it(`example "${e.name}" resolves to a valid program`, () => {
                expect(e.name && e.id && e.url && e.description).toBeTruthy();
                const p = ex(e.url);
                expect(existsSync(p)).toBe(true);
                const src = readFileSync(p, "utf8");
                expect(src).toContain("main:");
                expect(src).toContain("ecall"); // every program exits cleanly
                referenced.add(e.url.replace(/\\/g, "/"));
            });
        }
    });
}

describe("UdL example programs — no orphans", () => {
    it("every .s under examples/udl-tests/** is referenced by a manifest", () => {
        const base = "examples/udl-tests";
        const found: string[] = [];
        for (const dir of ["datapath", "pipeline", "cache", "vmemory"]) {
            for (const f of readdirSync(ex(join(base, dir)))) {
                if (f.endsWith(".s")) found.push(`${base}/${dir}/${f}`);
            }
        }
        const orphans = found.filter(f => !referenced.has(f));
        expect(orphans).toEqual([]);
    });
});
