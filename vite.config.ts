import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const builtAt = new Date().toISOString();
const buildId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export default defineConfig({
  plugins: [
    react(),
    {
      name: "galileohub-build-metadata",
      transformIndexHtml() {
        return [
          {
            tag: "meta",
            attrs: { name: "galileohub-build-id", content: buildId },
            injectTo: "head",
          },
        ];
      },
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: `${JSON.stringify({ buildId, builtAt }, null, 2)}\n`,
        });
      },
    },
  ],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
    globals: true,
  },
});
