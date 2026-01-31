import { it } from "@effect/vitest";
import { ImportRunId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";
import { expect as vitestExpect } from "vitest";

import type { MockOverrides } from "#lib/test-utils/effect";

import { ImportRunFailuresService } from "../failure-service";
import { ImportsService } from "../service";
import { failImportRunWithFailures, markImportRunStarted } from "./import-run-status";

const mockImportRunFailuresService = Layer.mock(ImportRunFailuresService);
const mockImportsService = Layer.mock(ImportsService);

const makeImportRunFailuresService = (
	overrides: MockOverrides<typeof mockImportRunFailuresService> = {},
) =>
	mockImportRunFailuresService({
		create: () => Effect.void,
		...overrides,
	});

const makeImportsService = (overrides: MockOverrides<typeof mockImportsService> = {}) =>
	mockImportsService({
		update: () => Effect.void,
		...overrides,
	});

const makeTestLayer = (
	importsService: Layer.Layer<ImportsService>,
	importRunFailuresService: Layer.Layer<ImportRunFailuresService>,
) => Layer.mergeAll(importsService, importRunFailuresService);

it.effect("marks import runs as running", () => {
	const updates: Array<Record<string, unknown>> = [];
	const layer = makeTestLayer(
		makeImportsService({
			update: (input) => {
				updates.push(input);
				return Effect.void;
			},
		}),
		makeImportRunFailuresService(),
	);

	return Effect.gen(function* () {
		yield* markImportRunStarted(ImportRunId.make("run_1"));

		vitestExpect(updates).toEqual([
			{ runId: "run_1", status: "running", startedAt: vitestExpect.any(Date) },
		]);
	}).pipe(Effect.provide(layer));
});

it.effect("records failures and final failed run counts", () => {
	const updates: Array<Record<string, unknown>> = [];
	const failures: Array<Record<string, unknown>> = [];
	const layer = makeTestLayer(
		makeImportsService({
			update: (input) => {
				updates.push(input);
				return Effect.void;
			},
		}),
		makeImportRunFailuresService({
			create: (input) => {
				failures.push(input);
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
