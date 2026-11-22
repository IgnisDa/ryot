import { expect } from "bun:test";

import { BunServices } from "@effect/platform-bun";
import { fixtureManifest } from "@ryot-app/contract/testing";
import { validateDefinitionSet } from "@ryot-app/definitions/definition-set";
import { kernelDefinitionSource } from "@ryot-app/definitions/kernel-definitions";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Duration, Effect, Fiber, Schedule } from "effect";

import {
	DEFINITION_SET_WORKER_LIMITS,
	makeDefinitionSetValidator,
} from "./definition-set-validator";

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

/** Hundreds of stored saved views, which take the worker about a second to validate. */
const heavyBaseline = () => {
	const kernel = kernelDefinitionSource();
	const view = kernel.savedViews.find(({ dataSources }) => dataSources !== null);
	assert(view);
	return {
		...kernel,
		savedViews: [
			...kernel.savedViews,
			...Array.from({ length: 600 }, (_, index) => ({ ...view, slug: `${view.slug}-${index}` })),
		],
	};
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

layer(BunServices.layer, { excludeTestServices: true })((test) => {
	test.effect(
		"returns the in-process validation error across the worker boundary",
		() =>
			Effect.gen(function* () {
				const validator = yield* makeDefinitionSetValidator(DEFINITION_SET_WORKER_LIMITS);
				const thrown = yield* Effect.try({
					catch: String,
					try: () => validateDefinitionSet(kernelDefinitionSource(), [invalidPlugin]),
				}).pipe(Effect.flip);

				const failure = yield* validator
					.validate(kernelDefinitionSource(), [invalidPlugin])
					.pipe(Effect.flip);

				expect(failure).toMatchObject({ issues: [thrown], _tag: "PluginValidationError" });
				yield* validator.validate(kernelDefinitionSource(), [{ manifest, id: "valid" }]);
			}).pipe(Effect.scoped),
		testTimeout,
	);

	test.effect(
		"reports a worker that outlasts its time limit as unavailable",
		() =>
			Effect.gen(function* () {
				const validator = yield* makeDefinitionSetValidator({
					...DEFINITION_SET_WORKER_LIMITS,
					timeoutMs: 1,
				});

				const failure = yield* validator.validate(heavyBaseline(), []).pipe(Effect.flip);

				expect(failure).toMatchObject({ _tag: "CompilerWorkerUnavailable" });
			}).pipe(Effect.scoped),
		testTimeout,
	);

	test.effect(
		"keeps the event loop responsive while the worker validates",
		() =>
			Effect.gen(function* () {
				const validator = yield* makeDefinitionSetValidator(DEFINITION_SET_WORKER_LIMITS);

				const { stallMs, elapsedMs } = yield* longestEventLoopStall(
					validator.validate(heavyBaseline(), []),
				);

				expect(elapsedMs).toBeGreaterThan(500);
				expect(stallMs).toBeLessThan(150);
			}).pipe(Effect.scoped),
		testTimeout,
	);
});
