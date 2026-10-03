import { expect, layer } from "@effect/vitest";
import { ImportRunId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";

import { databaseLayer } from "#lib/test-utils/effect";

import { ImportRunFailuresService } from "./failure-service";
import { ImportsRepository } from "./repository";

const mockImportsRepository = Layer.mock(ImportsRepository);

class FakeFailureRepository extends Context.Service<
	FakeFailureRepository,
	{ readonly createdFailures: Effect.Effect<ReadonlyArray<unknown>> }
>()("test/FakeFailureRepository") {}

const recordingServiceLayer = ImportRunFailuresService.layer.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			databaseLayer,
			Layer.unwrap(
				Effect.gen(function* () {
					const created = yield* Ref.make<ReadonlyArray<unknown>>([]);
					return Layer.merge(
						Layer.succeed(FakeFailureRepository, { createdFailures: Ref.get(created) }),
						mockImportsRepository({
							createFailure: (input) => Ref.update(created, (all) => [...all, input]),
						}),
					);
				}),
			),
		),
	),
);

layer(recordingServiceLayer)((test) => {
	test.effect("routes failure creation through its owning service", () =>
		Effect.gen(function* () {
			const service = yield* ImportRunFailuresService;
			const input = {
				itemIndex: 0,
				stage: "source_fetch" as const,
				runId: ImportRunId.make("run-1"),
				reason: { code: "source-fetch-failed" as const },
			};

			yield* service.create(input);

			expect((yield* (yield* FakeFailureRepository).createdFailures).at(-1)).toEqual(input);
		}),
	);
});
