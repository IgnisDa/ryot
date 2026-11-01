import { BunRuntime } from "@effect/platform-bun";
import { runTests } from "@ryot-app/testing/runner";
import { Effect } from "effect";

import setup from "./global-setup";

BunRuntime.runMain(
	Effect.scoped(
		Effect.gen(function* () {
			const args = process.argv.slice(2);
			if (!args.some((argument) => argument.endsWith(".test.ts"))) {
				return yield* Effect.die(new Error("Select specific e2e .test.ts files"));
			}
			const env = yield* setup;
			for (const pages of [true, false]) {
				const group = args.filter(
					(argument) =>
						!argument.endsWith(".test.ts") ||
						/(?:^|\/)(?:browser|api\/kernel\/pages)\//.test(argument) === pages,
				);
				if (group.some((argument) => argument.endsWith(".test.ts"))) {
					yield* runTests({ env, args: group, workers: Math.min(6, availableParallelism()), timeout: 180_000 });
				}
			}
		}),
	),
);
import { availableParallelism } from "node:os";
