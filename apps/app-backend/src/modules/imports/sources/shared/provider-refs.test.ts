import { describe, expect, it } from "vitest";

import { buildMovieOrShowImportRef } from "./provider-refs";

describe("buildMovieOrShowImportRef", () => {
	it("prefers TMDB over IMDb and TVDB", () => {
		const ref = buildMovieOrShowImportRef({
			sourceLabel: "Inception",
			entitySchemaSlug: "movie",
			providerIds: { tmdb: "27205", imdb: "tt1375666", tvdb: "12345" },
		});
		expect(ref).toMatchObject({ kind: "resolved", externalId: "27205", scriptSlug: "movie.tmdb" });
	});

	it("falls back to IMDb when TMDB is absent", () => {
		const ref = buildMovieOrShowImportRef({
			sourceLabel: "Inception",
			entitySchemaSlug: "movie",
			providerIds: { imdb: "tt1375666" },
		});
		expect(ref).toMatchObject({
			kind: "unresolved",
			identifierType: "imdb",
			identifierValue: "tt1375666",
		});
	});

	it("falls back to TVDB when TMDB and IMDb are absent", () => {
		const ref = buildMovieOrShowImportRef({
			entitySchemaSlug: "show",
			sourceLabel: "Breaking Bad",
			providerIds: { tvdb: "81189" },
		});
		expect(ref).toMatchObject({ kind: "resolved", externalId: "81189", scriptSlug: "show.tvdb" });
	});

	it("returns undefined when all provider ids are absent", () => {
		const ref = buildMovieOrShowImportRef({
			providerIds: {},
			sourceLabel: "Unknown",
			entitySchemaSlug: "movie",
		});
		expect(ref).toBeUndefined();
	});

	it("treats whitespace-only provider ids as missing", () => {
		const ref = buildMovieOrShowImportRef({
			sourceLabel: "Inception",
			entitySchemaSlug: "movie",
			providerIds: { tmdb: "   ", imdb: "  ", tvdb: "  " },
		});
		expect(ref).toBeUndefined();
	});

	it("strips whitespace from provider ids", () => {
		const ref = buildMovieOrShowImportRef({
			sourceLabel: "Inception",
			entitySchemaSlug: "movie",
			providerIds: { tmdb: "  27205  " },
		});
		expect(ref).toMatchObject({ kind: "resolved", externalId: "27205" });
	});

	it("sets the correct script slug for show entity schema with TMDB", () => {
		const ref = buildMovieOrShowImportRef({
			entitySchemaSlug: "show",
			sourceLabel: "Breaking Bad",
			providerIds: { tmdb: "1396" },
		});
		expect(ref).toMatchObject({ scriptSlug: "show.tmdb", entitySchemaSlug: "show" });
	});

	it("includes the source label in the ref", () => {
		const ref = buildMovieOrShowImportRef({
			entitySchemaSlug: "movie",
			providerIds: { tmdb: "123" },
			sourceLabel: "My Movie Title",
		});
		expect(ref).toMatchObject({ sourceLabel: "My Movie Title" });
	});

	it("treats null provider ids as missing", () => {
		const ref = buildMovieOrShowImportRef({
			sourceLabel: "Test",
			entitySchemaSlug: "movie",
			providerIds: { tmdb: null, imdb: null, tvdb: null },
		});
		expect(ref).toBeUndefined();
	});
});
