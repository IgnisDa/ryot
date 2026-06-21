import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import type { AppConfigValue } from "#lib/infrastructure/config/service";
import { AppConfig, validateSystemConfig } from "#lib/infrastructure/config/service";
import { makeAppConfigLayer } from "#lib/test-support/effect";

type Overrides = Parameters<typeof makeAppConfigLayer>[0];

const validate = (overrides?: Overrides) =>
	Effect.runSyncExit(
		Effect.gen(function* () {
			const config: AppConfigValue = yield* AppConfig;
			return yield* validateSystemConfig(config);
		}).pipe(Effect.provide(makeAppConfigLayer(overrides))),
	);

describe("validateSystemConfig workflow-pool inversion", () => {
	it("passes with defaults (workerConcurrency 5, workflowPoolMax 10)", () => {
		expect(Exit.isSuccess(validate())).toBe(true);
	});

	it("fails when workerConcurrency exceeds usable workflow-pool connections", () => {
		const result = validate({
			sandbox: { workerConcurrency: 32 },
			database: { workflowPoolMax: 10 },
		});
		expect(Exit.isFailure(result)).toBe(true);
		if (Exit.isFailure(result)) {
			const message = JSON.stringify(result.cause);
			expect(message).toContain("SANDBOX_WORKER_CONCURRENCY");
			expect(message).toContain("DATABASE_WORKFLOW_POOL_MAX");
		}
	});

	it("passes at the boundary workerConcurrency = workflowPoolMax - 1", () => {
		const result = validate({
			sandbox: { workerConcurrency: 9 },
			database: { workflowPoolMax: 10 },
		});
		expect(Exit.isSuccess(result)).toBe(true);
	});
});
