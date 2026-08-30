import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { pluginClientCatalogRecipe } from "./plugin-client-catalog";
import { requireRowsQuery, rowsResult } from "./test-utils";

const entry = {
	sortOrder: 0,
	icon: "puzzle",
	name: "Fixture",
	slug: "fixture",
	health: "ready",
	isDisabled: false,
	clientApiVersion: 1,
	pluginId: "plugin-1",
	homeSavedViewId: null,
	sourceHash: "source-hash",
	installationId: "installation-1",
};

const response = {
	data: { installations: rowsResult([entry], { hasMore: false, limit: 100, nextCursor: null }) },
};

describe("plugin client catalog recipe", () => {
	it("queries one active-plugin page after the supplied cursor", () => {
		const query = requireRowsQuery(
			pluginClientCatalogRecipe({ after: "cursor" }).document.queries.installations,
		);

		expect(query).toMatchObject({
			output: { pagination: { after: "cursor", limit: 100 } },
			from: { alias: "installation", table: "pluginInstallation" },
			joins: [{ type: "inner", table: { alias: "plugin", table: "plugin" } }],
			where: {
				type: "and",
				predicates: [
					{ type: "comparison", right: { type: "literal", value: "active" } },
					{
						type: "isNotNull",
						expr: { type: "column", field: "clientApiVersion", tableAlias: "plugin" },
					},
				],
			},
		});
		expect(query.output.orderBy).toEqual([
			{
				direction: "asc",
				expr: { field: "sortOrder", tableAlias: "installation", type: "column" },
			},
			{ direction: "asc", expr: { field: "slug", tableAlias: "plugin", type: "column" } },
			{ direction: "asc", expr: { field: "id", tableAlias: "installation", type: "column" } },
		]);
	});

	it("decodes installations with their public client availability", () => {
		expect(Result.getOrThrow(pluginClientCatalogRecipe().decode(response))).toEqual({
			items: response.data.installations.items,
			pageInfo: response.data.installations.pageInfo,
		});
	});

	it("retains disabled and incompatible installations", () => {
		const disabled = { ...entry, isDisabled: true };
		const incompatible = { ...entry, health: "incompatible", installationId: "installation-2" };
		const decoded = pluginClientCatalogRecipe().decode({
			data: {
				installations: rowsResult([disabled, incompatible], {
					limit: 100,
					hasMore: false,
					nextCursor: null,
				}),
			},
		});

		expect(Result.getOrThrow(decoded).items).toEqual([disabled, incompatible]);
	});

	it("rejects an unknown installation health", () => {
		expect(
			Result.isFailure(
				pluginClientCatalogRecipe().decode({
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
