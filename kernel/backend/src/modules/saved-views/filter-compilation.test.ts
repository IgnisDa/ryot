import { expect, it } from "bun:test";

import type { Filter, FilterField } from "@ryot-app/contract/modules/filters/schemas";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import { EntitySchemaSlug, EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	castBoolean,
	castDate,
	castNumber,
	castText,
	column,
	document,
	eq,
	field,
	join,
	jsonPath,
	rows,
	table,
} from "@ryot-app/ryotql";
import { filter as filterPlaceholder } from "@ryot-app/ryotql/authoring";
import { DateTime, Result } from "effect";

import { savedViewDataSourceAccess, validateRyotQLDocument } from "#modules/ryotql/validator";

import { bindControlFixture } from "./controls.test-support";

const entity = table("entity", "entity");
const properties = column(entity, "properties");
const now = DateTime.makeUnsafe("2026-03-10T12:00:00.000Z");

const valueField = (
	key: string,
	type: "enum" | "text" | "date" | "number" | "boolean" | "enum-list" | "text-list",
): FilterField =>
	type === "enum" || type === "enum-list"
		? {
				key,
				type,
				label: key,
				field: key,
				kind: "value",
				choices: [
					{ value: "a", label: "A" },
					{ value: "b", label: "B" },
				],
			}
		: { key, type, label: key, field: key, kind: "value" };

const filterFields = [
	valueField("displayName", "text"),
	valueField("level", "enum"),
	valueField("muscles", "enum-list"),
	valueField("genres", "text-list"),
	valueField("reps", "number"),
	valueField("done", "boolean"),
	valueField("added", "date"),
	valueField("released", "date"),
	{
		key: "records",
		label: "Records",
		kind: "session-event",
		event: {
			owner: { kind: "kernel" },
			slug: EventSchemaSlug.make("record-set"),
			entitySchemaSlug: EntitySchemaSlug.make("record"),
		},
	},
] satisfies readonly FilterField[];

const selection = (extraJoins: readonly ReturnType<typeof join>[] = []) =>
	document({
		selection: rows(entity, {
			limit: 40,
			orderBy: [{ direction: "asc", expr: column(entity, "id") }],
			...(extraJoins.length > 0 ? { joins: extraJoins } : {}),
			fields: [
				field("displayName", column(entity, "name")),
				field("level", jsonPath(properties, "level")),
				field("muscles", jsonPath(properties, "muscles")),
				field("genres", jsonPath(properties, "genres")),
				field("reps", jsonPath(properties, "reps")),
				field("done", jsonPath(properties, "done")),
				field("added", column(entity, "createdAt")),
				field("released", jsonPath(properties, "released")),
			],
		}),
	});

const subject = table("entity", "subject");

const browseExpression = (filterField: Extract<FilterField, { readonly kind: "value" }>) => {
	if (filterField.field === "displayName") {
		return column(subject, "name");
	}
	if (filterField.field === "added") {
		return column(subject, "createdAt");
	}
	const value = jsonPath(column(subject, "properties"), filterField.field);
	switch (filterField.type) {
		case "enum":
		case "text":
			return castText(value);
		case "date":
			return castDate(value);
		case "rating":
		case "number":
			return castNumber(value);
		case "boolean":
			return castBoolean(value);
		case "enum-list":
		case "text-list":
			return value;
		default:
			return filterField satisfies never;
	}
};

const browse = [
	{
		slug: "item",
		pluginId: null,
		browse: {
			fields: filterFields.map((filterField) => {
				if (filterField.kind !== "value") {
					return filterField;
				}
				const { field: _, ...rest } = filterField;
				return Object.assign({}, rest, { expression: browseExpression(filterField) });
			}),
		},
	},
];

const settings = {
	pageSize: 10,
	addAction: null,

	layouts: ["grid"],
	tableColumns: null,
	defaultLayout: "grid",
	sourceName: "selection",
	summary: { image: null, subtitle: null },
	subject: {
		entityAlias: "entity",
		schemas: [{ owner: { kind: "kernel" }, slug: EntitySchemaSlug.make("item") }],
	},
} as const;

const bindBrowserFixture = (input: {
	readonly filter: Filter;
	readonly now: DateTime.Utc;
	readonly browse: typeof browse;
	readonly settings: typeof settings;
	readonly queryDocument: RyotQLDocument;
}) => {
	const source = input.queryDocument.queries[input.settings.sourceName];
	if (!source) {
		return Result.fail(new Error("Missing source"));
	}
	const authored: RyotQLDocument = {
		...input.queryDocument,
		controls: {
			filter: {
				kind: "browse",
				alias: "entity",
				schemas: [{ slug: "item", owner: { kind: "kernel" } }],
			},
		},
		queries: {
			selection: {
				...source,
				where: {
					type: "and",
					predicates: [...(source.where ? [source.where] : []), filterPlaceholder()],
				},
			},
		},
	};
	return bindControlFixture({
		now: input.now,
		document: authored,
		filter: input.filter,
		schemas: input.browse.map((entry) => ({
			...entry,
			packageId: null,
			isEffective: true,
			pluginScope: null,
		})),
	});
};
const bindTableFixture = (input: {
	readonly filter: Filter;
	readonly now: DateTime.Utc;
	readonly queryDocument: RyotQLDocument;
	readonly settings: { readonly filterFields: readonly FilterField[] };
}) => {
	const source = input.queryDocument.queries["selection"];
	if (!source) {
		return Result.fail(new Error("Missing source"));
	}
	const authored: RyotQLDocument = {
		...input.queryDocument,
		controls: {
			filter: {
				kind: "outputs",
				query: "selection",
				fields: input.settings.filterFields.filter((value) => value.kind === "value"),
			},
		},
		queries: {
			selection: {
				...source,
				where: {
					type: "and",
					predicates: [...(source.where ? [source.where] : []), filterPlaceholder()],
				},
			},
		},
	};
	return bindControlFixture({
		schemas: [],
		now: input.now,
		document: authored,
		filter: input.filter,
	});
};
const issue = (filter: Filter, queryDocument = selection()) =>
	validateRyotQLDocument(
		Result.getOrThrow(bindBrowserFixture({ now, filter, browse, settings, queryDocument }))
			.document,
		savedViewDataSourceAccess,
	).error;

