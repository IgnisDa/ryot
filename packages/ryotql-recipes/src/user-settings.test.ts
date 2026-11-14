import { expect, it } from "bun:test";

import { Result } from "effect";

import { bindRecipe, rowsResult } from "./test-utils";
import { userSettingsRecipe } from "./user-settings";

const page = (items: readonly unknown[]) =>
	rowsResult(items, { limit: 2, hasMore: false, nextCursor: null });

it("reads canonical stored preferences and rejects malformed persisted values", () => {
	const user = {
		name: "A",
		image: null,
		id: "user-1",
		email: "a@example.com",
		preferences: {
			language: null,
			ratingScale: "ten",
			reportingTimeZone: "UTC",
			disableIntegrations: false,
		},
	};
	const recipe = bindRecipe(userSettingsRecipe, {});
	expect(
		Result.getOrThrow(recipe.decode({ data: { user: page([user]) } })).preferences,
	).toEqual<unknown>(user.preferences);
	for (const preferences of [
		{ ...user.preferences, language: "" },
		{ ...user.preferences, disableIntegrations: "yes" },
		{ ...user.preferences, reportingTimeZone: null },
		{ ...user.preferences, reportingTimeZone: "+05:30" },
		{ ...user.preferences, ratingScale: "stars" },
		{ language: null },
	]) {
		expect(
			Result.isFailure(recipe.decode({ data: { user: page([{ ...user, preferences }]) } })),
		).toBe(true);
	}
});
