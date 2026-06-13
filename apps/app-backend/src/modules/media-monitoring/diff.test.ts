import { assert, describe, expect, it } from "vitest";

import { diffMediaMonitoringSnapshots, type MediaMonitoringSnapshot } from "./diff";

const snapshot = (overrides: Partial<MediaMonitoringSnapshot> = {}): MediaMonitoringSnapshot => ({
	seasons: [],
	properties: {},
	name: "Example",
	associations: [],
	entityId: "entity",
	podcastEpisodes: [],
	entityKind: "media",
	animeEpisodes: null,
	mangaChapters: null,
	entitySchemaSlug: "movie",
	populatedAt: "2026-01-01T00:00:00.000Z",
	...overrides,
});

describe("diffMediaMonitoringSnapshots", () => {
	it("uses incomplete snapshots as a silent baseline", () => {
		const before = snapshot({ populatedAt: null });
		const after = snapshot({ properties: { productionStatus: "Ended" } });

		expect(diffMediaMonitoringSnapshots(before, after)).toEqual([]);
		expect(diffMediaMonitoringSnapshots(after, { ...after, populatedAt: null })).toEqual([]);
	});

	it("reports only populated root scalar values and ignores root publish dates", () => {
		const before = snapshot({
			properties: { productionStatus: "Continuing", publishDate: "2025-01-01", publishYear: 2025 },
		});
		const after = snapshot({
			properties: { productionStatus: "Ended", publishDate: "2026-01-01", publishYear: 2026 },
		});

		expect(diffMediaMonitoringSnapshots(before, after)).toMatchObject([
			{
				eventType: "metadata_status_changed",
				message: "Status of Example changed from Continuing to Ended",
			},
			{
				eventType: "metadata_release_date_changed",
				message: "Publish year changed from 2025 to 2026 for Example",
			},
		]);
		expect(
			diffMediaMonitoringSnapshots(snapshot(), snapshot({ properties: { publishYear: 2026 } })),
		).toEqual([]);
	});

	it("suppresses show episode details when season counts change", () => {
		const before = snapshot({
			entitySchemaSlug: "show",
			seasons: [{ episodes: [], seasonNumber: 1, name: "Season 1", externalId: "season-1" }],
		});
		const after = snapshot({
			entitySchemaSlug: "show",
			seasons: [
				...before.seasons,
				{ externalId: "season-2", name: "Season 2", seasonNumber: 2, episodes: [] },
			],
		});

		expect(diffMediaMonitoringSnapshots(before, after).map((change) => change.eventType)).toEqual([
			"metadata_number_of_seasons_changed",
		]);
	});

	it("matches reordered show seasons and episodes by provider identity", () => {
		const episode = {
			name: "Pilot",
			episodeNumber: 1,
			externalId: "episode-1",
			publishDate: "2026-01-01",
			images: [{ type: "remote", url: "https://example.com/a.jpg" }],
		};
		const before = snapshot({
			entitySchemaSlug: "show",
			seasons: [
				{ externalId: "season-1", name: "Season 1", seasonNumber: 1, episodes: [episode] },
				{ externalId: "season-2", name: "Season 2", seasonNumber: 2, episodes: [] },
			],
		});
		const after = snapshot({
			entitySchemaSlug: "show",
			seasons: [
				{ externalId: "season-2", name: "Season 2", seasonNumber: 2, episodes: [] },
				{
					seasonNumber: 1,
					name: "Season 1",
					externalId: "season-1",
					episodes: [
						{
							...episode,
							name: "Premiere",
							publishDate: "2026-02-01",
							images: [{ url: "https://example.com/a.jpg", type: "remote" }],
						},
					],
				},
			],
		});

		const changes = diffMediaMonitoringSnapshots(before, after);
		expect(changes.map((change) => change.eventType)).toEqual([
			"metadata_episode_name_changed",
			"metadata_release_date_changed",
		]);
		expect(changes[0]?.fingerprint).toBe(
			diffMediaMonitoringSnapshots(before, after)[0]?.fingerprint,
		);
	});

	it("skips special-season details and suppresses details when an episode count changes", () => {
		const specialBefore = snapshot({
			entitySchemaSlug: "show",
			seasons: [
				{
					seasonNumber: 0,
					name: "Specials",
					externalId: "specials",
					episodes: [
						{
							images: [],
							name: "Old",
							episodeNumber: 1,
							publishDate: null,
							externalId: "special-1",
						},
					],
				},
			],
		});
		const specialSeason = specialBefore.seasons[0];
		assert(specialSeason);
		const specialEpisode = specialSeason.episodes[0];
		assert(specialEpisode);
		const specialAfter = snapshot({
			entitySchemaSlug: "show",
			seasons: [{ ...specialSeason, episodes: [{ ...specialEpisode, name: "New" }] }],
		});
		expect(diffMediaMonitoringSnapshots(specialBefore, specialAfter)).toEqual([]);

		const countAfter = snapshot({
			entitySchemaSlug: "show",
			seasons: [
				{
					...specialSeason,
					seasonNumber: 1,
					name: "Season 1",
					externalId: "season-1",
					episodes: [
						...specialSeason.episodes,
						{
							images: [],
							name: "Second",
							episodeNumber: 2,
							publishDate: null,
							externalId: "episode-2",
						},
					],
				},
			],
		});
		const countSeason = countAfter.seasons[0];
		assert(countSeason);
		const countBefore = { ...countAfter, seasons: [{ ...countSeason, episodes: [] }] };
		expect(
			diffMediaMonitoringSnapshots(countBefore, countAfter).map((change) => change.eventType),
		).toEqual(["metadata_episode_released"]);
	});

	it("reports anime, manga, and podcast changes by their normalized identities", () => {
		expect(
			diffMediaMonitoringSnapshots(
				snapshot({ animeEpisodes: 12, entitySchemaSlug: "anime" }),
				snapshot({ animeEpisodes: 13, entitySchemaSlug: "anime" }),
			).map((change) => change.eventType),
		).toEqual(["metadata_chapters_or_episodes_changed"]);
		expect(
			diffMediaMonitoringSnapshots(
				snapshot({ entitySchemaSlug: "manga", mangaChapters: 10 }),
				snapshot({ entitySchemaSlug: "manga", mangaChapters: 11 }),
			).map((change) => change.eventType),
		).toEqual(["metadata_chapters_or_episodes_changed"]);

		const podcastBefore = snapshot({
			entitySchemaSlug: "podcast",
			podcastEpisodes: [
				{
					name: "Old",
					images: ["old"],
					episodeNumber: 1,
					publishDate: null,
					externalId: "podcast-1",
				},
			],
		});
		const podcastEpisode = podcastBefore.podcastEpisodes[0];
		assert(podcastEpisode);
		const podcastAfter = snapshot({
			entitySchemaSlug: "podcast",
			podcastEpisodes: [{ ...podcastEpisode, name: "New", images: ["new"] }],
		});
		expect(
			diffMediaMonitoringSnapshots(podcastBefore, podcastAfter).map((change) => change.eventType),
		).toEqual(["metadata_episode_name_changed", "metadata_episode_images_changed"]);
	});

	it("emits distinct association changes once and emits again after removal", () => {
		const before = snapshot({ entityKind: "company" });
		const associated = snapshot({
			entityKind: "company",
			associations: [
				{ id: "media:one", kind: "metadata", name: "Film", role: "Publisher" },
				{ id: "media:one", kind: "metadata", name: "Film", role: "Publisher" },
				{ id: "group:one", kind: "group", name: "Series", role: "Publisher" },
			],
		});
		expect(
			diffMediaMonitoringSnapshots(before, associated).map((change) => change.eventType),
		).toEqual(["company_metadata_associated", "company_metadata_group_associated"]);
		expect(diffMediaMonitoringSnapshots(associated, associated)).toEqual([]);
		expect(diffMediaMonitoringSnapshots(snapshot({ entityKind: "person" }), associated)).toEqual([
			expect.objectContaining({ eventType: "company_metadata_associated" }),
			expect.objectContaining({ eventType: "company_metadata_group_associated" }),
		]);
		const removed = { ...associated, associations: [] };
		expect(diffMediaMonitoringSnapshots(removed, associated)).toHaveLength(2);
	});
});
