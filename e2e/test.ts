import { availableParallelism } from "node:os";

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
			const groups = [true, false]
				.map((pages) =>
					args.filter(
						(argument) =>
							!argument.endsWith(".test.ts") ||
							/(?:^|\/)(?:browser|api\/kernel\/pages)\//.test(argument) === pages,
					),
				)
				.filter((group) => group.some((argument) => argument.endsWith(".test.ts")));
			return yield* Effect.forEach(
				groups,
				(group) =>
					runTests({
						env,
						args: group,
						timeout: 180_000,
						workers: Math.min(6, availableParallelism()),
					}),
				{ discard: true },
			);
		}),
	),
);
