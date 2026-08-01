import type { RyotQLResponse } from "@ryot/contract/modules/ryotql/language";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
	buildNotificationChannelsDocument,
	decodeNotificationChannelsResponse,
} from "./notification-channels";

const notificationChannelsResponse = {
	data: {
		notificationChannels: {
			type: "rows",
			pageInfo: { hasMore: true, limit: 2, nextCursor: "next" },
			items: [
				{
					id: { kind: "text", value: "channel-1" },
					channel: { kind: "text", value: "ntfy" },
					isDisabled: { kind: "boolean", value: false },
					description: { kind: "text", value: "Primary notifications" },
					createdAt: { kind: "date", value: "2026-01-01T01:00:00+02:00" },
					updatedAt: { kind: "date", value: "2026-01-02T01:00:00+02:00" },
				},
			],
		},
	},
} satisfies RyotQLResponse;

const notificationChannelItem = notificationChannelsResponse.data.notificationChannels.items[0];

const responseWithItems = (items: readonly unknown[]) => ({
	data: {
		notificationChannels: { ...notificationChannelsResponse.data.notificationChannels, items },
	},
});

describe("notification channel recipes", () => {
	it("builds the paginated query with the named key, exact fields, and stable ordering", () => {
		const document = buildNotificationChannelsDocument({ after: "cursor", limit: 7 });
		const query = document.queries.notificationChannels;

		expect(Object.keys(document.queries)).toEqual(["notificationChannels"]);
		expect(query.output.pagination).toEqual({ after: "cursor", limit: 7 });
		expect(
			query.output.fields.map((selection) => {
				if (!("key" in selection)) {
					throw new Error("Expected an explicit field selection");
				}
				return selection.key;
			}),
		).toEqual(["id", "channel", "description", "isDisabled", "createdAt", "updatedAt"]);
		expect(query.output.orderBy).toEqual([
			{
				direction: "desc",
				expr: { field: "createdAt", tableAlias: "notificationChannel", type: "column" },
			},
			{
				direction: "desc",
				expr: { field: "id", tableAlias: "notificationChannel", type: "column" },
			},
		]);
	});

	it("decodes channel summaries, preserves page info, and normalizes dates to UTC ISO", () => {
		expect(
			Result.getOrThrow(decodeNotificationChannelsResponse(notificationChannelsResponse)),
		).toEqual({
			pageInfo: { hasMore: true, limit: 2, nextCursor: "next" },
			items: [
				{
					id: "channel-1",
					channel: "ntfy",
					isDisabled: false,
					description: "Primary notifications",
					createdAt: "2025-12-31T23:00:00.000Z",
					updatedAt: "2026-01-01T23:00:00.000Z",
				},
			],
		});
	});

	it("rejects missing fields", () => {
		for (const field of ["id", "channel", "description", "isDisabled", "createdAt", "updatedAt"]) {
			const item = { ...notificationChannelItem } as Record<string, unknown>;
			delete item[field];
			expect(Result.isFailure(decodeNotificationChannelsResponse(responseWithItems([item])))).toBe(
				true,
			);
		}
	});

	it("rejects wrong field kinds", () => {
		const wrongKinds = {
			id: { kind: "number", value: 1 },
			updatedAt: { kind: "number", value: 1 },
			description: { kind: "json", value: {} },
			channel: { kind: "boolean", value: true },
			isDisabled: { kind: "text", value: "false" },
			createdAt: { kind: "text", value: "2026-01-01" },
		};

		for (const [field, value] of Object.entries(wrongKinds)) {
			expect(
				Result.isFailure(
					decodeNotificationChannelsResponse(
						responseWithItems([{ ...notificationChannelItem, [field]: value }]),
					),
				),
			).toBe(true);
		}
	});

	it("rejects invalid dates and channel kinds", () => {
		for (const field of ["createdAt", "updatedAt"]) {
			expect(
				Result.isFailure(
					decodeNotificationChannelsResponse(
						responseWithItems([
							{ ...notificationChannelItem, [field]: { kind: "date", value: "not-a-date" } },
						]),
					),
				),
			).toBe(true);
		}

		expect(
			Result.isFailure(
				decodeNotificationChannelsResponse(
					responseWithItems([
						{ ...notificationChannelItem, channel: { kind: "text", value: "unknown" } },
					]),
				),
			),
		).toBe(true);
	});

	it("rejects a wrong query name and output type", () => {
		expect(
			Result.isFailure(
				decodeNotificationChannelsResponse({
					data: { notificationChannel: notificationChannelsResponse.data.notificationChannels },
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeNotificationChannelsResponse({
					data: {
						notificationChannels: {
							...notificationChannelsResponse.data.notificationChannels,
							type: "aggregate",
						},
					},
				}),
			),
		).toBe(true);
	});
});
