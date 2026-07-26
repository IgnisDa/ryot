import { ImportRunId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	listEventSlugs,
	pollImportRunUntilTerminal,
	queryInLibraryRelationship,
	seedGlobalShowEpisodeTree,
	uploadImportFile,
	waitForEventSlugs,
} from "~/fixtures";
import { describe, expect, it } from "~/support/effect-test";

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
				const uploadToken = yield* uploadImportFile(
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
						query: { page: 1, limit: 20 },
						params: { runId: ImportRunId.make(created.id) },
					}),
				);
				const failureMessages = runWithFailures.failures.items.map((failure) => failure.message);
				expect(failureMessages.some((message) => message.includes("S1E99"))).toBe(true);
			}),
	);
});
