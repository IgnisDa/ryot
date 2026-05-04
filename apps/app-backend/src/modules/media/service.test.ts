import { describe, expect, it } from "bun:test";

import { dayjs } from "@ryot/ts-utils";

import { expectDataResult } from "~/lib/test-helpers";
import { QueryEngineNotFoundError, QueryEngineValidationError } from "~/lib/views/errors";
import type { QueryEngineResponse, ResolvedDisplayValue } from "~/modules/query-engine";

import {
	getContinueItems,
	getLibraryStats,
	getRateTheseItems,
	getRecentActivityItems,
	getUpNextItems,
	getWeekActivity,
} from "./service";

const date = (value: string) => dayjs.utc(value).toDate();

type SectionField = {
	key: string;
	value: Date | number | string | null;
	kind: "date" | "number" | "text" | "null" | "image";
};

const makeSectionItem = (opts: {
	id: string;
	name: string;
	fields?: SectionField[];
	entitySchemaSlug: string;
	image?: { kind: "remote"; url: string } | null;
}) => [
	{ key: "entityId", kind: "text" as const, value: opts.id },
	{ key: "entityName", kind: "text" as const, value: opts.name },
	{
		key: "entityImage",
		kind: opts.image ? ("image" as const) : ("null" as const),
		value: opts.image ?? null,
	},
	{
		kind: "text" as const,
		key: "entitySchemaSlug",
		value: opts.entitySchemaSlug,
	},
	...(opts.fields ?? []),
];

const makeSectionResult = <T>(items: T[], opts: { limit?: number } = {}) => ({
	mode: "entities" as const,
	data: {
		items,
		meta: {
			pagination: {
				page: 1,
				hasNextPage: false,
				total: items.length,
				hasPreviousPage: false,
				limit: opts.limit ?? items.length,
				totalPages: items.length > 0 ? 1 : 0,
			},
		},
	},
});

