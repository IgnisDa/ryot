import { ImportRunId } from "@ryot/contract/schema/brands";
import { queryEngineField, queryEngineSystemRef } from "@ryot/query-engine/primitives";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	buildEntityRowsQueryDocument,
	executeQueryEngine,
	FIXTURE_CONFIG_IMPORT_SOURCE,
	FIXTURE_IMPORT_SOURCE,
	findBuiltinSchemaBySlug,
	getImportRun,
	installTestImportPlugin,
	listEventSlugs,
	pollImportRunUntilTerminal,
	postBackendJson,
	runHevyImportFixture,
	runOpenScaleImportFixture,
	queryInLibraryRelationship,
	requireQueryEngineTextField,
	seedGlobalShowEpisodeTree,
	startOpenScaleImport,
	uploadTemporaryFile,
	type InstalledTestPlugin,
	uninstallTestPlugin,
	uninstallTestPluginStrict,
	waitForEventSlugs,
} from "~/fixtures";
import { assertPresent, assertTaggedError } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";

let fixtureImportPlugin: InstalledTestPlugin | undefined;

describe("Plugin Import Public Boundary", () => {
	beforeAll(async () => {
		fixtureImportPlugin = await Effect.runPromise(installTestImportPlugin());
	});

	afterAll(async () => {
		if (fixtureImportPlugin) {
			await Effect.runPromise(uninstallTestPlugin(fixtureImportPlugin));
		}
	});

	it.live("runs an installed source absent from the central contract to terminal success", () =>
		Effect.gen(function* () {
			const { client, cookies } = yield* createAuthenticatedClient();
			const archiveUploadToken = yield* uploadTemporaryFile(
				cookies,
				"name,value\nfixture,1\n",
				"fixture-archive.csv",
				"text/csv",
			);
			const created = yield* client.call((c) =>
				c.imports.createRun({ payload: { source: FIXTURE_IMPORT_SOURCE, archiveUploadToken } }),
			);

			const completed = yield* pollImportRunUntilTerminal(client, created.id);
			expect(completed).toMatchObject({
				progress: 100,
				failedItems: 0,
				importedItems: 0,
				processedItems: 0,
				status: "completed",
				source: FIXTURE_IMPORT_SOURCE,
			});
			expect(completed.finishedAt).not.toBeNull();
		}),
	);

	it.live("rejects malformed import payloads", () =>
		Effect.gen(function* () {
			const { cookies } = yield* createAuthenticatedClient();
			const response = yield* Effect.promise(() => postBackendJson("/imports/runs", [], cookies));

			expect(response.status).toBe(400);
		}),
	);

	it.live("rejects upload-token fields not declared by the selected source", () =>
		Effect.gen(function* () {
			const { client, cookies } = yield* createAuthenticatedClient();
			const [archiveUploadToken, undeclaredUploadToken] = yield* Effect.all([
				uploadTemporaryFile(cookies, "fixture", "fixture.csv", "text/csv"),
				uploadTemporaryFile(cookies, "other", "other.csv", "text/csv"),
			]);
			const error = yield* Effect.flip(
				client.call((c) =>
					c.imports.createRun({
						payload: { archiveUploadToken, undeclaredUploadToken, source: FIXTURE_IMPORT_SOURCE },
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
		}),
	);

	it.live("rejects internal dispatch and artifact path fields before claiming uploads", () =>
		Effect.gen(function* () {
			const { client, cookies } = yield* createAuthenticatedClient();
			const archiveUploadToken = yield* uploadTemporaryFile(
				cookies,
				"fixture",
				"fixture.csv",
				"text/csv",
			);
			const integrationError = yield* Effect.flip(
				client.call((c) =>
					c.imports.createRun({
						payload: {
							source: FIXTURE_IMPORT_SOURCE,
							archiveUploadToken,
							integrationScriptSlug: "integration.spoofed",
						},
					}),
				),
			);
			assertTaggedError(integrationError, "BadRequest");

			const artifactPathError = yield* Effect.flip(
				client.call((c) =>
					c.imports.createRun({
						payload: {
							source: FIXTURE_IMPORT_SOURCE,
							archiveUploadToken,
							archiveFilePath: "/tmp/unclaimed.csv",
						},
					}),
				),
			);
			assertTaggedError(artifactPathError, "BadRequest");

			const created = yield* client.call((c) =>
				c.imports.createRun({
					payload: { source: FIXTURE_IMPORT_SOURCE, archiveUploadToken },
				}),
			);
			expect((yield* pollImportRunUntilTerminal(client, created.id)).status).toBe("completed");
		}),
	);

	it.live("rejects a missing required named artifact", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const error = yield* Effect.flip(
				client.call((c) => c.imports.createRun({ payload: { source: FIXTURE_IMPORT_SOURCE } })),
			);

			assertTaggedError(error, "BadRequest");
		}),
	);

	it.live("rejects an invalid named artifact extension", () =>
		Effect.gen(function* () {
			const { client, cookies } = yield* createAuthenticatedClient();
			const archiveUploadToken = yield* uploadTemporaryFile(
				cookies,
				"fixture",
				"fixture.json",
				"application/json",
			);
			const error = yield* Effect.flip(
				client.call((c) =>
					c.imports.createRun({
						payload: { source: FIXTURE_IMPORT_SOURCE, archiveUploadToken },
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
		}),
	);

	it.live("rejects an unknown source before claiming uploads or starting a workflow", () =>
		Effect.gen(function* () {
			const { client, cookies } = yield* createAuthenticatedClient();
			const archiveUploadToken = yield* uploadTemporaryFile(
				cookies,
				"fixture",
				"fixture.csv",
				"text/csv",
			);
			const error = yield* Effect.flip(
				client.call((c) =>
					c.imports.createRun({
						payload: { source: "e2e_missing_import_source", archiveUploadToken },
					}),
				),
			);
			assertTaggedError(error, "BadRequest");
			expect(yield* client.call((c) => c.imports.listRuns())).toEqual([]);

			const created = yield* client.call((c) =>
				c.imports.createRun({ payload: { source: FIXTURE_IMPORT_SOURCE, archiveUploadToken } }),
			);
			expect((yield* pollImportRunUntilTerminal(client, created.id)).status).toBe("completed");
		}),
	);

	it.live("rejects a source whose required plugin config is absent", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const error = yield* Effect.flip(
				client.call((c) =>
					c.imports.createRun({ payload: { source: FIXTURE_CONFIG_IMPORT_SOURCE } }),
				),
			);

			assertTaggedError(error, "BadRequest");
		}),
	);

	it.live("rejects an inactive source before claiming uploads or starting a workflow", () =>
		Effect.gen(function* () {
			assertPresent(fixtureImportPlugin, "Fixture import plugin is missing");
			yield* uninstallTestPluginStrict(fixtureImportPlugin);

			const { client, cookies } = yield* createAuthenticatedClient();
			const archiveUploadToken = yield* uploadTemporaryFile(
				cookies,
				"fixture",
				"fixture.csv",
				"text/csv",
			);
			const error = yield* Effect.flip(
				client.call((c) =>
					c.imports.createRun({ payload: { source: FIXTURE_IMPORT_SOURCE, archiveUploadToken } }),
				),
			);
			assertTaggedError(error, "BadRequest");
			expect(yield* client.call((c) => c.imports.listRuns())).toEqual([]);

			fixtureImportPlugin = yield* installTestImportPlugin();
			const created = yield* client.call((c) =>
				c.imports.createRun({ payload: { source: FIXTURE_IMPORT_SOURCE, archiveUploadToken } }),
			);
			expect((yield* pollImportRunUntilTerminal(client, created.id)).status).toBe("completed");
		}),
	);
});

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

describe("Watcharr Show Import E2E (episode resolution)", () => {
	it.live(
		"attaches per-episode history to the episode entity and drops unresolvable locators",
		() =>
			Effect.gen(function* () {
				const { client, cookies } = yield* createAuthenticatedClient();

				// Pre-seed an already-populated show → season → episode tree so the import
				// resolves the episode positionally without any external provider calls.
				const { tmdbId, showId, episodeId } = yield* seedGlobalShowEpisodeTree(client, {
					showName: "Test Show",
				});

				// One resolvable watched episode (S1E2) and one unresolvable locator (S1E99).
				const watcharrExport = JSON.stringify([
					{
						rating: 0,
						activity: [],
						thoughts: "",
						pinned: false,
						status: "WATCHING",
						content: { type: "tv", title: "Test Show", tmdbId: Number(tmdbId) },
						watchedEpisodes: [
							{
								seasonNumber: 1,
								episodeNumber: 2,
								status: "FINISHED",
								createdAt: "2026-01-01T00:00:00Z",
							},
							{
								seasonNumber: 1,
								episodeNumber: 99,
								status: "FINISHED",
								createdAt: "2026-01-01T00:00:00Z",
							},
						],
					},
				]);
				const uploadToken = yield* uploadTemporaryFile(
					cookies,
					watcharrExport,
					"watcharr.json",
					"application/json",
				);
				const created = yield* client.call((c) =>
					c.imports.createRun({ payload: { source: "watcharr", uploadToken } }),
				);
				const completedRun = yield* pollImportRunUntilTerminal(client, created.id);
				const membership = yield* queryInLibraryRelationship(client, showId, "show");
				expect(membership.data.items).toHaveLength(1);

				expect(completedRun).toMatchObject({ status: "completed", errorSummary: null });
				expect(completedRun.progress).toBe(100);

				// The resolvable episode's progress lands on the episode, never the show.
				const episodeEvents = yield* waitForEventSlugs(client, episodeId, "progress");
				const showEvents = yield* listEventSlugs(client, showId);
				expect(episodeEvents).toContain("progress");
				expect(showEvents).not.toContain("progress");

				// The unresolvable locator is reported as a failure, not mis-attached.
				const runWithFailures = yield* client.call((c) =>
					c.imports.getRun({
						urlParams: { page: 1, limit: 20 },
						path: { runId: ImportRunId.make(created.id) },
					}),
				);
				const failureMessages = runWithFailures.failures.items.map((failure) => failure.message);
				expect(failureMessages.some((message) => message.includes("S1E99"))).toBe(true);
			}),
	);
});
