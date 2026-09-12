import { BunServices } from "@effect/platform-bun";
import { expect, layer } from "@effect/vitest";
import {
	Context,
	Effect,
	Exit,
	FileSystem,
	Layer,
	Logger,
	type LogLevel,
	MutableRef,
	Path,
	References,
	Ref,
} from "effect";
import { TestClock } from "effect/testing";

import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { filterLogger, ObservabilityLive } from "./observability";

class RecordedLogLevels extends Context.Service<
	RecordedLogLevels,
	{ readonly levels: Effect.Effect<ReadonlyArray<LogLevel.LogLevel>> }
>()("test/RecordedLogLevels") {}

const filteredRecordingLoggerLayer = (minimumLevel: LogLevel.LogLevel) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const levels = yield* Ref.make<ReadonlyArray<LogLevel.LogLevel>>([]);
			const logger = filterLogger(
				Logger.make((options) =>
					MutableRef.update(levels.ref, (all) => [...all, options.logLevel]),
				),
				minimumLevel,
			);
			return Layer.merge(
				Layer.succeed(RecordedLogLevels, { levels: Ref.get(levels) }),
				Logger.layer([logger]),
			);
		}),
	);

// Starting and stopping ObservabilityLive is the behavior under test, so these tests build
// the layer in their own scope around a program that runs while the layer is alive.
const runObservabilityLifecycle = <E, R>(
	overrides: Parameters<typeof makeAppConfigLayer>[0],
	program: Effect.Effect<void, E, R>,
) =>
	Effect.scoped(
		Layer.build(
			Layer.effectDiscard(program).pipe(
				Layer.provide(ObservabilityLive),
				Layer.provide(makeAppConfigLayer(overrides)),
			),
		),
	);

layer(filteredRecordingLoggerLayer("Info"))((test) => {
	test.effect("filters a logger at its own minimum level", () =>
		Effect.gen(function* () {
			yield* Effect.all([
				Effect.logTrace("trace"),
				Effect.logDebug("debug"),
				Effect.logInfo("info"),
				Effect.logWarning("warn"),
				Effect.logError("error"),
				Effect.logFatal("fatal"),
			]).pipe(Effect.provideService(References.MinimumLogLevel, "All"));

			expect(yield* (yield* RecordedLogLevels).levels).toEqual(["Info", "Warn", "Error", "Fatal"]);
		}),
	);
});

layer(BunServices.layer)((test) => {
	test.effect("writes only configured levels and flushes on shutdown", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-observability-" });
			const logFile = path.join(root, "nested", "ryot.log");

			yield* runObservabilityLifecycle(
				{ observability: { logging: { level: "Error", file: { path: logFile } } } },
				Effect.all([
					Effect.logDebug("excluded-debug-entry"),
					Effect.logInfo("excluded-info-entry"),
					Effect.logError("included-error-entry"),
				]),
			);

			const contents = yield* fs.readFileString(logFile);
			expect(contents).not.toContain("excluded-debug-entry");
			expect(contents).not.toContain("excluded-info-entry");
			expect(contents).toContain("included-error-entry");
		}),
	);

	test.effect("rotates and compresses the structured log file", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-log-rotation-" });
			const logFile = path.join(root, "ryot.log");

			yield* runObservabilityLifecycle(
				{
					observability: {
						logging: { level: "Debug", file: { path: logFile, rotationSize: "300B" } },
					},
				},
				Effect.gen(function* () {
					yield* Effect.logDebug("x".repeat(600));
					yield* TestClock.adjust("1 second");
					yield* Effect.logDebug("rotation-trigger");
					yield* TestClock.adjust("1 second");
				}),
			);

			const entries = yield* fs.readDirectory(root);
			expect(entries).toContain("ryot.log");
			expect(entries.some((entry) => entry.endsWith(".gz"))).toBe(true);
		}),
	);

	test.effect("fails startup when the log directory cannot be created", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-log-failure-" });
			const parentFile = path.join(root, "not-a-directory");
			yield* fs.writeFileString(parentFile, "blocker");

			const exit = yield* runObservabilityLifecycle(
				{ observability: { logging: { file: { path: path.join(parentFile, "ryot.log") } } } },
				Effect.void,
			).pipe(Effect.exit);

			expect(Exit.isFailure(exit)).toBe(true);
		}),
	);
});