describe("getContinueItems", () => {
	it("returns continue items with progress", async () => {
		const result = expectDataResult(
			await getContinueItems("user_1", {
				executeQuery: async () =>
					makeSectionResult(
						[
							makeSectionItem({
								id: "book-1",
								name: "Test Book",
								entitySchemaSlug: "book",
								fields: [
									{
										kind: "date",
										key: "progressAt",
										value: date("2024-03-20"),
									},
									{ key: "progressPercent", kind: "number", value: 50 },
								],
							}),
						],
						{ limit: 6 },
					),
			}),
		);

		expect(result.items).toHaveLength(1);
		expect(result.count).toBe(1);
		expect(result.items[0]).toMatchObject({
			id: "book-1",
			title: "Test Book",
			entitySchemaSlug: "book",
		});
	});

	it("returns audiobook continue item with runtime-based progress label and Log Progress cta", async () => {
		const result = expectDataResult(
			await getContinueItems("user_1", {
				executeQuery: async () =>
					makeSectionResult(
						[
							makeSectionItem({
								id: "audiobook-1",
								name: "Test Audiobook",
								entitySchemaSlug: "audiobook",
								fields: [
									{
										kind: "date",
										key: "progressAt",
										value: date("2024-03-20"),
									},
									{ key: "progressPercent", kind: "number", value: 50 },
									{ key: "totalUnits", kind: "number", value: 180 },
								],
							}),
						],
						{ limit: 6 },
					),
			}),
		);

		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({
			id: "audiobook-1",
			entitySchemaSlug: "audiobook",
			labels: { cta: "Log Progress" },
		});
		expect(result.items[0]?.labels.progress).toMatch(/minutes/);
	});

	it("returns podcast continue item with episode-based progress label and Log Progress cta", async () => {
		const result = expectDataResult(
			await getContinueItems("user_1", {
				executeQuery: async () =>
					makeSectionResult(
						[
							makeSectionItem({
								id: "podcast-1",
								name: "Test Podcast",
								entitySchemaSlug: "podcast",
								fields: [
									{
										kind: "date",
										key: "progressAt",
										value: date("2024-03-20"),
									},
									{ key: "progressPercent", kind: "number", value: 25 },
									{ key: "totalUnits", kind: "number", value: 40 },
								],
							}),
						],
						{ limit: 6 },
					),
			}),
		);

		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({
			id: "podcast-1",
			entitySchemaSlug: "podcast",
			labels: { cta: "Log Progress" },
		});
		expect(result.items[0]?.labels.progress).toBe("10 / 40 episodes");
	});

	it("returns comic-book continue item with page-based progress label and Log Progress cta", async () => {
		const result = expectDataResult(
			await getContinueItems("user_1", {
				executeQuery: async () =>
					makeSectionResult(
						[
							makeSectionItem({
								id: "comic-1",
								name: "Test Comic",
								entitySchemaSlug: "comic-book",
								fields: [
									{
										kind: "date",
										key: "progressAt",
										value: date("2024-03-20"),
									},
									{ key: "progressPercent", kind: "number", value: 25 },
									{ key: "totalUnits", kind: "number", value: 32 },
								],
							}),
						],
						{ limit: 6 },
					),
			}),
		);

		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({
			id: "comic-1",
			entitySchemaSlug: "comic-book",
			labels: { cta: "Log Progress" },
		});
		expect(result.items[0]?.labels.progress).toBe("8 / 32 pages");
	});

	it("filters items requiring progressAt", async () => {
		const result = expectDataResult(
			await getContinueItems("user_1", {
				executeQuery: async () =>
					makeSectionResult(
						[
							makeSectionItem({
								id: "book-1",
								name: "With Progress",
								entitySchemaSlug: "book",
								fields: [
									{
										kind: "date",
										key: "progressAt",
										value: date("2024-03-20"),
									},
								],
							}),
							makeSectionItem({
								id: "book-2",
								name: "Without Progress",
								entitySchemaSlug: "book",
							}),
						],
						{ limit: 6 },
					),
			}),
		);

		expect(result.items).toHaveLength(1);
		expect(result.items[0]?.id).toBe("book-1");
	});

	it("maps QueryEngineNotFoundError to not_found error", async () => {
		const result = await getContinueItems("user_1", {
			executeQuery: async () => {
				throw new QueryEngineNotFoundError("Schema missing");
			},
		});

		expect(result).toEqual({
			error: "not_found",
			message: "Built-in media overview configuration is invalid",
		});
	});

	it("maps QueryEngineValidationError to validation error", async () => {
		const result = await getContinueItems("user_1", {
			executeQuery: async () => {
				throw new QueryEngineValidationError("Invalid config");
			},
		});

		expect(result).toEqual({
			error: "validation",
			message: "Built-in media overview configuration is invalid",
		});
	});

	it("re-throws unexpected errors", async () => {
		expect(
			getContinueItems("user_1", {
				executeQuery: async () => {
					throw new Error("Unexpected error");
				},
			}),
		).rejects.toThrow("Unexpected error");
	});

	it("uses a limit of 6", async () => {
		let capturedLimit: number | undefined;

		await getContinueItems("user_1", {
			executeQuery: async (_userId, request) => {
				if (request.mode === "entities") {
					capturedLimit = request.pagination.limit;
				}
				return makeSectionResult([], { limit: 10 });
			},
		});

		expect(capturedLimit).toBe(6);
	});
});

