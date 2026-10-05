// The web UI: one React app whose views come from the modules (host/web/registry.ts discovers them).
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: `${here}host/web`,
  plugins: [react()],
  resolve: { alias: { "@os": `${here}host/web/src` } },
  // Modules live outside the web root; let the dev server read them.
  server: { fs: { allow: [here] } },
  build: { outDir: `${here}dist/web`, emptyOutDir: true, chunkSizeWarningLimit: 4096 },
});
