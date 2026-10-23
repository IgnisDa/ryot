import { validateRyotQLDocument } from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { Result } from "@ryot-app/plugin-kit/effect";
import { castDate, literal } from "@ryot-app/plugin-kit/ryotql";
import { rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { describe, expect, it } from "vitest";

import {
	flatCollectionAddedEventRow,
	flatCompletionEventRow,
	flatProgressEventRow,
	flatReviewEventRow,
} from "../tests/client/flat-media/activity-fixture";
import { animeRecipes } from "./anime-recipes";
import { movieRecipes } from "./movie-recipes";
import { personRecipes } from "./person-recipes";
import { showRecipes } from "./show-recipes";

const input = { limit: 2, entityId: "media-1", reference: { kind: "self" } } as const;
const rows = (items: readonly unknown[], hasMore = false) =>
	rowsResult(items, { hasMore, limit: 2, nextCursor: hasMore ? "unused-source-cursor" : null });

describe("complete activity history recipes", () => {
	it("does not offer more history for truncated coverage alone, but includes older episode logs hidden by the summary", () => {
		const recipe = showRecipes.activityRecipe({
			timeZone: "UTC",
			entityId: "show-1",
			coverageLimit: 100,
			watchDayLimit: 1000,
			parentEventLimit: 60,
			episodeEventLimit: 100,
			collectionEventLimit: 60,
			episodeProgressLimit: 100,
			reference: { kind: "self" },
		});
		const data = {
			parentEvents: rows([]),
			episodeEvents: rows([]),
			coverage: rows([], true),
			episodeProgress: rows([]),
			collectionEvents: rows([]),
			totals: rows([{ watchCount: 0, historyEventCount: 0 }]),
			watchDays: { items: [], type: "aggregate", pageInfo: { limit: 1000, hasMore: false } },
		};
		expect(Result.getOrThrow(recipe.decode({ data }))).toMatchObject({
			truncated: true,
			hasMoreActivities: false,
		});
		expect(
			Result.getOrThrow(
				recipe.decode({
					data: { ...data, totals: rows([{ watchCount: 0, historyEventCount: 1 }]) },
				}),
			),
		).toMatchObject({ hasMoreActivities: true });
		const watchDay = {
			runtime: 40,
			minutes: 40,
			seasonNumber: 1,
			episodeNumber: 1,
			episodeName: "Pilot",
			episodeId: "episode-1",
			day: "2025-11-04T00:00:00.000Z",
		};
		expect(
			Result.getOrThrow(
				recipe.decode({
					data: {
						...data,
						totals: rows([{ watchCount: 0, historyEventCount: 2 }]),
						watchDays: {
							...data.watchDays,
							items: [
								{ ...watchDay, consumedOn: "Jellyfin" },
								{ ...watchDay, consumedOn: "Plex" },
							],
						},
					},
				}),
			).hasMoreActivities,
		).toBe(true);
	});
	it("merges bounded sources before slicing and seeks all sources from the last displayed event", () => {
		const recipe = movieRecipes.historyRecipe(input);
		const page = Result.getOrThrow(
			recipe.decode({
				data: {
					events: rows([flatReviewEventRow, flatCompletionEventRow]),
					collectionEvents: rows([
						{
							...flatCollectionAddedEventRow,
							id: "z-collection",
							createdAt: flatReviewEventRow.createdAt,
							occurredAt: flatReviewEventRow.occurredAt,
						},
					]),
				},
			}),
		);
		expect(page.items.map(({ id }) => id)).toEqual(["z-collection", flatReviewEventRow.id]);
		expect(page.pageInfo.hasMore).toBe(true);
		if (page.pageInfo.nextCursor === null) {
			throw new Error("Expected another history page");
		}
		const next = movieRecipes.historyRecipe({ ...input, before: page.pageInfo.nextCursor });
		for (const historyRecipe of [
			movieRecipes.historyRecipe,
			personRecipes.historyRecipe,
			showRecipes.historyRecipe,
			animeRecipes.historyRecipe,
		]) {
			expect(
				validateRyotQLDocument(
					historyRecipe({ ...input, before: page.pageInfo.nextCursor }).document,
					{ type: "plugin" },
				),
			).toBeNull();
		}
		for (const name of ["events", "collectionEvents"]) {
			expect(next.document.queries[name]?.where).toMatchObject({
				type: "and",
				predicates: expect.arrayContaining([
					{
						type: "or",
						predicates: expect.arrayContaining([
							{
								operator: "lt",
								type: "comparison",
								left: expect.objectContaining({ field: "occurredAt" }),
								right: castDate(literal(flatReviewEventRow.occurredAt)),
							},
						]),
					},
				]),
			});
			expect(JSON.stringify(next.document.queries[name]?.where)).toContain(flatReviewEventRow.id);
		}
	});

	it("keeps paging when a source has more rows and stops on the final or empty page", () => {
		const recipe = movieRecipes.historyRecipe(input);
		const page = Result.getOrThrow(
			recipe.decode({
				data: { collectionEvents: rows([]), events: rows([flatProgressEventRow], true) },
			}),
		);
		expect(page.pageInfo.hasMore).toBe(true);
		expect(page.pageInfo.nextCursor).not.toBeNull();
		const final = Result.getOrThrow(
			recipe.decode({ data: { collectionEvents: rows([]), events: rows([flatProgressEventRow]) } }),
		);
		expect(final.pageInfo).toEqual({ hasMore: false, nextCursor: null });
		expect(
			Result.getOrThrow(recipe.decode({ data: { events: rows([]), collectionEvents: rows([]) } }))
				.items,
		).toEqual([]);
	});

	it("preserves schema-specific progress and snapshot fields", () => {
		const page = Result.getOrThrow(
			animeRecipes
				.historyRecipe(input)
				.decode({
					data: {
						collectionEvents: rows([]),
						events: rows([{ ...flatProgressEventRow, animeEpisode: 7, listState: null }]),
					},
				}),
		);
		expect(page.items).toMatchObject([{ kind: "media", animeEpisode: 7 }]);
	});

	it("uses the review-only event set for creators", () => {
		const recipe = personRecipes.historyRecipe(input);
		expect(JSON.stringify(recipe.document.queries.events?.where)).toContain('"value":"review"');
		expect(JSON.stringify(recipe.document.queries.events?.where)).not.toContain(
			'"value":"progress"',
		);
		const page = Result.getOrThrow(
			recipe.decode({
				data: {
					events: rows([flatReviewEventRow]),
					collectionEvents: rows([flatCollectionAddedEventRow]),
				},
			}),
		);
		expect(page.items.map(({ kind }) => kind)).toEqual(["media", "collection"]);
	});

	it("pages raw episode completions and progress together with parent reviews and collection changes", () => {
		const recipe = showRecipes.historyRecipe({ ...input, limit: 4 });
		const episode = {
			seasonNumber: 1,
			episodeNumber: 1,
			episodeRuntime: 40,
			episodeName: "Pilot",
			episodeId: "episode-1",
		};
		const page = Result.getOrThrow(
			recipe.decode({
				data: {
					parentEvents: rows([flatReviewEventRow]),
					collectionEvents: rows([flatCollectionAddedEventRow]),
					episodeEvents: rows([
						{ ...flatCompletionEventRow, ...episode },
						{ ...flatProgressEventRow, ...episode },
					]),
				},
			}),
		);
		expect(page.items.map(({ kind, eventSchemaSlug }) => [kind, eventSchemaSlug])).toEqual([
			["parent", "review"],
			["episode", "complete"],
			["episode", "progress"],
			["collection", "add-entity-to-collection"],
		]);
		expect(page.pageInfo).toEqual({ hasMore: false, nextCursor: null });
		expect(Object.keys(recipe.document.queries).sort()).toEqual([
			"collectionEvents",
			"episodeEvents",
			"parentEvents",
		]);
	});
});
