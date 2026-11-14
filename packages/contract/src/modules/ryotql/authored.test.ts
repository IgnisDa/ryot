import { expect, it } from "bun:test";

import { type ScalarExpression, scalarExpressionTables } from "./authored";

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
