import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";

import { makeClientPageGraphCompiler } from "./service";
import {
	resolveTracerGraphsForCacheTest,
	testClientPageArtifact,
} from "./service-cache.test-support";

it.effect("does not share StyleX and Tailwind in-flight compilations", () =>
	Effect.gen(function* () {
		const graphs = yield* resolveTracerGraphsForCacheTest;
		const requests: string[] = [];
		const started = yield* Deferred.make<void>();
		const release = yield* Deferred.make<void>();
		const compileGraph = makeClientPageGraphCompiler((input) =>
			Effect.gen(function* () {
				const engine = input.stylexTracer ? "stylex" : "tailwind";
				requests.push(engine);
				if (requests.length === 2) {
					yield* Deferred.succeed(started, undefined);
				}
				yield* Deferred.await(release);
				return testClientPageArtifact(`${engine}-artifact`);
			}),
		);

		expect(graphs.stylex.compilerInput.stylexTracer).toEqual({ fingerprint: graphs.fingerprint });
		expect(graphs.stylex.graphHash).not.toBe(graphs.tailwind.graphHash);
		const fibers = yield* Effect.forEach([graphs.tailwind, graphs.stylex], (graph) =>
			compileGraph(graph).pipe(Effect.forkChild),
		);
		yield* Deferred.await(started);
		expect([...requests].sort()).toEqual(["stylex", "tailwind"]);
		yield* Deferred.succeed(release, undefined);
		expect((yield* Effect.forEach(fibers, Fiber.join)).map(({ hash }) => hash).sort()).toEqual([
			"stylex-artifact",
			"tailwind-artifact",
		]);
	}),
);