describe("getUpNextItems", () => {
	it("returns up next items with backlog", async () => {
		const result = expectDataResult(
			await getUpNextItems("user_1", {
				executeQuery: async () =>
					makeSectionResult(
						[
							makeSectionItem({
								id: "anime-1",
								name: "Test Anime",
								entitySchemaSlug: "anime",
								fields: [{ key: "backlogAt", kind: "date", value: date("2024-03-20") }],
							}),
						],
						{ limit: 6 },
					),
			}),
		);

		expect(result.items).toHaveLength(1);
		expect(result.count).toBe(1);
		expect(result.items[0]).toMatchObject({
			id: "anime-1",
			title: "Test Anime",
			entitySchemaSlug: "anime",
		});
	});

	it("filters items requiring backlogAt", async () => {
		const result = expectDataResult(
			await getUpNextItems("user_1", {
				executeQuery: async () =>
					makeSectionResult(
						[
							makeSectionItem({
								id: "anime-1",
								name: "With Backlog",
								entitySchemaSlug: "anime",
								fields: [{ key: "backlogAt", kind: "date", value: date("2024-03-20") }],
							}),
							makeSectionItem({
								id: "anime-2",
								name: "Without Backlog",
								entitySchemaSlug: "anime",
							}),
						],
						{ limit: 20 },
					),
			}),
		);

		expect(result.items).toHaveLength(1);
		expect(result.items[0]?.id).toBe("anime-1");
	});

	it("uses a lifecycle-aware filter so newer progress or complete events remove items from Up Next", async () => {
		let capturedFilter: unknown;

		await getUpNextItems("user_1", {
			executeQuery: async (_userId, request) => {
				if (request.mode === "entities") {
					capturedFilter = request.filter;
				}
				return makeSectionResult([], { limit: 10 });
			},
		});

		expect(capturedFilter).toEqual({
			type: "and",
			predicates: [
				{
					type: "isNotNull",
					expression: {
						type: "reference",
						reference: {
							type: "event-join",
							joinKey: "backlog",
							path: ["createdAt"],
						},
					},
				},
				{
					type: "or",
					predicates: [
						{
							type: "isNull",
							expression: {
								type: "reference",
								reference: {
									type: "event-join",
									joinKey: "progress",
									path: ["createdAt"],
								},
							},
						},
						{
							operator: "gt",
							type: "comparison",
							left: {
								type: "reference",
								reference: {
									type: "event-join",
									joinKey: "backlog",
									path: ["createdAt"],
								},
							},
							right: {
								type: "reference",
								reference: {
									type: "event-join",
									joinKey: "progress",
									path: ["createdAt"],
								},
							},
						},
					],
				},
				{
					type: "or",
					predicates: [
						{
							type: "isNull",
							expression: {
								type: "reference",
								reference: {
									type: "event-join",
									joinKey: "complete",
									path: ["createdAt"],
								},
							},
						},
						{
							operator: "gt",
							type: "comparison",
							left: {
								type: "reference",
								reference: {
									type: "event-join",
									joinKey: "backlog",
									path: ["createdAt"],
								},
							},
							right: {
								type: "reference",
								reference: {
									type: "event-join",
									joinKey: "complete",
									path: ["createdAt"],
								},
							},
						},
					],
				},
			],
		});
	});

	it("maps QueryEngineNotFoundError to not_found error", async () => {
		const result = await getUpNextItems("user_1", {
			executeQuery: async () => {
				throw new QueryEngineNotFoundError("Schema missing");
			},
		});

		expect(result).toEqual({
			error: "not_found",
			message: "Built-in media overview configuration is invalid",
		});
	});

	it("maps QueryEngineValidationError to validation error", async () => {
		const result = await getUpNextItems("user_1", {
			executeQuery: async () => {
				throw new QueryEngineValidationError("Invalid config");
			},
		});

		expect(result).toEqual({
			error: "validation",
			message: "Built-in media overview configuration is invalid",
		});
	});

	it("uses a limit of 6", async () => {
		let capturedLimit: number | undefined;

		await getUpNextItems("user_1", {
			executeQuery: async (_userId, request) => {
				if (request.mode === "entities") {
					capturedLimit = request.pagination.limit;
				}
				return makeSectionResult([], { limit: 10 });
			},
		});

		expect(capturedLimit).toBe(6);
	});

	it("re-throws unexpected errors", async () => {
		expect(
			getUpNextItems("user_1", {
				executeQuery: async () => {
					throw new Error("Unexpected error");
				},
			}),
		).rejects.toThrow("Unexpected error");
	});
});

