import { expect } from "bun:test";

import { BunServices } from "@effect/platform-bun";
import { fixtureManifest } from "@ryot-app/contract/testing";
import { validateDefinitionSet } from "@ryot-app/definitions/definition-set";
import { kernelDefinitionSource } from "@ryot-app/definitions/kernel-definitions";
import { pluginBackendCompilerPlatformLayer } from "@ryot-app/plugin-backend-compiler/platform";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Duration, Effect, Fiber, Layer, Schedule } from "effect";

import { loadPluginSource } from "../source.test-support";
import { fixturePackageRoot } from "../test-support";
import { normalizePluginSource } from "./pipeline";
import { makePluginValidationWorker, PLUGIN_VALIDATION_WORKER_LIMITS } from "./validation-worker";
import { heavyDefinitionBaseline } from "./validation-worker.test-support";

const PROBE_INTERVAL_MS = 5;

const manifest = fixtureManifest();
const entitySchema = manifest.entitySchemas[0];
assert(entitySchema);
const invalidPlugin = {
	id: "invalid",
	manifest: {
		...manifest,
		entitySchemas: [{ ...entitySchema, mergeIdentityProperties: ["missing"] }],
	},
};

const longestEventLoopStall = <A, E, R>(work: Effect.Effect<A, E, R>) =>
	Effect.gen(function* () {
		const probe = { longest: 0, last: performance.now() };
		const sampler = yield* Effect.sync(() => {
			const now = performance.now();
			probe.longest = Math.max(probe.longest, now - probe.last - PROBE_INTERVAL_MS);
			probe.last = now;
		}).pipe(Effect.repeat(Schedule.spaced(Duration.millis(PROBE_INTERVAL_MS))), Effect.forkChild);
		const startedAt = performance.now();
		yield* work;
		const elapsedMs = performance.now() - startedAt;
		yield* Effect.sleep(Duration.millis(PROBE_INTERVAL_MS * 4));
		yield* Fiber.interrupt(sampler);
		return { elapsedMs, stallMs: probe.longest };
	});

layer(Layer.merge(BunServices.layer, pluginBackendCompilerPlatformLayer), {
	excludeTestServices: true,
})((test) => {
	test.effect(
		"returns the in-process validation error across the worker boundary",
		() =>
			Effect.gen(function* () {
				const { session } = yield* makePluginValidationWorker(PLUGIN_VALIDATION_WORKER_LIMITS);
				const worker = yield* session;
				const thrown = yield* Effect.try({
					catch: String,
					try: () => validateDefinitionSet(kernelDefinitionSource(), [invalidPlugin]),
				}).pipe(Effect.flip);

				const failure = yield* worker
					.validateDefinitionSet(kernelDefinitionSource(), [invalidPlugin])
					.pipe(Effect.flip);

				expect(failure).toMatchObject({ issues: [thrown], _tag: "PluginValidationError" });
				yield* worker.validateDefinitionSet(kernelDefinitionSource(), [{ manifest, id: "valid" }]);
			}).pipe(Effect.scoped),
		testTimeout,
	);

	test.effect(
		"checks a package source with the in-process content hash and errors",
		() =>
			Effect.gen(function* () {
				const { session } = yield* makePluginValidationWorker(PLUGIN_VALIDATION_WORKER_LIMITS);
				const worker = yield* session;
				const source = yield* loadPluginSource(fixturePackageRoot(), manifest);
				const missingCatalog = { ...source, catalogs: {} };

				expect(yield* worker.checkSource(source)).toBe(
					(yield* normalizePluginSource(source)).contentHash,
				);
				expect(yield* worker.checkSource(missingCatalog).pipe(Effect.flip)).toEqual(
					yield* normalizePluginSource(missingCatalog).pipe(Effect.flip),
				);
			}).pipe(Effect.scoped),
		testTimeout,
	);

	test.effect(
		"reports a worker that outlasts its time limit as unavailable",
		() =>
			Effect.gen(function* () {
				const { session } = yield* makePluginValidationWorker({
					...PLUGIN_VALIDATION_WORKER_LIMITS,
					timeoutMs: 1,
				});
				const worker = yield* session;

				const failure = yield* worker
					.validateDefinitionSet(heavyDefinitionBaseline(), [])
					.pipe(Effect.flip);

				expect(failure).toMatchObject({ _tag: "CompilerWorkerUnavailable" });
			}).pipe(Effect.scoped),
		testTimeout,
	);

	test.effect(
		"keeps the event loop responsive while the worker validates",
		() =>
			Effect.gen(function* () {
				const { session } = yield* makePluginValidationWorker(PLUGIN_VALIDATION_WORKER_LIMITS);
				const worker = yield* session;

				const { stallMs, elapsedMs } = yield* longestEventLoopStall(
					worker.validateDefinitionSet(heavyDefinitionBaseline(), []),
				);

				expect(elapsedMs).toBeGreaterThan(500);
				expect(stallMs).toBeLessThan(150);
			}).pipe(Effect.scoped),
		testTimeout,
	);
});
