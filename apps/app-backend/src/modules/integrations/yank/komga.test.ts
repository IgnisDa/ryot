import { describe, expect, it } from "vitest";

import { extractMangaRef } from "./komga";

describe("extractMangaRef", () => {
	it("maps an AniList manga link to a resolved manga.anilist ref", () => {
		const ref = extractMangaRef(
			[{ label: "AniList", url: "https://anilist.co/manga/30002" }],
			"Berserk",
		);

		expect(ref).toEqual({
			kind: "resolved",
			externalId: "30002",
			sourceLabel: "Berserk",
			entitySchemaSlug: "manga",
			scriptSlug: "manga.anilist",
		});
	});

	it("maps a MyAnimeList link to manga.myanimelist", () => {
		const ref = extractMangaRef(
			[{ label: "MyAnimeList", url: "https://myanimelist.net/manga/2/Berserk" }],
			"Berserk",
		);

		expect(ref).toMatchObject({ scriptSlug: "manga.myanimelist", externalId: "2" });
	});

	it("maps a MangaUpdates link to manga.manga-updates", () => {
		const ref = extractMangaRef(
			[{ label: "MangaUpdates", url: "https://www.mangaupdates.com/series/abc123/berserk" }],
			"Berserk",
		);

		expect(ref).toMatchObject({ scriptSlug: "manga.manga-updates", externalId: "abc123" });
	});

	it("returns null for links without a supported manga resolver", () => {
		const ref = extractMangaRef(
			[{ label: "Hardcover", url: "https://hardcover.app/books/berserk" }],
			"Berserk",
		);

		expect(ref).toBeNull();
	});

	it("returns null when there are no links", () => {
		expect(extractMangaRef([], "Berserk")).toBeNull();
	});
});