describe("getRateTheseItems", () => {
	it("returns rate these items with complete", async () => {
		const result = expectDataResult(
			await getRateTheseItems("user_1", {
				executeQuery: async () =>
					makeSectionResult(
						[
							makeSectionItem({
								id: "manga-1",
								name: "Test Manga",
								entitySchemaSlug: "manga",
								fields: [
									{
										kind: "date",
										key: "completeAt",
										value: date("2024-03-20"),
									},
								],
							}),
						],
						{ limit: 6 },
					),
			}),
		);

		expect(result.items).toHaveLength(1);
		expect(result.count).toBe(1);
		expect(result.items[0]).toMatchObject({
			id: "manga-1",
			title: "Test Manga",
			entitySchemaSlug: "manga",
		});
	});

	it("filters items requiring completeAt", async () => {
		const result = expectDataResult(
			await getRateTheseItems("user_1", {
				executeQuery: async () =>
					makeSectionResult(
						[
							makeSectionItem({
								id: "manga-1",
								name: "With Complete",
								entitySchemaSlug: "manga",
								fields: [
									{
										key: "completeAt",
										kind: "date",
										value: date("2024-03-20"),
									},
								],
							}),
							makeSectionItem({
								id: "manga-2",
								name: "Without Complete",
								entitySchemaSlug: "manga",
							}),
						],
						{ limit: 12 },
					),
			}),
		);

		expect(result.items).toHaveLength(1);
		expect(result.items[0]?.id).toBe("manga-1");
	});

	it("maps QueryEngineNotFoundError to not_found error", async () => {
		const result = await getRateTheseItems("user_1", {
			executeQuery: async () => {
				throw new QueryEngineNotFoundError("Schema missing");
			},
		});

		expect(result).toEqual({
			error: "not_found",
			message: "Built-in media overview configuration is invalid",
		});
	});

	it("maps QueryEngineValidationError to validation error", async () => {
		const result = await getRateTheseItems("user_1", {
			executeQuery: async () => {
				throw new QueryEngineValidationError("Invalid config");
			},
		});

		expect(result).toEqual({
			error: "validation",
			message: "Built-in media overview configuration is invalid",
		});
	});

	it("re-throws unexpected errors", async () => {
		expect(
			getRateTheseItems("user_1", {
				executeQuery: async () => {
					throw new Error("Unexpected error");
				},
			}),
		).rejects.toThrow("Unexpected error");
	});

	it("uses a limit of 6", async () => {
		let capturedLimit: number | undefined;

		await getRateTheseItems("user_1", {
			executeQuery: async (_userId, request) => {
				if (request.mode === "entities") {
					capturedLimit = request.pagination.limit;
				}
				return makeSectionResult([], { limit: 10 });
			},
		});

		expect(capturedLimit).toBe(6);
	});
});

const makeEventsResult = (
	items: Array<Array<ResolvedDisplayValue & { key: string }>>,
	opts: { limit?: number } = {},
): QueryEngineResponse => ({
	mode: "events" as const,
	data: {
		items,
		meta: {
			pagination: {
				page: 1,
				hasNextPage: false,
				total: items.length,
				hasPreviousPage: false,
				limit: opts.limit ?? items.length,
				totalPages: items.length > 0 ? 1 : 0,
			},
		},
	},
});

const makeEventsItem = (opts: {
	eventId: string;
	entityId: string;
	entityName: string;
	eventCreatedAt: Date;
	entityImage?: unknown;
	eventSchemaSlug: string;
	entitySchemaSlug: string;
	eventRating?: number | null;
	eventCompletedOn?: Date | null;
}): Array<ResolvedDisplayValue & { key: string }> => [
	{ key: "eventId", kind: "text", value: opts.eventId },
	{ key: "entityId", kind: "text", value: opts.entityId },
	{ key: "entityName", kind: "text", value: opts.entityName },
	{
		key: "entityImage",
		kind: (opts.entityImage ? "image" : "null") as "image" | "null",
		value: opts.entityImage ?? null,
	},
	{ key: "entitySchemaSlug", kind: "text", value: opts.entitySchemaSlug },
	{ key: "eventSchemaSlug", kind: "text", value: opts.eventSchemaSlug },
	{ key: "eventCreatedAt", kind: "date", value: opts.eventCreatedAt },
	{
		key: "eventCompletedOn",
		kind: (opts.eventCompletedOn ? "date" : "null") as "date" | "null",
		value: opts.eventCompletedOn ?? null,
	},
	{
		key: "eventRating",
		kind: (opts.eventRating != null ? "number" : "null") as "number" | "null",
		value: opts.eventRating ?? null,
	},
];

