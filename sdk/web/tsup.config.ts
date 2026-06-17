import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs", "iife"],
  globalName: "AeroLog",
  dts: true,
  sourcemap: true,
  clean: true,
  minify: true,
  target: "es2019",
});
