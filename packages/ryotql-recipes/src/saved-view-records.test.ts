import type { RyotQLResponse } from "@ryot/contract/modules/ryotql/language";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
	buildSavedViewRecordDocument,
	buildSavedViewRecordsDocument,
	decodeSavedViewRecordResponse,
	decodeSavedViewRecordsResponse,
} from "./saved-view-records";

const queryDocument = {
	queries: {
		entities: {
			from: { alias: "entity", table: "entity" },
			output: {
				orderBy: [],
				type: "rows",
				pagination: { limit: 1 },
				fields: [{ key: "id", expr: { field: "id", tableAlias: "entity", type: "column" } }],
			},
		},
	},
} as const;

const cardConfiguration = {
	imageField: null,
	calloutField: null,
	titleField: "title",
	overlineField: null,
	primaryMetadataField: null,
	secondaryMetadataField: null,
} as const;
const layouts = {
	grid: { ...cardConfiguration, entityIdField: "entityId", queryDocument },
	list: { ...cardConfiguration, entityIdField: "entityId", queryDocument },
	table: {
		queryDocument,
		imageField: null,
		entityIdField: "entityId",
		columns: [{ label: "Title", field: "title" }],
	},
} as const;

const savedViewRecordsResponse = {
	data: {
		savedViews: {
			type: "rows",
			pageInfo: { hasMore: true, limit: 2, nextCursor: "next" },
			items: [
				{
					id: { kind: "text", value: "view-1" },
					sortOrder: { kind: "number", value: 2 },
					slug: { kind: "text", value: "view-one" },
					name: { kind: "text", value: "View One" },
					icon: { kind: "text", value: "bookmark" },
					layouts: { kind: "json", value: layouts },
					sandboxScripts: {
						kind: "json",
						value: { search: ["movie.tmdb.search"] },
					},
					pluginSlug: { kind: "text", value: "media" },
					isBuiltin: { kind: "boolean", value: false },
					isDisabled: { kind: "boolean", value: false },
					createdAt: { kind: "date", value: "2026-01-01T01:00:00+02:00" },
					updatedAt: { kind: "date", value: "2026-01-02T01:00:00+02:00" },
				},
			],
		},
	},
} satisfies RyotQLResponse;

const savedViewRecordItem = savedViewRecordsResponse.data.savedViews.items[0];

const listResponseWithItems = (items: readonly unknown[]) => ({
	data: { savedViews: { ...savedViewRecordsResponse.data.savedViews, items } },
});

const detailResponse = (items: readonly unknown[]) => ({
	data: { savedView: { ...savedViewRecordsResponse.data.savedViews, items } },
});

