import { validateRyotQLDocument } from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { Result } from "@ryot-app/plugin-kit/effect";
import { TimeZone } from "@ryot-app/plugin-kit/schema";
import { describe, expect, it } from "vitest";

import { bookRecipes } from "./book-recipes";
import { podcastRecipes } from "./podcast-recipes";
import { showRecipes } from "./show-recipes";

const rows = (items: readonly unknown[]) => ({
	items,
	type: "rows",
	pageInfo: { limit: 10, hasMore: false, nextCursor: null },
});

describe("canonical consumption reads", () => {
	it("keeps episodic lifetime and coverage reads within production query limits", () => {
		for (const recipes of [showRecipes, podcastRecipes]) {
			const recipe = recipes.activityRecipe({
				entityId: "parent",
				coverageLimit: 100,
				watchDayLimit: 1000,
				parentEventLimit: 60,
				episodeEventLimit: 100,
				collectionEventLimit: 60,
				episodeProgressLimit: 100,
				reference: { kind: "self" },
				timeZone: TimeZone.make("America/New_York"),
			});
			expect(
				validateRyotQLDocument(recipe.document, {
					type: "user",
					audience: "plugin",
					accessClass: "standard",
				}).error,
			).toBeNull();
		}
	});
	it("flat detail totals expose repair state alongside quantities", () => {
		const recipe = bookRecipes.activityRecipe({
			eventLimit: 10,
			entityId: "book",
			collectionEventLimit: 10,
			reference: { kind: "self" },
		});
		const result = Result.getOrThrow(
			recipe.decode({
				data: {
					events: rows([]),
					collectionEvents: rows([]),
					totals: rows([
						{
							completionCount: 1,
							consumedAmount: 40,
							unknownAmountCount: 1,
							consumptionFailedCount: 1,
							consumptionPendingCount: 2,
						},
					]),
				},
			}),
		);
		expect(result).toMatchObject({
			completionCount: 1,
			consumedAmount: 40,
			unknownAmountCount: 1,
			consumptionFailedCount: 1,
			consumptionPendingCount: 2,
		});
		expect(
			validateRyotQLDocument(recipe.document, {
				type: "user",
				audience: "plugin",
				accessClass: "standard",
			}).error,
		).toBeNull();
	});
});
