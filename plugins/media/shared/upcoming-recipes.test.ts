import { describe, expect, it } from "bun:test";

import {
	savedViewDataSourceAccess,
	validateRyotQLDocument,
} from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { Result } from "@ryot-app/plugin-kit/effect";
import { bindRecipe, rowsResult } from "@ryot-app/ryotql-recipes/test-utils";

import { upcomingRecipe } from "./upcoming-recipes";

const identity = (id: string, schemaSlug: string) => ({
	id,
	schemaSlug,
	images: null,
	name: `Media ${id}`,
	translationStatus: { state: "idle", availability: "none" },
	populationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
});
const episodeRow = (
	title: string,
	id: string,
	publishDate: string,
	episodeNumber: number,
	onePerTitle = true,
) => ({
	...identity(title, "show"),
	onePerTitle,
	publishDate,
	episodeNumber,
	seasonNumber: 2,
	occurrenceId: id,
	occurrenceImages: null,
});

const page = (items: readonly unknown[]) =>
	rowsResult(items, { limit: 20, hasMore: false, nextCursor: null });

const totals = (items: readonly { readonly id: string; readonly total: number }[]) => ({
	items,
	type: "aggregate",
	pageInfo: { limit: 1000, hasMore: false, nextCursor: null },
});
const included = (items: readonly unknown[]) => ({ items, pageInfo: { limit: 1, hasMore: false } });
const recipe = (onePerTitle: boolean) =>
	bindRecipe(upcomingRecipe({ reference: { kind: "self" } }), { onePerTitle });
describe("upcoming recipe", () => {
	it.each([true, false])("validates the document with onePerTitle=%s", (onePerTitle) => {
		expect(
			validateRyotQLDocument(recipe(onePerTitle).document, savedViewDataSourceAccess).error,
		).toBeNull();
	});

	it("normalizes every source to titles with dated occurrences", () => {
		const decoded = recipe(true).decode({
			data: {
				podcasts: page([]),
				podcastTotals: totals([]),
				releases: page([{ ...identity("movie-1", "movie"), publishDate: "2026-09-10" }]),
				showTotals: totals([
					{ total: 5, id: "show-1" },
					{ total: 1, id: "show-2" },
				]),
				shows: page([
					episodeRow("show-2", "episode-9", "2026-09-04", 9),
					episodeRow("show-1", "episode-3", "2026-09-04", 3),
					episodeRow("show-1", "episode-4", "2026-09-11", 4),
				]),
				anime: page([
					{
						...identity("anime-1", "anime"),
						total: 1,
						onePerTitle: true,
						occurrences: included([{ episodeNumber: 4, airingAt: "2026-09-03T15:00:00.000Z" }]),
					},
				]),
			},
		});

		expect(Result.getOrThrow(decoded)).toEqual<unknown>([
			{
				total: 5,
				entity: identity("show-1", "show"),
				occurrences: [
					{
						images: null,
						dateOnly: true,
						key: "episode-3",
						airsAt: "2026-09-04",
						episode: { seasonNumber: 2, episodeNumber: 3 },
					},
				],
			},
			{
				total: 1,
				entity: identity("show-2", "show"),
				occurrences: [
					{
						images: null,
						dateOnly: true,
						key: "episode-9",
						airsAt: "2026-09-04",
						episode: { seasonNumber: 2, episodeNumber: 9 },
					},
				],
			},
			{
				total: 1,
				entity: identity("anime-1", "anime"),
				occurrences: [
					{
						images: null,
						dateOnly: false,
						airsAt: "2026-09-03T15:00:00.000Z",
						key: "anime-1:4:2026-09-03T15:00:00.000Z",
						episode: { episodeNumber: 4, seasonNumber: null },
					},
				],
			},
			{
				total: 1,
				entity: identity("movie-1", "movie"),
				occurrences: [
					{ images: null, episode: null, dateOnly: true, key: "movie-1", airsAt: "2026-09-10" },
				],
			},
		]);
	});

	it("lists every occurrence and caps titles when not one per title", () => {
		const decoded = bindRecipe(upcomingRecipe({ reference: { kind: "self" } }), {
			onePerTitle: false,
		}).decode({
			data: {
				anime: page([]),
				podcasts: page([]),
				releases: page([]),
				showTotals: totals([]),
				podcastTotals: totals([]),
				shows: page([
					...Array.from({ length: 21 }, (_, index) =>
						episodeRow(`show-${index + 1}`, `episode-${index + 3}`, "2026-09-04", 3, false),
					),
					episodeRow("show-1", "episode-4", "2026-09-05", 4, false),
				]),
			},
		});

		expect(
			Result.getOrThrow(decoded).map(({ total, entity, occurrences }) => [
				entity.id,
				total,
				occurrences.map(({ key }) => key),
			]),
		).toHaveLength(20);
		expect(Result.getOrThrow(decoded).find(({ entity }) => entity.id === "show-1")).toMatchObject({
			total: 2,
			occurrences: [{ key: "episode-3" }, { key: "episode-4" }],
		});
	});
});
