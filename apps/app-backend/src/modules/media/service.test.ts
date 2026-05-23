import { describe, expect, it } from "bun:test";

import { dayjs } from "@ryot/ts-utils/dayjs";

import { expectDataResult } from "~/lib/test-helpers";
import { QueryEngineNotFoundError, QueryEngineValidationError } from "~/lib/views/errors";
import type {
	AggregateQueryEngineRequest,
	EventsQueryEngineRequest,
	QueryEngineItem,
	QueryEngineAggregateResponseData,
	QueryEngineResponse,
	TimeSeriesQueryEngineRequest,
} from "~/modules/query-engine";

import {
	getContinueItems,
	getLibraryStats,
	getRateTheseItems,
	getRecentActivityItems,
	getUpNextItems,
	getWeekActivity,
} from "./service";

const date = (value: string) => dayjs.utc(value).toDate();

type SectionField =
	| { key: string; value: Date; kind: "date" }
	| { key: string; value: null; kind: "null" }
	| { key: string; kind: "text"; value: string }
	| { key: string; value: number; kind: "number" }
	| {
			key: string;
			kind: "image";
			value: { type: "remote"; url: string } | null;
	  };

const makeImageField = (
	key: string,
	image: { type: "remote"; url: string } | null,
): SectionField => {
	return image ? { key, kind: "image", value: image } : { key, kind: "null", value: null };
};

const makeDateField = (key: string, value: Date | null | undefined): SectionField => {
	return value ? { key, kind: "date", value } : { key, kind: "null", value: null };
};

const makeNumberField = (key: string, value: number | null | undefined): SectionField => {
	return value != null ? { key, kind: "number", value } : { key, kind: "null", value: null };
};

const toQueryEngineField = (field: SectionField): QueryEngineItem[string] => {
	if (field.kind === "date") {
		return { kind: "date", value: field.value.toISOString() };
	}

	return field;
};

const toQueryEngineItem = (fields: SectionField[]): QueryEngineItem => {
	return Object.fromEntries(fields.map((field) => [field.key, toQueryEngineField(field)]));
};

const makeSectionItem = (opts: {
	id: string;
	name: string;
	fields?: SectionField[];
	entitySchemaSlug: string;
	image?: { type: "remote"; url: string } | null;
}) =>
	toQueryEngineItem([
		{ key: "entityId", kind: "text" as const, value: opts.id },
		{ key: "entityName", kind: "text" as const, value: opts.name },
		makeImageField("entityImage", opts.image ?? null),
		{
			kind: "text" as const,
			key: "entitySchemaSlug",
			value: opts.entitySchemaSlug,
		},
		...(opts.fields ?? []),
	]);

