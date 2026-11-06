import { defineConfig } from "vite";

// Relative base + output to docs/ so the built app can be served straight
// from the repository (raw.githack.com or GitHub Pages "/docs").
export default defineConfig({
  base: "./",
  build: { target: "es2020", outDir: "docs", emptyOutDir: true, chunkSizeWarningLimit: 1000 },
});
