import type { BrowseField } from "@ryot-app/contract/modules/filters/browse";
import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/language";
import { castNumber, castText, column, jsonPath, literal, table } from "@ryot-app/ryotql";
import { expect, it } from "vitest";

import { browseConsistencyIssue, browseIssue } from "./browse-validation";

const subject = table("entity", "subject");
const rating: BrowseField = {
	key: "rating",
	kind: "value",
	type: "number",
	label: "Rating",
	sort: { ascending: "Lowest rated", descending: "Highest rated" },
	expression: castNumber(jsonPath(column(subject, "properties"), "rating")),
};

const sorted = (expression: ScalarExpression) => ({
	browse: {
		fields: [
			{
				expression,
				key: "added",
				kind: "sort" as const,
				sort: { ascending: "Old", descending: "New" },
			},
		],
	},
});

const issue = (...fields: readonly BrowseField[]) => browseIssue({ fields });

it("accepts read-only expressions whose kind matches the declared type", () => {
	expect(issue(rating)).toBeUndefined();
	expect(
		issue({
			kind: "sort",
			key: "named",
			expression: column(subject, "name"),
			sort: { ascending: "A-Z", descending: "Z-A" },
		}),
	).toBeUndefined();
});

it("rejects malformed, reserved and duplicate keys", () => {
	expect(issue({ ...rating, key: "user-rating" })).toBe(
		"browse field key 'user-rating' must be camelCase letters and digits",
	);
	expect(issue({ ...rating, key: "name" })).toBe("browse field key 'name' is reserved");
	expect(issue({ ...rating, key: "collections" })).toBe(
		"browse field key 'collections' is reserved",
	);
	expect(issue(rating, rating)).toBe("browse field key 'rating' must be unique");
});

it("rejects expressions of the wrong kind or outside the subject", () => {
	expect(issue({ ...rating, expression: castText(column(subject, "name")) })).toBe(
		"browse field 'rating' expression has kind 'text'",
	);
	expect(issue({ ...rating, expression: column(table("entity", "other"), "name") })).toContain(
		"browse field 'rating' expression is invalid",
	);
});

it("rejects duplicate choices and sorted list fields", () => {
	expect(
		issue({
			key: "tags",
			kind: "value",
			label: "Tags",
			type: "enum-list",
			expression: jsonPath(column(subject, "properties"), "tags"),
			choices: [
				{ value: "a", label: "A" },
				{ value: "a", label: "B" },
			],
		}),
	).toBe("browse field 'tags' choices must be unique");
	expect(
		issue({
			key: "tags",
			kind: "value",
			label: "Tags",
			type: "text-list",
			sort: { ascending: "A", descending: "Z" },
			expression: jsonPath(column(subject, "properties"), "tags"),
		}),
	).toBe("browse field 'tags' of type text-list cannot be sorted");
});

it("requires a key shared across entity schemas to keep its kind and type", () => {
	expect(
		browseConsistencyIssue([
			{ slug: "movie", browse: { fields: [rating] } },
			{ slug: "show", browse: { fields: [{ ...rating, label: "Score" }] } },
			{ slug: "person" },
		]),
	).toBeUndefined();
	expect(
		browseConsistencyIssue([
			{ slug: "movie", browse: { fields: [rating] } },
			{
				slug: "show",
				browse: {
					fields: [
						{
							key: "rating",
							kind: "value",
							type: "boolean",
							label: "Rating",
							expression: literal(true),
						},
					],
				},
			},
		]),
	).toBe("Browse field 'rating' differs between entity schemas movie and show");
});

it("requires sort-only fields sharing a key to sort the same kind", () => {
	expect(
		browseConsistencyIssue([
			{ slug: "movie", ...sorted(column(subject, "createdAt")) },
			{ slug: "show", ...sorted(column(subject, "updatedAt")) },
		]),
	).toBeUndefined();
	expect(
		browseConsistencyIssue([
			{ slug: "movie", ...sorted(column(subject, "createdAt")) },
			{ slug: "show", ...sorted(column(subject, "name")) },
		]),
	).toBe("Browse field 'added' differs between entity schemas movie and show");
});
