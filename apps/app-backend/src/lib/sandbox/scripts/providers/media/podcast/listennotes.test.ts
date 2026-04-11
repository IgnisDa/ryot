import { describe, expect, it } from "bun:test";
import listennotesScriptCode from "./listennotes.txt";

type DriverFunction = (context?: Record<string, unknown>) => Promise<unknown>;

const buildScriptRuntime = (hostFunctions: Record<string, unknown> = {}) => {
	const driverRegistry: Record<string, DriverFunction> = {};
	const driver = (name: string, fn: DriverFunction) => {
		driverRegistry[name] = fn;
	};

	const factory = new Function(
		"driver",
		`return (async function sandboxMain(${Object.keys(hostFunctions).join(", ")}, context) {\n${listennotesScriptCode}\n});`,
	);
	const sandboxMain = factory(driver) as (
		...args: Array<unknown>
	) => Promise<unknown>;

	return {
		drivers: driverRegistry,
		execute: (context?: Record<string, unknown>) =>
			sandboxMain(...Object.values(hostFunctions), context ?? {}),
	};
};

describe("ListenNotes sandbox provider", () => {
	it("uses the podcast recommendations endpoint in details", async () => {
		const urls: string[] = [];
		const runtime = buildScriptRuntime({
			getAppConfigValue: async () => ({ success: true, data: "token" }),
			getCachedValue: async () => ({ success: true, data: { 1: "Tech" } }),
			setCachedValue: async () => ({ success: true, data: null }),
			httpCall: async (_method: string, url: string) => {
				urls.push(url);
				if (url.includes("/podcasts/podcast-1/recommendations")) {
					return {
						success: true,
						data: {
							body: JSON.stringify({
								recommendations: [
									{
										id: "rec-1",
										title: "Similar Show",
										thumbnail: "https://img/1",
									},
								],
							}),
						},
					};
				}

				return {
					success: true,
					data: {
						body: JSON.stringify({
							title: "My Podcast",
							total_episodes: 1,
							genre_ids: [1],
							episodes: [
								{
									id: "ep-1",
									title: "Episode 1",
									pub_date_ms: 1704067200000,
									audio_length_sec: 600,
								},
							],
						}),
					},
				};
			},
		});

		await runtime.execute({ identifier: "podcast-1" });
		const detailsDriver = runtime.drivers.details;
		if (!detailsDriver) {
			throw new Error("details driver was not registered");
		}

		await expect(
			detailsDriver({ identifier: "podcast-1" }),
		).resolves.toMatchObject({
			name: "My Podcast",
			suggestions: [
				{ identifier: "rec-1", title: "Similar Show", image: "https://img/1" },
			],
		});

		expect(urls).toContain(
			"https://listen-api.listennotes.com/api/v2/podcasts/podcast-1/recommendations",
		);
	});

	it("paginates episodes using next_episode_pub_date and deduplicates repeated pages", async () => {
		const podcastUrls: string[] = [];
		const runtime = buildScriptRuntime({
			getAppConfigValue: async () => ({ success: true, data: "token" }),
			getCachedValue: async () => ({ success: true, data: { 1: "Tech" } }),
			setCachedValue: async () => ({ success: true, data: null }),
			httpCall: async (_method: string, url: string) => {
				if (url.includes("/recommendations")) {
					return {
						success: true,
						data: { body: JSON.stringify({ recommendations: [] }) },
					};
				}

				podcastUrls.push(url);
				if (url.endsWith("next_episode_pub_date=null")) {
					return {
						success: true,
						data: {
							body: JSON.stringify({
								title: "My Podcast",
								total_episodes: 3,
								genre_ids: [1],
								next_episode_pub_date: 1704153600000,
								episodes: [
									{
										id: "ep-1",
										title: "Episode 1",
										pub_date_ms: 1704067200000,
									},
									{
										id: "ep-2",
										title: "Episode 2",
										pub_date_ms: 1704153600000,
									},
								],
							}),
						},
					};
				}

				return {
					success: true,
					data: {
						body: JSON.stringify({
							title: "My Podcast",
							total_episodes: 3,
							genre_ids: [1],
							next_episode_pub_date: 1704153600000,
							episodes: [
								{ id: "ep-2", title: "Episode 2", pub_date_ms: 1704153600000 },
								{ id: "ep-3", title: "Episode 3", pub_date_ms: 1704240000000 },
							],
						}),
					},
				};
			},
		});

		await runtime.execute();
		const detailsDriver = runtime.drivers.details;
		if (!detailsDriver) {
			throw new Error("details driver was not registered");
		}

		const result = (await detailsDriver({
			identifier: "podcast-1",
		})) as {
			properties: { episodes: Array<{ id: string; number: number }> };
		};

		expect(
			result.properties.episodes.map((episode) => ({
				id: episode.id,
				number: episode.number,
			})),
		).toEqual([
			{ id: "ep-1", number: 1 },
			{ id: "ep-2", number: 2 },
			{ id: "ep-3", number: 3 },
		]);
		expect(podcastUrls).toEqual([
			"https://listen-api.listennotes.com/api/v2/podcasts/podcast-1?sort=oldest_first&next_episode_pub_date=null",
			"https://listen-api.listennotes.com/api/v2/podcasts/podcast-1?sort=oldest_first&next_episode_pub_date=1704153600000",
		]);
	});
});
