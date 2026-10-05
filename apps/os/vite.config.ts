// The web UI: one React app whose views come from the modules (host/web/registry.ts discovers them).
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";

const here = fileURLToPath(new URL(".", import.meta.url));
// In an environment, node_modules is a link to os/runtime/<hash>: Vite serves files by their real path.
const deps = join(here, "node_modules");
const runtime = existsSync(deps) ? [realpathSync(deps)] : [];

export default defineConfig({
  root: `${here}host/web`,
  plugins: [react()],
  resolve: { alias: { "@os": `${here}host/web/src` } },
  // Modules live outside the web root; the dependencies (fonts…) are hoisted above this app in the monorepo and
  // live in the shared runtime in an environment.
  server: { fs: { allow: [here, searchForWorkspaceRoot(here), ...runtime] } },
  build: { outDir: `${here}dist/web`, emptyOutDir: true, chunkSizeWarningLimit: 4096 },
});
