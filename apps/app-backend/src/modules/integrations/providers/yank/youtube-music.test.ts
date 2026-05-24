import { describe, expect, it } from "bun:test";

import { fetchYoutubeMusicProgress } from "./youtube-music";

const MOCK_INPUT = {
	userId: "user1",
	timezone: "UTC",
	integrationId: "int1",
	authCookie: "SAPISID=abc123",
};

const createDeps = (songs: Array<{ videoId: string; title: string }>, claimed = true) => ({
	fetchTodaySongs: async () => Promise.resolve(songs),
	claimCacheKey: async () => Promise.resolve({ claimed }),
});

describe("fetchYoutubeMusicProgress", () => {
	it("emits progressPercent 35 for first sighting (cache claimed)", async () => {
		const result = await fetchYoutubeMusicProgress(
			MOCK_INPUT,
			createDeps([{ videoId: "vid1", title: "Song One" }], true),
		);

		expect(result.entityGroups).toHaveLength(1);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: {
				kind: "resolved",
				externalId: "vid1",
				entitySchemaSlug: "music",
				scriptSlug: "music.youtube-music",
			},
			events: [
				{
					eventSchemaSlug: "progress",
					properties: { progressPercent: 35, consumedOn: "youtube_music" },
				},
			],
		});
		expect(result.failures).toHaveLength(0);
	});

	it("emits progressPercent 100 for second sighting (cache not claimed)", async () => {
		const result = await fetchYoutubeMusicProgress(
			MOCK_INPUT,
			createDeps([{ videoId: "vid2", title: "Song Two" }], false),
		);

		expect(result.entityGroups[0]?.events[0]?.properties).toMatchObject({
			progressPercent: 100,
		});
	});

	it("uses videoId as cache key segment", async () => {
		const capturedKeys: string[] = [];
		const deps = {
			fetchTodaySongs: async () => Promise.resolve([{ videoId: "vid3", title: "Song Three" }]),
			claimCacheKey: async (key: string) => {
				capturedKeys.push(key);
				return Promise.resolve({ claimed: true });
			},
		};

		await fetchYoutubeMusicProgress(MOCK_INPUT, deps);

		expect(capturedKeys[0]).toContain("vid3");
		expect(capturedKeys[0]).toContain("user1");
		expect(capturedKeys[0]).toContain("int1");
	});

	it("returns empty result when no songs today", async () => {
		const result = await fetchYoutubeMusicProgress(MOCK_INPUT, createDeps([]));

		expect(result.entityGroups).toHaveLength(0);
		expect(result.failures).toHaveLength(0);
	});

	it("returns source_fetch failure when history fetch throws", async () => {
		const deps = {
			claimCacheKey: async () => Promise.resolve({ claimed: true }),
			fetchTodaySongs: () => {
				throw new Error("Auth failed");
			},
		};

		const result = await fetchYoutubeMusicProgress(MOCK_INPUT, deps);

		expect(result.entityGroups).toHaveLength(0);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toMatchObject({
			stage: "source_fetch",
			message: "Auth failed",
		});
	});
});
