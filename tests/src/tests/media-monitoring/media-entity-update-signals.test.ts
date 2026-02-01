import { Effect } from "effect";

import {
	cleanupBuiltinProviderScript,
	createAuthenticatedClient,
	createNotificationChannel,
	enableMediaMonitoring,
	fakeProviderDetailsResult,
	getBuiltinEntitySchemaId,
	providerSandboxSource,
	replaceSandboxScriptCompiledRepresentation,
	seedBuiltinProviderScript,
	seedMediaEntity,
	startFakeAppriseServer,
	triggerCronAndWaitForEntity,
	pollUntil,
} from "~/fixtures";
import { requireObjectRecord } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";
import type { FakeHttpServer } from "~/support/fake-http-server";

let fakeApprise: FakeHttpServer;

beforeAll(async () => {
	fakeApprise = await startFakeAppriseServer();
});

afterAll(() => {
	fakeApprise.stop();
});

function pollNotificationBodies(key: string, count: number) {
	return pollUntil(
		`${count} notification(s) for '${key}'`,
		Effect.sync(() => {
			const requests = fakeApprise.requests.filter(({ path }) => path === `/notify/${key}`);
			return requests.length === count ? requests : null;
		}),
	);
}

describe("hierarchical media entity-update signals", () => {
	it.live("notifies content-count and publish-year changes for a monitored anime", () =>
		Effect.gen(function* () {
			const animeName = "Entity Update Anime";
			const animeSlug = `anime.entity-update-e2e-${crypto.randomUUID()}`;
			const animeExternalId = `entity-update-anime-${crypto.randomUUID()}`;

			const buildDetails = (episodes: number, publishYear: number) =>
				fakeProviderDetailsResult({
					name: animeName,
					properties: { productionStatus: "Continuing", episodes, publishYear },
				});

			const { client } = yield* createAuthenticatedClient();
			const animeSchemaId = yield* getBuiltinEntitySchemaId("anime");
			const animeProvider = yield* seedBuiltinProviderScript({
				client,
				slug: animeSlug,
				drivers: { details: buildDetails(12, 2025) },
			});

			try {
				const anime = yield* seedMediaEntity({
					properties: {},
					name: animeName,
					externalId: animeExternalId,
					entitySchemaId: animeSchemaId,
					sandboxScriptId: animeProvider.scriptId,
				});

				const monitor = yield* createAuthenticatedClient();
				yield* createNotificationChannel(monitor.client, {
					channel: "apprise",
					channelSpecifics: { baseUrl: fakeApprise.url, key: "anime-monitor", kind: "apprise" },
				});
				yield* enableMediaMonitoring(monitor.client, anime.id);

				fakeApprise.requests.length = 0;
				yield* triggerCronAndWaitForEntity(anime.id);
				expect(fakeApprise.requests.filter(({ path }) => path === "/notify/anime-monitor")).toEqual(
					[],
				);

				fakeApprise.requests.length = 0;
				yield* replaceSandboxScriptCompiledRepresentation(
					client,
					animeProvider.scriptId,
					providerSandboxSource({
						slug: animeSlug,
						name: animeName,
						providerInformation: { source: "e2e" },
						drivers: { details: buildDetails(13, 2026) },
					}),
				);
				yield* triggerCronAndWaitForEntity(anime.id);

				const delivered = yield* pollNotificationBodies("anime-monitor", 2);
				const bodies = delivered
					.map(({ body }) => requireObjectRecord(body, "Missing notification body").body)
					.sort((left, right) => String(left).localeCompare(String(right)));
				expect(bodies).toEqual(
					[
						`Number of episodes changed from 12 to 13 for ${animeName}`,
						`Publish year changed from 2025 to 2026 for ${animeName}`,
					].sort((left, right) => left.localeCompare(right)),
				);
			} finally {
				yield* cleanupBuiltinProviderScript(animeProvider);
			}
		}),
	);

	it.live(
		"notifies episode name, image, and release-date changes while staying silent for a special season",
		() =>
			Effect.gen(function* () {
				const showName = "Entity Update Show";
				const showSlug = `show.entity-update-e2e-${crypto.randomUUID()}`;
				const showExternalId = `entity-update-show-${crypto.randomUUID()}`;
				const seasonOneExternalId = `entity-update-season-1-${crypto.randomUUID()}`;
				const episodeOneExternalId = `entity-update-episode-1-${crypto.randomUUID()}`;
				const specialSeasonExternalId = `entity-update-season-0-${crypto.randomUUID()}`;
				const specialEpisodeExternalId = `entity-update-special-1-${crypto.randomUUID()}`;

				const buildDetails = (input: {
					specialName: string;
					episodeName: string;
					episodeImageUrl: string;
					episodePublishDate: string;
					specialPublishDate: string;
				}) =>
					fakeProviderDetailsResult({
						name: showName,
						properties: { productionStatus: "Continuing", publishYear: 2025 },
						childEntities: [
							{
								name: "Season 1",
								properties: { seasonNumber: 1 },
								entitySchemaSlug: "show-season",
								externalId: seasonOneExternalId,
								childEntities: [
									{
										name: input.episodeName,
										entitySchemaSlug: "show-episode",
										externalId: episodeOneExternalId,
										properties: {
											seasonNumber: 1,
											episodeNumber: 1,
											publishDate: input.episodePublishDate,
											images: [{ type: "remote", url: input.episodeImageUrl }],
										},
									},
								],
							},
							{
								name: "Specials",
								properties: { seasonNumber: 0 },
								entitySchemaSlug: "show-season",
								externalId: specialSeasonExternalId,
								childEntities: [
									{
										name: input.specialName,
										entitySchemaSlug: "show-episode",
										externalId: specialEpisodeExternalId,
										properties: {
											seasonNumber: 0,
											episodeNumber: 1,
											publishDate: input.specialPublishDate,
										},
									},
								],
							},
						],
					});

				const { client } = yield* createAuthenticatedClient();
				const showSchemaId = yield* getBuiltinEntitySchemaId("show");
				const showProvider = yield* seedBuiltinProviderScript({
					client,
					slug: showSlug,
					drivers: {
						details: buildDetails({
							episodeName: "Episode 1",
							specialName: "Special 1",
							specialPublishDate: "2026-01-01",
							episodePublishDate: "2026-01-01",
							episodeImageUrl: "https://example.com/entity-update-before.jpg",
						}),
					},
				});

				try {
					const show = yield* seedMediaEntity({
						name: showName,
						properties: {},
						externalId: showExternalId,
						entitySchemaId: showSchemaId,
						sandboxScriptId: showProvider.scriptId,
					});

					const monitor = yield* createAuthenticatedClient();
					yield* createNotificationChannel(monitor.client, {
						channel: "apprise",
						channelSpecifics: {
							kind: "apprise",
							baseUrl: fakeApprise.url,
							key: "show-episode-monitor",
						},
					});
					yield* enableMediaMonitoring(monitor.client, show.id);

					fakeApprise.requests.length = 0;
					yield* triggerCronAndWaitForEntity(show.id);
					expect(
						fakeApprise.requests.filter(({ path }) => path === "/notify/show-episode-monitor"),
					).toEqual([]);

					fakeApprise.requests.length = 0;
					yield* replaceSandboxScriptCompiledRepresentation(
						client,
						showProvider.scriptId,
						providerSandboxSource({
							slug: showSlug,
							name: showName,
							providerInformation: { source: "e2e" },
							drivers: {
								details: buildDetails({
									specialName: "Special 1 Renamed",
									episodeName: "Episode 1 Renamed",
									episodePublishDate: "2026-02-01",
									specialPublishDate: "2026-02-01",
									episodeImageUrl: "https://example.com/entity-update-after.jpg",
								}),
							},
						}),
					);
					yield* triggerCronAndWaitForEntity(show.id);

					const delivered = yield* pollNotificationBodies("show-episode-monitor", 3);
					const bodies = delivered
						.map(({ body }) => requireObjectRecord(body, "Missing notification body").body)
						.sort((left, right) => String(left).localeCompare(String(right)));
					expect(bodies).toEqual(
						[
							`Episode image changed for S1E1 in ${showName}`,
							`Episode name changed from "Episode 1" to "Episode 1 Renamed" (S1E1) for ${showName}`,
							`Episode release date changed from 2026-01-01 to 2026-02-01 (S1E1) for ${showName}`,
						].sort((left, right) => left.localeCompare(right)),
					);
				} finally {
					yield* cleanupBuiltinProviderScript(showProvider);
				}
			}),
	);
});