describe("saved-view record recipes", () => {
	it("builds the paginated list with safe fields, filters, ordering, and a named key", () => {
		const query = buildSavedViewRecordsDocument({
			after: "cursor",
			limit: 7,
			pluginSlug: "media",
			includeDisabled: false,
		}).queries.savedViews;

		expect(query.output.pagination).toEqual({ after: "cursor", limit: 7 });
		expect(
			query.output.fields.map((selection) => {
				if (!("key" in selection)) {
					throw new Error("Expected an explicit field selection");
				}
				return selection.key;
			}),
		).toEqual([
			"id",
			"slug",
			"name",
			"icon",
			"sortOrder",
			"createdAt",
			"updatedAt",
			"isBuiltin",
			"isDisabled",
			"layouts",
			"sandboxScripts",
			"pluginSlug",
		]);
		expect(query.where).toMatchObject({
			type: "and",
			predicates: [
				{ left: { field: "isDisabled" }, right: { value: false } },
				{ left: { field: "pluginSlug" }, right: { value: "media" } },
			],
		});
		expect(query.output.orderBy).toEqual([
			{ direction: "asc", expr: { field: "pluginSlug", tableAlias: "savedView", type: "column" } },
			{ direction: "asc", expr: { field: "sortOrder", tableAlias: "savedView", type: "column" } },
			{ direction: "asc", expr: { field: "createdAt", tableAlias: "savedView", type: "column" } },
		]);
	});

	it("omits the disabled predicate when disabled records are included", () => {
		const query = buildSavedViewRecordsDocument({ includeDisabled: true, limit: 5 }).queries
			.savedViews;

		expect(query.where).toBeUndefined();
	});

	it("defaults the disabled filter to false", () => {
		const query = buildSavedViewRecordsDocument({ limit: 5 }).queries.savedViews;

		expect(query.where).toMatchObject({
			type: "and",
			predicates: [{ left: { field: "isDisabled" }, right: { value: false } }],
		});
	});

	it("builds the by-slug query with a limit of one and a named key", () => {
		const query = buildSavedViewRecordDocument({ slug: "view-one" }).queries.savedView;

		expect(query.output.pagination).toEqual({ limit: 1 });
		expect(query.where).toMatchObject({
			type: "comparison",
			right: { value: "view-one" },
			left: { field: "slug", tableAlias: "savedView" },
		});
		expect(query.output.orderBy).toEqual([
			{ direction: "asc", expr: { field: "id", tableAlias: "savedView", type: "column" } },
		]);
	});

	it("decodes valid records, nullable plugin slugs, page metadata, and ISO dates", () => {
		expect(Result.getOrThrow(decodeSavedViewRecordsResponse(savedViewRecordsResponse))).toEqual({
			pageInfo: { hasMore: true, limit: 2, nextCursor: "next" },
			items: [
				{
					layouts,
					id: "view-1",
					sortOrder: 2,
					slug: "view-one",
					name: "View One",
					icon: "bookmark",
					isBuiltin: false,
					isDisabled: false,
					pluginSlug: "media",
					createdAt: "2025-12-31T23:00:00.000Z",
					updatedAt: "2026-01-01T23:00:00.000Z",
					sandboxScripts: { search: ["movie.tmdb.search"] },
				},
			],
		});

		const nullableItem = { ...savedViewRecordItem, pluginSlug: { kind: "null", value: null } };
		expect(
			Result.getOrThrow(decodeSavedViewRecordsResponse(listResponseWithItems([nullableItem])))
				.items[0],
		).toMatchObject({ pluginSlug: null });
	});

	it("decodes a detail record and returns null when it is absent", () => {
		expect(
			Result.getOrThrow(decodeSavedViewRecordResponse(detailResponse([savedViewRecordItem]))),
		).toEqual({
			layouts,
			id: "view-1",
			sortOrder: 2,
			slug: "view-one",
			name: "View One",
			icon: "bookmark",
			isBuiltin: false,
			isDisabled: false,
			pluginSlug: "media",
			createdAt: "2025-12-31T23:00:00.000Z",
			updatedAt: "2026-01-01T23:00:00.000Z",
			sandboxScripts: { search: ["movie.tmdb.search"] },
		});
		expect(Result.getOrThrow(decodeSavedViewRecordResponse(detailResponse([])))).toBeNull();
	});

	it("rejects malformed or missing record fields", () => {
		for (const field of [
			"id",
			"slug",
			"name",
			"icon",
			"sortOrder",
			"createdAt",
			"updatedAt",
			"isBuiltin",
			"isDisabled",
			"layouts",
			"sandboxScripts",
			"pluginSlug",
		]) {
			const item = { ...savedViewRecordItem } as Record<string, unknown>;
			delete item[field];
			expect(Result.isFailure(decodeSavedViewRecordsResponse(listResponseWithItems([item])))).toBe(
				true,
			);
		}
	});

	it("rejects wrong field kinds and invalid dates", () => {
		const wrongKinds = {
			id: { kind: "number", value: 1 },
			slug: { kind: "json", value: {} },
			name: { kind: "boolean", value: true },
			sortOrder: { kind: "text", value: "2" },
			updatedAt: { kind: "number", value: 1 },
			isBuiltin: { kind: "number", value: 0 },
			pluginSlug: { kind: "number", value: 1 },
			icon: { kind: "date", value: "2026-01-01" },
			isDisabled: { kind: "text", value: "false" },
			layouts: { kind: "text", value: "not-json" },
			createdAt: { kind: "text", value: "2026-01-01" },
			sandboxScripts: { kind: "json", value: { search: "not-an-array" } },
		};

		for (const [field, value] of Object.entries(wrongKinds)) {
			expect(
				Result.isFailure(
					decodeSavedViewRecordsResponse(
						listResponseWithItems([{ ...savedViewRecordItem, [field]: value }]),
					),
				),
			).toBe(true);
		}

		for (const field of ["createdAt", "updatedAt"]) {
			expect(
				Result.isFailure(
					decodeSavedViewRecordsResponse(
						listResponseWithItems([
							{ ...savedViewRecordItem, [field]: { kind: "date", value: "not-a-date" } },
						]),
					),
				),
			).toBe(true);
		}
	});

	it("rejects wrong result types and query names", () => {
		expect(Result.isFailure(decodeSavedViewRecordsResponse({ data: {} }))).toBe(true);
		expect(
			Result.isFailure(
				decodeSavedViewRecordsResponse({
					data: { savedView: savedViewRecordsResponse.data.savedViews },
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeSavedViewRecordsResponse({
					data: { savedViews: { ...savedViewRecordsResponse.data.savedViews, type: "aggregate" } },
				}),
			),
		).toBe(true);

		expect(Result.isFailure(decodeSavedViewRecordResponse({ data: {} }))).toBe(true);
		expect(
			Result.isFailure(
				decodeSavedViewRecordResponse({
					data: { savedViews: savedViewRecordsResponse.data.savedViews },
				}),
			),
		).toBe(true);
	});
});