const makeSectionResult = (items: QueryEngineItem[], opts: { limit?: number } = {}) => ({
	mode: "entities" as const,
	data: {
		items,
		meta: {
			fieldOrder: Object.keys(items[0] ?? {}),
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
				executeQuery: () =>
					Promise.resolve(
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
				executeQuery: () =>
					Promise.resolve(
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
				executeQuery: () =>
					Promise.resolve(
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
				executeQuery: () =>
					Promise.resolve(
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
				executeQuery: () =>
					Promise.resolve(
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
					),
			}),
		);

		expect(result.items).toHaveLength(1);
		expect(result.items[0]?.id).toBe("book-1");
	});

	it("maps QueryEngineNotFoundError to not_found error", async () => {
		const result = await getContinueItems("user_1", {
			executeQuery: () => {
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
			executeQuery: () => {
				throw new QueryEngineValidationError("Invalid config");
			},
		});

		expect(result).toEqual({
			error: "validation",
			message: "Built-in media overview configuration is invalid",
		});
	});

	it("re-throws unexpected errors", () => {
		expect(
			getContinueItems("user_1", {
				executeQuery: () => {
					throw new Error("Unexpected error");
				},
			}),
		).rejects.toThrow("Unexpected error");
	});

	it("uses a limit of 6", async () => {
		let capturedLimit: number | undefined;

		await getContinueItems("user_1", {
			executeQuery: (_userId, request) => {
				if (request.mode === "entities") {
					capturedLimit = request.pagination.limit;
				}
				return Promise.resolve(makeSectionResult([], { limit: 10 }));
			},
		});

		expect(capturedLimit).toBe(6);
	});
});

describe("getUpNextItems", () => {
	it("returns up next items with backlog", async () => {
		const result = expectDataResult(
			await getUpNextItems("user_1", {
				executeQuery: () =>
					Promise.resolve(
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
				executeQuery: () =>
					Promise.resolve(
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
					),
			}),
		);

		expect(result.items).toHaveLength(1);
		expect(result.items[0]?.id).toBe("anime-1");
	});

	it("uses a lifecycle-aware filter so newer progress or complete events remove items from Up Next", async () => {
		let capturedFilter: unknown;

		await getUpNextItems("user_1", {
			executeQuery: (_userId, request) => {
				if (request.mode === "entities") {
					capturedFilter = request.filter;
				}
				return Promise.resolve(makeSectionResult([], { limit: 10 }));
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
							path: ["occurredAt"],
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
									path: ["occurredAt"],
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
									path: ["occurredAt"],
								},
							},
							right: {
								type: "reference",
								reference: {
									type: "event-join",
									joinKey: "progress",
									path: ["occurredAt"],
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
									path: ["occurredAt"],
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
									path: ["occurredAt"],
								},
							},
							right: {
								type: "reference",
								reference: {
									type: "event-join",
									joinKey: "complete",
									path: ["occurredAt"],
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
			executeQuery: () => {
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
			executeQuery: () => {
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
			executeQuery: (_userId, request) => {
				if (request.mode === "entities") {
					capturedLimit = request.pagination.limit;
				}
				return Promise.resolve(makeSectionResult([], { limit: 10 }));
			},
		});

		expect(capturedLimit).toBe(6);
	});

	it("re-throws unexpected errors", () => {
		expect(
			getUpNextItems("user_1", {
				executeQuery: () => {
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
				executeQuery: () =>
					Promise.resolve(
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
				executeQuery: () =>
					Promise.resolve(
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
					),
			}),
		);

		expect(result.items).toHaveLength(1);
		expect(result.items[0]?.id).toBe("manga-1");
	});

	it("maps QueryEngineNotFoundError to not_found error", async () => {
		const result = await getRateTheseItems("user_1", {
			executeQuery: () => {
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
			executeQuery: () => {
				throw new QueryEngineValidationError("Invalid config");
			},
		});

		expect(result).toEqual({
			error: "validation",
			message: "Built-in media overview configuration is invalid",
		});
	});

	it("re-throws unexpected errors", () => {
		expect(
			getRateTheseItems("user_1", {
				executeQuery: () => {
					throw new Error("Unexpected error");
				},
			}),
		).rejects.toThrow("Unexpected error");
	});

	it("uses a limit of 6", async () => {
		let capturedLimit: number | undefined;

		await getRateTheseItems("user_1", {
			executeQuery: (_userId, request) => {
				if (request.mode === "entities") {
					capturedLimit = request.pagination.limit;
				}
				return Promise.resolve(makeSectionResult([], { limit: 10 }));
			},
		});

		expect(capturedLimit).toBe(6);
	});
});

const makeEventsResult = (
	items: QueryEngineItem[],
	opts: { limit?: number } = {},
): QueryEngineResponse => ({
	mode: "events" as const,
	data: {
		items,
		meta: {
			fieldOrder: Object.keys(items[0] ?? {}),
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
	eventOccurredAt: Date;
	eventSchemaSlug: string;
	entitySchemaSlug: string;
	eventRating?: number | null;
	entityImage?: { type: "remote"; url: string } | null;
}): QueryEngineItem =>
	toQueryEngineItem([
		{ key: "eventId", kind: "text", value: opts.eventId },
		{ key: "entityId", kind: "text", value: opts.entityId },
		{ key: "entityName", kind: "text", value: opts.entityName },
		makeImageField("entityImage", opts.entityImage ?? null),
		{ key: "entitySchemaSlug", kind: "text", value: opts.entitySchemaSlug },
		{ key: "eventSchemaSlug", kind: "text", value: opts.eventSchemaSlug },
		makeDateField("eventOccurredAt", opts.eventOccurredAt),
		makeNumberField("eventRating", opts.eventRating),
	]);

describe("getRecentActivityItems", () => {
	it("returns recent activity items mapped from events mode response", async () => {
		const result = expectDataResult(
			await getRecentActivityItems("user_1", {
				executeQuery: () =>
					Promise.resolve(
						makeEventsResult([
							makeEventsItem({
								eventId: "event-1",
								entityId: "entity-1",
								entityName: "Test Book",
								entitySchemaSlug: "book",
								eventSchemaSlug: "progress",
								eventOccurredAt: date("2024-03-20T12:00:00Z"),
							}),
							makeEventsItem({
								eventRating: 5,
								eventId: "event-2",
								entityId: "entity-2",
								entityName: "Test Manga",
								entitySchemaSlug: "manga",
								eventSchemaSlug: "review",
								eventOccurredAt: date("2024-03-21T12:00:00Z"),
							}),
						]),
					),
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

	it("uses eventOccurredAt as occurredAt directly", async () => {
		const occurredAt = date("2024-03-15T00:00:00Z");

		const result = expectDataResult(
			await getRecentActivityItems("user_1", {
				executeQuery: () =>
					Promise.resolve(
						makeEventsResult([
							makeEventsItem({
								eventId: "event-1",
								entityId: "entity-1",
								entityName: "Test Movie",
								eventOccurredAt: occurredAt,
								entitySchemaSlug: "movie",
								eventSchemaSlug: "complete",
							}),
						]),
					),
			}),
		);

		expect(result.items[0]?.occurredAt).toEqual(occurredAt);
	});

	it("sends events mode request with limit 12", async () => {
		let capturedRequest: EventsQueryEngineRequest | undefined;

		await getRecentActivityItems("user_1", {
			executeQuery: (_userId, request) => {
				if (request.mode === "events") {
					capturedRequest = request;
				}
				return Promise.resolve(makeEventsResult([]));
			},
		});

		expect(capturedRequest?.mode).toBe("events");
		expect(capturedRequest?.pagination.limit).toBe(12);
	});

	it("maps QueryEngineNotFoundError to not_found error", async () => {
		const result = await getRecentActivityItems("user_1", {
			executeQuery: () => {
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
			executeQuery: () => {
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
				executeQuery: () =>
					Promise.resolve(
						makeEventsResult([
							makeEventsItem({
								eventId: "event-1",
								entityId: "entity-1",
								entityName: "Test Book",
								entitySchemaSlug: "book",
								eventSchemaSlug: "unknown-event",
								eventOccurredAt: date("2024-03-20T12:00:00Z"),
							}),
						]),
					),
			}),
		);

		expect(result.items).toHaveLength(0);
	});

	it("drops items with unknown entitySchemaSlug", async () => {
		const result = expectDataResult(
			await getRecentActivityItems("user_1", {
				executeQuery: () =>
					Promise.resolve(
						makeEventsResult([
							makeEventsItem({
								eventId: "event-1",
								entityId: "entity-1",
								entityName: "Test Thing",
								eventSchemaSlug: "review",
								entitySchemaSlug: "unknown-entity",
								eventOccurredAt: date("2024-03-20T12:00:00Z"),
							}),
						]),
					),
			}),
		);

		expect(result.items).toHaveLength(0);
	});

	it("drops items with null eventOccurredAt", async () => {
		const item = makeEventsItem({
			eventId: "event-1",
			entityId: "entity-1",
			entityName: "Test Book",
			entitySchemaSlug: "book",
			eventSchemaSlug: "progress",
			eventOccurredAt: date("2024-03-20T12:00:00Z"),
		});
		const itemWithNullOccurredAt = {
			...item,
			eventOccurredAt: { kind: "null" as const, value: null },
		};

		const result = expectDataResult(
			await getRecentActivityItems("user_1", {
				executeQuery: () => Promise.resolve(makeEventsResult([itemWithNullOccurredAt])),
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
				executeQuery: () =>
					Promise.resolve({
						mode: "timeSeries" as const,
						data: {
							buckets: Array.from({ length: 7 }, (_, i) => ({
								date: monday.add(i, "day").toISOString(),
								value: i === 1 ? 2 : i === 4 ? 1 : 0,
							})),
							meta: {
								alignedDateRange: {
									startAt: monday.toISOString(),
									endAt: monday.add(7, "day").toISOString(),
								},
							},
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
		let capturedRequest: TimeSeriesQueryEngineRequest | undefined;

		await getWeekActivity("user_1", {
			executeQuery: (_userId, request) => {
				if (request.mode === "timeSeries") {
					capturedRequest = request;
				}
				return Promise.resolve({
					mode: "timeSeries" as const,
					data: {
						buckets: [],
						meta: {
							alignedDateRange: { endAt: "2024-01-01T00:00:00Z", startAt: "2024-01-01T00:00:00Z" },
						},
					},
				});
			},
		});

		expect(capturedRequest?.mode).toBe("timeSeries");
		expect(capturedRequest?.bucket).toBe("day");
		expect(capturedRequest?.metric.type).toBe("count");
	});

	it("maps QueryEngineNotFoundError to not_found error", async () => {
		const result = await getWeekActivity("user_1", {
			executeQuery: () => {
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
			executeQuery: () => {
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
	values: QueryEngineAggregateResponseData["values"],
): QueryEngineResponse => ({ data: { values }, mode: "aggregate" as const });

describe("getLibraryStats", () => {
	it("maps aggregate response values to library stats shape", async () => {
		const result = expectDataResult(
			await getLibraryStats("user_1", {
				executeQuery: () =>
					Promise.resolve(
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
					),
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
				executeQuery: () =>
					Promise.resolve(
						makeAggregateResult([
							{ key: "total", kind: "number", value: 0 },
							{ key: "inBacklog", kind: "number", value: 0 },
							{ key: "inProgress", kind: "number", value: 0 },
							{ key: "completed", kind: "number", value: 0 },
							{ key: "avgRating", kind: "null", value: null },
							{ key: "bySchema", kind: "json", value: {} },
						]),
					),
			}),
		);

		expect(result.avgRating).toBeNull();
		expect(result.total).toBe(0);
	});

	it("sends aggregate mode request with correct aggregation keys", async () => {
		let capturedRequest: AggregateQueryEngineRequest | undefined;

		await getLibraryStats("user_1", {
			executeQuery: (_userId, request) => {
				if (request.mode === "aggregate") {
					capturedRequest = request;
				}
				return Promise.resolve(
					makeAggregateResult([
						{ key: "total", kind: "number", value: 0 },
						{ key: "inBacklog", kind: "number", value: 0 },
						{ key: "inProgress", kind: "number", value: 0 },
						{ key: "completed", kind: "number", value: 0 },
						{ key: "avgRating", kind: "null", value: null },
						{ key: "bySchema", kind: "json", value: {} },
					]),
				);
			},
		});

		expect(capturedRequest?.mode).toBe("aggregate");
		expect(capturedRequest?.aggregations.map((a) => a.key)).toEqual([
			"total",
			"inBacklog",
			"inProgress",
			"completed",
			"bySchema",
			"avgRating",
		]);
	});

	it("uses in-library relationship filter", async () => {
		let capturedRequest: AggregateQueryEngineRequest | undefined;

		await getLibraryStats("user_1", {
			executeQuery: (_userId, request) => {
				if (request.mode === "aggregate") {
					capturedRequest = request;
				}
				return Promise.resolve(
					makeAggregateResult([
						{ key: "total", kind: "number", value: 0 },
						{ key: "inBacklog", kind: "number", value: 0 },
						{ key: "inProgress", kind: "number", value: 0 },
						{ key: "completed", kind: "number", value: 0 },
						{ key: "avgRating", kind: "null", value: null },
						{ key: "bySchema", kind: "json", value: {} },
					]),
				);
			},
		});

		expect(capturedRequest?.relationshipJoins).toEqual([
			{
				required: true,
				key: "inLibrary",
				direction: "outgoing",
				kind: "latestRelationship",
				relationshipSchemaSlug: "in-library",
			},
		]);
	});

	it("maps QueryEngineNotFoundError to not_found error", async () => {
		const result = await getLibraryStats("user_1", {
			executeQuery: () => {
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
			executeQuery: () => {
				throw new QueryEngineValidationError("Invalid config");
			},
		});

		expect(result).toEqual({
			error: "validation",
			message: "Built-in media overview configuration is invalid",
		});
	});

	it("re-throws unexpected errors", () => {
		expect(
			getLibraryStats("user_1", {
				executeQuery: () => {
					throw new Error("Unexpected error");
				},
			}),
		).rejects.toThrow("Unexpected error");
	});
});
