import {
	savedViewDataSourceAccess,
	validateRyotQLDocument,
} from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { Result } from "@ryot-app/plugin-kit/effect";
import { rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { describe, expect, it } from "vitest";

import { animeAiringSoonRecipe, showsAiringSoonRecipe } from "./airing-recipes";

const identity = (id: string, schemaSlug: string) => ({
	id,
	schemaSlug,
	images: null,
	name: `Media ${id}`,
	populationStatus: "ready",
	translationStatus: "none",
});

const page = (items: readonly unknown[]) =>
	rowsResult(items, { limit: 20, hasMore: false, nextCursor: null });

const ANIME_INPUT = {
	fromDate: "2026-09-01",
	untilDate: "2026-09-15",
	now: "2026-09-01T09:30:00.000Z",
	until: "2026-09-16T00:00:00.000Z",
};

const decodeAnime = (row: Record<string, unknown>) =>
	Result.getOrThrow(
		animeAiringSoonRecipe(ANIME_INPUT).decode({
			data: { anime: page([{ ...identity("anime-1", "anime"), ...row }]) },
		}),
	);

describe("shows airing soon recipe", () => {
	it("validates the document", () => {
		const recipe = showsAiringSoonRecipe({ limit: 20, from: "2026-09-01", until: "2026-09-15" });
		expect(validateRyotQLDocument(recipe.document, savedViewDataSourceAccess)).toBeNull();
	});

	it("maps each show to its soonest episode and same-day count", () => {
		const decoded = showsAiringSoonRecipe({
			limit: 20,
			from: "2026-09-01",
			until: "2026-09-15",
		}).decode({
			data: {
				shows: page([
					{
						...identity("show-1", "show"),
						episode: {
							pageInfo: { limit: 1, hasMore: true },
							items: [
								{
									...identity("episode-3", "show-episode"),
									seasonNumber: 2,
									sameDayCount: 2,
									episodeNumber: 3,
									publishDate: "2026-09-04",
								},
							],
						},
					},
				]),
			},
		});

		expect(Result.getOrThrow(decoded)).toEqual([
			{
				sameDayCount: 2,
				entity: identity("show-1", "show"),
				episode: {
					...identity("episode-3", "show-episode"),
					seasonNumber: 2,
					episodeNumber: 3,
					publishDate: "2026-09-04",
				},
			},
		]);
	});
});

describe("anime airing soon recipe", () => {
	it("validates the document", () => {
		expect(
			validateRyotQLDocument(
				animeAiringSoonRecipe(ANIME_INPUT).document,
				savedViewDataSourceAccess,
			),
		).toBeNull();
	});

	it("labels the next episode and counts entries airing at the same instant", () => {
		const [anime] = decodeAnime({
			nextEpisode: 4,
			publishDate: "2026-04-01",
			nextAiringAt: "2026-09-03T15:00:00.000Z",
			airingSchedule: [
				{ episode: 3, airingAt: "2026-08-27T15:00:00.000Z" },
				{ episode: 4, airingAt: "2026-09-03T15:00:00Z" },
				{ episode: 5, airingAt: "2026-09-03T15:00:00.000Z" },
				{ episode: 6, airingAt: "2026-09-10T15:00:00.000Z" },
			],
		});

		expect(anime).toEqual({
			sameDayCount: 2,
			dateOnly: false,
			episodeLabel: "Episode 4",
			airsAt: "2026-09-03T15:00:00.000Z",
			entity: identity("anime-1", "anime"),
		});
	});

	it("reports a premiere known only by date as that date", () => {
		const [anime] = decodeAnime({
			nextEpisode: 1,
			publishDate: "2026-09-05",
			nextAiringAt: "2026-09-05T00:00:00.000Z",
			airingSchedule: [{ episode: 1, airingAt: "2026-09-05T00:00:00.000Z" }],
		});

		expect(anime).toMatchObject({ dateOnly: true, sameDayCount: 1, airsAt: "2026-09-05" });
	});

	it("keeps an instant at midnight that is not the premiere date", () => {
		const [anime] = decodeAnime({
			nextEpisode: 2,
			publishDate: "2026-08-29",
			nextAiringAt: "2026-09-05T00:00:00.000Z",
			airingSchedule: [{ episode: 2, airingAt: "2026-09-05T00:00:00.000Z" }],
		});

		expect(anime).toMatchObject({ dateOnly: false, airsAt: "2026-09-05T00:00:00.000Z" });
	});
});
