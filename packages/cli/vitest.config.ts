import shared from "@ryot-app/testing/vitest.shared";
import { mergeConfig } from "vitest/config";

export default mergeConfig(shared, {
	test: { testTimeout: 30_000, include: ["src/**/*.test.ts"] },
});
