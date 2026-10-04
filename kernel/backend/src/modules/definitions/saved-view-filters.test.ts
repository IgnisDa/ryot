import type { FilterField } from "@ryot-app/contract/modules/filters/schemas";
import type { KernelSavedViewRendererName } from "@ryot-app/contract/modules/saved-views/schemas";
import { RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import { column, document, field, jsonPath, rows, table } from "@ryot-app/ryotql";
import { expect, it } from "vitest";

import { filterFieldIssues } from "./saved-view-filters";

const entity = table("entity", "entity");
const query = document({
	source: rows(entity, {
		fields: [
			field("name", column(entity, "name")),
			field("level", jsonPath(column(entity, "properties"), "level")),
		],
	}),
}).queries["source"];

const level: FilterField = {
	key: "level",
	type: "enum",
	kind: "value",
	field: "level",
	label: "Level",
	choices: [{ value: "easy", label: "Easy" }],
};
const related: FilterField = {
	key: "tags",
	label: "Tags",
	kind: "relationship",
	direction: "outgoing",
	relationship: { owner: { kind: "kernel" }, slug: RelationshipSchemaSlug.make("tagged") },
};

const issue = (
	filterFields: readonly FilterField[] | undefined,
	renderer: KernelSavedViewRendererName = "entity-browser",
) => filterFieldIssues({ query, renderer, settings: { filterFields } });

it("accepts absent, value and relationship filter fields", () => {
	expect(issue(undefined)).toBeUndefined();
	expect(issue([level, related])).toBeUndefined();
	expect(issue([related], "collection-browser")).toBeUndefined();
	expect(issue([level], "results-table")).toBeUndefined();
});

it("rejects duplicate and reserved keys", () => {
	expect(issue([level, level])).toBe("Filter field key 'level' must be unique");
	expect(issue([{ ...related, key: "collections" }])).toBe(
		"Filter field key 'collections' is reserved",
	);
});

it("rejects value fields that the source does not project", () => {
	expect(issue([{ ...level, field: "missing" }])).toBe(
		"Filter field 'level' must reference a projected scalar field",
	);
});

it("rejects duplicate enum choices", () => {
	expect(
		issue([
			{
				...level,
				choices: [
					{ value: "a", label: "A" },
					{ value: "a", label: "B" },
				],
			},
		]),
	).toBe("Filter field 'level' choices must be unique");
});

it("rejects relationship fields on results tables", () => {
	expect(issue([related], "results-table")).toBe(
		"Filter field 'tags' cannot be a relationship on a results table",
	);
});
