import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [tailwindcss(), tanstackStart(), react()],
  ssr: { external: ["bun:sqlite", "systeminformation"] },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.PORT ?? 3000),
    strictPort: true,
  },
});
