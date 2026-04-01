import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Resolve shared/ directory at repo root (../../ relative to worker/client/)
      "../../shared": path.resolve(__dirname, "../../shared"),
      "../../../shared": path.resolve(__dirname, "../../shared"),
      "../../../../shared": path.resolve(__dirname, "../../shared"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      "/auth": "http://localhost:8787",
      "/authorize": "http://localhost:8787",
      "/callback": "http://localhost:8787",
      "/token": "http://localhost:8787",
      "/register": "http://localhost:8787",
      "/mcp": "http://localhost:8787",
    },
  },
});
