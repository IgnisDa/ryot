import { BunServices } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { Effect, Exit, FileSystem, Layer, Logger, Path, References } from "effect";
import { TestClock } from "effect/testing";

import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { filterLogger, ObservabilityLive } from "./observability";

const observabilityLayer = (overrides: Parameters<typeof makeAppConfigLayer>[0]) =>
	ObservabilityLive.pipe(
		Layer.provide(makeAppConfigLayer(overrides)),
		Layer.provideMerge(BunServices.layer),
	);

it.effect("filters a logger at its own minimum level", () =>
	Effect.gen(function* () {
		const levels: string[] = [];
		const logger = filterLogger(
			Logger.make((options) => levels.push(options.logLevel)),
			"Info",
		);

		yield* Effect.all([
			Effect.logTrace("trace"),
			Effect.logDebug("debug"),
			Effect.logInfo("info"),
			Effect.logWarning("warn"),
			Effect.logError("error"),
			Effect.logFatal("fatal"),
		]).pipe(
			Effect.provide(Logger.layer([logger])),
			Effect.provideService(References.MinimumLogLevel, "All"),
		);

		expect(levels).toEqual(["Info", "Warn", "Error", "Fatal"]);
	}),
);

it.effect("writes only configured levels and flushes on shutdown", () =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-observability-" });
		const logFile = path.join(root, "nested", "ryot.log");

		yield* Effect.all([
			Effect.logDebug("excluded-debug-entry"),
			Effect.logInfo("excluded-info-entry"),
			Effect.logError("included-error-entry"),
		]).pipe(Effect.provide(observabilityLayer({ server: { logFile, logLevel: "Error" } })));

		const contents = yield* fs.readFileString(logFile);
		expect(contents).not.toContain("excluded-debug-entry");
		expect(contents).not.toContain("excluded-info-entry");
		expect(contents).toContain("included-error-entry");
	}).pipe(Effect.provide(BunServices.layer)),
);

it.effect("rotates and compresses the structured log file", () =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-log-rotation-" });
		const logFile = path.join(root, "ryot.log");

		yield* Effect.gen(function* () {
			yield* Effect.logDebug("x".repeat(600));
			yield* TestClock.adjust("1 second");
			yield* Effect.logDebug("rotation-trigger");
			yield* TestClock.adjust("1 second");
		}).pipe(
			Effect.provide(
				observabilityLayer({ server: { logFile, logLevel: "Debug", logRotationSize: "300B" } }),
			),
		);

		const entries = yield* fs.readDirectory(root);
		expect(entries).toContain("ryot.log");
		expect(entries.some((entry) => entry.endsWith(".gz"))).toBe(true);
	}).pipe(Effect.provide(BunServices.layer)),
);

it.effect("fails startup when the log directory cannot be created", () =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-log-failure-" });
		const parentFile = path.join(root, "not-a-directory");
		yield* fs.writeFileString(parentFile, "blocker");

		const exit = yield* Effect.void.pipe(
			Effect.provide(
				observabilityLayer({ server: { logFile: path.join(parentFile, "ryot.log") } }),
			),
			Effect.exit,
		);

		expect(Exit.isFailure(exit)).toBe(true);
	}).pipe(Effect.provide(BunServices.layer)),
);
