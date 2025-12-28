import { ImportRunId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	getImportRun,
	listEventSlugs,
	pollImportRunUntilTerminal,
	runHevyImportFixture,
	runOpenScaleImportFixture,
	seedGlobalShowEpisodeTree,
	startOpenScaleImport,
	uploadTemporaryFile,
	waitForEventSlugs,
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

			const runData = yield* client.call((c) =>
				c.imports.getRun({
					path: { runId: ImportRunId.make(runId) },
					urlParams: { page: 1, limit: 20 },
				}),
			);

			expect(runData.failures.items.length).toBeGreaterThan(0);
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

				expect(completedRun.status).toBe("completed");
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
