import { describe, expect, it } from "vitest";

import {
	chooseBestMetadataLookupTitleMatch,
	type MetadataLookupTitleMatchCandidate,
} from "./title-matching";

const candidate = (
	overrides: Partial<MetadataLookupTitleMatchCandidate>,
): MetadataLookupTitleMatchCandidate => ({
	externalId: "1",
	publishYear: 2005,
	title: "The Office",
	scriptSlug: "show.tmdb",
	entitySchemaSlug: "show",
	...overrides,
});

describe("chooseBestMetadataLookupTitleMatch", () => {
	it("rejects unrelated candidates", () => {
		expect(
			chooseBestMetadataLookupTitleMatch({
				title: "Completely Unknown Export Row",
				results: [candidate({ title: "The Office" })],
			}),
		).toBeUndefined();
	});

	it("prefers an exact token match over a longer partial match", () => {
		const match = chooseBestMetadataLookupTitleMatch({
			title: "Dune (2021)",
			results: [
				candidate({
					publishYear: 2024,
					externalId: "partial",
					title: "Dune: Part Two",
					scriptSlug: "movie.tmdb",
					entitySchemaSlug: "movie",
				}),
				candidate({
					title: "Dune",
					publishYear: 2021,
					externalId: "exact",
					scriptSlug: "movie.tmdb",
					entitySchemaSlug: "movie",
				}),
			],
		});

		expect(match?.externalId).toBe("exact");
	});

	it("prefers show matches when the title carries episode indicators", () => {
		const match = chooseBestMetadataLookupTitleMatch({
			title: "The Gentlemen: Season 1: The Gospel According to Bobby Glass",
			results: [
				candidate({
					externalId: "movie_1",
					title: "The Gentlemen",
					scriptSlug: "movie.tmdb",
					entitySchemaSlug: "movie",
				}),
				candidate({ title: "The Gentlemen", externalId: "show_1" }),
			],
		});

		expect(match?.externalId).toBe("show_1");
	});
});
