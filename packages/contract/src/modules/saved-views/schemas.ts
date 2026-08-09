import { Schema } from "effect";

import { EntitySchemaSlug, PluginSlug, SavedViewId } from "../../schema/brands";
import { strictStruct } from "../../schema/utils";
import { JsonValue, OutputFieldKey, RyotQLDocument } from "../ryotql/language";

export const SavedViewLayoutName = Schema.Literals(["grid", "list", "table"]);
export type SavedViewLayoutName = typeof SavedViewLayoutName.Type;

export const SavedViewDefinitionIssue = Schema.Literals([
	"query-count",
	"output-kind",
	"cursor-pagination",
	"explicit-fields-required",
	"nested-results",
	"columns-empty",
	"query-invalid",
	"mapping-field-missing",
	"field-kind",
	"entity-id-source",
	"image-cast",
]);
export type SavedViewDefinitionIssue = typeof SavedViewDefinitionIssue.Type;

const SavedViewBadRequestReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("duplicate-name") }),
	Schema.Struct({ code: Schema.Literal("plugin-not-found"), pluginSlug: PluginSlug }),
	Schema.Struct({ code: Schema.Literal("builtin-view-immutable"), viewSlug: Schema.String }),
	Schema.Struct({
		entitySchemaSlug: EntitySchemaSlug,
		code: Schema.Literal("entity-schema-not-found"),
	}),
	Schema.Struct({
		code: Schema.Literal("required-field"),
		field: Schema.Literals(["name", "slug"]),
	}),
	Schema.Struct({
		viewSlugs: Schema.Array(Schema.String),
		code: Schema.Literal("invalid-reorder"),
		issue: Schema.Literals(["empty", "duplicate", "unknown-view", "update-failed"]),
	}),
	Schema.Struct({
		layout: SavedViewLayoutName,
		issue: SavedViewDefinitionIssue,
		field: Schema.optional(Schema.String),
		code: Schema.Literal("invalid-definition"),
	}),
]);

const SavedViewNotFoundReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("saved-view-not-found"), viewSlug: Schema.String }),
]);

export class SavedViewBadRequest extends Schema.TaggedError<SavedViewBadRequest>()(
	"SavedViewBadRequest",
	{ reason: SavedViewBadRequestReason },
) {}

export class SavedViewNotFound extends Schema.TaggedError<SavedViewNotFound>()(
	"SavedViewNotFound",
	{ reason: SavedViewNotFoundReason },
) {}

export const SavedViewDisplayKind = Schema.Literals(["text", "date", "json", "number", "boolean"]);
export type SavedViewDisplayKind = typeof SavedViewDisplayKind.Type;

export const SavedViewDisplayValue = Schema.Union([
	strictStruct({ value: JsonValue, displayKind: Schema.Literal("json") }),
	strictStruct({ value: Schema.NullOr(Schema.String), displayKind: Schema.Literal("text") }),
	strictStruct({ value: Schema.NullOr(Schema.String), displayKind: Schema.Literal("date") }),
	strictStruct({ value: Schema.NullOr(Schema.Number), displayKind: Schema.Literal("number") }),
	strictStruct({ value: Schema.NullOr(Schema.Boolean), displayKind: Schema.Literal("boolean") }),
]);
export type SavedViewDisplayValue = typeof SavedViewDisplayValue.Type;

const SavedViewValueMapping = strictStruct({
	field: OutputFieldKey,
	displayKind: SavedViewDisplayKind,
});

export const SavedViewCardMapping = strictStruct({
	titleField: OutputFieldKey,
	imageField: Schema.NullOr(OutputFieldKey),
	callout: Schema.NullOr(SavedViewValueMapping),
	overline: Schema.NullOr(SavedViewValueMapping),
	primaryMetadata: Schema.NullOr(SavedViewValueMapping),
	secondaryMetadata: Schema.NullOr(SavedViewValueMapping),
});
export type SavedViewCardMapping = typeof SavedViewCardMapping.Type;

export const SavedViewTableMapping = strictStruct({
	imageField: Schema.NullOr(OutputFieldKey),
	columns: Schema.NonEmptyArray(
		strictStruct({
			label: Schema.String,
			field: OutputFieldKey,
			displayKind: SavedViewDisplayKind,
		}),
	),
});
export type SavedViewTableMapping = typeof SavedViewTableMapping.Type;

const SavedViewCardLayout = strictStruct({
	...SavedViewCardMapping.fields,
	entityIdField: OutputFieldKey,
	queryDocument: RyotQLDocument,
});

const SavedViewTableLayout = strictStruct({
	...SavedViewTableMapping.fields,
	entityIdField: OutputFieldKey,
	queryDocument: RyotQLDocument,
});

export const SavedViewLayouts = strictStruct({
	grid: SavedViewCardLayout,
	list: SavedViewCardLayout,
	table: SavedViewTableLayout,
});
export type SavedViewLayouts = typeof SavedViewLayouts.Type;

export const ListedSavedView = strictStruct({
	id: SavedViewId,
	slug: Schema.String,
	name: Schema.String,
	icon: Schema.String,
	sortOrder: Schema.Number,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	isBuiltin: Schema.Boolean,
	layouts: SavedViewLayouts,
	isDisabled: Schema.Boolean,
	pluginSlug: Schema.NullOr(PluginSlug),
	entitySchemaSlug: Schema.NullOr(EntitySchemaSlug),
});

export type ListedSavedView = typeof ListedSavedView.Type;

export const CreateSavedViewBody = Schema.Struct({
	icon: Schema.String,
	name: Schema.String,
	layouts: SavedViewLayouts,
	pluginSlug: Schema.optional(PluginSlug),
	entitySchemaSlug: Schema.NullOr(EntitySchemaSlug),
});

export type CreateSavedViewBody = typeof CreateSavedViewBody.Type;

export const UpdateSavedViewBody = Schema.Struct({
	icon: Schema.String,
	name: Schema.String,
	isDisabled: Schema.Boolean,
	pluginSlug: Schema.optional(PluginSlug),
	layouts: Schema.optional(SavedViewLayouts),
	entitySchemaSlug: Schema.optional(Schema.NullOr(EntitySchemaSlug)),
});

export type UpdateSavedViewBody = typeof UpdateSavedViewBody.Type;

export const ReorderSavedViewsBody = Schema.Struct({
	viewSlugs: Schema.Array(Schema.String),
	pluginSlug: Schema.optional(PluginSlug),
});

export type ReorderSavedViewsBody = typeof ReorderSavedViewsBody.Type;

export const ReorderSavedViewsResponse = Schema.Struct({
	viewSlugs: Schema.Array(Schema.String),
});

export type ReorderSavedViewsResponse = typeof ReorderSavedViewsResponse.Type;
