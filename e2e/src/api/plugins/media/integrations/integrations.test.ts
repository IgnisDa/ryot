import { integrationWebhookUrl } from "@ryot-app/contract/modules/integrations/schemas";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { DateTime, Effect, Option } from "effect";

import {
	createAuthenticatedClient,
	createIntegration,
	createKodiIntegration,
	getIntegration,
	listEventsForEntity,
	listEventSlugs,
	pollImportRunUntilTerminal,
	postIntegrationWebhookAndWait,
	setEntityPopulatedAt,
	waitForEventSlugs,
	waitForEventWithSchema,
} from "~/fixtures/kernel";
import {
	findMediaEntitySchema,
	mediaFixtureInstallation,
	seedGlobalShowEpisodeTree,
	seedMediaEntity,
} from "~/fixtures/plugins/media";
import { requireObjectRecord, requirePresent, requireString } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { webRequest } from "~/support/web-request";

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
	it.live("uses Emby series IDs instead of episode IDs for show progress", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const integration = yield* createIntegration(client, {
				providerSpecifics: { kind: "emby" },
				provider: {
					slug: "emby",
					owner: definitionOwner((yield* mediaFixtureInstallation(client.target)).id),
				},
			});
			const { tmdbId, episodeId } = yield* seedGlobalShowEpisodeTree(client, {
				showName: "Emby Identity Show",
			});
			const { run } = yield* postIntegrationWebhookAndWait(client, integration, {
				PlaybackInfo: { PositionTicks: 500 },
				Series: { ProviderIds: { Tmdb: tmdbId } },
				Item: {
					IndexNumber: 2,
					Type: "Episode",
					Name: "Episode",
					RunTimeTicks: 1000,
					ParentIndexNumber: 1,
					SeriesName: "Emby Identity Show",
					ProviderIds: { Tmdb: "episode-not-show" },
				},
			});
			expect(run).toMatchObject({ status: "completed", failureReason: null });
			expect(run.summary.every(({ counts }) => counts.unsuccessful === 0)).toBe(true);
			const events = yield* listEventsForEntity(client, episodeId, undefined, 20, {
				eventSchemaSlug: "progress",
			});
			expect(events.map(({ properties }) => properties)).toMatchObject([
				{ consumedOn: "Emby", progressPercent: 50 },
			]);
		}),
	);

	it.live(
		"POST /api/webhooks/integrations/{validKodiWebhookToken} attaches show progress to the resolved episode",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const integration = yield* createKodiIntegration(client);

				const { tmdbId, showId, episodeId } = yield* seedGlobalShowEpisodeTree(client, {
					showName: "Live Sink Test Show",
				});

				const { run: completedRun } = yield* postIntegrationWebhookAndWait(client, integration, {
					lot: "show",
					progress: 45,
					identifier: tmdbId,
					show_season_number: 1,
					show_episode_number: 2,
				});

				expect(completedRun).toMatchObject({ status: "completed", failureReason: null });
				expect(completedRun.summary.every(({ counts }) => counts.unsuccessful === 0)).toBe(true);

				const episodeEvents = yield* waitForEventSlugs(client, episodeId, "progress");
				const showEvents = yield* listEventSlugs(client, showId);
				expect(showEvents).not.toContain("progress");
				expect(episodeEvents).toContain("progress");
			}),
	);

	it.live("POST /_i/{validPlexWebhookToken} parses the multipart body Plex actually sends", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const integration = yield* createIntegration(client, {
				providerSpecifics: { kind: "plex_sink" },
				provider: {
					slug: "plex_sink",
					owner: definitionOwner((yield* mediaFixtureInstallation(client.target)).id),
				},
			});

			const { schema } = yield* findMediaEntitySchema(client, "movie");
			const provider = requirePresent(
				schema.providers.find((candidate) => candidate.name === "TMDB"),
				"Expected TMDB movie provider",
			);
			const tmdbId = String(Math.floor(Math.random() * 1_000_000_000));
			const movie = yield* seedMediaEntity({
				properties: {},
				externalId: tmdbId,
				entitySchemaSlug: schema.id,
				providerId: provider.providerId,
				name: "Plex Multipart Sink Movie",
			});
			yield* setEntityPopulatedAt(movie.id, DateTime.formatIso(yield* DateTime.now));

			const boundary = "----RyotPlexBoundary";
			const detail = requirePresent(
				Option.getOrUndefined(yield* getIntegration(client, integration.id)),
				"Expected Plex integration detail",
			);
			const { frontendOrigin } = yield* client.call((c) => c.system.config());
			const webhookUrl = integrationWebhookUrl(
				frontendOrigin,
				requirePresent(detail.webhookToken, "Expected Plex webhook token"),
			);
			const response = yield* webRequest(webhookUrl, {
				method: "POST",
				headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
				body: plexMultipartBody(boundary, {
					event: "media.scrobble",
					Metadata: {
						type: "movie",
						Guid: [{ id: `tmdb://${tmdbId}` }],
						title: "Plex Multipart Sink Movie",
					},
				}),
			});

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
			expect(run.summary.every(({ counts }) => counts.unsuccessful === 0)).toBe(true);
			expect(yield* waitForEventSlugs(client, movie.id, "progress")).toContain("progress");
		}),
	);
});

