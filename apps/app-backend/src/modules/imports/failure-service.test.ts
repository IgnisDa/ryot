import { it, expect } from "@effect/vitest";
import { ImportRunId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import type { MockOverrides } from "#lib/test-support/effect";
import { dbRunnerLayer } from "#lib/test-support/effect";

import { ImportRunFailuresService } from "./failure-service";
import { ImportsRepository } from "./repository";

const mockImportsRepository = Layer.mock(ImportsRepository);

const makeImportsRepository = (overrides: MockOverrides<typeof mockImportsRepository> = {}) =>
	mockImportsRepository({
		_tag: "ImportsRepository",
		createFailure: () => Effect.void,
		...overrides,
	});

const makeServiceLayer = (repository = makeImportsRepository()) =>
	ImportRunFailuresService.Default.pipe(Layer.provide(Layer.mergeAll(dbRunnerLayer, repository)));

it.effect("routes failure creation through its owning service", () => {
	let createdInput: unknown;
	const layer = makeServiceLayer(
		makeImportsRepository({
			createFailure: (input) =>
				Effect.sync(() => {
					createdInput = input;
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* ImportRunFailuresService;
		const input = {
			itemIndex: 0,
			message: "Source failed",
			stage: "source_fetch" as const,
			runId: ImportRunId.make("run-1"),
		};

		yield* service.create(input);

		expect(createdInput).toEqual(input);
	}).pipe(Effect.provide(layer));
});
