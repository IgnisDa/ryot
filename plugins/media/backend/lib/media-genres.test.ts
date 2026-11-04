import { expect } from "bun:test";

import { it } from "@voila.dev/effect-bun-test";

import { mediaGenreGroups } from "./media-genres";

it("deduplicates genre aliases into shared provider identities", () => {
	expect(mediaGenreGroups("movie", ["SCI-FI", "Science Fiction", "Drama", " "])).toEqual([
		{
			direction: "outgoing",
			synchronization: "authoritative",
			coverage: { status: "complete" },
			relationshipSchemaSlug: "movie-to-genre",
			entities: [
				{
					name: "Science Fiction",
					externalId: "science fiction",
					providerSlug: "genre.media-catalog",
				},
				{ name: "Drama", externalId: "drama", providerSlug: "genre.media-catalog" },
			],
		},
	]);
});

it("emits an authoritative empty group for successful empty genres", () => {
	expect(mediaGenreGroups("book", [])).toEqual([
		{
			entities: [],
			direction: "outgoing",
			synchronization: "authoritative",
			coverage: { status: "complete" },
			relationshipSchemaSlug: "book-to-genre",
		},
	]);
});
