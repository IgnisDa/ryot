import { describe, expect, it } from "bun:test";

import { entityBrowserFields } from "@ryot-app/contract/modules/saved-views/entity-browser-fields";
import type {
	EntityBrowserSavedViewSettings,
	ResultsTableSavedViewSettings,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { Result } from "effect";

import {
	decodeEntityBrowserResult,
	decodeResultsTableResult,
	decodeSavedViewCount,
	decodeSavedViewIds,
} from "./saved-views";
import { rowsResponse } from "./test-utils";

const settings: EntityBrowserSavedViewSettings = {
	pageSize: 20,
	addAction: null,
	sourceName: "items",
	defaultLayout: "grid",
	layouts: ["grid", "list"],
	summary: { image: null, subtitle: null },
	controls: { sort: true, filter: true, search: "search" },
	tableColumns: [{ field: "rating", label: "Rating", displayKind: "rating" }],
	subject: {
		entityAlias: "entity",
		schemas: [{ owner: { kind: "kernel" }, slug: EntitySchemaSlug.make("item") }],
	},
};
const pageInfo = { limit: 20, hasMore: true, nextCursor: "next" };
const row = {
	rating: 75,
	[entityBrowserFields.id]: "one",
	[entityBrowserFields.name]: "One",
	[entityBrowserFields.owner]: null,
	[entityBrowserFields.schema]: "item",
	[entityBrowserFields.population]: { state: "succeeded", availability: "complete" },
	[entityBrowserFields.translation]: { state: "succeeded", availability: "complete" },
};
const tableSettings: ResultsTableSavedViewSettings = {
	pageSize: 20,
	entityLink: null,
	sourceName: "items",
	rowKeyFields: ["key"],
	columns: [{ field: "name", label: "Name", displayKind: "text" }],
};

describe("saved-view response decoding", () => {
	it("decodes reserved provenance, sync state, cells and paging without composing a document", () => {
		const result = Result.getOrThrow(
			decodeEntityBrowserResult(rowsResponse("items", [row], pageInfo), "items", settings),
		);
		expect(result).toMatchObject({
			pageInfo,
			items: [
				{
					name: "One",
					entityId: "one",
					ownerPluginId: null,
					entitySchemaSlug: "item",
					cells: [{ key: "rating", label: "Rating", value: { value: 75, displayKind: "rating" } }],
				},
			],
		});
	});
	it("rejects missing or malformed provenance, malformed cells and duplicate entities", () => {
		const { [entityBrowserFields.id]: _id, ...missing } = row;
		for (const items of [
			[missing],
			[{ ...row, [entityBrowserFields.name]: 1 }],
			[{ ...row, rating: "bad" }],
			[row, row],
		]) {
			expect(
				Result.isFailure(
					decodeEntityBrowserResult(rowsResponse("items", items, pageInfo), "items", settings),
				),
			).toBe(true);
		}
	});
	it("decodes explicit count.count and ids.id results", () => {
		expect(
			Result.getOrThrow(
				decodeSavedViewCount({ data: { count: { type: "aggregate", items: [{ count: 3 }] } } }),
			),
		).toBe(3);
		expect(
			Result.getOrThrow(
				decodeSavedViewIds(rowsResponse("ids", [{ id: "one" }, { id: "two" }], pageInfo)),
			),
		).toEqual({ pageInfo, items: ["one", "two"] });
		expect(
			Result.isFailure(decodeSavedViewCount({ data: { count: { items: [], type: "aggregate" } } })),
		).toBe(true);
		expect(
			Result.isFailure(decodeSavedViewIds(rowsResponse("ids", [{ entityId: "one" }], pageInfo))),
		).toBe(true);
	});
	it("keeps results-table object keys deterministic and rejects duplicate/null keys", () => {
		const first = Result.getOrThrow(
			decodeResultsTableResult(
				rowsResponse("items", [{ name: "One", key: { a: 1, b: 2 } }], pageInfo),
				"items",
				tableSettings,
			),
		);
		const reordered = Result.getOrThrow(
			decodeResultsTableResult(
				rowsResponse("items", [{ name: "One", key: { b: 2, a: 1 } }], pageInfo),
				"items",
				tableSettings,
			),
		);
		expect(first.items[0]?.key).toBe(reordered.items[0]?.key);
		for (const items of [
			[{ key: null, name: "One" }],
			[
				{ key: 1, name: "One" },
				{ key: 1, name: "Two" },
			],
		]) {
			expect(
				Result.isFailure(
					decodeResultsTableResult(rowsResponse("items", items, pageInfo), "items", tableSettings),
				),
			).toBe(true);
		}
	});
});
