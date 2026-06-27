import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
	cleanupBuiltinProviderScript,
	countSignalsBySlug,
	createAuthenticatedClient,
	createNotificationChannel,
	detailsDriverCode,
	enableMediaMonitoring,
	getBuiltinEntitySchemaId,
	queryRecipientUserIds,
	querySignalBySlug,
	querySubscriptionRuns,
	runInfrequentCron,
	seedAnimeMonitoringEntity,
	seedBuiltinProviderScript,
	seedMediaEntity,
	seedMonitoredShowProvider,
	startFakeAppriseServer,
	updateProviderScriptCode,
	waitForEntityPopulatedById,
	waitForProviderRefresh,
	withBumpedEpisode,
	withRenamedEpisode,
	type MonitoredShowTree,
	type SeededProviderScript,
} from "../fixtures";
import { pollUntil } from "../fixtures/polling";
import { getPgClient } from "../setup";
import type { FakeHttpServer } from "../test-support/fake-http-server";

const imageSet = (...urls: string[]) => urls.map((url) => ({ url, type: "remote" as const }));

const setPopulated = (entityId: string) =>
	getPgClient().query(`update entity set populated_at = now() where id = $1`, [entityId]);

let movieSchemaId: string;
let fakeApprise: FakeHttpServer;
const providers: SeededProviderScript[] = [];

const enrollMonitor = async (entityId: string) => {
	const user = await createAuthenticatedClient();
	await createNotificationChannel(user.client, {
		kind: "apprise",
		specifics: { baseUrl: fakeApprise.url, key: `k-${crypto.randomUUID()}`, kind: "apprise" },
	});
	await enableMediaMonitoring(user.client, entityId);
	return user;
};

beforeAll(async () => {
	movieSchemaId = await getBuiltinEntitySchemaId("movie");
	fakeApprise = await startFakeAppriseServer();
});

afterAll(async () => {
	fakeApprise.stop();
	await Promise.all(providers.map((provider) => cleanupBuiltinProviderScript(provider)));
});

