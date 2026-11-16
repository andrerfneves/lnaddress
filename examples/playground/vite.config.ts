import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    // The mock provider signs invoices with the shared test fixture in ../../test.
    fs: { allow: [repoRoot] },
  },
});
