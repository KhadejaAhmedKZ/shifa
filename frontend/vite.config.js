import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev: base "/" and a proxy to the local FastAPI backend on :8000
// (override with SHIFA_API=http://localhost:8010 if that port is taken).
// In build (GitHub Pages project site): base must match the repo name.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/shifa/" : "/",
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.SHIFA_API || "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
}));
