import { defineConfig, mergeConfig } from "vitest/config";

const shared = {};

export default mergeConfig(shared, defineConfig({ test: {
  testTimeout: 20_000
} }));