describe("getRecentActivityItems", () => {
	it("returns recent activity items mapped from events mode response", async () => {
		const result = expectDataResult(
			await getRecentActivityItems("user_1", {
				executeQuery: async () =>
					makeEventsResult([
						makeEventsItem({
							eventId: "event-1",
							entityId: "entity-1",
							entityName: "Test Book",
							entitySchemaSlug: "book",
							eventSchemaSlug: "progress",
							eventCreatedAt: date("2024-03-20T12:00:00Z"),
						}),
						makeEventsItem({
							eventRating: 5,
							eventId: "event-2",
							entityId: "entity-2",
							entityName: "Test Manga",
							entitySchemaSlug: "manga",
							eventSchemaSlug: "review",
							eventCreatedAt: date("2024-03-21T12:00:00Z"),
						}),
					]),
			}),
		);

		expect(result.items.map((item) => item.id)).toEqual(["event-2", "event-1"]);
		expect(result.items[0]).toMatchObject({
			rating: 5,
			id: "event-2",
			eventSchemaSlug: "review",
			entity: { name: "Test Manga", entitySchemaSlug: "manga" },
		});
	});

	it("uses completedOn as occurredAt for complete events", async () => {
		const completedOn = date("2024-03-15T00:00:00Z");
		const createdAt = date("2024-03-20T12:00:00Z");

		const result = expectDataResult(
			await getRecentActivityItems("user_1", {
				executeQuery: async () =>
					makeEventsResult([
						makeEventsItem({
							eventId: "event-1",
							entityId: "entity-1",
							entityName: "Test Movie",
							eventCreatedAt: createdAt,
							entitySchemaSlug: "movie",
							eventSchemaSlug: "complete",
							eventCompletedOn: completedOn,
						}),
					]),
			}),
		);

		expect(result.items[0]?.occurredAt).toEqual(completedOn);
	});

	it("falls back to eventCreatedAt as occurredAt when completedOn is absent for complete events", async () => {
		const createdAt = date("2024-03-20T12:00:00Z");

		const result = expectDataResult(
			await getRecentActivityItems("user_1", {
				executeQuery: async () =>
					makeEventsResult([
						makeEventsItem({
							eventId: "event-1",
							entityId: "entity-1",
							entityName: "Test Movie",
							entitySchemaSlug: "movie",
							eventCreatedAt: createdAt,
							eventSchemaSlug: "complete",
						}),
					]),
			}),
		);

		expect(result.items[0]?.occurredAt).toEqual(createdAt);
	});

	it("sends events mode request with limit 12", async () => {
		let capturedRequest: unknown;

		await getRecentActivityItems("user_1", {
			executeQuery: async (_userId, request) => {
				capturedRequest = request;
				return makeEventsResult([]);
			},
		});

		expect((capturedRequest as { mode: string }).mode).toBe("events");
		expect((capturedRequest as { pagination: { limit: number } }).pagination.limit).toBe(12);
	});

	it("maps QueryEngineNotFoundError to not_found error", async () => {
		const result = await getRecentActivityItems("user_1", {
			executeQuery: async () => {
				throw new QueryEngineNotFoundError("Schema missing");
			},
		});

		expect(result).toEqual({
			error: "not_found",
			message: "Built-in media overview configuration is invalid",
		});
	});

	it("maps QueryEngineValidationError to validation error", async () => {
		const result = await getRecentActivityItems("user_1", {
			executeQuery: async () => {
				throw new QueryEngineValidationError("Invalid config");
			},
		});

		expect(result).toEqual({
			error: "validation",
			message: "Built-in media overview configuration is invalid",
		});
	});

	it("drops items with unknown eventSchemaSlug", async () => {
		const result = expectDataResult(
			await getRecentActivityItems("user_1", {
				executeQuery: async () =>
					makeEventsResult([
						makeEventsItem({
							eventId: "event-1",
							entityId: "entity-1",
							entityName: "Test Book",
							entitySchemaSlug: "book",
							eventSchemaSlug: "unknown-event",
							eventCreatedAt: date("2024-03-20T12:00:00Z"),
						}),
					]),
			}),
		);

		expect(result.items).toHaveLength(0);
	});

	it("drops items with unknown entitySchemaSlug", async () => {
		const result = expectDataResult(
			await getRecentActivityItems("user_1", {
				executeQuery: async () =>
					makeEventsResult([
						makeEventsItem({
							eventId: "event-1",
							entityId: "entity-1",
							entityName: "Test Thing",
							eventSchemaSlug: "review",
							entitySchemaSlug: "unknown-entity",
							eventCreatedAt: date("2024-03-20T12:00:00Z"),
						}),
					]),
			}),
		);

		expect(result.items).toHaveLength(0);
	});

	it("drops items with null eventCreatedAt", async () => {
		const item = makeEventsItem({
			eventId: "event-1",
			entityId: "entity-1",
			entityName: "Test Book",
			entitySchemaSlug: "book",
			eventSchemaSlug: "progress",
			eventCreatedAt: date("2024-03-20T12:00:00Z"),
		});
		const itemWithNullCreatedAt = item.map((field) =>
			field.key === "eventCreatedAt"
				? { key: "eventCreatedAt", kind: "null" as const, value: null }
				: field,
		);

		const result = expectDataResult(
			await getRecentActivityItems("user_1", {
				executeQuery: async () => makeEventsResult([itemWithNullCreatedAt]),
			}),
		);

		expect(result.items).toHaveLength(0);
	});
});

