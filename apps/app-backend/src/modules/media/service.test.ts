import { describe, expect, it } from "bun:test";
import { serviceData } from "~/lib/result";
import { expectDataResult } from "~/lib/test-helpers";
import {
	ViewRuntimeNotFoundError,
	ViewRuntimeValidationError,
} from "~/lib/views/errors";
import { getBuiltInMediaOverview, loadOverviewItems } from "./service";

const date = (value: string) => new Date(value);

describe("getBuiltInMediaOverview", () => {
	it("assembles ordered sections with UI-ready labels", async () => {
		const result = expectDataResult(
			await getBuiltInMediaOverview(
				{ userId: "user_1" },
				{
					loadOverviewItems: async () =>
						serviceData([
							{
								id: "book-1",
								image: null,
								reviewAt: null,
								backlogAt: null,
								totalUnits: 300,
								completeAt: null,
								completedOn: null,
								publishYear: 2020,
								reviewRating: null,
								title: "First Book",
								progressPercent: 25,
								entitySchemaSlug: "book",
								progressAt: date("2026-03-20T10:00:00.000Z"),
							},
							{
								image: null,
								id: "anime-1",
								reviewAt: null,
								totalUnits: 24,
								progressAt: null,
								completeAt: null,
								publishYear: 2024,
								completedOn: null,
								reviewRating: null,
								progressPercent: null,
								title: "Queued Anime",
								entitySchemaSlug: "anime",
								backlogAt: date("2026-03-22T10:00:00.000Z"),
							},
							{
								image: null,
								id: "manga-1",
								reviewAt: null,
								completeAt: null,
								totalUnits: null,
								completedOn: null,
								publishYear: null,
								reviewRating: null,
								progressPercent: 55,
								title: "Unread Manga",
								entitySchemaSlug: "manga",
								backlogAt: date("2026-03-19T10:00:00.000Z"),
								progressAt: date("2026-03-21T10:00:00.000Z"),
							},
							{
								image: null,
								id: "anime-2",
								totalUnits: 12,
								backlogAt: null,
								reviewRating: 3,
								progressAt: null,
								publishYear: 2022,
								progressPercent: null,
								title: "Finished Anime",
								entitySchemaSlug: "anime",
								reviewAt: date("2026-03-18T10:00:00.000Z"),
								completeAt: date("2026-03-19T10:00:00.000Z"),
								completedOn: date("2026-03-23T10:00:00.000Z"),
							},
						]),
				},
			),
		);

		expect(result.continue.items.map((item) => item.id)).toEqual([
			"manga-1",
			"book-1",
		]);
		expect(result.continue.items[0]).toMatchObject({
			entitySchemaSlug: "manga",
			labels: { cta: "Log Progress", progress: "55% complete" },
			progress: { totalUnits: null, currentUnits: null, progressPercent: 55 },
		});
		expect(result.continue.items[1]).toMatchObject({
			entitySchemaSlug: "book",
			subtitle: { raw: 2020, label: "2020" },
			labels: { progress: "75 / 300 pages", cta: "Log Progress" },
			progress: { currentUnits: 75, totalUnits: 300, progressPercent: 25 },
		});

		expect(result.upNext.items).toEqual([
			expect.objectContaining({
				id: "anime-1",
				labels: { cta: "Start" },
				subtitle: { raw: 2024, label: "2024" },
			}),
		]);

		expect(result.rateThese.items).toEqual([
			expect.objectContaining({
				rating: 3,
				id: "anime-2",
				reviewAt: date("2026-03-18T10:00:00.000Z"),
				completedAt: date("2026-03-23T10:00:00.000Z"),
			}),
		]);
	});
});

