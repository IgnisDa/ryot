import { afterAll, describe, expect, it } from "bun:test";

import {
	cleanupBuiltinProviderScript,
	countSignalsBySlug,
	createAuthenticatedClient,
	enableMediaMonitoring,
	querySignalBySlug,
	runInfrequentCron,
	seedMonitoredShowProvider,
	withAddedEpisode,
	withAddedSeason,
	withBumpedEpisode,
	withRenamedEpisode,
	waitForEntityPopulatedById,
	waitForProviderRefresh,
	type MonitoredShowTree,
	type SeededProviderScript,
} from "../fixtures";
import { pollUntil } from "../fixtures/polling";

const providers: SeededProviderScript[] = [];

const enrollMonitor = async (entityId: string) => {
	const user = await createAuthenticatedClient();
	await enableMediaMonitoring(user.client, entityId);
	return user;
};

const singleSeasonTree = (
	showName: string,
	seasonExternalId: string,
	episodeExternalIds: string[],
): MonitoredShowTree => ({
	name: showName,
	seasons: [
		{
			seasonNumber: 1,
			name: "Season 1",
			externalId: seasonExternalId,
			episodes: episodeExternalIds.map((externalId, index) => ({
				externalId,
				episodeNumber: index + 1,
				name: `Episode ${index + 1}`,
				publishDate: `2020-01-0${index + 1}`,
			})),
		},
	],
});

const seedMonitoredShow = async (tree: MonitoredShowTree) => {
	const show = await seedMonitoredShowProvider({ tree });
	providers.push(show.provider);
	await enrollMonitor(show.showEntityId);
	const baseline = await runInfrequentCron();
	await waitForEntityPopulatedById(show.showEntityId);
	await waitForProviderRefresh(baseline.executionId, show.showEntityId);
	return show;
};

afterAll(async () => {
	await Promise.all(providers.map((provider) => cleanupBuiltinProviderScript(provider)));
});

