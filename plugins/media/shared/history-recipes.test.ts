import { describe, expect, it } from "bun:test";

import { validateRyotQLDocument } from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { Result } from "@ryot-app/plugin-kit/effect";
import { bindRecipe, rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { bindDocument } from "@ryot-app/ryotql/binding";

import {
	flatCollectionAddedEventRow,
	flatCompletionEventRow,
	flatProgressEventRow,
	flatReviewEventRow,
} from "../tests/client/flat-media/activity-fixture";
import { historyRow } from "../tests/client/history-fixture";
import { animeRecipes } from "./anime-recipes";
import { movieRecipes } from "./movie-recipes";
import { personRecipes } from "./person-recipes";
import { showRecipes } from "./show-recipes";

const input = { limit: 2, entityId: "media-1", reference: { kind: "self" } } as const;
const rows = (items: readonly unknown[], hasMore = false) =>
	rowsResult(items, { hasMore, limit: 2, nextCursor: hasMore ? "unused-source-cursor" : null });

describe("complete activity history recipes", () => {
	it("does not offer more history for truncated coverage alone, but includes older episode logs hidden by the summary", () => {
		const recipe = bindRecipe(showRecipes.activityRecipe({ reference: { kind: "self" } }), {
			entityId: "show-1",
		});
		const data = {
			parentEvents: rows([]),
			seasonEvents: rows([]),
			episodeEvents: rows([]),
			coverage: rows([], true),
			watchDayReviews: rows([]),
			episodeProgress: rows([]),
			collectionEvents: rows([]),
			watchDays: {
				items: [],
				type: "aggregate",
				pageInfo: { limit: 1000, hasMore: false, nextCursor: null },
			},
			totals: rows([
				{
					consumedAmount: 0,
					completionCount: 0,
					historyEventCount: 0,
					unknownAmountCount: 0,
					consumptionProcessing: "ready",
				},
			]),
		};
		expect(Result.getOrThrow(recipe.decode({ data }))).toMatchObject({
			truncated: true,
			hasMoreActivities: false,
		});
		expect(
			Result.getOrThrow(
				recipe.decode({
					data: {
						...data,
						totals: rows([
							{
								consumedAmount: 0,
								completionCount: 0,
								historyEventCount: 1,
								unknownAmountCount: 0,
								consumptionProcessing: "ready",
							},
						]),
					},
				}),
			),
		).toMatchObject({ hasMoreActivities: true });
		const watchDay = {
			missing: 0,
			runtime: 40,
			minutes: 40,
			seasonNumber: 1,
			episodeNumber: 1,
			day: "2025-11-04",
			episodeName: "Pilot",
			episodeId: "episode-1",
			lastWatchedAt: "2025-11-04T21:00:00.000Z",
		};
		expect(
			Result.getOrThrow(
				recipe.decode({
					data: {
						...data,
						watchDays: {
							...data.watchDays,
							items: [
								{ ...watchDay, consumedOn: ["Jellyfin"] },
								{ ...watchDay, consumedOn: ["Plex"] },
							],
						},
						totals: rows([
							{
								consumedAmount: 0,
								completionCount: 0,
								historyEventCount: 2,
								unknownAmountCount: 0,
								consumptionProcessing: "ready",
							},
						]),
					},
				}),
			).hasMoreActivities,
		).toBe(true);
	});
	it("offers more history when only season reviews are truncated", () => {
		const recipe = bindRecipe(showRecipes.activityRecipe({ reference: { kind: "self" } }), {
			entityId: "show-1",
		});
		expect(
			Result.getOrThrow(
				recipe.decode({
					data: {
						coverage: rows([]),
						parentEvents: rows([]),
						episodeEvents: rows([]),
						watchDayReviews: rows([]),
						episodeProgress: rows([]),
						collectionEvents: rows([]),
						seasonEvents: rows([], true),
						watchDays: {
							items: [],
							type: "aggregate",
							pageInfo: { limit: 1000, hasMore: false, nextCursor: null },
						},
						totals: rows([
							{
								consumedAmount: 0,
								completionCount: 0,
								historyEventCount: 0,
								unknownAmountCount: 0,
								consumptionProcessing: "ready",
							},
						]),
					},
				}),
			).hasMoreActivities,
		).toBe(true);
	});
	it("decodes one native page in database order without multiplying or re-sorting categories", () => {
		const recipe = movieRecipes.historyRecipe({ reference: input.reference });
		const collection = {
			...flatCollectionAddedEventRow,
			id: "z-collection",
			createdAt: flatReviewEventRow.createdAt,
			occurredAt: flatReviewEventRow.occurredAt,
		};
		const page = Result.getOrThrow(
			recipe.decode({
				data: {
					history: rows(
						[
							historyRow(recipe.document, 1, collection),
							historyRow(recipe.document, 0, flatReviewEventRow),
							historyRow(recipe.document, 0, flatCompletionEventRow),
						],
						true,
					),
				},
			}),
		);
		expect(page.items.map(({ id }) => id)).toEqual<unknown>([
			"z-collection",
			flatReviewEventRow.id,
			flatCompletionEventRow.id,
		]);
		expect(page.items[0]).toMatchObject({
			kind: "collection",
			collection: {
				id: flatCollectionAddedEventRow.collectionId,
				name: flatCollectionAddedEventRow.collectionName,
			},
		});
		expect(page.pageInfo).toEqual({ limit: 2, hasMore: true, nextCursor: "unused-source-cursor" });
		const document = bindRecipe(recipe, {
			limit: 2,
			entityId: input.entityId,
			after: page.pageInfo.nextCursor ?? undefined,
		}).document;
		expect(Object.keys(document.queries)).toEqual(["history"]);
		const query = document.queries["history"];
		expect(query?.from).toEqual({ table: "event", alias: "history" });
		expect(query?.joins).toBeUndefined();
		expect(query?.output).toMatchObject({
			pagination: { limit: 2, after: "unused-source-cursor" },
			orderBy: [
				{ direction: "desc", expr: { type: "column", field: "occurredAt", tableAlias: "history" } },
				{ direction: "desc", expr: { type: "column", field: "createdAt", tableAlias: "history" } },
				{ direction: "desc", expr: { field: "id", type: "column", tableAlias: "history" } },
			],
		});
	});
	it("keeps a native cursor through equal timestamp rows and stops on the final or empty page", () => {
		const recipe = movieRecipes.historyRecipe({ reference: input.reference });
		const stamp = {
			createdAt: flatReviewEventRow.createdAt,
			occurredAt: flatReviewEventRow.occurredAt,
		};
		const first = Result.getOrThrow(
			recipe.decode({
				data: {
					history: rows(
						[
							historyRow(recipe.document, 0, { ...flatReviewEventRow, ...stamp, id: "z" }),
							historyRow(recipe.document, 1, { ...flatCollectionAddedEventRow, ...stamp, id: "y" }),
						],
						true,
					),
				},
			}),
		);
		const final = Result.getOrThrow(
			recipe.decode({
				data: {
					history: rows([
						historyRow(recipe.document, 0, { ...flatProgressEventRow, ...stamp, id: "x" }),
						historyRow(recipe.document, 1, { ...flatCollectionAddedEventRow, ...stamp, id: "w" }),
					]),
				},
			}),
		);
		expect([...first.items, ...final.items].map(({ id }) => id)).toEqual<unknown>([
			"z",
			"y",
			"x",
			"w",
		]);
		expect(final.pageInfo).toEqual({ limit: 2, hasMore: false, nextCursor: null });
		expect(Result.getOrThrow(recipe.decode({ data: { history: rows([]) } })).items).toEqual([]);
	});
	it("preserves schema-specific progress and all collection display fields", () => {
		const recipe = animeRecipes.historyRecipe({ reference: input.reference });
		const page = Result.getOrThrow(
			animeRecipes
				.historyRecipe({ reference: input.reference })
				.decode({
					data: {
						history: rows([
							historyRow(recipe.document, 0, {
								...flatProgressEventRow,
								listState: null,
								position: { position: 7, unit: "episodes" },
							}),
							historyRow(recipe.document, 1, flatCollectionAddedEventRow),
						]),
					},
				}),
		);
		expect(page.items).toMatchObject([
			{ kind: "media", position: { position: 7, unit: "episodes" } },
			{ kind: "collection" },
		]);
		expect(page.items[0]).toMatchObject({
			id: flatProgressEventRow.id,
			createdAt: flatProgressEventRow.createdAt,
			occurredAt: flatProgressEventRow.occurredAt,
		});
	});
	it("uses review-only matching for creators and validates every history category", () => {
		for (const recipes of [movieRecipes, personRecipes, showRecipes, animeRecipes]) {
			const document = Result.getOrThrow(
				bindDocument(
					recipes.historyRecipe({ reference: input.reference }).document,
					{ arguments: { entityId: input.entityId } },
					{ reportingTimeZone: "UTC", now: new Date("2026-01-01T00:00:00Z") },
				),
			).document;
			expect(
				validateRyotQLDocument(document, {
					type: "user",
					audience: "plugin",
					accessClass: "standard",
				}).error,
			).toBeNull();
		}
		const recipe = personRecipes.historyRecipe({ reference: input.reference });
		const query = bindRecipe(recipe, { entityId: input.entityId }).document.queries["history"];
		expect(JSON.stringify(query?.where)).toContain('"value":"review"');
		expect(JSON.stringify(query?.where)).not.toContain('"value":"progress"');
		const page = Result.getOrThrow(
			recipe.decode({
				data: {
					history: rows([
						historyRow(recipe.document, 0, flatReviewEventRow),
						historyRow(recipe.document, 1, flatCollectionAddedEventRow),
					]),
				},
			}),
		);
		expect(page.items.map(({ kind }) => kind)).toEqual(["media", "collection"]);
	});
	it("decodes parent, episode, season and collection categories in one interleaved page", () => {
		const recipe = showRecipes.historyRecipe({ reference: input.reference });
		const episode = {
			seasonNumber: 1,
			episodeNumber: 1,
			episodeRuntime: 40,
			episodeName: "Pilot",
			episodeId: "episode-1",
			consumptionMinutes: null,
		};
		const page = Result.getOrThrow(
			showRecipes
				.historyRecipe({ reference: input.reference })
				.decode({
					data: {
						history: rows([
							historyRow(recipe.document, 0, flatReviewEventRow),
							historyRow(recipe.document, 1, { ...flatCompletionEventRow, ...episode }),
							historyRow(recipe.document, 1, { ...flatProgressEventRow, ...episode }),
							historyRow(recipe.document, 3, flatCollectionAddedEventRow),
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
		expect(page.items[1]).toMatchObject({
			episode: { runtime: 40, name: "Pilot", id: "episode-1", seasonNumber: 1, episodeNumber: 1 },
		});
	});
});
