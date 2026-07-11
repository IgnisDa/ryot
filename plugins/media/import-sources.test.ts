import { expect, it } from "vitest";

import { mediaPlugin } from "./manifest";

it("declares the complex file-backed import artifacts and config requirements", () => {
	const sources = new Map(mediaPlugin.importSources.map((source) => [source.slug, source]));
	expect(sources.get("netflix")).toEqual({
		lot: "single",
		input: "file",
		slug: "netflix",
		name: "Netflix",
		workflowSlug: "import",
		allowedFileExtensions: ["zip"],
		requiredAppConfigKeys: ["moviesAndShows.tmdbAccessToken"],
		description: "Import viewing activity, ratings, and watchlist entries from Netflix",
	});
	expect(sources.get("movary")).toMatchObject({
		lot: "named",
		requiredAppConfigKeys: ["moviesAndShows.tmdbAccessToken"],
		artifacts: [
			{
				required: true,
				key: "historyFilePath",
				allowedFileExtensions: ["csv"],
				uploadTokenField: "historyUploadToken",
			},
			{
				required: true,
				key: "ratingsFilePath",
				allowedFileExtensions: ["csv"],
				uploadTokenField: "ratingsUploadToken",
			},
			{
				required: true,
				key: "watchlistFilePath",
				allowedFileExtensions: ["csv"],
				uploadTokenField: "watchlistUploadToken",
			},
		],
	});
	expect(sources.get("myanimelist")).toMatchObject({
		lot: "named",
		requiredAppConfigKeys: ["animeAndManga.malClientId"],
		artifacts: [
			{
				required: false,
				key: "animeFilePath",
				allowedFileExtensions: ["gz", "xml"],
				uploadTokenField: "animeUploadToken",
			},
			{
				required: false,
				key: "mangaFilePath",
				allowedFileExtensions: ["gz", "xml"],
				uploadTokenField: "mangaUploadToken",
			},
		],
	});
});

it("declares credentialed sources as payload imports", () => {
	const sources = new Map(mediaPlugin.importSources.map((source) => [source.slug, source]));
	expect(sources.get("trakt")).toEqual({
		slug: "trakt",
		name: "Trakt",
		input: "payload",
		workflowSlug: "import",
		requiredAppConfigKeys: ["server.traktClientId"],
		description:
			"Import movies, shows, history, ratings, watchlist, lists, and ownership from Trakt",
	});
	for (const slug of ["jellyfin", "plex", "audiobookshelf", "media_tracker"] as const) {
		expect(sources.get(slug)).toMatchObject({ input: "payload", slug, workflowSlug: "import" });
	}
});
