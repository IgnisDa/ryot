import { expect, it } from "@effect/vitest";
import type { ScalarExpression, TableReference } from "@ryot-app/contract/modules/ryotql/language";
import {
	ascending,
	average,
	castBoolean,
	castDate,
	castJson,
	castNumber,
	castText,
	coalesce,
	column,
	concat,
	conditional,
	count,
	dateBucket,
	eq,
	exists,
	first,
	floor,
	integer,
	isNotNull,
	jsonArrayCount,
	jsonArrayExists,
	jsonArrayFirst,
	jsonElement,
	jsonPath,
	kebabCase,
	literal,
	maximum,
	minimum,
	multiply,
	round,
	sum,
	table,
} from "@ryot-app/ryotql";

import { getCatalogTable } from "./catalog";
import type { ScalarKind } from "./expression-kind";
import { expressionKind } from "./validator";

const view = table("savedView", "v");
const entity = table("entity", "e");
const nested = table("event", "n");

const catalogScope = (...references: readonly TableReference[]) =>
	new Map(
		references.flatMap((reference) => {
			const catalog = getCatalogTable(reference.table);
			return catalog ? [[reference.alias, catalog] as const] : [];
		}),
	);

const scope = catalogScope(entity, view);
const isName = eq(column(entity, "name"), literal("target"));
const firstNested = (select: ScalarExpression) =>
	first(nested, { select, orderBy: [ascending(column(nested, "occurredAt"))] });

it("infers one kind per scalar expression variant", () => {
	const cases: readonly { readonly kind: ScalarKind; readonly expr: ScalarExpression }[] = [
		{ kind: "null", expr: literal(null) },
		{ kind: "text", expr: literal("value") },
		{ kind: "number", expr: literal(4) },
		{ kind: "boolean", expr: literal(true) },
		{ kind: "json", expr: literal({ nested: 1 }) },
		{ kind: "text", expr: column(entity, "name") },
		{ kind: "json", expr: column(entity, "properties") },
		{ kind: "date", expr: column(entity, "createdAt") },
		{ kind: "number", expr: column(view, "sortOrder") },
		{ kind: "boolean", expr: column(view, "isBuiltin") },
		{ kind: "text", expr: castText(column(entity, "properties")) },
		{ kind: "date", expr: castDate(column(entity, "name")) },
		{ kind: "json", expr: castJson(column(entity, "name")) },
		{ kind: "number", expr: castNumber(column(entity, "name")) },
		{ kind: "boolean", expr: castBoolean(column(entity, "name")) },
		{
			kind: "date",
			expr: dateBucket(column(entity, "createdAt"), { bucket: "day", timeZone: "UTC" }),
		},
		{ kind: "json", expr: jsonPath(column(entity, "properties"), "title") },
		{ kind: "boolean", expr: exists(nested) },
		{ kind: "boolean", expr: isNotNull(column(entity, "name")) },
		{ kind: "text", expr: concat(column(entity, "name"), literal("suffix")) },
		{ kind: "text", expr: kebabCase(column(entity, "name")) },
		{ kind: "number", expr: count(nested) },
		{ kind: "number", expr: sum(nested, column(nested, "occurredAt")) },
		{ kind: "number", expr: average(nested, column(nested, "occurredAt")) },
		{ kind: "date", expr: maximum(nested, column(nested, "occurredAt")) },
		{ kind: "date", expr: minimum(nested, column(entity, "createdAt")) },
		{ kind: "text", expr: maximum(entity, column(entity, "name")) },
		{ kind: "text", expr: minimum(entity, column(entity, "name")) },
		{ kind: "number", expr: maximum(view, column(view, "sortOrder")) },
		{ kind: "number", expr: minimum(view, column(view, "sortOrder")) },
		{ kind: "json", expr: maximum(nested, column(nested, "properties")) },
		{ kind: "boolean", expr: minimum(view, column(view, "isBuiltin")) },
		{ kind: "number", expr: multiply(literal(2), column(view, "sortOrder")) },
		{ kind: "number", expr: floor(column(view, "sortOrder")) },
		{ kind: "number", expr: integer(column(view, "sortOrder")) },
		{ kind: "number", expr: round(column(view, "sortOrder")) },
		{ kind: "text", expr: coalesce(column(entity, "name"), literal("fallback")) },
		{ kind: "text", expr: coalesce(literal(null), column(entity, "name")) },
		{ kind: "null", expr: coalesce(literal(null), literal(null)) },
		{ kind: "json", expr: coalesce(column(entity, "name"), column(view, "sortOrder")) },
		{ kind: "text", expr: conditional(isName, column(entity, "name"), literal("fallback")) },
		{ kind: "null", expr: conditional(isName, literal(null), literal(null)) },
		{ kind: "json", expr: conditional(isName, column(entity, "name"), column(view, "sortOrder")) },
		{ kind: "date", expr: firstNested(column(nested, "occurredAt")) },
		{ kind: "json", expr: firstNested(column(nested, "properties")) },
		{ kind: "text", expr: firstNested(column(entity, "name")) },
		{ kind: "number", expr: firstNested(count(nested)) },
		{ kind: "json", expr: jsonElement() },
		{ kind: "boolean", expr: jsonArrayExists(jsonPath(column(entity, "properties"), "schedule")) },
		{ kind: "number", expr: jsonArrayCount(jsonPath(column(entity, "properties"), "schedule")) },
		{
			kind: "date",
			expr: jsonArrayFirst(jsonPath(column(entity, "properties"), "schedule"), {
				select: castDate(jsonPath(jsonElement(), "airingAt")),
				orderBy: [ascending(castDate(jsonPath(jsonElement(), "airingAt")))],
			}),
		},
		{
			kind: "json",
			expr: jsonArrayFirst(jsonPath(column(entity, "properties"), "schedule"), {
				select: jsonElement(),
				orderBy: [ascending(column(entity, "createdAt"))],
			}),
		},
	];
	for (const { expr, kind } of cases) {
		expect({ type: expr.type, kind: expressionKind(expr, scope) }).toEqual({
			kind,
			type: expr.type,
		});
	}
});

it("leaves unresolvable column kinds undefined", () => {
	const unknownTable = table("unknownTable", "u");
	const unresolved: readonly ScalarExpression[] = [
		column(nested, "occurredAt"),
		column(entity, "unknownField"),
		maximum(nested, column(nested, "unknownField")),
		firstNested(column(nested, "unknownField")),
		first(unknownTable, {
			select: column(unknownTable, "id"),
			orderBy: [ascending(column(entity, "createdAt"))],
		}),
	];
	for (const expr of unresolved) {
		expect(expressionKind(expr, scope)).toBeUndefined();
	}
});
