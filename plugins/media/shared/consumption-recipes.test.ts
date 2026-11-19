import { describe, expect, it } from "bun:test";

import { Result } from "@ryot-app/plugin-kit/effect";
import { and, column, dateAdd, gte, literal, lt, table } from "@ryot-app/plugin-kit/ryotql";
import { calendarPeriod, TimeZone } from "@ryot-app/plugin-kit/schema";
import { expressionDateWindow } from "@ryot-app/ryotql-recipes/reporting-parameters";
import { bindRecipe } from "@ryot-app/ryotql-recipes/test-utils";
import { validateRyotQLDocument } from "@ryot-app/ryotql/validator";

import { bookRecipes } from "./book-recipes";
import { consumptionPeriod } from "./consumption-recipes";
import { podcastRecipes } from "./podcast-recipes";
import { showRecipes } from "./show-recipes";

const rows = (items: readonly unknown[]) => ({
	items,
	type: "rows",
	pageInfo: { limit: 10, hasMore: false, nextCursor: null },
});

describe("consumption periods", () => {
	it.each(["Pacific/Kiritimati", "Etc/GMT+12"])(
		"prefilters occurrence time by a range covering local instants and nearby date-only evidence in %s",
		(zone) => {
			const period = calendarPeriod("2026-10-01", "2026-10-31", TimeZone.make(zone));
			const event = table("event", "source");
			const predicate = consumptionPeriod(
				event,
				expressionDateWindow(literal("2026-10-01"), literal("2026-11-01")),
			);
			expect(predicate.type === "and" ? predicate.predicates[1] : undefined).toEqual(
				and(
					gte(column(event, "occurredAt"), dateAdd(literal("2026-10-01"), -2, "day")),
					lt(column(event, "occurredAt"), dateAdd(literal("2026-11-01"), 2, "day")),
				),
			);
			expect(Date.parse(period.startAt)).toBeGreaterThanOrEqual(
				Date.parse("2026-09-30T00:00:00.000Z"),
			);
			expect(Date.parse(period.endAt)).toBeLessThanOrEqual(Date.parse("2026-11-02T00:00:00.000Z"));
		},
	);
});

describe("canonical consumption reads", () => {
	it("keeps episodic lifetime and coverage reads within production query limits", () => {
		for (const recipes of [showRecipes, podcastRecipes]) {
			const recipe = bindRecipe(recipes.activityRecipe({ reference: { kind: "self" } }), {
				entityId: "parent",
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
		const recipe = bindRecipe(bookRecipes.activityRecipe({ reference: { kind: "self" } }), {
			entityId: "book",
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
							consumptionProcessing: "failed",
						},
					]),
				},
			}),
		);
		expect(result).toMatchObject({
			completionCount: 1,
			consumedAmount: 40,
			unknownAmountCount: 1,
			consumptionProcessing: "failed",
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
