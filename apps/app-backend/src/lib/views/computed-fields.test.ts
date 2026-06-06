import { describe, expect, it } from "vitest";

import { createComputedFieldExpression, createLiteralExpression } from "#lib/query-language";

import {
	buildComputedFieldMap,
	getComputedFieldDependencies,
	orderComputedFields,
} from "./computed-fields";

describe("computed fields", () => {
	it("collects dependencies from expressions and predicate branches", () => {
		expect(
			getComputedFieldDependencies({
				type: "conditional",
				whenFalse: createLiteralExpression(null),
				whenTrue: createComputedFieldExpression("label"),
				condition: {
					operator: "gte",
					type: "comparison",
					right: createLiteralExpression(4),
					left: createComputedFieldExpression("score"),
				},
			}),
		).toEqual(["score", "label"]);
	});

	it("orders nested computed fields in dependency order", () => {
		expect(
			orderComputedFields([
				{ key: "summary", expression: createComputedFieldExpression("label") },
				{ key: "label", expression: createComputedFieldExpression("base") },
				{ key: "base", expression: createLiteralExpression("Alpha") },
			]).map((field) => field.key),
		).toEqual(["base", "label", "summary"]);
	});

	it("rejects duplicate computed field keys", () => {
		expect(() =>
			buildComputedFieldMap([
				{ key: "label", expression: createLiteralExpression("A") },
				{ key: "label", expression: createLiteralExpression("B") },
			]),
		).toThrow("Computed field 'label' is defined more than once");
	});

	it("rejects dependency cycles with the full path", () => {
		expect(() =>
			orderComputedFields([
				{ key: "first", expression: createComputedFieldExpression("second") },
				{ key: "second", expression: createComputedFieldExpression("third") },
				{ key: "third", expression: createComputedFieldExpression("first") },
			]),
		).toThrow("Computed field dependency cycle detected: first -> second -> third -> first");
	});
});
