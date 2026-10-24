import { Schema } from "effect";

import { strictStruct } from "../../schema/utils";
import {
	AuthoredEventSchemaReference,
	AuthoredRelationshipSchemaReference,
	EventSchemaReference,
	type PluginIdentityReference,
	RelationshipSchemaReference,
} from "../plugins/references";
import { mapScalarExpression, type RyotQLDocument, ScalarExpression } from "../ryotql/language";
import {
	FilterChoice,
	type FilterFieldWith,
	mapFilterFieldReference,
	relationshipFilterField,
	sessionEventFilterField,
} from "./schemas";

export const BROWSE_SUBJECT_ALIAS = "subject";

export const BrowseSort = strictStruct({
	ascending: Schema.NonEmptyString,
	descending: Schema.NonEmptyString,
});
export type BrowseSort = typeof BrowseSort.Type;

const browseValueFieldBase = {
	label: Schema.String,
	key: Schema.NonEmptyString,
	expression: ScalarExpression,
	kind: Schema.Literal("value"),
	sort: Schema.optionalKey(BrowseSort),
};

export const BrowseValueField = Schema.Union([
	strictStruct({
		...browseValueFieldBase,
		choices: Schema.NonEmptyArray(FilterChoice),
		type: Schema.Literals(["enum", "enum-list"]),
	}),
	strictStruct({
		...browseValueFieldBase,
		type: Schema.Literals(["text", "text-list", "number", "date", "boolean"]),
	}),
]);
export type BrowseValueField = typeof BrowseValueField.Type;

export const BrowseSortField = strictStruct({
	sort: BrowseSort,
	key: Schema.NonEmptyString,
	expression: ScalarExpression,
	kind: Schema.Literal("sort"),
});
export type BrowseSortField = typeof BrowseSortField.Type;

export const BrowseField = Schema.Union([
	BrowseValueField,
	BrowseSortField,
	relationshipFilterField(RelationshipSchemaReference),
	sessionEventFilterField(EventSchemaReference),
]);
export type BrowseField = typeof BrowseField.Type;

export const AuthoredBrowseField = Schema.Union([
	BrowseValueField,
	BrowseSortField,
	relationshipFilterField(AuthoredRelationshipSchemaReference),
	sessionEventFilterField(AuthoredEventSchemaReference),
]);
export type AuthoredBrowseField = typeof AuthoredBrowseField.Type;

export const EntitySchemaBrowse = strictStruct({ fields: Schema.Array(BrowseField) });
export type EntitySchemaBrowse = typeof EntitySchemaBrowse.Type;

export const AuthoredEntitySchemaBrowse = strictStruct({
	fields: Schema.Array(AuthoredBrowseField),
});
export type AuthoredEntitySchemaBrowse = typeof AuthoredEntitySchemaBrowse.Type;

export const browseExpressionDocument = (expression: ScalarExpression): RyotQLDocument => ({
	queries: {
		browse: {
			from: { table: "entity", alias: BROWSE_SUBJECT_ALIAS },
			output: {
				orderBy: [],
				type: "rows",
				pagination: { limit: 1 },
				fields: [{ key: "value", expr: expression }],
			},
		},
	},
});

type BrowseFieldWith<Owner extends object> =
	BrowseSortField | BrowseValueField | Exclude<FilterFieldWith<Owner>, { readonly kind: "value" }>;

export const mapBrowseFieldReferences = <From extends object, To extends object>(
	browseField: BrowseFieldWith<From>,
	mapReference: <Slug extends string>(
		reference: From & { readonly slug: Slug },
	) => To & { readonly slug: Slug },
	transform: (reference: PluginIdentityReference) => PluginIdentityReference,
): BrowseFieldWith<To> => {
	if (browseField.kind === "value" || browseField.kind === "sort") {
		return {
			...browseField,
			expression: mapScalarExpression(browseField.expression, { reference: transform }),
		};
	}
	const mapped = mapFilterFieldReference(browseField, mapReference);
	if (mapped.kind === "value") {
		throw new Error("Browse link field mapping must preserve its kind");
	}
	return mapped;
};
