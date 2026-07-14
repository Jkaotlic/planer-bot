import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served by the server under /app/ once deployed (see server workspace).
export default defineConfig({
  plugins: [react()],
  base: "/app/",
  build: {
    outDir: "dist",
  },
});
