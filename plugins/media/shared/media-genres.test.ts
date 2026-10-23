import { describe, expect, it } from "@effect/vitest";

import { mediaGenre, recognizedMediaGenres } from "./media-genres";

describe("genre identity", () => {
	it("shares aliases, case and whitespace without stripping meaningful characters", () => {
		expect(mediaGenre("  SCI-FI ")).toEqual({
			name: "Science Fiction",
			externalId: "science fiction",
		});
		expect(mediaGenre("Science   Fiction")).toEqual(mediaGenre("sci fi"));
		expect(mediaGenre("Action & Adventure")).toEqual({
			name: "Action & Adventure",
			externalId: "action & adventure",
		});
		expect(mediaGenre("RPG")?.name).toBe("RPG");
		expect(mediaGenre("C++")).not.toEqual(mediaGenre("C"));
		expect(mediaGenre(" ")).toBeNull();
		expect(mediaGenre("constructor")).toEqual({ name: "Constructor", externalId: "constructor" });
	});
	it("round trips Unicode identities and admits only recognized broad classifications", () => {
		expect(mediaGenre("Cafe\u0301")).toEqual(mediaGenre("Café"));
		const genre = mediaGenre("Étrange Fiction");
		expect(genre === null ? null : mediaGenre(genre.externalId)).toEqual(genre);
		expect(recognizedMediaGenres(["Fantasy", "Best Seller", "Space", "sci-fi"])).toEqual([
			"Fantasy",
			"Science Fiction",
		]);
	});
});
