import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served by the server under /admin/ once deployed (see server workspace).
export default defineConfig({
  plugins: [react()],
  base: "/admin/",
  build: {
    outDir: "dist",
  },
});
