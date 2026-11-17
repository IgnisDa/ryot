import { describe, expect, it } from "bun:test";

import { Result } from "effect";

import { pluginClientCatalogRecipe } from "./plugin-client-catalog";
import { bindRecipe, requireRowsQuery, rowsResult } from "./test-utils";

const entry = {
	sortOrder: 0,
	icon: "puzzle",
	scope: "system",
	health: "ready",
	isHidden: false,
	clientApiVersion: 1,
	homeSavedView: null,
	pluginId: "plugin-1",
	packageId: "ryot/other",
	contentHash: "source-hash",
	installationId: "installation-1",
	assistantStarters: [{ key: "assistant.summarize" }],
	name: { key: "test.fixture", namespace: "plugin-1" },
	clientEntities: { item: { createRoute: "/items/new" } },
};

const stamped = <Row extends typeof entry>(row: Row) => ({
	...row,
	assistantStarters: [{ namespace: "plugin-1", key: "assistant.summarize" }],
});

const response = {
	data: { installations: rowsResult([entry], { limit: 100, hasMore: false, nextCursor: null }) },
};

describe("plugin client catalog recipe", () => {
	it("queries one active-plugin page after the supplied cursor", () => {
		const query = requireRowsQuery(
			bindRecipe(pluginClientCatalogRecipe, { after: "cursor" }).document.queries.installations,
		);

		expect(query).toMatchObject({
			output: { pagination: { limit: 100, after: "cursor" } },
			from: { alias: "installation", table: "pluginInstallation" },
			joins: [{ type: "inner", table: { alias: "plugin", table: "plugin" } }],
			where: {
				type: "and",
				predicates: [
					{ type: "comparison", right: { type: "literal", value: "active" } },
					{
						type: "isNotNull",
						expr: { type: "column", tableAlias: "plugin", field: "clientApiVersion" },
					},
				],
			},
		});
		expect(query.output.orderBy).toEqual([
			{
				direction: "asc",
				expr: { type: "column", field: "sortOrder", tableAlias: "installation" },
			},
			{ direction: "asc", expr: { type: "column", field: "packageId", tableAlias: "plugin" } },
			{ direction: "asc", expr: { field: "id", type: "column", tableAlias: "installation" } },
		]);
	});

	it("decodes installations and stamps assistant starters with the plugin namespace", () => {
		expect(
			Result.getOrThrow(bindRecipe(pluginClientCatalogRecipe, {}).decode(response)),
		).toEqual<unknown>({ items: [stamped(entry)], pageInfo: response.data.installations.pageInfo });
	});

	it("retains hidden and incompatible installations", () => {
		const hidden = { ...entry, isHidden: true };
		const incompatible = { ...entry, health: "incompatible", installationId: "installation-2" };
		const decoded = bindRecipe(pluginClientCatalogRecipe, {}).decode({
			data: {
				installations: rowsResult([hidden, incompatible], {
					limit: 100,
					hasMore: false,
					nextCursor: null,
				}),
			},
		});

		expect(Result.getOrThrow(decoded).items).toEqual<unknown>([
			stamped(hidden),
			stamped(incompatible),
		]);
	});

	it("rejects an unknown installation health", () => {
		expect(
			Result.isFailure(
				bindRecipe(pluginClientCatalogRecipe, {}).decode({
					data: {
						installations: rowsResult([{ ...entry, health: "unknown" }], {
							limit: 100,
							hasMore: false,
							nextCursor: null,
						}),
					},
				}),
			),
		).toBe(true);
	});
});
