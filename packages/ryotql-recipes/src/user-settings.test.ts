import { Result } from "effect";
import { expect, it } from "vitest";

import { rowsResult } from "./test-utils";
import { userSettingsRecipe } from "./user-settings";

const page = (items: readonly unknown[]) =>
	rowsResult(items, { limit: 2, hasMore: false, nextCursor: null });

it("reads canonical stored preferences and rejects malformed persisted values", () => {
	const user = {
		name: "A",
		image: null,
		id: "user-1",
		email: "a@example.com",
		preferences: { language: null, reportingTimeZone: null, disableIntegrations: false },
	};
	const recipe = userSettingsRecipe();
	expect(Result.getOrThrow(recipe.decode({ data: { user: page([user]) } })).preferences).toEqual(
		user.preferences,
	);
	for (const preferences of [
		{ language: "", reportingTimeZone: null, disableIntegrations: false },
		{ language: null, reportingTimeZone: null, disableIntegrations: "yes" },
		{ language: null, disableIntegrations: false, reportingTimeZone: "+05:30" },
		{ language: null },
	]) {
		expect(
			Result.isFailure(recipe.decode({ data: { user: page([{ ...user, preferences }]) } })),
		).toBe(true);
	}
});
