import { ImportRunId } from "@ryot/contract/schema/brands";
import { queryEngineField, queryEngineSystemRef } from "@ryot/query-engine/primitives";
import { Effect } from "effect";

import {
	buildEntityRowsQueryDocument,
	createAuthenticatedClient,
	executeQueryEngine,
	findBuiltinSchemaBySlug,
	getImportRun,
	pollImportRunUntilTerminal,
	queryInLibraryRelationship,
	requireQueryEngineTextField,
	runHevyImportFixture,
	runOpenScaleImportFixture,
	startOpenScaleImport,
	uploadTemporaryFile,
} from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
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
			const measurements = yield* executeQueryEngine(
				client,
				buildEntityRowsQueryDocument({
					limit: 20,
					alias: "measurement",
					schemas: [schema.id],
					fields: [queryEngineField("id", queryEngineSystemRef("measurement", "id"))],
				}),
			);
			expect(measurements.data.items).toHaveLength(3);
			const memberships = yield* Effect.forEach(measurements.data.items, (measurement) =>
				queryInLibraryRelationship(
					client,
					requireQueryEngineTextField(measurement, "id"),
					schema.slug,
				),
			);
			expect(memberships.every((membership) => membership.data.items.length === 0)).toBe(true);
		}),
	);

	it.live("returns the run via GET /imports/runs/:id", () =>
		Effect.gen(function* () {
			const { client, cookies } = yield* createAuthenticatedClient();
			const { runId } = yield* runOpenScaleImportFixture(client, cookies);

			const run = yield* getImportRun(client, runId);
			expect(run.id).toBe(ImportRunId.make(runId));
			expect(run.status).toBe("completed");
		}),
	);

	it.live("lists runs for the current user", () =>
		Effect.gen(function* () {
			const { client, cookies } = yield* createAuthenticatedClient();
			yield* runOpenScaleImportFixture(client, cookies);

			const data = yield* client.call((c) => c.imports.listRuns());

			expect(data.length).toBeGreaterThan(0);
			expect(data[0]?.source).toBe("open_scale");
		}),
	);

	it.live("returns 404 for unknown run id", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const error = yield* Effect.flip(
				client.call((c) =>
					c.imports.getRun({
						path: { runId: ImportRunId.make("nonexistent-run-id") },
						urlParams: {},
					}),
				),
			);

			assertTaggedError(error, "NotFound");
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

			assertTaggedError(error, "BadRequest");
		}),
	);

	it.live("rejects a non-CSV file extension", () =>
		Effect.gen(function* () {
			const { client, cookies } = yield* createAuthenticatedClient();

			const uploadToken = yield* uploadTemporaryFile(
				cookies,
				'{"data": "not csv"}',
				"export.json",
				"application/octet-stream",
			);

			const error = yield* Effect.flip(
				client.call((c) => c.imports.createRun({ payload: { source: "open_scale", uploadToken } })),
			);

			assertTaggedError(error, "BadRequest");
		}),
	);

	it.live("deletes a completed run", () =>
		Effect.gen(function* () {
			const { client, cookies } = yield* createAuthenticatedClient();
			const { runId } = yield* runOpenScaleImportFixture(client, cookies);

			yield* client.call((c) => c.imports.deleteRun({ path: { runId: ImportRunId.make(runId) } }));

			const error = yield* Effect.flip(
				client.call((c) =>
					c.imports.getRun({ path: { runId: ImportRunId.make(runId) }, urlParams: {} }),
				),
			);

			assertTaggedError(error, "NotFound");
		}),
	);

	it.live("returns failures for a run with bad rows", () =>
		Effect.gen(function* () {
			const { client, cookies } = yield* createAuthenticatedClient();

			const badCsv = `dateTime,weight\n2026-01-01 08:00:00,75.0\n,invalid-no-date\n2026-01-03 08:00:00,not-a-number\n`;

			const uploadToken = yield* uploadTemporaryFile(
				cookies,
				badCsv,
				"openscale-bad.csv",
				"text/csv",
			);

			const runId = yield* startOpenScaleImport(client, uploadToken);
			const completedRun = yield* pollImportRunUntilTerminal(client, runId);

			expect(completedRun.status).toBe("completed");
			expect(completedRun.failedItems).toBeGreaterThan(0);
			expect(completedRun.importedItems).toBeGreaterThan(0);
			expect(completedRun.totalItems).toBe(3);
			expect(completedRun.processedItems).toBe(3);
			expect(completedRun.importedItems).toBe(1);
			expect(completedRun.failedItems).toBe(2);

			const runData = yield* client.call((c) =>
				c.imports.getRun({
					urlParams: { page: 1, limit: 20 },
					path: { runId: ImportRunId.make(runId) },
				}),
			);

			expect(runData.failures.items.length).toBeGreaterThan(0);
			expect(runData.failures.items).toMatchObject([
				{
					itemIndex: 1,
					sourceLabel: "Row 2",
					sourceIdentifier: "2",
					message: "Row is missing a date/time value",
				},
				{
					itemIndex: 2,
					sourceLabel: "2026-01-03 08:00",
					sourceIdentifier: "2026-01-03T08:00:00.000Z",
					message: 'Could not parse numeric value for column "weight"',
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
