import shared from "@ryot/testing/vitest.shared";
import { mergeConfig } from "vitest/config";

export default mergeConfig(shared, { test: { include: ["src/**/*.test.ts"] } });
