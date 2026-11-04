import { BunRuntime } from "@effect/platform-bun";
import { runTests } from "@ryot-app/testing/runner";
import { Effect } from "effect";

import setup from "./global-setup";

BunRuntime.runMain(
	Effect.scoped(
		Effect.gen(function* () {
			if (!process.argv.slice(2).some((argument) => argument.endsWith(".test.ts"))) {
				return yield* Effect.die(new Error("Select specific e2e .test.ts files"));
			}
			const env = yield* setup;
			return yield* runTests({ env, workers: 6, timeout: 180_000 });
		}),
	),
);
