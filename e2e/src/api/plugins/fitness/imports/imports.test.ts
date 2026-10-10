import { ImportRunId } from "@ryot-app/contract/schema/brands";
import { measurementListRecipe } from "@ryot-app/fitness-plugin/query-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	executeRyotQLRecipe,
	findBuiltinSchemaBySlug,
	getImportRun,
	listManualImportRuns,
	pollImportRunUntilTerminal,
	uploadImportFile,
} from "~/fixtures/kernel";
import { runOpenScaleImportFixture, startOpenScaleImport } from "~/fixtures/plugins/fitness";
import { queryInMediaLibraryRelationship } from "~/fixtures/plugins/media";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("OpenScale Import E2E", () => {
	it.live("completes an OpenScale import and creates measurement entities", () =>
		Effect.gen(function* () {
			const { token, client } = yield* createAuthenticatedClient();
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

			const { schema } = yield* findBuiltinSchemaBySlug(client, "measurement");
			const result = yield* executeRyotQLRecipe(client, measurementListRecipe({ limit: 20 }));
			expect(result.items).toHaveLength(3);
			const memberships = yield* Effect.forEach(result.items, (measurement) =>
				queryInMediaLibraryRelationship(client, measurement.id, schema.slug),
			);
			expect(
				memberships.every(
					(membership) =>
						membership.data.entity?.type === "rows" && membership.data.entity.items.length === 0,
				),
			).toBe(true);
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

			const error = yield* Effect.flip(
				client.call((c) =>
					c.imports.createRun({ payload: { source: "open_scale", uploadToken: "bogus-token" } }),
				),
			);

			assertTaggedError(error, "ImportRequestError");
		}),
	);

	it.live("rejects a non-CSV file extension", () =>
		Effect.gen(function* () {
			const { token, client } = yield* createAuthenticatedClient();

			const uploadToken = yield* uploadImportFile(
				token,
				'{"data": "not csv"}',
				"export.json",
				"application/octet-stream",
			);

			const error = yield* Effect.flip(
				client.call((c) => c.imports.createRun({ payload: { uploadToken, source: "open_scale" } })),
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

			const badCsv = `dateTime,weight\n2026-01-01 08:00:00,75.0\n,invalid-no-date\n2026-01-03 08:00:00,not-a-number\n`;

			const uploadToken = yield* uploadImportFile(token, badCsv, "openscale-bad.csv", "text/csv");

			const runId = yield* startOpenScaleImport(client, uploadToken);
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
