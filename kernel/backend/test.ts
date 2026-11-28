import { BunRuntime } from "@effect/platform-bun";
import { runTests, testWorkers } from "@ryot-app/testing/runner";
import { Effect } from "effect";

import { runDatabaseTests } from "#testing/database-run";

BunRuntime.runMain(
	Effect.scoped(
		Effect.gen(function* () {
			const workers = yield* testWorkers(4);
			yield* runDatabaseTests({
				workers,
				label: "kernel-backend",
				run: (env) => runTests({ env, workers, timeout: 120_000 }),
			});
		}),
	),
);
