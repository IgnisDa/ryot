import shared from "@ryot-app/testing/vitest.shared";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(shared, defineConfig({ test: { testTimeout: 20_000 } }));
