import { Result } from "effect";
import { assert, describe, expect, it } from "vitest";

import { notificationDeliveriesRecipe, notificationOutcomeRecipe } from "./notification-delivery";
import { rowsResponse } from "./test-utils";

const pageInfo = { limit: 3, hasMore: true, nextCursor: "next" };
const outcome = {
	reason: null,
	settledAt: null,
	state: "settled",
	outcome: "unknown",
	id: "notification-1",
	createdAt: "2026-01-01T01:00:00+02:00",
};
const delivery = {
	reason: null,
	channel: "ntfy",
	id: "delivery-1",
	status: "accepted",
	channelId: "channel-1",
	description: "Primary notifications",
	claimedAt: "2026-03-10T12:30:00+02:00",
	settledAt: "2026-03-10T12:45:00+02:00",
};
const outcomeResponse = (items: readonly unknown[]) =>
	rowsResponse("notifications", items, pageInfo);
const deliveriesResponse = (items: readonly unknown[]) =>
	rowsResponse("deliveries", items, pageInfo);

describe("notification delivery recipes", () => {
	it("maps an empty outcome read to null and decodes settled unknown outcomes", () => {
		const recipe = notificationOutcomeRecipe({ id: "notification-1" });

		expect(Result.getOrThrow(recipe.decode(outcomeResponse([])))).toBeNull();
		expect(Result.getOrThrow(recipe.decode(outcomeResponse([outcome])))).toEqual({
			...outcome,
			createdAt: "2025-12-31T23:00:00.000Z",
		});
	});

	it("rejects malformed outcome state and date fields", () => {
		const recipe = notificationOutcomeRecipe({ id: "notification-1" });

		expect(
			Result.isFailure(recipe.decode(outcomeResponse([{ ...outcome, state: "running" }]))),
		).toBe(true);
		expect(
			Result.isFailure(recipe.decode(outcomeResponse([{ ...outcome, createdAt: "bad" }]))),
		).toBe(true);
	});

	it("preserves delivery pagination and decodes safe statuses and dates", () => {
		const recipe = notificationDeliveriesRecipe({
			limit: 7,
			after: "cursor",
			notificationId: "notification-1",
		});
		const query = recipe.document.queries.deliveries;
		assert(query);
		assert(query.output.type === "rows");

		expect(query.output.pagination).toEqual({ limit: 7, after: "cursor" });
		const items = ["accepted", "unknown", "skipped"].map((status, index) =>
			Object.assign({}, delivery, { status, id: `delivery-${index + 1}` }),
		);
		expect(Result.getOrThrow(recipe.decode(deliveriesResponse(items)))).toEqual({
			pageInfo,
			items: items.map((item) =>
				Object.assign({}, item, {
					claimedAt: "2026-03-10T10:30:00.000Z",
					settledAt: "2026-03-10T10:45:00.000Z",
				}),
			),
		});
	});

	it("rejects malformed delivery status and date fields", () => {
		const recipe = notificationDeliveriesRecipe({ limit: 3, notificationId: "notification-1" });

		expect(
			Result.isFailure(recipe.decode(deliveriesResponse([{ ...delivery, status: "sent" }]))),
		).toBe(true);
		expect(
			Result.isFailure(recipe.decode(deliveriesResponse([{ ...delivery, settledAt: "bad" }]))),
		).toBe(true);
	});
});
