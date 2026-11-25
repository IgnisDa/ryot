import { availableParallelism } from "node:os";

import { BunRuntime } from "@effect/platform-bun";
import { runTests } from "@ryot-app/testing/runner";
import { Config, Effect, Option, Result } from "effect";

import setup from "./global-setup";
import { provideE2eServices } from "./src/support/e2e-runtime";
import { externalTargetEnv } from "./src/support/external-target";

BunRuntime.runMain(
	Effect.scoped(
		Effect.gen(function* () {
			const args = process.argv.slice(2);
			const expandedArgs = args.includes("ALL")
				? [
						...Array.from(
							new Bun.Glob("**/*.test.ts").scanSync({
								cwd: "src",
								onlyFiles: true,
								followSymlinks: false,
							}),
							(argument) => `src/${argument}`,
						),
						...args.filter((argument) => argument !== "ALL"),
					]
				: args;
			if (!expandedArgs.some((argument) => argument.endsWith(".test.ts"))) {
				return yield* Effect.die(new Error("Select specific e2e .test.ts files"));
			}
			const target = yield* Config.option(
				Config.all({
					url: Config.String("E2E_TARGET_URL"),
					credentials: Config.String("E2E_TARGET_CREDENTIALS"),
				}),
			);
			const env = Option.isNone(target)
				? yield* setup(expandedArgs)
				: yield* provideE2eServices(
						externalTargetEnv(
							target.value.url,
							target.value.credentials,
							expandedArgs.filter((argument) => argument.endsWith(".test.ts")),
						),
					);
			const groups = [true, false]
				.map((pages) =>
					expandedArgs.filter(
						(argument) =>
							!argument.endsWith(".test.ts") ||
							/(?:^|\/)(?:browser|api\/kernel\/pages)\//.test(argument) === pages,
					),
				)
				.filter((group) => group.some((argument) => argument.endsWith(".test.ts")));
			// Both groups run even when the first fails.
			const results = yield* Effect.all(
				groups.map((group) =>
					runTests({
						env,
						args: group,
						timeout: 180_000,
						workers: Math.min(6, availableParallelism()),
					}),
				),
				{ mode: "result" },
			);
			const failure = results.find(Result.isFailure);
			return failure === undefined ? undefined : yield* failure.failure;
		}),
	),
);
