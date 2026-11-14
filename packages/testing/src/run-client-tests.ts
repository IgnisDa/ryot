import { BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";

import { runTests } from "./runner.js";

export const runClientTests = (
	options: {
		readonly workers?: number;
		readonly args?: ReadonlyArray<string>;
		readonly env?: Readonly<Record<string, string>>;
	} = {},
): Effect.Effect<void, Effect.Error<ReturnType<typeof runTests>>> =>
	Effect.scoped(
		Effect.gen(function* () {
			const args = options.args ?? process.argv.slice(2);
			const valueFlags = new Set([
				"-t",
				"--seed",
				"--retry",
				"--shard",
				"--timeout",
				"--timings",
				"--reporter",
				"--rerun-each",
				"--coverage-dir",
				"--parallel-delay",
				"--max-concurrency",
				"--reporter-outfile",
				"--test-name-pattern",
				"--coverage-reporter",
				"--path-ignore-patterns",
			]);
			const positionals: string[] = [];
			const flags: string[] = [];
			let positionalOnly = false;
			for (let index = 0; index < args.length; index += 1) {
				const argument = args[index];
				if (argument === undefined) {
					continue;
				}
				if (argument === "--") {
					positionalOnly = true;
				} else if (!positionalOnly && argument.startsWith("-")) {
					flags.push(argument);
					const next = args[index + 1];
					const optionalValue =
						next !== undefined &&
						!next.startsWith("-") &&
						(argument === "--changed" ||
							((argument === "--bail" || argument === "--parallel") && /^\d+$/.test(next)));
					if (valueFlags.has(argument) || optionalValue) {
						const value = args[index + 1];
						if (value === undefined) {
							throw new Error(`Missing value for ${argument}`);
						}
						flags.push(value);
						index += 1;
					}
				} else {
					positionals.push(argument.startsWith("./") ? argument.slice(2) : argument);
				}
			}
			const files = Array.from(
				new Bun.Glob("**/*.test.{ts,tsx}").scanSync({ onlyFiles: true, followSymlinks: false }),
			)
				.filter(
					(file) =>
						!file
							.split("/")
							.some((part) => ["out", "dist", "build", "node_modules"].includes(part)) &&
						(positionals.length === 0 || positionals.some((pattern) => file.includes(pattern))),
				)
				.sort();

			if (files.length === 0) {
				return yield* Effect.die(new Error("No matching test files"));
			}
			for (const dom of [false, true]) {
				const selected = files.filter((file) => file.endsWith(".tsx") === dom);
				if (selected.length === 0) {
					continue;
				}
				const preloads = dom ? ["--preload", import.meta.resolve("./dom.ts")] : [];
				yield* runTests({
					env: options.env,
					workers: options.workers,
					args: [...flags, ...preloads, ...selected.map((file) => `./${file}`)],
				});
			}
			return undefined;
		}),
	);

if (import.meta.main) {
	BunRuntime.runMain(runClientTests());
}
