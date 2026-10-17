import { ImportRunId } from "@ryot-app/contract/schema/brands";
import { measurementSummaryRecipe } from "@ryot-app/fitness-plugin/measurement-recipes";
import { measurementReadingListRecipe } from "@ryot-app/fitness-plugin/query-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	executeRyotQLRecipe,
	getImportRun,
	listManualImportRuns,
	pollImportRunUntilTerminal,
	uploadImportFile,
} from "~/fixtures/kernel";
import {
	createFitnessImportRun,
	runOpenScaleImportFixture,
	startOpenScaleImport,
	findFitnessEntitySchema,
} from "~/fixtures/plugins/fitness";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("OpenScale Import E2E", () => {
	it.live("reuses a manually created weight metric", () =>
		Effect.gen(function* () {
			const { token, client } = yield* createAuthenticatedClient();
			const { pluginId, schema: metricSchema } = yield* findFitnessEntitySchema(
				client,
				"measurement-metric",
			);
			const weight = yield* createEntity(client, {
				name: "Weight",
				entitySchema: metricSchema.reference,
				properties: { unit: "kg", key: "weight" },
			});
			yield* runOpenScaleImportFixture(client, token);

			const readings = yield* executeRyotQLRecipe(
				client,
				measurementReadingListRecipe({ limit: 20, reference: { pluginId, kind: "local" } }),
			);
			const weightReadings = readings.items.filter(({ metricKey }) => metricKey === "weight");
			expect(weightReadings).toHaveLength(3);
			expect(weightReadings.map(({ metricId }) => metricId)).toEqual([
				weight.id,
				weight.id,
				weight.id,
			]);
			expect(weightReadings.map(({ unit }) => unit)).toEqual(["kg", "kg", "kg"]);

			const summary = yield* executeRyotQLRecipe(
				client,
				measurementSummaryRecipe({
					rangeStart: "1970-01-01T00:00:00.000Z",
					reference: { pluginId, kind: "local" },
				}),
			);
			expect(summary.items.filter(({ key }) => key === "weight").map(({ id }) => id)).toEqual([
				weight.id,
			]);
		}),
	);

	it.live("completes an OpenScale import and creates measurement metrics and readings", () =>
		Effect.gen(function* () {
			const { token, client } = yield* createAuthenticatedClient();
			const { pluginId } = yield* findFitnessEntitySchema(client, "exercise");
			const { runId, completedRun } = yield* runOpenScaleImportFixture(client, token);

			expect(completedRun.id).toBe(ImportRunId.make(runId));
			expect(completedRun.status).toBe("completed");
			expect(completedRun.source).toBe("open_scale");
			expect(completedRun.summary).toEqual([
				{
					unit: "measurements",
					recordKind: "measurements",
					counts: { created: 3, updated: 0, skipped: 0, unchanged: 0, unsuccessful: 0 },
				},
			]);
			expect(completedRun.activities.every(({ state }) => state === "completed")).toBe(true);
			expect(completedRun.activities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						completed: 3,
						unit: "records",
						kind: "preparing",
						state: "completed",
						id: "normalization",
					}),
					expect.objectContaining({
						completed: 3,
						kind: "writing",
						id: "application",
						state: "completed",
						unit: "measurements",
					}),
				]),
			);
			expect(completedRun.startedAt).not.toBeNull();
			expect(completedRun.finishedAt).not.toBeNull();

			const result = yield* executeRyotQLRecipe(
				client,
				measurementReadingListRecipe({ limit: 20, reference: { pluginId, kind: "local" } }),
			);
			expect(result.items).toHaveLength(15);
			expect(new Set(result.items.map(({ metricId }) => metricId)).size).toBe(5);
			const weightReadings = result.items.filter(({ metricKey }) => metricKey === "weight");
			expect(weightReadings.map(({ value, comment }) => ({ value, comment }))).toEqual([
				{ value: 75.2, comment: "After lunch" },
				{ value: 74.8, comment: null },
				{ value: 75, comment: "Morning weight" },
			]);
			expect(weightReadings.map(({ occurredAt }) => occurredAt.slice(0, 10))).toEqual([
				"2026-04-03",
				"2026-04-02",
				"2026-04-01",
			]);
			expect(
				Object.fromEntries(result.items.map(({ unit, metricKey }) => [metricKey, unit])),
			).toEqual({ fat: "%", water: "%", muscle: "%", bmi: "kg/m²", weight: "kg" });
			expect(new Set(result.items.map(({ metricName }) => metricName))).toEqual(
				new Set(["weight", "bmi", "fat", "water", "muscle"]),
			);
		}),
	);

	it.live("returns the run via RyotQL", () =>
		Effect.gen(function* () {
			const { token, client } = yield* createAuthenticatedClient();
			const { runId } = yield* runOpenScaleImportFixture(client, token);

			const detail = yield* getImportRun(client, runId, undefined, 20);
			const run = requirePresent(detail.run, "Expected completed import run");
			expect(run.id).toBe(ImportRunId.make(runId));
			expect(run.status).toBe("completed");
		}),
	);

	it.live("lists runs for the current user", () =>
		Effect.gen(function* () {
			const { token, client } = yield* createAuthenticatedClient();
			yield* runOpenScaleImportFixture(client, token);

			const data = yield* listManualImportRuns(client, undefined, 20);

			expect(data.items.length).toBeGreaterThan(0);
			expect(data.items[0]?.source).toBe("open_scale");
		}),
	);

	it.live("returns no run for an unknown id", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const detail = yield* getImportRun(client, "nonexistent-run-id", undefined, 20);
			expect(detail.run).toBeUndefined();
		}),
	);

	it.live("rejects an invalid upload token", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { pluginId } = yield* findFitnessEntitySchema(client, "exercise");

			const error = yield* Effect.flip(
				createFitnessImportRun(client, pluginId, {
					source: "open_scale",
					uploadToken: "bogus-token",
				}),
			);

			assertTaggedError(error, "ImportRequestError");
		}),
	);

	it.live("rejects a non-CSV file extension", () =>
		Effect.gen(function* () {
			const { token, client } = yield* createAuthenticatedClient();
			const { pluginId } = yield* findFitnessEntitySchema(client, "exercise");

			const uploadToken = yield* uploadImportFile(
				token,
				'{"data": "not csv"}',
				"export.json",
				"application/octet-stream",
			);

			const error = yield* Effect.flip(
				createFitnessImportRun(client, pluginId, { uploadToken, source: "open_scale" }),
			);

			assertTaggedError(error, "ImportRequestError");
		}),
	);

	it.live("deletes a completed run", () =>
		Effect.gen(function* () {
			const { token, client } = yield* createAuthenticatedClient();
			const { runId } = yield* runOpenScaleImportFixture(client, token);

			yield* client.call((c) =>
				c.imports.deleteRun({ params: { runId: ImportRunId.make(runId) } }),
			);

			expect((yield* getImportRun(client, runId, undefined, 20)).run).toBeUndefined();
		}),
	);

	it.live("returns failures for a run with bad rows", () =>
		Effect.gen(function* () {
			const { token, client } = yield* createAuthenticatedClient();
			const { pluginId } = yield* findFitnessEntitySchema(client, "exercise");

			const badCsv = `dateTime,weight\n2026-01-01 08:00:00,75.0\n,invalid-no-date\n2026-01-03 08:00:00,not-a-number\n`;

			const uploadToken = yield* uploadImportFile(token, badCsv, "openscale-bad.csv", "text/csv");

			const runId = yield* startOpenScaleImport(client, pluginId, { uploadToken });
			const completedRun = yield* pollImportRunUntilTerminal(client, runId);

			expect(completedRun.status).toBe("completed");
			expect(completedRun.summary).toEqual([
				{
					unit: "measurements",
					recordKind: "measurements",
					counts: { created: 1, updated: 0, skipped: 0, unchanged: 0, unsuccessful: 2 },
				},
			]);

			const runData = yield* getImportRun(client, runId, undefined, 20);

			expect(runData.issues.items).toHaveLength(2);
			expect(runData.issues.items.map(({ data }) => data)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						recordKind: "measurements",
						reason: { key: null, code: "input-transformation-failed" },
						attribution: expect.objectContaining({ sourceLabel: "Row 2", sourceIdentifier: "2" }),
					}),
					expect.objectContaining({
						recordKind: "measurements",
						reason: { key: null, code: "input-transformation-failed" },
						attribution: expect.objectContaining({
							sourceLabel: "2026-01-03 08:00",
							sourceIdentifier: "2026-01-03T08:00:00.000Z",
						}),
					}),
				]),
			);
		}),
	);
});
