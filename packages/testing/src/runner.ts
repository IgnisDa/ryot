import { Effect, Schema } from "effect";

import { TestTimeout, testTimeout } from "./test-timeout.js";

class TestRunError extends Schema.TaggedError<TestRunError, { readonly brand: unique symbol }>()(
	"TestRunError",
	{ exitCode: Schema.Finite },
) {}

const parentEnvironment = { ...Bun.env };

const TestWorkers = Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0));

export const testWorkers = Effect.fn(function* (
	fallback: number,
	args: ReadonlyArray<string> = process.argv.slice(2),
) {
	const argument = args.findLast(
		(value) => value === "--parallel" || value.startsWith("--parallel="),
	);
	if (argument === undefined) {
		return fallback;
	}
	if (argument === "--parallel") {
		return navigator.hardwareConcurrency;
	}
	return yield* Schema.decodeEffect(TestWorkers)(argument.slice("--parallel=".length));
});

export const runTests = Effect.fn(function* (
	options: {
		workers?: number;
		timeout?: number;
		args?: ReadonlyArray<string>;
		env?: Readonly<Record<string, string>>;
	} = {},
) {
	const args = options.args ?? process.argv.slice(2);
	const timeoutIndex = args.findLastIndex(
		(argument) => argument === "--timeout" || argument.startsWith("--timeout="),
	);
	const timeoutArgument = args[timeoutIndex];
	const timeout =
		timeoutArgument === undefined
			? (options.timeout ?? testTimeout ?? 0)
			: yield* Schema.decodeUnknownEffect(TestTimeout)(
					timeoutArgument === "--timeout"
						? args[timeoutIndex + 1]
						: timeoutArgument.slice("--timeout=".length),
				);
	const subprocess = yield* Effect.acquireRelease(
		Effect.sync(() =>
			Bun.spawn(
				[
					process.execPath,
					"test",
					"--isolate",
					"--no-orphans",
					`--timeout=${timeout}`,
					...(options.workers === undefined ? [] : [`--parallel=${options.workers}`]),
					...args,
				],
				{
					stdin: "inherit",
					stdout: "inherit",
					stderr: "inherit",
					env: { ...parentEnvironment, ...options.env, RYOT_TEST_TIMEOUT: String(timeout) },
				},
			),
		),
		(child) =>
			Effect.gen(function* () {
				if (child.exitCode === null) {
					child.kill();
				}
				yield* Effect.promise(() => child.exited);
			}),
	);
	const code = yield* Effect.promise(() => subprocess.exited);
	if (code !== 0) {
		return yield* new TestRunError({ exitCode: code });
	}
	return undefined;
});