describe("media entity change signals", () => {
	it("emits status and publish-year signals for a monitored movie and fans out per recipient", async () => {
		fakeApprise.requests.length = 0;
		const movieName = `Entity Signal Movie ${crypto.randomUUID()}`;
		const movieDetails = (status: string, year: number) =>
			detailsDriverCode({
				name: movieName,
				properties: { productionStatus: status, publishYear: year },
			});

		const provider = await seedBuiltinProviderScript({
			name: "Entity Signal Movie Provider",
			code: movieDetails("Continuing", 2026),
			slug: `movie.entity-signal-${crypto.randomUUID()}`,
		});
		providers.push(provider);
		const movie = await seedMediaEntity({
			userId: null,
			name: movieName,
			entitySchemaId: movieSchemaId,
			sandboxScriptId: provider.scriptId,
			externalId: `entity-signal-movie-${crypto.randomUUID()}`,
			properties: { productionStatus: "Continuing", publishYear: 2026 },
		});
		await setPopulated(movie.id);

		const first = await enrollMonitor(movie.id);
		const second = await enrollMonitor(movie.id);

		const baseline = await runInfrequentCron();
		await waitForProviderRefresh(baseline.executionId, movie.id);

		await updateProviderScriptCode(provider.scriptId, movieDetails("Ended", 2027));
		const changed = await runInfrequentCron();
		await pollUntil("movie provider refresh applied", async () => {
			const result = await getPgClient().query<{ status: string | null }>(
				`select properties->>'productionStatus' as status from entity where id = $1`,
				[movie.id],
			);
			return result.rows[0]?.status === "Ended" ? true : null;
		});
		await waitForProviderRefresh(changed.executionId, movie.id);

		const expectedUserIds = [first.userId, second.userId].sort();
		const statusDelivery = await pollUntil("status signal fan-out", async () => {
			const signal = await querySignalBySlug({
				slug: "media.status.changed",
				subjectEntityId: movie.id,
				correlationId: changed.executionId,
			});
			if (!signal) {
				return null;
			}
			const recipients = await queryRecipientUserIds(signal.id);
			const runs = await querySubscriptionRuns({ signalId: signal.id, status: "succeeded" });
			const succeeded = runs
				.filter((run) => run.operation === "signal")
				.map((run) => run.executionUserId ?? "")
				.sort();
			return recipients.length === 2 && succeeded.length === 2
				? { signal, recipients, succeeded }
				: null;
		});
		expect(statusDelivery.recipients).toEqual(expectedUserIds);
		expect(statusDelivery.succeeded).toEqual(expectedUserIds);
		expect(statusDelivery.signal.properties).toEqual({
			newStatus: "Ended",
			entityName: movieName,
			oldStatus: "Continuing",
		});

		const releaseSignal = await pollUntil("publish year signal", () =>
			querySignalBySlug({
				subjectEntityId: movie.id,
				slug: "media.release-date.changed",
				correlationId: changed.executionId,
			}),
		);
		expect(releaseSignal.properties).toEqual({
			oldYear: 2026,
			newYear: 2027,
			entityName: movieName,
			changeKind: "publish_year",
		});

		const baselineSignals = await countSignalsBySlug({
			subjectEntityId: movie.id,
			correlationId: baseline.executionId,
		});
		expect(Object.keys(baselineSignals)).toHaveLength(0);

		const delivered = await pollUntil("status notification delivery", () => {
			const statusBodies = fakeApprise.requests.filter((request) => {
				const body = request.body;
				return (
					typeof body === "object" &&
					body !== null &&
					"body" in body &&
					body.body === `Status of ${movieName} changed from Continuing to Ended`
				);
			});
			return Promise.resolve(statusBodies.length >= 2 ? statusBodies : null);
		});
		expect(delivered.length).toBeGreaterThanOrEqual(2);
	});

	it("emits a sole content-count signal when a monitored anime episode count changes", async () => {
		const animeName = `Content Count Anime ${crypto.randomUUID()}`;
		const anime = await seedAnimeMonitoringEntity({ episodes: 12, name: animeName });
		providers.push(anime.provider);
		await setPopulated(anime.animeEntityId);
		await enrollMonitor(anime.animeEntityId);

		const baseline = await runInfrequentCron();
		await waitForProviderRefresh(baseline.executionId, anime.animeEntityId);

		await anime.setEpisodes(24);
		const changed = await runInfrequentCron();
		await pollUntil("anime provider refresh applied", async () => {
			const result = await getPgClient().query<{ episodes: string | null }>(
				`select properties->>'episodes' as episodes from entity where id = $1`,
				[anime.animeEntityId],
			);
			return result.rows[0]?.episodes === "24" ? true : null;
		});
		await waitForProviderRefresh(changed.executionId, anime.animeEntityId);

		const signal = await pollUntil("content-count signal", () =>
			querySignalBySlug({
				correlationId: changed.executionId,
				slug: "media.content-count.changed",
				subjectEntityId: anime.animeEntityId,
			}),
		);
		expect(signal.properties).toEqual({
			oldCount: 12,
			newCount: 24,
			entityName: animeName,
			contentType: "episodes",
		});

		const bySlug = await countSignalsBySlug({
			correlationId: changed.executionId,
			subjectEntityId: anime.animeEntityId,
		});
		expect(bySlug["media.content-count.changed"]).toBe(1);
		expect(Object.keys(bySlug)).toHaveLength(1);
	});

	it("emits episode name, image, and date signals subject to the parent show", async () => {
		const seasonExternalId = `s1-${crypto.randomUUID()}`;
		const episodeExternalId = `s1e3-${crypto.randomUUID()}`;
		const showName = `Episode Signal Show ${crypto.randomUUID()}`;
		const baseTree: MonitoredShowTree = {
			name: showName,
			seasons: [
				{
					name: "Season 1",
					seasonNumber: 1,
					externalId: seasonExternalId,
					episodes: [
						{
							episodeNumber: 3,
							name: "Original Episode",
							publishDate: "2021-05-01",
							externalId: episodeExternalId,
							properties: { images: imageSet("img-a", "img-b") },
						},
					],
				},
			],
		};
		const show = await seedMonitoredShowProvider({ tree: baseTree });
		providers.push(show.provider);
		await enrollMonitor(show.showEntityId);

		const baseline = await runInfrequentCron();
		await waitForEntityPopulatedById(show.showEntityId);
		await waitForProviderRefresh(baseline.executionId, show.showEntityId);

		let changedTree = withRenamedEpisode(baseTree, episodeExternalId, "Renamed Episode");
		changedTree = withBumpedEpisode(changedTree, episodeExternalId, {
			publishDate: "2021-06-15",
			properties: { images: imageSet("img-c") },
		});
		await show.refresh(changedTree);
		const changed = await runInfrequentCron();
		await waitForProviderRefresh(changed.executionId, show.showEntityId);

		const nameSignal = await pollUntil("episode name signal", () =>
			querySignalBySlug({
				slug: "media.episode.name.changed",
				subjectEntityId: show.showEntityId,
				correlationId: changed.executionId,
			}),
		);
		expect(nameSignal.properties).toEqual({
			seasonNumber: 1,
			episodeNumber: 3,
			entityName: showName,
			oldName: "Original Episode",
			newName: "Renamed Episode",
		});

		const imageSignal = await pollUntil("episode image signal", () =>
			querySignalBySlug({
				subjectEntityId: show.showEntityId,
				correlationId: changed.executionId,
				slug: "media.episode.images.changed",
			}),
		);
		expect(imageSignal.properties).toEqual({
			seasonNumber: 1,
			episodeNumber: 3,
			entityName: showName,
		});

		const dateSignal = await pollUntil("episode date signal", () =>
			querySignalBySlug({
				slug: "media.release-date.changed",
				subjectEntityId: show.showEntityId,
				correlationId: changed.executionId,
			}),
		);
		expect(dateSignal.properties).toEqual({
			seasonNumber: 1,
			episodeNumber: 3,
			entityName: showName,
			oldDate: "2021-05-01",
			newDate: "2021-06-15",
			changeKind: "episode_date",
		});
	});

	it("treats a permuted/duplicated image set as a no-op", async () => {
		const seasonExternalId = `s1-${crypto.randomUUID()}`;
		const episodeExternalId = `s1e1-${crypto.randomUUID()}`;
		const showName = `Image No-op Show ${crypto.randomUUID()}`;
		const baseTree: MonitoredShowTree = {
			name: showName,
			seasons: [
				{
					seasonNumber: 1,
					name: "Season 1",
					externalId: seasonExternalId,
					episodes: [
						{
							name: "Episode",
							episodeNumber: 1,
							externalId: episodeExternalId,
							properties: { images: imageSet("img-a", "img-b") },
						},
					],
				},
			],
		};
		const show = await seedMonitoredShowProvider({ tree: baseTree });
		providers.push(show.provider);
		await enrollMonitor(show.showEntityId);

		const baseline = await runInfrequentCron();
		await waitForEntityPopulatedById(show.showEntityId);
		await waitForProviderRefresh(baseline.executionId, show.showEntityId);

		let changedTree = withRenamedEpisode(baseTree, episodeExternalId, "Episode Renamed");
		changedTree = withBumpedEpisode(changedTree, episodeExternalId, {
			properties: { images: imageSet("img-b", "img-a", "img-a") },
		});
		await show.refresh(changedTree);
		const changed = await runInfrequentCron();
		await waitForProviderRefresh(changed.executionId, show.showEntityId);

		await pollUntil("episode name signal (control)", () =>
			querySignalBySlug({
				slug: "media.episode.name.changed",
				subjectEntityId: show.showEntityId,
				correlationId: changed.executionId,
			}),
		);
		const bySlug = await countSignalsBySlug({
			subjectEntityId: show.showEntityId,
			correlationId: changed.executionId,
		});
		expect(bySlug["media.episode.images.changed"] ?? 0).toBe(0);
	});

	it("stays silent on the initial population of a freshly monitored show", async () => {
		const seasonExternalId = `s1-${crypto.randomUUID()}`;
		const episodeExternalId = `s1e1-${crypto.randomUUID()}`;
		const baseTree: MonitoredShowTree = {
			properties: { productionStatus: "Continuing" },
			name: `Initial Silence Show ${crypto.randomUUID()}`,
			seasons: [
				{
					seasonNumber: 1,
					name: "Season 1",
					externalId: seasonExternalId,
					episodes: [
						{
							episodeNumber: 1,
							name: "Episode 1",
							publishDate: "2020-01-01",
							externalId: episodeExternalId,
						},
					],
				},
			],
		};
		const show = await seedMonitoredShowProvider({ tree: baseTree });
		providers.push(show.provider);
		await enrollMonitor(show.showEntityId);

		const baseline = await runInfrequentCron();
		await waitForEntityPopulatedById(show.showEntityId);
		await waitForProviderRefresh(baseline.executionId, show.showEntityId);

		await show.refresh({ ...baseTree, properties: { productionStatus: "Ended" } });
		const changed = await runInfrequentCron();
		await waitForProviderRefresh(changed.executionId, show.showEntityId);
		await pollUntil("post-baseline status signal anchor", () =>
			querySignalBySlug({
				slug: "media.status.changed",
				subjectEntityId: show.showEntityId,
				correlationId: changed.executionId,
			}),
		);

		const baselineSignals = await countSignalsBySlug({
			subjectEntityId: show.showEntityId,
			correlationId: baseline.executionId,
		});
		expect(Object.keys(baselineSignals)).toHaveLength(0);
	});

	it("suppresses episode changes that occur inside a Specials season", async () => {
		const seasonExternalId = `specials-${crypto.randomUUID()}`;
		const specialExternalId = `special-${crypto.randomUUID()}`;
		const baseTree: MonitoredShowTree = {
			name: `Specials Show ${crypto.randomUUID()}`,
			properties: { productionStatus: "Continuing" },
			seasons: [
				{
					seasonNumber: 0,
					name: "Specials",
					externalId: seasonExternalId,
					episodes: [
						{
							episodeNumber: 1,
							name: "Original Special",
							publishDate: "2019-12-25",
							externalId: specialExternalId,
							properties: { images: imageSet("special-a") },
						},
					],
				},
			],
		};
		const show = await seedMonitoredShowProvider({ tree: baseTree });
		providers.push(show.provider);
		await enrollMonitor(show.showEntityId);

		const baseline = await runInfrequentCron();
		await waitForEntityPopulatedById(show.showEntityId);
		await waitForProviderRefresh(baseline.executionId, show.showEntityId);

		let changedTree: MonitoredShowTree = {
			...baseTree,
			properties: { productionStatus: "Ended" },
		};
		changedTree = withRenamedEpisode(changedTree, specialExternalId, "Renamed Special");
		changedTree = withBumpedEpisode(changedTree, specialExternalId, {
			publishDate: "2020-12-25",
			properties: { images: imageSet("special-b") },
		});
		await show.refresh(changedTree);
		const changed = await runInfrequentCron();
		await waitForProviderRefresh(changed.executionId, show.showEntityId);

		await pollUntil("show status signal anchor", () =>
			querySignalBySlug({
				slug: "media.status.changed",
				subjectEntityId: show.showEntityId,
				correlationId: changed.executionId,
			}),
		);
		const bySlug = await countSignalsBySlug({
			subjectEntityId: show.showEntityId,
			correlationId: changed.executionId,
		});
		expect(bySlug["media.episode.name.changed"] ?? 0).toBe(0);
		expect(bySlug["media.episode.images.changed"] ?? 0).toBe(0);
		expect(bySlug["media.release-date.changed"] ?? 0).toBe(0);
	});
});
