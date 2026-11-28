import { BunRuntime } from "@effect/platform-bun";
import { runDatabaseTests } from "@ryot-app/kernel-backend/testing/database-run";
import { runClientTests } from "@ryot-app/testing/run-client-tests";
import { testWorkers } from "@ryot-app/testing/runner";
import { Effect } from "effect";

BunRuntime.runMain(
	Effect.scoped(
		Effect.gen(function* () {
			const workers = yield* testWorkers(4);
			yield* runDatabaseTests({
				workers,
				label: "media-plugin",
				run: (env) =>
					runClientTests({ env, workers, args: ["--timeout=120000", ...process.argv.slice(2)] }),
			});
		}),
	),
);
