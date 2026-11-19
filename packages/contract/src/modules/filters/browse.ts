import { Message } from "@ryot-app/i18n/message";
import { Array as Arr, Schema } from "effect";

import { strictStruct } from "../../schema/utils";
import { ManifestText } from "../plugins/manifest-text";
import {
	type AuthoredDefinitionOwner,
	AuthoredEventSchemaReference,
	AuthoredRelationshipSchemaReference,
	type DefinitionOwner,
	EventSchemaReference,
	type PluginIdentityReference,
	RelationshipSchemaReference,
} from "../plugins/references";
import { mapScalarExpression, type RyotQLDocument, ScalarExpression } from "../ryotql/authored";
import { filterChoice, relationshipFilterField, sessionEventFilterField } from "./schemas";
import { browseSort } from "./sort";

export const BROWSE_SUBJECT_ALIAS = "subject";

const browseFields = <
	Text extends Schema.Top,
	Relationship extends Schema.Top,
	Event extends Schema.Top,
>(
	text: Text,
	relationship: Relationship,
	event: Event,
) => {
	const sort = browseSort(text);
	const valueFieldBase = {
		label: text,
		key: Schema.NonEmptyString,
		expression: ScalarExpression,
		kind: Schema.Literal("value"),
		sort: Schema.optionalKey(sort),
	};
	const value = Schema.Union([
		strictStruct({
			...valueFieldBase,
			type: Schema.Literals(["enum", "enum-list"]),
			choices: Schema.NonEmptyArray(filterChoice(text)),
		}),
		strictStruct({
			...valueFieldBase,
			type: Schema.Literals(["text", "text-list", "number", "rating", "date", "boolean"]),
		}),
	]);
	const sortField = strictStruct({
		sort,
		key: Schema.NonEmptyString,
		expression: ScalarExpression,
		kind: Schema.Literal("sort"),
	});
	return {
		value,
		sort: sortField,
		field: Schema.Union([
			value,
			sortField,
			relationshipFilterField(relationship, text),
			sessionEventFilterField(event, text),
		]),
	};
};

const resolved = browseFields(Message, RelationshipSchemaReference, EventSchemaReference);

const authored = browseFields(
	ManifestText,
	AuthoredRelationshipSchemaReference,
	AuthoredEventSchemaReference,
);

export const BrowseValueField = resolved.value;
export type BrowseValueField = typeof BrowseValueField.Type;

export const BrowseSortField = resolved.sort;
export type BrowseSortField = typeof BrowseSortField.Type;

export const BrowseField = resolved.field;
export type BrowseField = typeof BrowseField.Type;

/** Plugin-authored browse fields name their labels with manifest text from the plugin's catalog. */
export const AuthoredBrowseField = authored.field;
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
				pagination: { limit: 1, maxLimit: 1 },
				fields: [{ key: "value", expr: expression }],
			},
		},
	},
});

type BrowseResolution = {
	readonly text: (text: ManifestText) => Message;
	readonly owner: (owner: AuthoredDefinitionOwner) => DefinitionOwner;
	readonly reference: (reference: PluginIdentityReference) => PluginIdentityReference;
};

const resolveSort = (
	sort: (typeof authored.sort.Type)["sort"],
	text: BrowseResolution["text"],
) => ({
	label: text(sort.label),
	ascending: text(sort.ascending),
	descending: text(sort.descending),
	defaultDirection: sort.defaultDirection,
});

const resolveValueField = (
	field: typeof authored.value.Type,
	{ text, reference }: BrowseResolution,
): BrowseValueField => {
	const base = {
		key: field.key,
		kind: field.kind,
		label: text(field.label),
		expression: mapScalarExpression(field.expression, { reference }),
		...(field.sort === undefined ? {} : { sort: resolveSort(field.sort, text) }),
	};
	return field.type === "enum" || field.type === "enum-list"
		? {
				...base,
				type: field.type,
				choices: Arr.map(field.choices, ({ value, label }) => ({ value, label: text(label) })),
			}
		: { ...base, type: field.type };
};

/** Resolves an authored browse field's references and stamps its labels with the owner's catalog. */
export const resolveBrowseField = (
	field: AuthoredBrowseField,
	resolution: BrowseResolution,
): BrowseField => {
	const { text, owner, reference } = resolution;
	if (field.kind === "value") {
		return resolveValueField(field, resolution);
	}
	if (field.kind === "sort") {
		return {
			key: field.key,
			kind: field.kind,
			sort: resolveSort(field.sort, text),
			expression: mapScalarExpression(field.expression, { reference }),
		};
	}
	if (field.kind === "relationship") {
		return {
			...field,
			label: text(field.label),
			relationship: { ...field.relationship, owner: owner(field.relationship.owner) },
		};
	}
	return {
		...field,
		label: text(field.label),
		event: { ...field.event, owner: owner(field.event.owner) },
	};
};

/** Every manifest text of an authored browse field, with its path below the field. */
export const authoredBrowseFieldTexts = (
	field: AuthoredBrowseField,
): ReadonlyArray<{ readonly path: string; readonly text: ManifestText }> => {
	const sort = field.kind === "sort" || field.kind === "value" ? field.sort : undefined;
	return [
		...(field.kind === "sort" ? [] : [{ path: "label", text: field.label }]),
		...("choices" in field
			? field.choices.map(({ value, label }) => ({ text: label, path: `choices.${value}.label` }))
			: []),
		...(sort === undefined
			? []
			: (["label", "ascending", "descending"] as const).map((name) => ({
					text: sort[name],
					path: `sort.${name}`,
				}))),
	];
};
