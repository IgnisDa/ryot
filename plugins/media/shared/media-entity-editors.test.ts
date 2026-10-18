import { expect, it } from "@effect/vitest";

import { mediaChildCreateInput, mediaChildCreateSearch } from "./media-entity-editors";

const searchOf = (values: Readonly<Record<string, string>>) => ({
	get: (key: string) => values[key] ?? null,
});

it("round-trips a child's parent and starting numbers through its create route", () => {
	const search = mediaChildCreateSearch("season-1", { seasonNumber: 2, episodeNumber: 5 });
	expect(search).toEqual({ seasonNumber: "2", parent: "season-1", episodeNumber: "5" });
	expect(mediaChildCreateInput("show-episode", searchOf(search))).toEqual({
		parents: { "show-season-to-show-episode": "season-1" },
		initialProperties: { seasonNumber: 2, episodeNumber: 5 },
	});
});

it("ignores parents for root schemas and malformed starting numbers", () => {
	expect(mediaChildCreateInput("movie", searchOf({ parent: "show-1" }))).toEqual({});
	expect(mediaChildCreateInput("show-season", searchOf({}))).toEqual({});
	expect(
		mediaChildCreateInput(
			"show-season",
			searchOf({ parent: "show-1", seasonNumber: "-1", episodeNumber: "1.5" }),
		),
	).toEqual({ initialProperties: {}, parents: { "show-to-show-season": "show-1" } });
});