describe("media relationship change signals", () => {
	it("emits a season-count signal when a monitored show gains a season", async () => {
		const showName = `Season Count Show ${crypto.randomUUID()}`;
		const seasonOne = `s1-${crypto.randomUUID()}`;
		const seasonTwo = `s2-${crypto.randomUUID()}`;
		const baseTree = singleSeasonTree(showName, seasonOne, [`s1e1-${crypto.randomUUID()}`]);
		const show = await seedMonitoredShow(baseTree);

		const changedTree = withAddedSeason(baseTree, {
			episodes: [],
			seasonNumber: 2,
			name: "Season 2",
			externalId: seasonTwo,
		});
		await show.refresh(changedTree);
		const changed = await runInfrequentCron();
		await waitForProviderRefresh(changed.executionId, show.showEntityId);

		const signal = await pollUntil("season-count signal", () =>
			querySignalBySlug({
				slug: "media.season-count.changed",
				subjectEntityId: show.showEntityId,
				correlationId: changed.executionId,
			}),
		);
		expect(signal.properties).toEqual({ entityName: showName, oldCount: 1, newCount: 2 });

		const bySlug = await countSignalsBySlug({
			subjectEntityId: show.showEntityId,
			correlationId: changed.executionId,
		});
		expect(bySlug).toEqual({ "media.season-count.changed": 1 });
	});

	it("emits an aggregate episode-discovered signal when a season gains episodes", async () => {
		const showName = `Episode Discovery Show ${crypto.randomUUID()}`;
		const seasonOne = `s1-${crypto.randomUUID()}`;
		const newEpisode = `s1e2-${crypto.randomUUID()}`;
		const baseTree = singleSeasonTree(showName, seasonOne, [`s1e1-${crypto.randomUUID()}`]);
		const show = await seedMonitoredShow(baseTree);

		const changedTree = withAddedEpisode(baseTree, seasonOne, {
			episodeNumber: 2,
			name: "Episode 2",
			externalId: newEpisode,
			publishDate: "2020-02-01",
		});
		await show.refresh(changedTree);
		const changed = await runInfrequentCron();
		await waitForProviderRefresh(changed.executionId, show.showEntityId);

		const signal = await pollUntil("episode-discovered signal", () =>
			querySignalBySlug({
				slug: "media.episode.discovered",
				subjectEntityId: show.showEntityId,
				correlationId: changed.executionId,
			}),
		);
		expect(signal.properties).toEqual({
			oldCount: 1,
			newCount: 2,
			seasonNumber: 1,
			discoveredCount: 1,
			entityName: showName,
		});

		const bySlug = await countSignalsBySlug({
			subjectEntityId: show.showEntityId,
			correlationId: changed.executionId,
		});
		expect(bySlug).toEqual({ "media.episode.discovered": 1 });
	});

	it("fires both season-count and episode-discovered when a season and its episodes arrive together", async () => {
		const showName = `Both Fire Show ${crypto.randomUUID()}`;
		const seasonOne = `s1-${crypto.randomUUID()}`;
		const seasonTwo = `s2-${crypto.randomUUID()}`;
		const baseTree = singleSeasonTree(showName, seasonOne, [`s1e1-${crypto.randomUUID()}`]);
		const show = await seedMonitoredShow(baseTree);

		const changedTree = withAddedSeason(baseTree, {
			seasonNumber: 2,
			name: "Season 2",
			externalId: seasonTwo,
			episodes: [
				{
					episodeNumber: 1,
					publishDate: "2021-01-01",
					name: "Season 2 Episode 1",
					externalId: `s2e1-${crypto.randomUUID()}`,
				},
			],
		});
		await show.refresh(changedTree);
		const changed = await runInfrequentCron();
		await waitForProviderRefresh(changed.executionId, show.showEntityId);

		const seasonSignal = await pollUntil("season-count signal", () =>
			querySignalBySlug({
				slug: "media.season-count.changed",
				subjectEntityId: show.showEntityId,
				correlationId: changed.executionId,
			}),
		);
		expect(seasonSignal.properties).toEqual({ entityName: showName, oldCount: 1, newCount: 2 });

		const discoverySignal = await pollUntil("episode-discovered signal", () =>
			querySignalBySlug({
				slug: "media.episode.discovered",
				subjectEntityId: show.showEntityId,
				correlationId: changed.executionId,
			}),
		);
		expect(discoverySignal.properties).toEqual({
			oldCount: 0,
			newCount: 1,
			seasonNumber: 2,
			discoveredCount: 1,
			entityName: showName,
		});

		const bySlug = await countSignalsBySlug({
			subjectEntityId: show.showEntityId,
			correlationId: changed.executionId,
		});
		expect(bySlug).toEqual({
			"media.season-count.changed": 1,
			"media.episode.discovered": 1,
		});
	});

	it("discovers a new episode without hiding sibling episode changes", async () => {
		const showName = `Siblings Show ${crypto.randomUUID()}`;
		const seasonOne = `s1-${crypto.randomUUID()}`;
		const existingEpisode = `s1e1-${crypto.randomUUID()}`;
		const otherEpisode = `s1e2-${crypto.randomUUID()}`;
		const newEpisode = `s1e3-${crypto.randomUUID()}`;
		const baseTree = singleSeasonTree(showName, seasonOne, [existingEpisode, otherEpisode]);
		const show = await seedMonitoredShow(baseTree);

		let changedTree = withAddedEpisode(baseTree, seasonOne, {
			episodeNumber: 3,
			name: "Episode 3",
			externalId: newEpisode,
			publishDate: "2020-03-01",
		});
		changedTree = withRenamedEpisode(changedTree, existingEpisode, "Episode 1 Renamed");
		changedTree = withBumpedEpisode(changedTree, existingEpisode, { publishDate: "2020-06-01" });
		await show.refresh(changedTree);
		const changed = await runInfrequentCron();
		await waitForProviderRefresh(changed.executionId, show.showEntityId);

		const discoverySignal = await pollUntil("episode-discovered signal", () =>
			querySignalBySlug({
				slug: "media.episode.discovered",
				subjectEntityId: show.showEntityId,
				correlationId: changed.executionId,
			}),
		);
		expect(discoverySignal.properties).toEqual({
			oldCount: 2,
			newCount: 3,
			seasonNumber: 1,
			discoveredCount: 1,
			entityName: showName,
		});

		const nameSignal = await pollUntil("existing episode name signal", () =>
			querySignalBySlug({
				slug: "media.episode.name.changed",
				subjectEntityId: show.showEntityId,
				correlationId: changed.executionId,
			}),
		);
		expect(nameSignal.properties).toEqual({
			seasonNumber: 1,
			episodeNumber: 1,
			oldName: "Episode 1",
			entityName: showName,
			newName: "Episode 1 Renamed",
		});

		const dateSignal = await pollUntil("existing episode date signal", () =>
			querySignalBySlug({
				slug: "media.release-date.changed",
				subjectEntityId: show.showEntityId,
				correlationId: changed.executionId,
			}),
		);
		expect(dateSignal.properties).toEqual({
			seasonNumber: 1,
			episodeNumber: 1,
			entityName: showName,
			oldDate: "2020-01-01",
			newDate: "2020-06-01",
			changeKind: "episode_date",
		});

		const bySlug = await countSignalsBySlug({
			subjectEntityId: show.showEntityId,
			correlationId: changed.executionId,
		});
		expect(bySlug).toEqual({
			"media.episode.discovered": 1,
			"media.episode.name.changed": 1,
			"media.release-date.changed": 1,
		});
	});
});
