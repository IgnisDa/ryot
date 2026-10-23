import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { PluginId } from "../../schema/brands";
import {
	calendarSourceDocument,
	calendarSourceNamedQuery,
	type CalendarSourceQuery,
	mapCalendarSourceQueryReferences,
	SetCalendarSourceVisibilityBody,
} from "./schemas";

const query: CalendarSourceQuery = {
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

describe("calendar source queries", () => {
	it("binds plugin identity references without adding kernel-owned output settings", () => {
		const bound = mapCalendarSourceQueryReferences(query, (reference) =>
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
		expect(calendarSourceNamedQuery(query, { orderBy, pagination: { limit: 100 } })).toEqual({
			...query,
			output: { ...query.output, orderBy, pagination: { limit: 100 } },
		});
		expect(Object.values(calendarSourceDocument(query).queries)).toEqual([
			{ ...query, output: { ...query.output, orderBy: [], pagination: { limit: 1 } } },
		]);
	});
});

describe("calendar source visibility body", () => {
	it("accepts exact plugin source identities and rejects extra properties", () => {
		const decode = Schema.decodeUnknownSync(SetCalendarSourceVisibilityBody);
		expect(decode({ slug: "dates", isHidden: true, pluginId: "plugin-1" })).toEqual({
			slug: "dates",
			isHidden: true,
			pluginId: "plugin-1",
		});
		expect(() =>
			decode({ slug: "dates", isHidden: true, userId: "other", pluginId: "plugin-1" }),
		).toThrow();
		expect(() => decode({ slug: "dates", pluginId: "plugin-1" })).toThrow();
	});
});