describe("getWeekActivity", () => {
	it("returns seven daily buckets from time-series response", async () => {
		const monday = dayjs.utc().startOf("isoWeek");

		const result = expectDataResult(
			await getWeekActivity("user_1", {
				executeQuery: async () => ({
					mode: "timeSeries" as const,
					data: {
						buckets: Array.from({ length: 7 }, (_, i) => ({
							date: monday.add(i, "day").toISOString(),
							value: i === 1 ? 2 : i === 4 ? 1 : 0,
						})),
					},
				}),
			}),
		);

		expect(result.items).toHaveLength(7);
		expect(result.items.map((item) => item.dayLabel)).toEqual([
			"Mon",
			"Tue",
			"Wed",
			"Thu",
			"Fri",
			"Sat",
			"Sun",
		]);
		expect(result.items.map((item) => item.count)).toEqual([0, 2, 0, 0, 1, 0, 0]);
	});

	it("sends time-series mode request for current ISO week with day bucket", async () => {
		let capturedRequest: unknown;

		await getWeekActivity("user_1", {
			executeQuery: async (_userId, request) => {
				capturedRequest = request;
				return {
					mode: "timeSeries" as const,
					data: { buckets: [] },
				};
			},
		});

		expect((capturedRequest as { mode: string }).mode).toBe("timeSeries");
		expect((capturedRequest as { bucket: string }).bucket).toBe("day");
		expect((capturedRequest as { metric: { type: string } }).metric.type).toBe("count");
	});

	it("maps QueryEngineNotFoundError to not_found error", async () => {
		const result = await getWeekActivity("user_1", {
			executeQuery: async () => {
				throw new QueryEngineNotFoundError("Schema missing");
			},
		});

		expect(result).toEqual({
			error: "not_found",
			message: "Built-in media overview configuration is invalid",
		});
	});

	it("maps QueryEngineValidationError to validation error", async () => {
		const result = await getWeekActivity("user_1", {
			executeQuery: async () => {
				throw new QueryEngineValidationError("Invalid config");
			},
		});

		expect(result).toEqual({
			error: "validation",
			message: "Built-in media overview configuration is invalid",
		});
	});
});

const makeAggregateResult = (
	values: Array<ResolvedDisplayValue & { key: string }>,
): QueryEngineResponse => ({
	mode: "aggregate" as const,
	data: { values },
});

