import { describe, expect, it } from "bun:test";
import {
	buildComputedFieldMap,
	getComputedFieldDependencies,
	orderComputedFields,
} from "./computed-fields";
import type { ViewExpression } from "./expression";

const literalExpression = (value: unknown): ViewExpression => ({
	type: "literal",
	value,
});

const computedExpression = (key: string): ViewExpression => ({
	type: "reference",
	reference: { key, type: "computed-field" },
});

describe("computed fields", () => {
	it("collects dependencies from expressions and predicate branches", () => {
		expect(
			getComputedFieldDependencies({
				type: "conditional",
				whenTrue: computedExpression("label"),
				whenFalse: literalExpression(null),
				condition: {
					operator: "gte",
					type: "comparison",
					right: literalExpression(4),
					left: computedExpression("score"),
				},
			}),
		).toEqual(["score", "label"]);
	});

	it("orders nested computed fields in dependency order", () => {
		expect(
			orderComputedFields([
				{ key: "summary", expression: computedExpression("label") },
				{ key: "label", expression: computedExpression("base") },
				{ key: "base", expression: literalExpression("Alpha") },
			]).map((field) => field.key),
		).toEqual(["base", "label", "summary"]);
	});

	it("rejects duplicate computed field keys", () => {
		expect(() =>
			buildComputedFieldMap([
				{ key: "label", expression: literalExpression("A") },
				{ key: "label", expression: literalExpression("B") },
			]),
		).toThrow("Computed field 'label' is defined more than once");
	});

	it("rejects dependency cycles with the full path", () => {
		expect(() =>
			orderComputedFields([
				{ key: "first", expression: computedExpression("second") },
				{ key: "second", expression: computedExpression("third") },
				{ key: "third", expression: computedExpression("first") },
			]),
		).toThrow(
			"Computed field dependency cycle detected: first -> second -> third -> first",
		);
	});
});
