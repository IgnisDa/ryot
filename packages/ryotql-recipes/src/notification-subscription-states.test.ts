import type { RyotQLResponse } from "@ryot/contract/modules/ryotql/language";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
	buildNotificationSubscriptionStateDocument,
	buildNotificationSubscriptionStatesDocument,
	decodeNotificationSubscriptionStateResponse,
	decodeNotificationSubscriptionStatesResponse,
} from "./notification-subscription-states";

const notificationSubscriptionStatesResponse = {
	data: {
		notificationSubscriptionStates: {
			type: "rows",
			pageInfo: { hasMore: true, limit: 2, nextCursor: "next" },
			items: [
				{
					id: { kind: "text", value: "rule-1" },
					isActive: { kind: "boolean", value: true },
					signalSchemaSlug: { kind: "text", value: "review.created" },
					createdAt: { kind: "date", value: "2026-01-01T01:00:00+02:00" },
					updatedAt: { kind: "date", value: "2026-01-02T01:00:00+02:00" },
				},
			],
		},
	},
} satisfies RyotQLResponse;

const notificationSubscriptionStateItem =
	notificationSubscriptionStatesResponse.data.notificationSubscriptionStates.items[0];

const listResponseWithItems = (items: readonly unknown[]) => ({
	data: {
		notificationSubscriptionStates: {
			...notificationSubscriptionStatesResponse.data.notificationSubscriptionStates,
			items,
		},
	},
});

const detailResponse = (items: readonly unknown[]) => ({
	data: {
		notificationSubscriptionState: {
			...notificationSubscriptionStatesResponse.data.notificationSubscriptionStates,
			items,
		},
	},
});

