import { describe, expect, it } from "bun:test";
import { dayjs } from "@ryot/ts-utils/dayjs";
import { expectDataResult } from "~/lib/test-helpers";
import {
	QueryEngineNotFoundError,
	QueryEngineValidationError,
} from "~/lib/views/errors";
import {
	getContinueItems,
	getRateTheseItems,
	getRecentActivityItems,
	getUpNextItems,
	getWeekActivity,
} from "./service";

const date = (value: string) => dayjs.utc(value).toDate();

describe("getContinueItems", () => {
	it("returns continue items with progress", async () => {
		const result = expectDataResult(
			await getContinueItems("user_1", {
				executeSectionQuery: async () => ({
					items: [
						{
							image: null,
							id: "book-1",
							name: "Test Book",
							entitySchemaSlug: "book",
							entitySchemaId: "schema-1",
							createdAt: date("2024-01-01"),
							updatedAt: date("2024-01-01"),
							fields: [
								{
									key: "progressAt",
									kind: "date" as const,
									value: date("2024-03-20"),
								},
								{
									value: 50,
									key: "progressPercent",
									kind: "number" as const,
								},
							],
						},
					],
					meta: {
						pagination: {
							page: 1,
							limit: 6,
							total: 1,
							totalPages: 1,
							hasNextPage: false,
							hasPreviousPage: false,
						},
					},
				}),
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

	it("filters items requiring progressAt", async () => {
		const result = expectDataResult(
			await getContinueItems("user_1", {
				executeSectionQuery: async () => ({
					items: [
						{
							id: "book-1",
							name: "With Progress",
							image: null,
							entitySchemaSlug: "book",
							entitySchemaId: "schema-1",
							createdAt: date("2024-01-01"),
							updatedAt: date("2024-01-01"),
							fields: [
								{
									key: "progressAt",
									kind: "date" as const,
									value: date("2024-03-20"),
								},
							],
						},
						{
							fields: [],
							image: null,
							id: "book-2",
							name: "Without Progress",
							entitySchemaSlug: "book",
							entitySchemaId: "schema-1",
							createdAt: date("2024-01-01"),
							updatedAt: date("2024-01-01"),
						},
					],
					meta: {
						pagination: {
							page: 1,
							limit: 6,
							total: 2,
							totalPages: 1,
							hasNextPage: false,
							hasPreviousPage: false,
						},
					},
				}),
			}),
		);

		expect(result.items).toHaveLength(1);
		expect(result.items[0]?.id).toBe("book-1");
	});

	it("maps QueryEngineNotFoundError to not_found error", async () => {
		const result = await getContinueItems("user_1", {
			executeSectionQuery: async () => {
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
			executeSectionQuery: async () => {
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
				executeSectionQuery: async () => {
					throw new Error("Unexpected error");
				},
			}),
		).rejects.toThrow("Unexpected error");
	});

	it("uses a limit of 6", async () => {
		let capturedLimit: number | undefined;

		await getContinueItems("user_1", {
			executeSectionQuery: async (_userId, request) => {
				capturedLimit = request.pagination.limit;
				return {
					items: [],
					meta: {
						pagination: {
							page: 1,
							total: 0,
							limit: 10,
							totalPages: 0,
							hasNextPage: false,
							hasPreviousPage: false,
						},
					},
				};
			},
		});

		expect(capturedLimit).toBe(6);
	});
});

describe("getUpNextItems", () => {
	it("returns up next items with backlog", async () => {
		const result = expectDataResult(
			await getUpNextItems("user_1", {
				executeSectionQuery: async () => ({
					items: [
						{
							image: null,
							id: "anime-1",
							name: "Test Anime",
							entitySchemaSlug: "anime",
							entitySchemaId: "schema-2",
							createdAt: date("2024-01-01"),
							updatedAt: date("2024-01-01"),
							fields: [
								{
									key: "backlogAt",
									kind: "date" as const,
									value: date("2024-03-20"),
								},
							],
						},
					],
					meta: {
						pagination: {
							page: 1,
							limit: 6,
							total: 1,
							totalPages: 1,
							hasNextPage: false,
							hasPreviousPage: false,
						},
					},
				}),
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
				executeSectionQuery: async () => ({
					items: [
						{
							image: null,
							id: "anime-1",
							name: "With Backlog",
							entitySchemaSlug: "anime",
							entitySchemaId: "schema-2",
							createdAt: date("2024-01-01"),
							updatedAt: date("2024-01-01"),
							fields: [
								{
									key: "backlogAt",
									kind: "date" as const,
									value: date("2024-03-20"),
								},
							],
						},
						{
							fields: [],
							image: null,
							id: "anime-2",
							name: "Without Backlog",
							entitySchemaSlug: "anime",
							entitySchemaId: "schema-2",
							createdAt: date("2024-01-01"),
							updatedAt: date("2024-01-01"),
						},
					],
					meta: {
						pagination: {
							page: 1,
							total: 2,
							limit: 20,
							totalPages: 1,
							hasNextPage: false,
							hasPreviousPage: false,
						},
					},
				}),
			}),
		);

		expect(result.items).toHaveLength(1);
		expect(result.items[0]?.id).toBe("anime-1");
	});

	it("maps QueryEngineNotFoundError to not_found error", async () => {
		const result = await getUpNextItems("user_1", {
			executeSectionQuery: async () => {
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
			executeSectionQuery: async () => {
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
			executeSectionQuery: async (_userId, request) => {
				capturedLimit = request.pagination.limit;
				return {
					items: [],
					meta: {
						pagination: {
							page: 1,
							total: 0,
							limit: 10,
							totalPages: 0,
							hasNextPage: false,
							hasPreviousPage: false,
						},
					},
				};
			},
		});

		expect(capturedLimit).toBe(6);
	});
});

describe("getRateTheseItems", () => {
	it("returns rate these items with complete", async () => {
		const result = expectDataResult(
			await getRateTheseItems("user_1", {
				executeSectionQuery: async () => ({
					items: [
						{
							image: null,
							id: "manga-1",
							name: "Test Manga",
							entitySchemaSlug: "manga",
							entitySchemaId: "schema-3",
							createdAt: date("2024-01-01"),
							updatedAt: date("2024-01-01"),
							fields: [
								{
									key: "completeAt",
									kind: "date" as const,
									value: date("2024-03-20"),
								},
							],
						},
					],
					meta: {
						pagination: {
							page: 1,
							limit: 6,
							total: 1,
							totalPages: 1,
							hasNextPage: false,
							hasPreviousPage: false,
						},
					},
				}),
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
				executeSectionQuery: async () => ({
					items: [
						{
							image: null,
							id: "manga-1",
							name: "With Complete",
							entitySchemaSlug: "manga",
							entitySchemaId: "schema-3",
							createdAt: date("2024-01-01"),
							updatedAt: date("2024-01-01"),
							fields: [
								{
									key: "completeAt",
									kind: "date" as const,
									value: date("2024-03-20"),
								},
							],
						},
						{
							fields: [],
							image: null,
							id: "manga-2",
							name: "Without Complete",
							entitySchemaSlug: "manga",
							entitySchemaId: "schema-3",
							createdAt: date("2024-01-01"),
							updatedAt: date("2024-01-01"),
						},
					],
					meta: {
						pagination: {
							page: 1,
							total: 2,
							limit: 12,
							totalPages: 1,
							hasNextPage: false,
							hasPreviousPage: false,
						},
					},
				}),
			}),
		);

		expect(result.items).toHaveLength(1);
		expect(result.items[0]?.id).toBe("manga-1");
	});

	it("maps QueryEngineNotFoundError to not_found error", async () => {
		const result = await getRateTheseItems("user_1", {
			executeSectionQuery: async () => {
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
			executeSectionQuery: async () => {
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
				executeSectionQuery: async () => {
					throw new Error("Unexpected error");
				},
			}),
		).rejects.toThrow("Unexpected error");
	});

	it("uses a limit of 6", async () => {
		let capturedLimit: number | undefined;

		await getRateTheseItems("user_1", {
			executeSectionQuery: async (_userId, request) => {
				capturedLimit = request.pagination.limit;
				return {
					items: [],
					meta: {
						pagination: {
							page: 1,
							total: 0,
							limit: 10,
							totalPages: 0,
							hasNextPage: false,
							hasPreviousPage: false,
						},
					},
				};
			},
		});

		expect(capturedLimit).toBe(6);
	});
});

describe("getRecentActivityItems", () => {
	it("returns recent activity items in reverse chronological order", async () => {
		const result = expectDataResult(
			await getRecentActivityItems("user_1", {
				listWeekActivityEventsForUser: async () => [],
				executeSectionQuery: async () => {
					throw new Error("Should not execute section query");
				},
				listRecentActivityEventsForUser: async () => [
					{
						rating: null,
						id: "event-1",
						eventSchemaSlug: "progress",
						occurredAt: date("2024-03-20T12:00:00Z"),
						entity: {
							image: null,
							name: "Test Book",
							entitySchemaSlug: "book",
						},
					},
					{
						rating: 5,
						id: "event-2",
						eventSchemaSlug: "review",
						occurredAt: date("2024-03-21T12:00:00Z"),
						entity: {
							image: null,
							name: "Test Manga",
							entitySchemaSlug: "manga",
						},
					},
				],
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

	it("uses an activity limit of 12", async () => {
		let capturedLimit: number | undefined;

		await getRecentActivityItems("user_1", {
			executeSectionQuery: async () => {
				throw new Error("Should not execute section query");
			},
			listRecentActivityEventsForUser: async (input) => {
				capturedLimit = input.limit;
				return [];
			},
			listWeekActivityEventsForUser: async () => [],
		});

		expect(capturedLimit).toBe(12);
	});

	it("orders same-timestamp activity by id descending", async () => {
		const timestamp = date("2024-03-21T12:00:00Z");
		const result = expectDataResult(
			await getRecentActivityItems("user_1", {
				listWeekActivityEventsForUser: async () => [],
				executeSectionQuery: async () => {
					throw new Error("Should not execute section query");
				},
				listRecentActivityEventsForUser: async () => [
					{
						rating: null,
						id: "event-1",
						occurredAt: timestamp,
						eventSchemaSlug: "review",
						entity: {
							image: null,
							name: "Older Id",
							entitySchemaSlug: "book",
						},
					},
					{
						rating: null,
						id: "event-2",
						occurredAt: timestamp,
						eventSchemaSlug: "review",
						entity: {
							image: null,
							name: "Newer Id",
							entitySchemaSlug: "manga",
						},
					},
				],
			}),
		);

		expect(result.items.map((item) => item.id)).toEqual(["event-2", "event-1"]);
	});
});

describe("getWeekActivity", () => {
	it("returns seven daily buckets for the current week", async () => {
		const monday = dayjs.utc().startOf("isoWeek");
		const tuesday = monday.add(1, "day").hour(12);
		const friday = monday.add(4, "day").hour(18);

		const result = expectDataResult(
			await getWeekActivity("user_1", {
				executeSectionQuery: async () => {
					throw new Error("Should not execute section query");
				},
				listRecentActivityEventsForUser: async () => [],
				listWeekActivityEventsForUser: async () => [
					{ occurredAt: tuesday.toDate() },
					{ occurredAt: tuesday.toDate() },
					{ occurredAt: friday.toDate() },
				],
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
		expect(result.items.map((item) => item.count)).toEqual([
			0, 2, 0, 0, 1, 0, 0,
		]);
	});

	it("labels week buckets in UTC", async () => {
		const mondayUtc = dayjs.utc().startOf("isoWeek");
		const sundayUtc = mondayUtc.add(6, "day").hour(23).minute(59);

		const result = expectDataResult(
			await getWeekActivity("user_1", {
				listRecentActivityEventsForUser: async () => [],
				executeSectionQuery: async () => {
					throw new Error("Should not execute section query");
				},
				listWeekActivityEventsForUser: async () => [
					{ occurredAt: mondayUtc.toDate() },
					{ occurredAt: sundayUtc.toDate() },
				],
			}),
		);

		expect(result.items[0]).toEqual({ count: 1, dayLabel: "Mon" });
		expect(result.items[6]).toEqual({ count: 1, dayLabel: "Sun" });
	});
});
