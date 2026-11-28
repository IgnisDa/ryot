import { BunRuntime } from "@effect/platform-bun";
import { runDatabaseTests } from "@ryot-app/kernel-backend/testing/database-run";
import { runTests, testWorkers } from "@ryot-app/testing/runner";
import { Effect } from "effect";

BunRuntime.runMain(
	Effect.scoped(
		Effect.gen(function* () {
			const workers = yield* testWorkers(2);
			yield* runDatabaseTests({
				workers,
				label: "server",
				run: (env) => runTests({ env, workers, timeout: 120_000 }),
			});
		}),
	),
);
