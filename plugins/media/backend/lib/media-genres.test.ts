import { expect, it } from "@effect/vitest";

import { mediaGenreGroups } from "./media-genres";

it("deduplicates genre aliases into shared provider identities", () => {
	expect(mediaGenreGroups("movie", ["SCI-FI", "Science Fiction", "Drama", " "])).toEqual([
		{
			direction: "outgoing",
			synchronization: "authoritative",
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
			relationshipSchemaSlug: "book-to-genre",
		},
	]);
});
