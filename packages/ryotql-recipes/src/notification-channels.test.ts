import { Result } from "effect";
import { assert, describe, expect, it } from "vitest";

import { notificationChannelsRecipe } from "./notification-channels";
import { rowsResponse } from "./test-utils";

const pageInfo = { limit: 2, hasMore: true, nextCursor: "next" };
const channel = {
	id: "channel-1",
	channel: "ntfy",
	isDisabled: false,
	description: "Primary notifications",
	createdAt: "2026-01-01T01:00:00+02:00",
	updatedAt: "2026-01-02T01:00:00+02:00",
};
const recipe = notificationChannelsRecipe({ limit: 7, after: "cursor" });
const responseWithItems = (items: readonly unknown[]) =>
	rowsResponse("notificationChannels", items, pageInfo);

describe("notification channel recipes", () => {
	it("prepares and decodes the paginated channel list", () => {
		const query = recipe.document.queries.notificationChannels;
		assert(query);
		assert(query.output.type === "rows");

		expect(query.output.pagination).toEqual({ limit: 7, after: "cursor" });
		expect(
			query.output.fields.map((selection) => ("key" in selection ? selection.key : null)),
		).toEqual(["id", "createdAt", "updatedAt", "isDisabled", "description", "channel"]);
		expect(Result.getOrThrow(recipe.decode(responseWithItems([channel])))).toEqual({
			pageInfo,
			items: [
				{
					...channel,
					createdAt: "2025-12-31T23:00:00.000Z",
					updatedAt: "2026-01-01T23:00:00.000Z",
				},
			],
		});
	});

	it("rejects malformed fields and non-rows results", () => {
		expect(
			Result.isFailure(recipe.decode(responseWithItems([{ ...channel, channel: "unknown" }]))),
		).toBe(true);
		expect(
			Result.isFailure(recipe.decode(responseWithItems([{ ...channel, createdAt: "bad" }]))),
		).toBe(true);
		expect(
			Result.isFailure(
				recipe.decode({ data: { notificationChannels: { items: [], type: "aggregate" } } }),
			),
		).toBe(true);
	});
});
