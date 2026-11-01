import { EntityId } from "@ryot-app/contract/schema/brands";
import { Result } from "effect";
import { assert, expect, it } from "vitest";

import { remindersRecipe } from "./reminders";
import { rowsResponse } from "./test-utils";

it("preserves inactive date-only evidence without inventing an instant or timezone", () => {
	const recipe = remindersRecipe({ limit: 20, states: ["needs-scheduling"] });
	const item = {
		revision: 1,
		dueAt: null,
		reason: null,
		outcome: null,
		timezone: null,
		settledAt: null,
		id: "reminder-1",
		processingAt: null,
		replacementId: null,
		entityId: "entity-1",
		parentEntityId: null,
		entityTitle: "Target",
		message: "Original text",
		state: "needs-scheduling",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		originalSchedule: { dueAt: null, timezone: null, date: "2025-03-30", mayHaveSent: false },
	};
	const pageInfo = { limit: 20, hasMore: false, nextCursor: null };
	expect(Result.getOrThrow(recipe.decode(rowsResponse("reminders", [item], pageInfo)))).toEqual({
		pageInfo,
		items: [item],
	});
});

it("uses stable schedule ordering, cursor pagination and explicit entity scope", () => {
	const recipe = remindersRecipe({
		limit: 3,
		after: "cursor",
		states: ["scheduled", "processing"],
		entityId: EntityId.make("entity-1"),
	});
	const query = recipe.document.queries.reminders;
	assert(query?.output.type === "rows");
	expect(query.output.pagination).toEqual({ limit: 3, after: "cursor" });
	expect(query.output.orderBy).toMatchObject([
		{ direction: "asc", expr: { field: "dueAt" } },
		{ direction: "asc", expr: { field: "createdAt" } },
		{ direction: "asc", expr: { field: "id" } },
	]);
	expect(JSON.stringify(query.where)).toContain("parentEntityId");
	expect(JSON.stringify(query.where)).toContain("removedAt");
	expect(JSON.stringify(query.where)).not.toContain("replacementId");
});
