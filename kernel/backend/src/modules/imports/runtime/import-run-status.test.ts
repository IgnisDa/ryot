import { it } from "@effect/vitest";
import { ImportRunId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";
import { expect as vitestExpect } from "vitest";

import { databaseLayer, type MockOverrides } from "#lib/test-utils/effect";

import { ImportsService } from "../service";
import { markImportRunStarted } from "./import-run-status";

const mockImportsService = Layer.mock(ImportsService);

const makeImportsService = (overrides: MockOverrides<typeof mockImportsService> = {}) =>
	mockImportsService({
		update: () => Effect.void,
		...overrides,
	});

const makeTestLayer = (importsService: Layer.Layer<ImportsService>) =>
	Layer.mergeAll(databaseLayer, importsService);

it.effect("marks import runs as running", () => {
	const updates: Array<Record<string, unknown>> = [];
	const layer = makeTestLayer(
		makeImportsService({
			update: (input) => {
				updates.push(input);
				return Effect.void;
			},
		}),
	);

	return Effect.gen(function* () {
		yield* markImportRunStarted(ImportRunId.make("run_1"));

		vitestExpect(updates).toEqual([
			{ runId: "run_1", status: "running", startedAt: vitestExpect.any(Date) },
		]);
	}).pipe(Effect.provide(layer));
});
