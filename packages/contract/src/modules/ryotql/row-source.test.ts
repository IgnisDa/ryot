import { describe, expect, it } from "vitest";

import { PluginId } from "../../schema/brands";
import {
	mapRowSourceQueryReferences,
	rowSourceDocument,
	rowSourceNamedQuery,
	type RowSourceQuery,
} from "./row-source";

const query: RowSourceQuery = {
	from: { alias: "entity", table: "entity" },
	where: {
		operator: "eq",
		type: "comparison",
		right: { type: "pluginId", reference: { kind: "self" } },
		left: { type: "column", tableAlias: "entity", field: "entitySchemaPluginId" },
	},
	output: {
		type: "rows",
		fields: [
			{ key: "startAt", expr: { type: "column", field: "createdAt", tableAlias: "entity" } },
			{ key: "owner", expr: { type: "pluginId", reference: { kind: "self" } } },
		],
	},
};

describe("row source queries", () => {
	it("binds plugin identity references without adding kernel-owned output settings", () => {
		const bound = mapRowSourceQueryReferences(query, (reference) =>
			reference.kind === "self"
				? { kind: "local", pluginId: PluginId.make("plugin-1") }
				: reference,
		);
		expect(bound).toEqual({
			...query,
			where: {
				...query.where,
				right: { type: "pluginId", reference: { kind: "local", pluginId: "plugin-1" } },
			},
			output: {
				type: "rows",
				fields: [
					query.output.fields[0],
					{
						key: "owner",
						expr: { type: "pluginId", reference: { kind: "local", pluginId: "plugin-1" } },
					},
				],
			},
		});
		expect(Object.keys(bound.output).sort()).toEqual(["fields", "type"]);
	});

	it("builds kernel-owned named queries and validation documents", () => {
		const orderBy = [
			{ direction: "asc", expr: { type: "column", field: "createdAt", tableAlias: "entity" } },
		] as const;
		expect(rowSourceNamedQuery(query, { orderBy, pagination: { limit: 100 } })).toEqual({
			...query,
			output: { ...query.output, orderBy, pagination: { limit: 100 } },
		});
		expect(Object.values(rowSourceDocument(query).queries)).toEqual([
			{ ...query, output: { ...query.output, orderBy: [], pagination: { limit: 1 } } },
		]);
	});
});
