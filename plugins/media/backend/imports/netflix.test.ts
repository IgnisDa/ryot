import { expect, it } from "vitest";

import { adaptNetflixCsv } from "./netflix";

const importedAt = "2026-01-01T00:00:00.000Z";
it("captures unresolved Netflix titles and episode coordinates without provider enrichment", () => {
	const result = adaptNetflixCsv({
		importedAt,
		file: "ViewingActivity.csv",
		text: 'Title,Start Time,Profile Name\n"Dark: Season 1: Secrets (Episode 1)",2026-01-03 12:00:00,Main',
	});
	expect(result.failures).toEqual([]);
	expect(result.entityGroups[0]?.entityRef).toMatchObject({
		kind: "unresolved",
		identifierValue: "Dark",
		entitySchemaSlug: "show",
		identifierType: "netflix-title",
	});
	expect(result.entityGroups[0]?.events[0]).toMatchObject({
		eventSchemaSlug: "progress",
		occurredAt: "2026-01-03T12:00:00.000Z",
		unresolvedEpisode: { type: "show", seasonNumber: 1, episodeNumber: 1 },
	});
});
it("filters profiles, trailers, and supplemental viewing rows before producing events", () => {
	const result = adaptNetflixCsv({
		importedAt,
		profileName: "Main",
		file: "ViewingActivity.csv",
		text: "Title,Start Time,Profile Name,Supplemental Video Type,Attributes\nMovie,2026-01-03 12:00:00,Other,,\nTrailer: Movie,2026-01-03 12:00:00,Main,,\nMovie,2026-01-03 12:00:00,Main,HOOK,\nMovie,2026-01-03 12:00:00,Main,,Autoplayed: user action: None;\nMovie,2026-01-03 12:00:00,Main,,",
	});
	expect(result.entityGroups).toHaveLength(1);
	expect(result.entityGroups[0]?.itemIndex).toBe(4);
	expect(result.entityGroups[0]?.events).toHaveLength(1);
});
it("keeps malformed rows out of entity groups and preserves their source indices", () => {
	const result = adaptNetflixCsv({
		importedAt,
		file: "ViewingActivity.csv",
		text: "Title,Start Time,Profile Name\nBad,not a date,Main\nGood,2026-01-03 12:00:00,Main",
	});
	expect(result.failures).toEqual([
		{ itemIndex: 0, sourceLabel: "Bad", sourceIdentifier: "Bad", message: "Start Time is invalid" },
	]);
	expect(result.entityGroups.map((group) => group.itemIndex)).toEqual([1]);
});
it("normalizes stars and thumbs and skips empty ratings without library writes", () => {
	const result = adaptNetflixCsv({
		importedAt,
		file: "Ratings.csv",
		text: "Title Name,Profile Name,Star Value,Thumbs Value\nStars,Main,4,\nThumbs,Main,,2\nEmpty,Main,,0",
	});
	expect(result.entityGroups.map((group) => group.events[0]?.properties["rating"])).toEqual([
		80, 67,
	]);
	expect(result.entityGroups.every((group) => group.events[0]?.occurredAt === importedAt)).toBe(
		true,
	);
});
it("captures MyList backlog events at the admitted import timestamp", () => {
	const result = adaptNetflixCsv({
		importedAt,
		file: "MyList.csv",
		text: "Title Name,Profile Name\nMovie,Main",
	});
	expect(result.entityGroups[0]?.events).toEqual([
		{ properties: {}, occurredAt: importedAt, eventSchemaSlug: "backlog" },
	]);
});
