import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { expect as vitestExpect } from "vitest";

import { ImportRunId } from "#lib/schema/brands";
import type { MockOverrides } from "#lib/test-support/effect";
import { dbRunnerLayer } from "#lib/test-support/effect";

import { ImportsRepository } from "../repository";
import { failImportRunWithFailures, markImportRunStarted } from "./import-run-status";

const mockImportsRepository = Layer.mock(ImportsRepository);

const makeImportsRepository = (overrides: MockOverrides<typeof mockImportsRepository> = {}) =>
	mockImportsRepository({
		_tag: "ImportsRepository",
		updateRun: () => Effect.void,
		createFailure: () => Effect.void,
		...overrides,
	});

const makeTestLayer = (importsRepository: Layer.Layer<ImportsRepository>) =>
	Layer.mergeAll(dbRunnerLayer, importsRepository);

it.effect("marks import runs as running", () => {
	const updates: Array<Record<string, unknown>> = [];
	const layer = makeTestLayer(
		makeImportsRepository({
			updateRun: (input) => {
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

it.effect("records failures and final failed run counts", () => {
	const failures: Array<Record<string, unknown>> = [];
	const updates: Array<Record<string, unknown>> = [];
	const layer = makeTestLayer(
		makeImportsRepository({
			createFailure: (input) => {
				failures.push(input);
				return Effect.void;
			},
			updateRun: (input) => {
				updates.push(input);
				return Effect.void;
			},
		}),
	);

	return Effect.gen(function* () {
		yield* failImportRunWithFailures({
			runId: ImportRunId.make("run_1"),
			failures: [
				{
					itemIndex: 0,
					sourceLabel: "Item",
					stage: "source_fetch",
					message: "fetch failed",
					sourceIdentifier: "item-1",
					context: { provider: "komga" },
				},
			],
		});

		vitestExpect(failures).toEqual([
			{
				itemIndex: 0,
				runId: "run_1",
				sourceLabel: "Item",
				stage: "source_fetch",
				message: "fetch failed",
				sourceIdentifier: "item-1",
				context: { provider: "komga" },
			},
		]);
		vitestExpect(updates).toEqual([
			{
				progress: 100,
				totalItems: 1,
				runId: "run_1",
				failedItems: 1,
				status: "failed",
				processedItems: 1,
				errorSummary: "fetch failed",
				finishedAt: vitestExpect.any(Date),
			},
		]);
	}).pipe(Effect.provide(layer));
});