describe("Progress normalization", () => {
	it.live(
		"clamps progress above the integration's maximum down to 100% and fills the completion timestamp",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const integration = yield* createIntegration(client, {
					maximumProgress: 90,
					providerSpecifics: { kind: "kodi" },
					provider: {
						slug: "kodi",
						owner: definitionOwner((yield* mediaFixtureInstallation(client.target)).id),
					},
				});

				const { tmdbId, episodeId } = yield* seedGlobalShowEpisodeTree(client, {
					showName: "Progress Clamp Test Show",
				});

				const { run: completedRun } = yield* postIntegrationWebhookAndWait(client, integration, {
					lot: "show",
					progress: 97,
					identifier: tmdbId,
					show_season_number: 1,
					show_episode_number: 2,
				});

				expect(completedRun.status).toBe("completed");
				expect(completedRun.summary.every(({ counts }) => counts.unsuccessful === 0)).toBe(true);

				yield* waitForEventSlugs(client, episodeId, "progress");
				const progressEvents = yield* listEventsForEntity(client, episodeId, undefined, 100, {
					eventSchemaSlug: "progress",
				});

				expect(progressEvents).toHaveLength(1);
				const progressEvent = requirePresent(progressEvents[0], "Expected progress event");
				expect(progressEvent.properties).toMatchObject({ progressPercent: 100 });
				expect(progressEvent.occurredAt).toBeTruthy();

				const completeEvent = yield* waitForEventWithSchema(client, episodeId, "complete");
				expect(completeEvent.occurredAt).toBe(progressEvent.occurredAt);
				expect(completeEvent.properties).not.toHaveProperty("completedOn");
			}),
	);

	it.live(
		"filters out progress below the integration's minimum threshold without failing the run",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const integration = yield* createIntegration(client, {
					minimumProgress: 10,
					providerSpecifics: { kind: "kodi" },
					provider: {
						slug: "kodi",
						owner: definitionOwner((yield* mediaFixtureInstallation(client.target)).id),
					},
				});

				const { tmdbId, episodeId } = yield* seedGlobalShowEpisodeTree(client, {
					showName: "Progress Filter Test Show",
				});

				const { run: firstRun } = yield* postIntegrationWebhookAndWait(client, integration, {
					lot: "show",
					progress: 5,
					identifier: tmdbId,
					show_season_number: 1,
					show_episode_number: 2,
				});
				expect(firstRun).toMatchObject({ status: "completed", failureReason: null });
				expect(firstRun.summary.every(({ counts }) => counts.unsuccessful === 0)).toBe(true);

				const { run: secondRun } = yield* postIntegrationWebhookAndWait(client, integration, {
					lot: "show",
					progress: 50,
					identifier: tmdbId,
					show_season_number: 1,
					show_episode_number: 2,
				});
				expect(secondRun).toMatchObject({ status: "completed", failureReason: null });
				expect(secondRun.summary.every(({ counts }) => counts.unsuccessful === 0)).toBe(true);

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