describe("notification subscription state recipes", () => {
	it("builds the paginated list with the named key, exact fields, pagination, and ordering", () => {
		const document = buildNotificationSubscriptionStatesDocument({ after: "cursor", limit: 7 });
		const query = document.queries.notificationSubscriptionStates;

		expect(Object.keys(document.queries)).toEqual(["notificationSubscriptionStates"]);
		expect(query.from).toEqual({
			table: "notificationSubscriptionState",
			alias: "notificationSubscriptionState",
		});
		expect(query.output.pagination).toEqual({ after: "cursor", limit: 7 });
		expect(
			query.output.fields.map((selection) => {
				if (!("key" in selection)) {
					throw new Error("Expected an explicit field selection");
				}
				return selection.key;
			}),
		).toEqual(["id", "signalSchemaSlug", "isActive", "createdAt", "updatedAt"]);
		expect(query.output.orderBy).toEqual([
			{
				direction: "asc",
				expr: {
					type: "column",
					field: "signalSchemaSlug",
					tableAlias: "notificationSubscriptionState",
				},
			},
			{
				direction: "asc",
				expr: { field: "id", tableAlias: "notificationSubscriptionState", type: "column" },
			},
		]);
	});

	it("builds the by-id query with a required id filter, limit one, deterministic ordering, and named key", () => {
		const document = buildNotificationSubscriptionStateDocument({ id: "rule-1" });
		const query = document.queries.notificationSubscriptionState;

		expect(Object.keys(document.queries)).toEqual(["notificationSubscriptionState"]);
		expect(query.output.pagination).toEqual({ limit: 1 });
		expect(
			query.output.fields.map((selection) => {
				if (!("key" in selection)) {
					throw new Error("Expected an explicit field selection");
				}
				return selection.key;
			}),
		).toEqual(["id", "signalSchemaSlug", "isActive", "createdAt", "updatedAt"]);
		expect(query.output.orderBy).toEqual([
			{
				direction: "asc",
				expr: { field: "id", tableAlias: "notificationSubscriptionState", type: "column" },
			},
		]);
		expect(query.where).toMatchObject({
			type: "comparison",
			left: { field: "id", tableAlias: "notificationSubscriptionState" },
			right: { value: "rule-1" },
		});
	});

	it("decodes a list with branded fields, page info, and normalized dates", () => {
		expect(
			Result.getOrThrow(
				decodeNotificationSubscriptionStatesResponse(notificationSubscriptionStatesResponse),
			),
		).toEqual({
			pageInfo: { hasMore: true, limit: 2, nextCursor: "next" },
			items: [
				{
					id: "rule-1",
					isActive: true,
					signalSchemaSlug: "review.created",
					createdAt: "2025-12-31T23:00:00.000Z",
					updatedAt: "2026-01-01T23:00:00.000Z",
				},
			],
		});
	});

	it("decodes a detail record and returns null when it is absent", () => {
		expect(
			Result.getOrThrow(
				decodeNotificationSubscriptionStateResponse(
					detailResponse([notificationSubscriptionStateItem]),
				),
			),
		).toEqual({
			id: "rule-1",
			isActive: true,
			signalSchemaSlug: "review.created",
			createdAt: "2025-12-31T23:00:00.000Z",
			updatedAt: "2026-01-01T23:00:00.000Z",
		});
		expect(
			Result.getOrThrow(decodeNotificationSubscriptionStateResponse(detailResponse([]))),
		).toBeNull();
	});

	it("rejects missing fields", () => {
		for (const field of ["id", "signalSchemaSlug", "isActive", "createdAt", "updatedAt"]) {
			const item = { ...notificationSubscriptionStateItem } as Record<string, unknown>;
			delete item[field];
			expect(
				Result.isFailure(
					decodeNotificationSubscriptionStatesResponse(listResponseWithItems([item])),
				),
			).toBe(true);
		}
	});

	it("rejects wrong field kinds and invalid dates", () => {
		const wrongKinds = {
			id: { kind: "number", value: 1 },
			updatedAt: { kind: "number", value: 1 },
			isActive: { kind: "text", value: "true" },
			createdAt: { kind: "text", value: "2026-01-01" },
			signalSchemaSlug: { kind: "boolean", value: true },
		};

		for (const [field, value] of Object.entries(wrongKinds)) {
			expect(
				Result.isFailure(
					decodeNotificationSubscriptionStatesResponse(
						listResponseWithItems([{ ...notificationSubscriptionStateItem, [field]: value }]),
					),
				),
			).toBe(true);
		}

		for (const field of ["createdAt", "updatedAt"]) {
			expect(
				Result.isFailure(
					decodeNotificationSubscriptionStatesResponse(
						listResponseWithItems([
							{
								...notificationSubscriptionStateItem,
								[field]: { kind: "date", value: "not-a-date" },
							},
						]),
					),
				),
			).toBe(true);
		}
	});

	it("rejects wrong query names and result shapes", () => {
		expect(Result.isFailure(decodeNotificationSubscriptionStatesResponse({ data: {} }))).toBe(true);
		expect(
			Result.isFailure(
				decodeNotificationSubscriptionStatesResponse({
					data: {
						notificationSubscriptionState:
							notificationSubscriptionStatesResponse.data.notificationSubscriptionStates,
					},
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeNotificationSubscriptionStatesResponse({
					data: {
						notificationSubscriptionStates: {
							...notificationSubscriptionStatesResponse.data.notificationSubscriptionStates,
							type: "aggregate",
						},
					},
				}),
			),
		).toBe(true);

		expect(Result.isFailure(decodeNotificationSubscriptionStateResponse({ data: {} }))).toBe(true);
		expect(
			Result.isFailure(
				decodeNotificationSubscriptionStateResponse({
					data: {
						notificationSubscriptionStates:
							notificationSubscriptionStatesResponse.data.notificationSubscriptionStates,
					},
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeNotificationSubscriptionStateResponse({
					data: {
						notificationSubscriptionState: {
							...notificationSubscriptionStatesResponse.data.notificationSubscriptionStates,
							type: "aggregate",
						},
					},
				}),
			),
		).toBe(true);
	});
});