const operatorFamilies: readonly Filter[] = [
	{ field: "level", operator: "anyOf", values: ["a", "b"] },
	{ values: ["a"], field: "level", operator: "noneOf" },
	{ field: "level", operator: "empty" },
	{ field: "level", operator: "notEmpty" },
	{ value: "sq", operator: "contains", field: "displayName" },
	{ value: "sq", field: "displayName", operator: "notContains" },
	{ operator: "is", value: "Squat", field: "displayName" },
	{ value: 3, field: "reps", operator: "gte" },
	{ value: 3, field: "reps", operator: "lte" },
	{ value: 3, field: "reps", operator: "eq" },
	{ min: 1, max: 5, field: "reps", operator: "between" },
	{ field: "done", operator: "isTrue" },
	{ field: "done", operator: "isFalse" },
	{ field: "added", operator: "before", value: "2026-01-01" },
	{ field: "added", operator: "after", value: "2026-01-01" },
	{ field: "added", to: "2026-02-01", from: "2026-01-01", operator: "betweenDates" },
	{ days: 30, field: "added", operator: "withinLastDays" },
	{ days: 30, field: "released", operator: "withinLastDays" },
	{ field: "released", operator: "after", value: "2026-01-01" },
	{ field: "muscles", operator: "anyOf", values: ["a", "b"] },
	{ field: "muscles", operator: "allOf", values: ["a", "b"] },
	{ values: ["a"], field: "muscles", operator: "noneOf" },
	{ field: "muscles", operator: "empty" },
	{ field: "muscles", operator: "notEmpty" },
	{ value: "dra", field: "genres", operator: "contains" },
	{ operator: "anyOf", field: "collections", values: ["c1", "c2"] },
	{ operator: "allOf", field: "collections", values: ["c1", "c2"] },
	{ values: ["c1"], operator: "noneOf", field: "collections" },
	{ operator: "empty", field: "collections" },
	{ field: "collections", operator: "notEmpty" },
	{ field: "records", operator: "anyOf", values: ["e1", "e2"] },
	{ field: "records", operator: "allOf", values: ["e1", "e2"] },
	{ values: ["e1"], field: "records", operator: "noneOf" },
	{ field: "records", operator: "empty" },
	{ field: "records", operator: "notEmpty" },
];

it("compiles every operator family into a document the RyotQL validator accepts", () => {
	for (const filter of operatorFamilies) {
		expect(issue(filter), JSON.stringify(filter)).toBeNull();
	}
});

it("validates nested filters", () => {
	expect(
		issue({
			type: "and",
			filters: [
				{ type: "not", filter: { values: ["a"], field: "level", operator: "anyOf" } },
				{
					type: "or",
					filters: [
						{ values: ["c1"], operator: "anyOf", field: "collections" },
						{ field: "muscles", operator: "notEmpty" },
					],
				},
			],
		}),
	).toBeNull();
});

it("validates a relationship filter on a source that already uses the relationship alias", () => {
	const relationship = table("relationship", "relationship");
	const crowded = selection([
		join("left", relationship, eq(column(relationship, "sourceEntityId"), column(entity, "id"))),
	]);
	expect(issue({ values: ["c1"], operator: "anyOf", field: "collections" }, crowded)).toBeNull();
	expect(
		issue(
			{
				type: "and",
				filters: [
					{ values: ["c1"], operator: "anyOf", field: "collections" },
					{ operator: "allOf", field: "collections", values: ["c2", "c3"] },
				],
			},
			crowded,
		),
	).toBeNull();
});

it("applies value filters to results tables and rejects the Collections field there", () => {
	const tableSettings = {
		filterFields,
		pageSize: 10,
		entityLink: null,
		rowKeyFields: ["name"],
		sourceName: "selection",
		columns: [{ label: "Name", displayKind: "text", field: "displayName" }],
	} as const;
	const prepared = bindTableFixture({
		now,
		settings: tableSettings,
		queryDocument: selection(),
		filter: { days: 7, field: "added", operator: "withinLastDays" },
	});
	expect(
		validateRyotQLDocument(Result.getOrThrow(prepared).document, savedViewDataSourceAccess).error,
	).toBeNull();
	expect(
		Result.isFailure(
			bindTableFixture({
				now,
				settings: tableSettings,
				queryDocument: selection(),
				filter: { field: "collections", operator: "notEmpty" },
			}),
		),
	).toBe(true);
	expect(
		Result.isFailure(
			bindTableFixture({
				now,
				settings: tableSettings,
				queryDocument: selection(),
				filter: { field: "records", operator: "notEmpty" },
			}),
		),
	).toBe(true);
});
