import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createIntegration,
	createKodiIntegration,
	listEventSlugs,
	listEventsForEntity,
	postIntegrationWebhookAndWait,
	seedGlobalShowEpisodeTree,
	waitForEventSlugs,
	waitForEventWithSchema,
} from "~/fixtures";
import { requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

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

				expect(completedRun).toMatchObject({ status: "completed", errorSummary: null });
				expect(completedRun.failedItems).toBe(0);

				const episodeEvents = yield* waitForEventSlugs(client, episodeId, "progress");
				const showEvents = yield* listEventSlugs(client, showId);
				expect(showEvents).not.toContain("progress");
				expect(episodeEvents).toContain("progress");
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
				const progressEvents = yield* listEventsForEntity(client, episodeId, {
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
				expect(firstRun).toMatchObject({ status: "completed", errorSummary: null });
				expect(firstRun.failedItems).toBe(0);

				const { run: secondRun } = yield* postIntegrationWebhookAndWait(client, id, {
					lot: "show",
					progress: 50,
					identifier: tmdbId,
					show_season_number: 1,
					show_episode_number: 2,
				});
				expect(secondRun).toMatchObject({ status: "completed", errorSummary: null });
				expect(secondRun.failedItems).toBe(0);

				yield* waitForEventSlugs(client, episodeId, "progress");
				const progressEvents = yield* listEventsForEntity(client, episodeId, {
					eventSchemaSlug: "progress",
				});

				expect(progressEvents).toHaveLength(1);
				expect(
					requirePresent(progressEvents[0], "Expected progress event").properties,
				).toMatchObject({
					progressPercent: 50,
				});
			}),
	);
});
