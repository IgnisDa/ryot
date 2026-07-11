import { describe, expect, it } from "vitest";

import {
	chooseBestMetadataLookupTitleMatch,
	type MetadataLookupTitleMatchCandidate,
} from "../shared/title-matching";

const candidate = (
	overrides: Partial<MetadataLookupTitleMatchCandidate>,
): MetadataLookupTitleMatchCandidate => ({
	externalId: "1",
	publishYear: 2016,
	title: "The Crown",
	providerSlug: "show.tmdb",
	entitySchemaSlug: "show",
	...overrides,
});

describe("chooseBestMetadataLookupTitleMatch", () => {
	it("rejects unrelated search candidates", () => {
		expect(
			chooseBestMetadataLookupTitleMatch({
				title: "Completely Unknown Export Row",
				results: [candidate({ title: "The Crown" })],
			}),
		).toBeUndefined();
	});

	it("prefers show matches for titles with season indicators", () => {
		const match = chooseBestMetadataLookupTitleMatch({
			title: "The Gentlemen: Season 1: The Gospel According to Bobby Glass",
			results: [
				candidate({
					externalId: "movie_1",
					title: "The Gentlemen",
					providerSlug: "movie.tmdb",
					entitySchemaSlug: "movie",
				}),
				candidate({ title: "The Gentlemen", externalId: "show_1" }),
			],
		});
		expect(match?.externalId).toBe("show_1");
	});
});
