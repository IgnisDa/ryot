import { ImportRunId } from "@ryot/contract/schema/brands";
import { measurementListRecipe } from "@ryot/fitness-plugin/query-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	executeRyotQLRecipe,
	findBuiltinSchemaBySlug,
	getImportRun,
	listManualImportRuns,
	pollImportRunUntilTerminal,
	queryInLibraryRelationship,
	runHevyImportFixture,
	runOpenScaleImportFixture,
	startOpenScaleImport,
	uploadImportFile,
} from "~/fixtures";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("OpenScale Import E2E", () => {
	it.live("completes an OpenScale import and creates measurement entities", () =>
		Effect.gen(function* () {
			const { client, cookies } = yield* createAuthenticatedClient();
			const { runId, completedRun } = yield* runOpenScaleImportFixture(client, cookies);

			expect(completedRun.id).toBe(ImportRunId.make(runId));
			expect(completedRun.status).toBe("completed");
			expect(completedRun.source).toBe("open_scale");
			expect(completedRun.importedItems).toBeGreaterThan(0);
			expect(completedRun.totalItems).toBe(3);
			expect(completedRun.failedItems).toBe(0);
			expect(completedRun.progress).toBe(100);
			expect(completedRun.startedAt).not.toBeNull();
			expect(completedRun.finishedAt).not.toBeNull();

			const { schema } = yield* findBuiltinSchemaBySlug(client, "measurement");
			const result = yield* executeRyotQLRecipe(client, measurementListRecipe({ limit: 20 }));
			expect(result.items).toHaveLength(3);
			const memberships = yield* Effect.forEach(result.items, (measurement) =>
				queryInLibraryRelationship(client, measurement.id, schema.slug),
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
			const { client, cookies } = yield* createAuthenticatedClient();
			const { runId } = yield* runOpenScaleImportFixture(client, cookies);

			const detail = yield* getImportRun(client, runId, undefined, 20);
			const run = requirePresent(detail.run, "Expected completed import run");
			expect(run.id).toBe(ImportRunId.make(runId));
			expect(run.status).toBe("completed");
		}),
	);

	it.live("lists runs for the current user", () =>
		Effect.gen(function* () {
			const { client, cookies } = yield* createAuthenticatedClient();
			yield* runOpenScaleImportFixture(client, cookies);

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
			const { client, cookies } = yield* createAuthenticatedClient();

			const uploadToken = yield* uploadImportFile(
				cookies,
				'{"data": "not csv"}',
				"export.json",
				"application/octet-stream",
			);

			const error = yield* Effect.flip(
				client.call((c) => c.imports.createRun({ payload: { source: "open_scale", uploadToken } })),
			);

			assertTaggedError(error, "ImportRequestError");
		}),
	);

	it.live("deletes a completed run", () =>
		Effect.gen(function* () {
			const { client, cookies } = yield* createAuthenticatedClient();
			const { runId } = yield* runOpenScaleImportFixture(client, cookies);

			yield* client.call((c) =>
				c.imports.deleteRun({ params: { runId: ImportRunId.make(runId) } }),
			);

			expect((yield* getImportRun(client, runId, undefined, 20)).run).toBeUndefined();
		}),
	);

	it.live("returns failures for a run with bad rows", () =>
		Effect.gen(function* () {
			const { client, cookies } = yield* createAuthenticatedClient();

			const badCsv = `dateTime,weight\n2026-01-01 08:00:00,75.0\n,invalid-no-date\n2026-01-03 08:00:00,not-a-number\n`;

			const uploadToken = yield* uploadImportFile(cookies, badCsv, "openscale-bad.csv", "text/csv");

			const runId = yield* startOpenScaleImport(client, uploadToken);
			const completedRun = yield* pollImportRunUntilTerminal(client, runId);

			expect(completedRun.status).toBe("completed");
			expect(completedRun.failedItems).toBeGreaterThan(0);
			expect(completedRun.importedItems).toBeGreaterThan(0);
			expect(completedRun.totalItems).toBe(3);
			expect(completedRun.processedItems).toBe(3);
			expect(completedRun.importedItems).toBe(1);
			expect(completedRun.failedItems).toBe(2);

			const runData = yield* getImportRun(client, runId, undefined, 20);

			expect(runData.failures.items.length).toBeGreaterThan(0);
			expect(runData.failures.items).toMatchObject([
				{
					itemIndex: 1,
					sourceLabel: "Row 2",
					sourceIdentifier: "2",
					reason: { code: "input-transformation-failed" },
				},
				{
					itemIndex: 2,
					sourceLabel: "2026-01-03 08:00",
					sourceIdentifier: "2026-01-03T08:00:00.000Z",
					reason: { code: "input-transformation-failed" },
				},
			]);
		}),
	);
});

describe("Hevy Workout Import E2E", () => {
	it.live("imports a Hevy workout into exercise/workout entities and events", () =>
		Effect.gen(function* () {
			const { client, cookies } = yield* createAuthenticatedClient();
			const { runId, completedRun } = yield* runHevyImportFixture(client, cookies);

			expect(completedRun.id).toBe(ImportRunId.make(runId));
			expect(completedRun.source).toBe("hevy");
			expect(completedRun.status).toBe("completed");
			expect(completedRun.failedItems).toBe(0);
			expect(completedRun.importedItems).toBeGreaterThan(0);
			expect(completedRun.progress).toBe(100);
		}),
	);
});
