import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

// Vitest config for component/unit tests (UdL extension). Kept separate from
// vite.config.ts so tests do not pull in the wasm / devtools / image plugins.
export default defineConfig({
    plugins: [vue()],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
            "#": fileURLToPath(new URL(".", import.meta.url)),
        },
    },
    test: {
        environment: "jsdom",
        globals: true,
        include: ["tests/unit/**/*.spec.ts"],
    },
});
