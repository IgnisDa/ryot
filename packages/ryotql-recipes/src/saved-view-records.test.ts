import { describe, expect, it } from "bun:test";

import { SavedViewId } from "@ryot-app/contract/schema/brands";
import { Result } from "effect";

import {
	savedViewRecordRecipe,
	savedViewRecordsRecipe,
	savedViewReferenceArguments,
} from "./saved-view-records";
import { bindRecipe, requireRowsQuery, rowsResult } from "./test-utils";

const item = {
	id: "view-1",
	sortOrder: 2,
	settings: {},
	isHidden: false,
	slug: "view-one",
	name: "View One",
	icon: "bookmark",
	isBuiltin: false,
	dataSources: null,
	packageId: "ryot/fixture",
	createdAt: "2026-01-01T01:00:00+02:00",
	updatedAt: "2026-01-02T01:00:00+02:00",
	reference: { kind: "custom", savedViewId: "view-1" },
	renderer: { kind: "kernel", name: "entity-browser" },
};
const pageInfo = { limit: 2, hasMore: true, nextCursor: "next" };
const rows = (items: readonly unknown[], limit = 2) => rowsResult(items, { ...pageInfo, limit });

describe("saved-view record recipes", () => {
	it("prepares list filters, fields, pagination, and ordering", () => {
		const query = requireRowsQuery(
			bindRecipe(savedViewRecordsRecipe, {
				limit: 7,
				after: "cursor",
				includeHidden: false,
				pluginId: "fixture-owner",
			}).document.queries.savedViews,
		);

		expect(query.output.pagination).toEqual({ limit: 7, after: "cursor" });
		expect(query.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"slug",
			"name",
			"icon",
			"isHidden",
			"sortOrder",
			"isBuiltin",
			"renderer",
			"reference",
			"createdAt",
			"updatedAt",
			"packageId",
			"dataSources",
			"settings",
		]);
		expect(query.where).toMatchObject({
			predicates: [
				{
					type: "or",
					predicates: [
						{ left: { value: false }, right: { value: true } },
						{ right: { value: false }, left: { field: "isHidden" } },
					],
				},
				{ left: { field: "pluginId" }, right: { value: "fixture-owner" } },
			],
		});
	});

	it("prepares optional detail with cardinality limit two", () => {
		const query = requireRowsQuery(
			bindRecipe(
				savedViewRecordRecipe,
				savedViewReferenceArguments({ kind: "custom", savedViewId: SavedViewId.make("view-1") }),
			).document.queries.savedView,
		);

		expect(query.output.pagination).toEqual({ limit: 2 });
		expect(query.where).toMatchObject({
			predicates: [
				{ right: { value: "custom" } },
				{
					type: "or",
					predicates: [
						{ predicates: [{ right: { value: "custom" } }, { right: { value: "view-1" } }] },
						{},
						{},
					],
				},
			],
		});
	});

	it("decodes plain records, page info, nulls, and normalized dates", () => {
		const decoded = Result.getOrThrow(
			bindRecipe(savedViewRecordsRecipe, { limit: 2 }).decode({
				data: { savedViews: rows([item]) },
			}),
		);

		expect(decoded).toEqual<unknown>({
			pageInfo,
			items: [
				{ ...item, createdAt: "2025-12-31T23:00:00.000Z", updatedAt: "2026-01-01T23:00:00.000Z" },
			],
		});
		expect(
			Result.getOrThrow(
				bindRecipe(savedViewRecordsRecipe, { limit: 2 }).decode({
					data: { savedViews: rows([{ ...item, packageId: null }]) },
				}),
			).items[0],
		).toMatchObject({ packageId: null });
	});

	it("decodes optional detail and rejects excess cardinality", () => {
		const recipe = bindRecipe(
			savedViewRecordRecipe,
			savedViewReferenceArguments({ kind: "custom", savedViewId: SavedViewId.make("view-1") }),
		);

		expect(Result.getOrThrow(recipe.decode({ data: { savedView: rows([], 2) } }))).toBeUndefined();
		expect(Result.isFailure(recipe.decode({ data: { savedView: rows([item, item], 2) } }))).toBe(
			true,
		);
	});

	it("rejects malformed JSON and dates", () => {
		const recipe = bindRecipe(savedViewRecordsRecipe, { limit: 2 });

		for (const malformed of [
			{ ...item, renderer: "not-json" },
			{ ...item, settings: "not-json" },
			{ ...item, dataSources: "not-json" },
			{ ...item, createdAt: "not-a-date" },
			{ ...item, updatedAt: "not-a-date" },
		]) {
			expect(Result.isFailure(recipe.decode({ data: { savedViews: rows([malformed]) } }))).toBe(
				true,
			);
		}
	});

	it("rejects missing fields and wrong result shapes", () => {
		const malformed = { ...item } as Record<string, unknown>;
		delete malformed.id;
		const recipe = bindRecipe(savedViewRecordsRecipe, { limit: 2 });

		expect(Result.isFailure(recipe.decode({ data: { savedViews: rows([malformed]) } }))).toBe(true);
		expect(Result.isFailure(recipe.decode({ data: {} }))).toBe(true);
		expect(
			Result.isFailure(
				recipe.decode({ data: { savedViews: { ...rows([item]), type: "aggregate" } } }),
			),
		).toBe(true);
	});
});
