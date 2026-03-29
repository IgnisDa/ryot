import { describe, expect, it } from "bun:test";
import { expectDataResult } from "~/lib/test-helpers";
import {
	ViewRuntimeNotFoundError,
	ViewRuntimeValidationError,
} from "~/lib/views/errors";
import { getBuiltInMediaOverview } from "./service";

const date = (value: string) => new Date(value);

describe("getBuiltInMediaOverview", () => {
	it("assembles sections from parallel queries", async () => {
		const result = expectDataResult(
			await getBuiltInMediaOverview(
				{ userId: "user_1" },
				{
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
				},
			),
		);

		expect(result.continue.items).toHaveLength(1);
		expect(result.upNext.items).toHaveLength(0);
		expect(result.rateThese.items).toHaveLength(0);
		expect(result.continue.items[0]).toMatchObject({
			id: "book-1",
			title: "Test Book",
			entitySchemaSlug: "book",
		});
	});

	it("runs 3 parallel queries with correct filters", async () => {
		const queries: Array<{ userId: string; request: unknown }> = [];

		await getBuiltInMediaOverview(
			{ userId: "user_1" },
			{
				executeSectionQuery: async (userId, request) => {
					queries.push({ userId, request });
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
			},
		);

		expect(queries).toHaveLength(3);
		expect(queries[0]?.userId).toBe("user_1");
		expect(queries[1]?.userId).toBe("user_1");
		expect(queries[2]?.userId).toBe("user_1");
	});

	it("maps ViewRuntimeNotFoundError to not_found error", async () => {
		const result = await getBuiltInMediaOverview(
			{ userId: "user_1" },
			{
				executeSectionQuery: async () => {
					throw new ViewRuntimeNotFoundError("Schema missing");
				},
			},
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Built-in media overview configuration is invalid",
		});
	});

	it("maps ViewRuntimeValidationError to validation error", async () => {
		const result = await getBuiltInMediaOverview(
			{ userId: "user_1" },
			{
				executeSectionQuery: async () => {
					throw new ViewRuntimeValidationError("Invalid config");
				},
			},
		);

		expect(result).toEqual({
			error: "validation",
			message: "Built-in media overview configuration is invalid",
		});
	});

	it("re-throws unexpected errors", async () => {
		expect(
			getBuiltInMediaOverview(
				{ userId: "user_1" },
				{
					executeSectionQuery: async () => {
						throw new Error("Unexpected error");
					},
				},
			),
		).rejects.toThrow("Unexpected error");
	});

	it("filters Continue items requiring progressAt", async () => {
		const result = expectDataResult(
			await getBuiltInMediaOverview(
				{ userId: "user_1" },
				{
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
								id: "book-2",
								name: "Without Progress",
								image: null,
								entitySchemaSlug: "book",
								entitySchemaId: "schema-1",
								createdAt: date("2024-01-01"),
								updatedAt: date("2024-01-01"),
								fields: [],
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
				},
			),
		);

		expect(result.continue.items).toHaveLength(1);
		expect(result.continue.items[0]?.id).toBe("book-1");
	});

	it("filters Up Next items requiring backlogAt", async () => {
		const result = expectDataResult(
			await getBuiltInMediaOverview(
				{ userId: "user_1" },
				{
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
				},
			),
		);

		expect(result.upNext.items).toHaveLength(1);
		expect(result.upNext.items[0]?.id).toBe("anime-1");
	});

	it("filters Rate These items requiring completeAt", async () => {
		const result = expectDataResult(
			await getBuiltInMediaOverview(
				{ userId: "user_1" },
				{
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
				},
			),
		);

		expect(result.rateThese.items).toHaveLength(1);
		expect(result.rateThese.items[0]?.id).toBe("manga-1");
	});

	it("uses a limit of 6 for each section", async () => {
		const limits: number[] = [];

		await getBuiltInMediaOverview(
			{ userId: "user_1" },
			{
				executeSectionQuery: async (_userId, request) => {
					limits.push(request.pagination.limit);
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
			},
		);

		expect(limits).toHaveLength(3);
		expect(limits[0]).toBe(6);
		expect(limits[1]).toBe(6);
		expect(limits[2]).toBe(6);
	});
});
