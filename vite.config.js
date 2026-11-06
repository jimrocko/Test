import { defineConfig } from "vite";

// Relative base so the build works on GitHub Pages (/<repo>/) and anywhere else.
export default defineConfig({
  base: "./",
  build: { target: "es2020", chunkSizeWarningLimit: 1000 },
});
