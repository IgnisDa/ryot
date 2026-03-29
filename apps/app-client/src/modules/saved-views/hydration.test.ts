import type {
	ColumnExpression,
	FieldSelection,
	NamedQuery,
	Predicate,
	RyotQLDocument,
	RowsOutput,
	ScalarExpression,
	TableReference,
} from "@ryot/contract/modules/ryotql/language";
import { describe, expect, it } from "vitest";

import { buildSavedViewHydrationDocument } from "./hydration";

const entity = { alias: "entity", table: "entity" } satisfies TableReference;
const metadata = { alias: "metadata", table: "metadata" } satisfies TableReference;
const column = (table: TableReference, field: string): ColumnExpression => ({
	field,
	type: "column",
	tableAlias: table.alias,
});
const field = (key: string, expr: ScalarExpression): FieldSelection => ({ expr, key });
const literal = (value: string) => ({ type: "literal", value }) as const;
const equal = (left: ScalarExpression, right: ScalarExpression) =>
	({ left, right, type: "comparison", operator: "eq" }) satisfies Predicate;
const entityId = column(entity, "id");

const queryFrom = (fields: readonly FieldSelection[]) =>
	({
		queries: {
			savedView: {
				from: entity,
				where: equal(column(entity, "entitySchemaSlug"), literal("media")),
				joins: [
					{ type: "left", table: metadata, on: equal(column(metadata, "entityId"), entityId) },
				],
				output: {
					fields,
					type: "rows",
					pagination: { limit: 20, after: "cursor-2" },
					orderBy: [
						{ direction: "asc", expr: column(entity, "name") },
						{ direction: "asc", expr: entityId },
					],
				},
			},
		},
	}) satisfies RyotQLDocument;

type RowsQuery = NamedQuery & { readonly output: RowsOutput };

const isRowsQuery = (selected: NamedQuery): selected is RowsQuery =>
	selected.output.type === "rows";

const query = (queryDocument: RyotQLDocument): RowsQuery => {
	const selected = queryDocument.queries.savedView;
	if (!isRowsQuery(selected)) {
		throw new TypeError("Expected savedView rows query");
	}
	return selected;
};

describe("saved-view hydration document", () => {
	it.each([
		{
			layout: "grid",
			fields: [
				field("entityId", entityId),
				field("title", column(entity, "name")),
				field("image", column(entity, "image")),
			],
		},
		{
			layout: "list",
			fields: [
				field("title", column(entity, "name")),
				field("entityId", entityId),
				field("primaryMetadata", column(metadata, "value")),
			],
		},
		{
			layout: "table",
			fields: [
				field("column0", column(entity, "name")),
				field("column1", column(entity, "createdAt")),
				field("entityId", entityId),
			],
		},
	])("preserves $layout projections, joins, expressions, and ordering", ({ fields }) => {
		const queryDocument = queryFrom(fields);
		const hydrated = buildSavedViewHydrationDocument({
			queryDocument,
			entityIdField: "entityId",
			entityIds: ["entity-1", "entity-2"],
		});

		expect(query(hydrated)).toMatchObject({
			from: query(queryDocument).from,
			joins: query(queryDocument).joins,
			output: {
				fields,
				type: "rows",
				pagination: { limit: 2 },
				orderBy: query(queryDocument).output.orderBy,
			},
		});
		expect(query(hydrated).where).toEqual({
			type: "and",
			predicates: [
				query(queryDocument).where,
				{ type: "in", expr: entityId, values: [literal("entity-1"), literal("entity-2")] },
			],
		});
	});

	it("looks up the entity ID expression by projection key", () => {
		const projectedEntityId = column(metadata, "canonicalEntityId");
		const hydrated = buildSavedViewHydrationDocument({
			entityIds: ["entity-1"],
			entityIdField: "selectedEntityId",
			queryDocument: queryFrom([
				field("entityId", entityId),
				field("selectedEntityId", projectedEntityId),
			]),
		});

		expect(query(hydrated).where).toMatchObject({
			type: "and",
			predicates: [{}, { type: "in", expr: projectedEntityId }],
		});
	});

	it("uses the entity predicate directly when the source has no predicate", () => {
		const queryDocument = {
			queries: {
				savedView: {
					from: entity,
					output: {
						type: "rows",
						pagination: { limit: 20 },
						fields: [field("entityId", entityId)],
						orderBy: [{ direction: "asc", expr: entityId }],
					},
				},
			},
		} satisfies RyotQLDocument;
		const hydrated = buildSavedViewHydrationDocument({
			queryDocument,
			entityIds: ["entity-1"],
			entityIdField: "entityId",
		});

		expect(query(hydrated).where).toEqual({
			type: "in",
			expr: entityId,
			values: [literal("entity-1")],
		});
	});

	it("does not mutate the source document", () => {
		const queryDocument = queryFrom([field("entityId", entityId)]);
		const snapshot = structuredClone(queryDocument);
		Object.freeze(queryDocument);
		Object.freeze(queryDocument.queries);
		Object.freeze(queryDocument.queries.savedView);
		Object.freeze(queryDocument.queries.savedView.output);
		Object.freeze(queryDocument.queries.savedView.output.pagination);

		const hydrated = buildSavedViewHydrationDocument({
			queryDocument,
			entityIds: ["entity-1"],
			entityIdField: "entityId",
		});

		expect(queryDocument).toEqual(snapshot);
		expect(hydrated).not.toBe(queryDocument);
		expect(query(hydrated)).not.toBe(query(queryDocument));
		expect(query(hydrated).output).not.toBe(query(queryDocument).output);
		expect(query(hydrated).output.pagination).toEqual({ limit: 1 });
	});

	const malformedInputs: readonly {
		readonly label: string;
		readonly entityIdField: string;
		readonly entityIds: readonly string[];
		readonly queryDocument: RyotQLDocument;
	}[] = [
		{
			entityIds: [],
			entityIdField: "entityId",
			label: "an empty entity ID batch",
			queryDocument: queryFrom([field("entityId", entityId)]),
		},
		{
			label: "no query",
			entityIds: ["entity-1"],
			entityIdField: "entityId",
			queryDocument: { queries: {} } satisfies RyotQLDocument,
		},
		{
			entityIds: ["entity-1"],
			label: "multiple queries",
			entityIdField: "entityId",
			queryDocument: {
				queries: {
					first: queryFrom([field("entityId", entityId)]).queries.savedView,
					second: queryFrom([field("entityId", entityId)]).queries.savedView,
				},
			} satisfies RyotQLDocument,
		},
		{
			entityIds: ["entity-1"],
			label: "a non-rows query",
			entityIdField: "entityId",
			queryDocument: {
				queries: {
					savedView: {
						from: entity,
						output: {
							type: "aggregate",
							measures: [{ key: "total", aggregation: { function: "count" } }],
						},
					},
				},
			} satisfies RyotQLDocument,
		},
		{
			entityIds: ["entity-1"],
			entityIdField: "entityId",
			label: "a missing entity ID projection",
			queryDocument: queryFrom([field("title", column(entity, "name"))]),
		},
		{
			entityIds: ["entity-1"],
			entityIdField: "entityId",
			label: "duplicate entity ID projections",
			queryDocument: queryFrom([
				field("entityId", entityId),
				field("entityId", column(metadata, "entityId")),
			]),
		},
	];

	it.each(malformedInputs)("rejects $label", (input) => {
		expect(() => buildSavedViewHydrationDocument(input)).toThrow();
	});
});
