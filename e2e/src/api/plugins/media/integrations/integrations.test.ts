import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createIntegration,
	createKodiIntegration,
	listEventSlugs,
	listEventsForEntity,
	pollImportRunUntilTerminal,
	postIntegrationWebhookAndWait,
	waitForEventSlugs,
	waitForEventWithSchema,
} from "~/fixtures/kernel";
import { seedGlobalShowEpisodeTree } from "~/fixtures/plugins/media";
import { requireObjectRecord, requirePresent, requireString } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { getApiUrl } from "~/support/harness-target";

const plexMultipartBody = (boundary: string, payload: unknown) =>
	[
		`--${boundary}`,
		'Content-Disposition: form-data; name="payload"',
		"",
		JSON.stringify(payload),
		`--${boundary}--`,
		"",
	].join("\r\n");

describe("Webhook routes", () => {
	it.live(
		"POST /api/webhooks/integrations/{validKodiIntegrationId} attaches show progress to the resolved episode",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { id } = yield* createKodiIntegration(client);

				const { tmdbId, showId, episodeId } = yield* seedGlobalShowEpisodeTree(client, {
					showName: "Live Sink Test Show",
				});

				const { run: completedRun } = yield* postIntegrationWebhookAndWait(client, id, {
					lot: "show",
					progress: 45,
					identifier: tmdbId,
					show_season_number: 1,
					show_episode_number: 2,
				});

				expect(completedRun).toMatchObject({ status: "completed", failureReason: null });
				expect(completedRun.failedItems).toBe(0);

				const episodeEvents = yield* waitForEventSlugs(client, episodeId, "progress");
				const showEvents = yield* listEventSlugs(client, showId);
				expect(showEvents).not.toContain("progress");
				expect(episodeEvents).toContain("progress");
			}),
	);

	it.live("POST /_i/{validPlexIntegrationId} parses the multipart body Plex actually sends", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { id } = yield* createIntegration(client, {
				provider: "plex_sink",
				providerSpecifics: { kind: "plex_sink" },
			});

			const { tmdbId, episodeId } = yield* seedGlobalShowEpisodeTree(client, {
				showName: "Plex Multipart Sink Show",
			});

			const boundary = "----RyotPlexBoundary";
			const response = yield* Effect.promise(() =>
				fetch(`${getApiUrl().replace(/\/api$/, "")}/_i/${id}`, {
					method: "POST",
					headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
					body: plexMultipartBody(boundary, {
						event: "media.scrobble",
						Metadata: {
							index: 2,
							parentIndex: 1,
							type: "episode",
							Guid: [{ id: `tmdb://${tmdbId}` }],
							grandparentTitle: "Plex Multipart Sink Show",
						},
					}),
				}),
			);

			expect(response.status).toBe(202);
			const data = requireObjectRecord(
				yield* Effect.promise(() => response.json()),
				"Expected webhook response",
			);
			const run = yield* pollImportRunUntilTerminal(
				client,
				requireString(data.runId, "Expected runId from webhook"),
			);

			expect(run).toMatchObject({ status: "completed", failureReason: null });
			expect(run.failedItems).toBe(0);
			expect(yield* waitForEventSlugs(client, episodeId, "progress")).toContain("progress");
		}),
	);
});

describe("Progress normalization", () => {
	it.live(
		"clamps progress above the integration's maximum down to 100% and fills the completion timestamp",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { id } = yield* createIntegration(client, {
					provider: "kodi",
					maximumProgress: 90,
					providerSpecifics: { kind: "kodi" },
				});

				const { tmdbId, episodeId } = yield* seedGlobalShowEpisodeTree(client, {
					showName: "Progress Clamp Test Show",
				});

				const { run: completedRun } = yield* postIntegrationWebhookAndWait(client, id, {
					lot: "show",
					progress: 97,
					identifier: tmdbId,
					show_season_number: 1,
					show_episode_number: 2,
				});

				expect(completedRun.status).toBe("completed");
				expect(completedRun.failedItems).toBe(0);

				yield* waitForEventSlugs(client, episodeId, "progress");
				const progressEvents = yield* listEventsForEntity(client, episodeId, undefined, 100, {
					eventSchemaSlug: "progress",
				});

				expect(progressEvents).toHaveLength(1);
				const progressEvent = requirePresent(progressEvents[0], "Expected progress event");
				expect(progressEvent.properties).toMatchObject({ progressPercent: 100 });
				expect(progressEvent.occurredAt).toBeTruthy();

				// The clamped 100% cascades into the builtin auto-complete trigger on this same
				// episode entity — assert completedOn to directly prove the completion-timestamp
				// fill, not just the progress event's own occurredAt.
				const completeEvent = yield* waitForEventWithSchema(client, episodeId, "complete");
				expect(completeEvent.properties).toMatchObject({ completedOn: progressEvent.occurredAt });
			}),
	);

	it.live(
		"filters out progress below the integration's minimum threshold without failing the run",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { id } = yield* createIntegration(client, {
					provider: "kodi",
					minimumProgress: 10,
					providerSpecifics: { kind: "kodi" },
				});

				const { tmdbId, episodeId } = yield* seedGlobalShowEpisodeTree(client, {
					showName: "Progress Filter Test Show",
				});

				const { run: firstRun } = yield* postIntegrationWebhookAndWait(client, id, {
					lot: "show",
					progress: 5,
					identifier: tmdbId,
					show_season_number: 1,
					show_episode_number: 2,
				});
				expect(firstRun).toMatchObject({ status: "completed", failureReason: null });
				expect(firstRun.failedItems).toBe(0);

				const { run: secondRun } = yield* postIntegrationWebhookAndWait(client, id, {
					lot: "show",
					progress: 50,
					identifier: tmdbId,
					show_season_number: 1,
					show_episode_number: 2,
				});
				expect(secondRun).toMatchObject({ status: "completed", failureReason: null });
				expect(secondRun.failedItems).toBe(0);

				yield* waitForEventSlugs(client, episodeId, "progress");
				const progressEvents = yield* listEventsForEntity(client, episodeId, undefined, 100, {
					eventSchemaSlug: "progress",
				});

				expect(progressEvents).toHaveLength(1);
				expect(
					requirePresent(progressEvents[0], "Expected progress event").properties,
				).toMatchObject({ progressPercent: 50 });
			}),
	);
});
