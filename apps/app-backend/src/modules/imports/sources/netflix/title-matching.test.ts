import { describe, expect, it } from "bun:test";

import { chooseBestNetflixTitleMatch, type NetflixTitleMatchCandidate } from "./title-matching";

const candidate = (overrides: Partial<NetflixTitleMatchCandidate>): NetflixTitleMatchCandidate => ({
	title: "The Crown",
	externalId: "1",
	publishYear: 2016,
	scriptSlug: "show.tmdb",
	entitySchemaSlug: "show",
	...overrides,
});

describe("chooseBestNetflixTitleMatch", () => {
	it("rejects unrelated search candidates", () => {
		expect(
			chooseBestNetflixTitleMatch({
				title: "Completely Unknown Export Row",
				results: [candidate({ title: "The Crown" })],
			}),
		).toBeUndefined();
	});

	it("prefers show matches for titles with season indicators", () => {
		const match = chooseBestNetflixTitleMatch({
			title: "The Gentlemen: Season 1: The Gospel According to Bobby Glass",
			results: [
				candidate({
					title: "The Gentlemen",
					externalId: "movie_1",
					scriptSlug: "movie.tmdb",
					entitySchemaSlug: "movie",
				}),
				candidate({ title: "The Gentlemen", externalId: "show_1" }),
			],
		});

		expect(match?.externalId).toBe("show_1");
	});
});
