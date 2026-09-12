import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: "dashboard",
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "web-dist"),
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
      "/events": "http://localhost:8080"
    }
  }
});
