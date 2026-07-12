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
		requiredPluginConfigKeys: ["tmdbAccessToken"],
		description: "Import viewing activity, ratings, and watchlist entries from Netflix",
	});
	expect(sources.get("movary")).toMatchObject({
		lot: "named",
		requiredPluginConfigKeys: ["tmdbAccessToken"],
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
		requiredPluginConfigKeys: ["malClientId"],
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
	expect(sources.get("trakt")).toMatchObject({
		lot: "named",
		input: "file",
		requiredPluginConfigKeys: [],
		artifacts: [
			{
				required: false,
				key: "exportFilePath",
				allowedFileExtensions: ["zip"],
				uploadTokenField: "exportUploadToken",
			},
		],
	});
});

it("declares credentialed sources as payload imports", () => {
	const sources = new Map(mediaPlugin.importSources.map((source) => [source.slug, source]));
	for (const slug of ["jellyfin", "plex", "audiobookshelf", "media_tracker"] as const) {
		expect(sources.get(slug)).toMatchObject({ input: "payload", slug, workflowSlug: "import" });
	}
});
