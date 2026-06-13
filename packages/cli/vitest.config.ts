import shared from "@ryot-app/testing/vitest.shared";
import { mergeConfig } from "vitest/config";

export default mergeConfig(shared, {
	test: { include: ["src/**/*.test.ts"], testTimeout: 30_000 },
});
