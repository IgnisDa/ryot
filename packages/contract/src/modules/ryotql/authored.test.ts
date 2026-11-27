import { expect, it } from "bun:test";

import { Schema } from "effect";

import {
	PluginRyotQLDocument,
	type ScalarExpression,
	scalarExpressionTables,
	stampRyotQLDocument,
} from "./authored";

const pluginDocument = (label: unknown) => {
	const input: unknown = {
		queries: {},
		parameters: { fields: { name: { label, type: "string", description: "Name" } } },
	};
	return Schema.decodeUnknownResult(PluginRyotQLDocument)(input);
};

it("stamps plugin-authored parameter text and keeps kernel messages", () => {
	const kernelLabel = { namespace: "kernel", key: "recipe.parameter.search" };
	const document = {
		queries: {},
		parameters: {
			fields: {
				search: { type: "string", label: kernelLabel, description: "Search" },
				name: { type: "string", description: "Name", label: { key: "query-parameter.name" } },
			},
		},
	} as const;
	expect(stampRyotQLDocument("plugin-1", document).parameters?.fields).toEqual({
		search: { type: "string", label: kernelLabel, description: "Search" },
		name: {
			type: "string",
			description: "Name",
			label: { namespace: "plugin-1", key: "query-parameter.name" },
		},
	});
});

it("rejects plain strings and other plugins' messages as plugin-authored parameter text", () => {
	expect(pluginDocument({ key: "query-parameter.name" })._tag).toBe("Success");
	expect(pluginDocument("Name")._tag).toBe("Failure");
	expect(pluginDocument({ namespace: "other-plugin", key: "query-parameter.name" })._tag).toBe(
		"Failure",
	);
});

it("discovers tables hidden in unselected authored choices and guarded correlated branches", () => {
	const expression: ScalarExpression = {
		type: "choice",
		parameter: "mode",
		cases: {
			visible: { value: 1, type: "literal" },
			hidden: {
				type: "conditional",
				whenFalse: { value: 0, type: "literal" },
				whenTrue: {
					type: "aggregate",
					aggregation: { function: "count" },
					query: { from: { table: "entity", alias: "entity" } },
				},
				condition: {
					type: "whenSet",
					parameter: "search",
					predicate: {
						type: "exists",
						query: {
							from: { table: "event", alias: "event" },
							joins: [
								{
									type: "inner",
									on: { type: "and", predicates: [] },
									table: { alias: "link", table: "relationship" },
								},
							],
						},
					},
				},
			},
		},
	};
	expect([...scalarExpressionTables(expression)].sort()).toEqual([
		"entity",
		"event",
		"relationship",
	]);
});

it("keeps unresolved source entities distinct from ordinary entity tables and ignores literal JSON", () => {
	expect([
		...scalarExpressionTables({
			type: "exists",
			query: { from: { alias: "selection", parameter: "source", type: "sourceEntity" } },
		}),
	]).toEqual(["sourceEntity"]);
	expect([
		...scalarExpressionTables({
			type: "literal",
			value: { from: { table: "event", alias: "event" } },
		}),
	]).toEqual([]);
});
