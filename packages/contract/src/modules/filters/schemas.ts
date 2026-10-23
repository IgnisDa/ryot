import { DateTime, Option, Schema } from "effect";

import type {
	EntitySchemaSlug,
	EventSchemaSlug,
	RelationshipSchemaSlug,
} from "../../schema/brands";
import { strictStruct } from "../../schema/utils";
import {
	AuthoredEventSchemaReference,
	AuthoredRelationshipSchemaReference,
	EventSchemaReference,
	type QueryOwnerReference,
	RelationshipSchemaReference,
} from "../plugins/references";
import { OutputFieldKey } from "../ryotql/language";

export const filterValueTypes = [
	"enum",
	"enum-list",
	"text",
	"text-list",
	"number",
	"date",
	"boolean",
] as const;
export type FilterValueType = (typeof filterValueTypes)[number];

export const filterOperators = {
	"text-list": ["contains"],
	boolean: ["isTrue", "isFalse"],
	enum: ["anyOf", "noneOf", "empty", "notEmpty"],
	text: ["contains", "notContains", "is", "empty", "notEmpty"],
	number: ["gte", "lte", "eq", "between", "empty", "notEmpty"],
	"enum-list": ["anyOf", "allOf", "noneOf", "empty", "notEmpty"],
	date: ["before", "after", "betweenDates", "withinLastDays", "empty", "notEmpty"],
} as const satisfies Record<FilterValueType, readonly string[]>;

export const linkFilterOperators = ["anyOf", "allOf", "noneOf", "empty", "notEmpty"] as const;

const FilterChoice = strictStruct({ label: Schema.String, value: Schema.NonEmptyString });

const filterFieldBase = {
	label: Schema.String,
	field: OutputFieldKey,
	key: Schema.NonEmptyString,
	kind: Schema.Literal("value"),
};

export const ValueFilterField = Schema.Union([
	strictStruct({
		...filterFieldBase,
		choices: Schema.NonEmptyArray(FilterChoice),
		type: Schema.Literals(["enum", "enum-list"]),
	}),
	strictStruct({
		...filterFieldBase,
		type: Schema.Literals(["text", "text-list", "number", "date", "boolean"]),
	}),
]);
export type ValueFilterField = typeof ValueFilterField.Type;

export const relationshipFilterField = <Reference extends Schema.Top>(relationship: Reference) =>
	strictStruct({
		relationship,
		label: Schema.String,
		key: Schema.NonEmptyString,
		kind: Schema.Literal("relationship"),
		direction: Schema.Literals(["outgoing", "incoming"]),
	});

const RelationshipFilterField = relationshipFilterField(RelationshipSchemaReference);
type RelationshipFilterField = typeof RelationshipFilterField.Type;

const AuthoredRelationshipFilterField = relationshipFilterField(
	AuthoredRelationshipSchemaReference,
);

export const sessionEventFilterField = <Reference extends Schema.Top>(event: Reference) =>
	strictStruct({
		event,
		label: Schema.String,
		key: Schema.NonEmptyString,
		kind: Schema.Literal("session-event"),
	});

const SessionEventFilterField = sessionEventFilterField(EventSchemaReference);
type SessionEventFilterField = typeof SessionEventFilterField.Type;

const AuthoredSessionEventFilterField = sessionEventFilterField(AuthoredEventSchemaReference);

export const FilterField = Schema.Union([
	ValueFilterField,
	RelationshipFilterField,
	SessionEventFilterField,
]);
export type FilterField = typeof FilterField.Type;

export const AuthoredFilterField = Schema.Union([
	ValueFilterField,
	AuthoredRelationshipFilterField,
	AuthoredSessionEventFilterField,
]);
export type AuthoredFilterField = typeof AuthoredFilterField.Type;

export type FilterFieldWith<Owner extends object> =
	| ValueFilterField
	| (Omit<RelationshipFilterField, "relationship"> & {
			readonly relationship: Owner & { readonly slug: RelationshipSchemaSlug };
	  })
	| (Omit<SessionEventFilterField, "event"> & {
			readonly event: Owner & {
				readonly slug: EventSchemaSlug;
				readonly entitySchemaSlug: EntitySchemaSlug;
			};
	  });

export type QueryFilterField = FilterFieldWith<{ readonly owner: QueryOwnerReference }>;

export const mapFilterFieldReference = <From extends object, To extends object>(
	filterField: FilterFieldWith<From>,
	mapReference: <Slug extends string>(
		reference: From & { readonly slug: Slug },
	) => To & { readonly slug: Slug },
): FilterFieldWith<To> => {
	if (filterField.kind === "value") {
		return filterField;
	}
	if (filterField.kind === "relationship") {
		return { ...filterField, relationship: mapReference(filterField.relationship) };
	}
	return {
		...filterField,
		event: {
			...mapReference(filterField.event),
			entitySchemaSlug: filterField.event.entitySchemaSlug,
		},
	};
};

const FilterDate = Schema.String.pipe(
	Schema.check(Schema.makeFilter((value) => Option.isSome(DateTime.make(value)))),
);

const filterRule = <Operator extends string, Fields extends Schema.Struct.Fields>(
	operator: Operator,
	fields: Fields,
) => strictStruct({ ...fields, field: Schema.NonEmptyString, operator: Schema.Literal(operator) });

const FilterValues = { values: Schema.NonEmptyArray(Schema.String) };
const FilterNumber = { value: Schema.Finite };
const FilterText = { value: Schema.String };

export const FilterRule = Schema.Union([
	filterRule("anyOf", FilterValues),
	filterRule("noneOf", FilterValues),
	filterRule("allOf", FilterValues),
	filterRule("empty", {}),
	filterRule("notEmpty", {}),
	filterRule("gte", FilterNumber),
	filterRule("lte", FilterNumber),
	filterRule("eq", FilterNumber),
	filterRule("between", { min: Schema.Finite, max: Schema.Finite }),
	filterRule("before", { value: FilterDate }),
	filterRule("after", { value: FilterDate }),
	filterRule("betweenDates", { to: FilterDate, from: FilterDate }),
	filterRule("withinLastDays", { days: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))) }),
	filterRule("contains", FilterText),
	filterRule("notContains", FilterText),
	filterRule("is", FilterText),
	filterRule("isTrue", {}),
	filterRule("isFalse", {}),
]);
export type FilterRule = typeof FilterRule.Type;
export type FilterOperator = FilterRule["operator"];

export type Filter =
	| FilterRule
	| { readonly type: "not"; readonly filter: Filter }
	| { readonly type: "and" | "or"; readonly filters: readonly Filter[] };

export const Filter: Schema.Codec<Filter, unknown> = Schema.suspend(() =>
	Schema.Union([
		FilterRule,
		strictStruct({ filter: Filter, type: Schema.Literal("not") }),
		strictStruct({ filters: Schema.Array(Filter), type: Schema.Literals(["and", "or"]) }),
	]),
);