describe("loadOverviewItems", () => {
	it("loads every runtime page before building sections", async () => {
		const items = expectDataResult(
			await loadOverviewItems(
				{ userId: "user_1" },
				{
					executeOverviewPage: async ({ page }) => ({
						items:
							page === 1
								? [
										{
											image: null,
											id: "book-1",
											name: "First Book",
											entitySchemaSlug: "book",
											entitySchemaId: "schema_1",
											updatedAt: date("2026-03-01T10:00:00.000Z"),
											createdAt: date("2026-03-01T10:00:00.000Z"),
											fields: [
												{
													kind: "date",
													key: "progressAt",
													value: date("2026-03-21T10:00:00.000Z"),
												},
											],
										},
									]
								: [
										{
											image: null,
											id: "anime-1",
											name: "Second Anime",
											entitySchemaSlug: "anime",
											entitySchemaId: "schema_2",
											createdAt: date("2026-03-01T10:00:00.000Z"),
											updatedAt: date("2026-03-01T10:00:00.000Z"),
											fields: [
												{
													kind: "date",
													key: "backlogAt",
													value: date("2026-03-22T10:00:00.000Z"),
												},
											],
										},
									],
						meta: {
							pagination: {
								page,
								total: 2,
								limit: 1,
								totalPages: 2,
								hasNextPage: page < 2,
								hasPreviousPage: page > 1,
							},
						},
					}),
				},
			),
		);

		expect(items.map((item) => item.id)).toEqual(["book-1", "anime-1"]);
	});

	it("maps missing built-in schemas to a predictable not found error", async () => {
		const result = await loadOverviewItems(
			{ userId: "user_1" },
			{
				executeOverviewPage: async () => {
					throw new ViewRuntimeNotFoundError("Schema missing");
				},
			},
		);

		expect(result).toEqual({
			error: "not_found",
			message: "Built-in media overview configuration is invalid",
		});
	});

	it("maps invalid built-in configuration to a validation error", async () => {
		const result = await loadOverviewItems(
			{ userId: "user_1" },
			{
				executeOverviewPage: async () => {
					throw new ViewRuntimeValidationError("Invalid schema reference");
				},
			},
		);

		expect(result).toEqual({
			error: "validation",
			message: "Built-in media overview configuration is invalid",
		});
	});

	describe("UTC date handling", () => {
		it("preserves UTC timezone from view-runtime date fields", async () => {
			const items = expectDataResult(
				await loadOverviewItems(
					{ userId: "user_1" },
					{
						executeOverviewPage: async () => ({
							items: [
								{
									image: null,
									id: "book-1",
									name: "Test Book",
									entitySchemaSlug: "book",
									entitySchemaId: "schema_1",
									updatedAt: date("2024-06-15T14:30:00.000Z"),
									createdAt: date("2024-06-15T14:30:00.000Z"),
									fields: [
										{
											key: "progressAt",
											kind: "date" as const,
											value: date("2024-06-15T14:30:00.000Z"),
										},
									],
								},
							],
							meta: {
								pagination: {
									page: 1,
									total: 1,
									limit: 1,
									totalPages: 1,
									hasNextPage: false,
									hasPreviousPage: false,
								},
							},
						}),
					},
				),
			);

			const book = items.find((item) => item.id === "book-1");
			expect(book).toBeDefined();
			expect(book?.progressAt).toEqual(date("2024-06-15T14:30:00.000Z"));
		});

		it("handles ISO 8601 UTC string dates from view-runtime", async () => {
			const items = expectDataResult(
				await loadOverviewItems(
					{ userId: "user_1" },
					{
						executeOverviewPage: async () => ({
							items: [
								{
									image: null,
									id: "anime-1",
									name: "Test Anime",
									entitySchemaSlug: "anime",
									entitySchemaId: "schema_2",
									updatedAt: date("2024-06-15T14:30:00.000Z"),
									createdAt: date("2024-06-15T14:30:00.000Z"),
									fields: [
										{
											key: "backlogAt",
											kind: "date" as const,
											value: "2024-06-15T14:30:00.000Z",
										},
									],
								},
							],
							meta: {
								pagination: {
									page: 1,
									total: 1,
									limit: 1,
									totalPages: 1,
									hasNextPage: false,
									hasPreviousPage: false,
								},
							},
						}),
					},
				),
			);

			const anime = items.find((item) => item.id === "anime-1");
			expect(anime).toBeDefined();
			expect(anime?.backlogAt).toEqual(date("2024-06-15T14:30:00.000Z"));
		});
	});
});
