import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readConfig } from "./src/server/config.server.ts";

const config = readConfig();

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [tailwindcss(), tanstackStart(), react()],
  ssr: { external: ["bun:sqlite", "systeminformation"] },
  server: {
    host: config.hostname,
    port: config.port,
    strictPort: true,
  },
});
