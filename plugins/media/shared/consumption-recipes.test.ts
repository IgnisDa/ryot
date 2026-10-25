import { validateRyotQLDocument } from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { Result } from "@ryot-app/plugin-kit/effect";
import { and, castDate, column, gte, literal, lt, table } from "@ryot-app/plugin-kit/ryotql";
import { calendarPeriod, TimeZone } from "@ryot-app/plugin-kit/schema";
import { describe, expect, it } from "vitest";

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
			const predicate = consumptionPeriod(event, period);
			expect(predicate.type === "and" ? predicate.predicates[0] : undefined).toEqual(
				and(
					gte(column(event, "occurredAt"), castDate(literal("2026-09-30T00:00:00.000Z"))),
					lt(column(event, "occurredAt"), castDate(literal("2026-11-02T00:00:00.000Z"))),
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