describe("getLibraryStats", () => {
	it("maps aggregate response values to library stats shape", async () => {
		const result = expectDataResult(
			await getLibraryStats("user_1", {
				executeQuery: async () =>
					makeAggregateResult([
						{ key: "total", kind: "number", value: 10 },
						{ key: "inBacklog", kind: "number", value: 2 },
						{ key: "inProgress", kind: "number", value: 3 },
						{ key: "completed", kind: "number", value: 4 },
						{ key: "avgRating", kind: "number", value: 7.5 },
						{
							kind: "json",
							key: "bySchema",
							value: { book: 5, anime: 3, movie: 2 },
						},
					]),
			}),
		);

		expect(result.total).toBe(10);
		expect(result.inBacklog).toBe(2);
		expect(result.inProgress).toBe(3);
		expect(result.completed).toBe(4);
		expect(result.avgRating).toBe(7.5);
		expect(result.entityTypeCounts).toMatchObject({
			book: 5,
			anime: 3,
			movie: 2,
		});
	});

	it("returns null avgRating when aggregate value is null (empty set)", async () => {
		const result = expectDataResult(
			await getLibraryStats("user_1", {
				executeQuery: async () =>
					makeAggregateResult([
						{ key: "total", kind: "number", value: 0 },
						{ key: "inBacklog", kind: "number", value: 0 },
						{ key: "inProgress", kind: "number", value: 0 },
						{ key: "completed", kind: "number", value: 0 },
						{ key: "avgRating", kind: "null", value: null },
						{ key: "bySchema", kind: "json", value: {} },
					]),
			}),
		);

		expect(result.avgRating).toBeNull();
		expect(result.total).toBe(0);
	});

	it("sends aggregate mode request with correct aggregation keys", async () => {
		let capturedRequest: unknown;

		await getLibraryStats("user_1", {
			executeQuery: async (_userId, request) => {
				capturedRequest = request;
				return makeAggregateResult([
					{ key: "total", kind: "number", value: 0 },
					{ key: "inBacklog", kind: "number", value: 0 },
					{ key: "inProgress", kind: "number", value: 0 },
					{ key: "completed", kind: "number", value: 0 },
					{ key: "avgRating", kind: "null", value: null },
					{ key: "bySchema", kind: "json", value: {} },
				]);
			},
		});

		const req = capturedRequest as {
			mode: string;
			aggregations: Array<{ key: string }>;
		};
		expect(req.mode).toBe("aggregate");
		expect(req.aggregations.map((a) => a.key)).toEqual([
			"total",
			"inBacklog",
			"inProgress",
			"completed",
			"avgRating",
			"bySchema",
		]);
	});

	it("uses in-library relationship filter", async () => {
		let capturedRequest: unknown;

		await getLibraryStats("user_1", {
			executeQuery: async (_userId, request) => {
				capturedRequest = request;
				return makeAggregateResult([
					{ key: "total", kind: "number", value: 0 },
					{ key: "inBacklog", kind: "number", value: 0 },
					{ key: "inProgress", kind: "number", value: 0 },
					{ key: "completed", kind: "number", value: 0 },
					{ key: "avgRating", kind: "null", value: null },
					{ key: "bySchema", kind: "json", value: {} },
				]);
			},
		});

		expect(
			(
				capturedRequest as {
					relationships: Array<{ relationshipSchemaSlug: string }>;
				}
			).relationships,
		).toEqual([{ relationshipSchemaSlug: "in-library" }]);
	});

	it("maps QueryEngineNotFoundError to not_found error", async () => {
		const result = await getLibraryStats("user_1", {
			executeQuery: async () => {
				throw new QueryEngineNotFoundError("Schema missing");
			},
		});

		expect(result).toEqual({
			error: "not_found",
			message: "Built-in media overview configuration is invalid",
		});
	});

	it("maps QueryEngineValidationError to validation error", async () => {
		const result = await getLibraryStats("user_1", {
			executeQuery: async () => {
				throw new QueryEngineValidationError("Invalid config");
			},
		});

		expect(result).toEqual({
			error: "validation",
			message: "Built-in media overview configuration is invalid",
		});
	});

	it("re-throws unexpected errors", async () => {
		expect(
			getLibraryStats("user_1", {
				executeQuery: async () => {
					throw new Error("Unexpected error");
				},
			}),
		).rejects.toThrow("Unexpected error");
	});
});
