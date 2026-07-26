import {
	BooleanFieldValue,
	NullFieldValue,
	NumberFieldValue,
	TextFieldValue,
	rowsResultSchema,
} from "@ryot/contract/modules/ryotql/language";
import {
	ascending,
	castText,
	column,
	document,
	eq,
	field,
	join,
	jsonPath,
	literal,
	rows,
	table,
} from "@ryot/ryotql";
import { Result, Schema } from "effect";

const navigationResponse = Schema.Struct({
	data: Schema.Struct({
		workspaces: rowsResultSchema(
			Schema.Struct({
				name: TextFieldValue,
				slug: TextFieldValue,
				icon: TextFieldValue,
				accentColor: TextFieldValue,
				sortOrder: Schema.Union([NumberFieldValue, NullFieldValue]),
				isDisabled: Schema.Union([BooleanFieldValue, NullFieldValue]),
			}),
		),
		savedViews: rowsResultSchema(
			Schema.Struct({
				name: TextFieldValue,
				slug: TextFieldValue,
				icon: TextFieldValue,
				sortOrder: NumberFieldValue,
				accentColor: TextFieldValue,
				isDisabled: BooleanFieldValue,
				pluginSlug: Schema.Union([TextFieldValue, NullFieldValue]),
			}),
		),
		collections: rowsResultSchema(Schema.Struct({ id: TextFieldValue, name: TextFieldValue })),
	}),
});

export const NavigationWorkspace = Schema.Struct({
	name: Schema.String,
	slug: Schema.String,
	icon: Schema.String,
	sortOrder: Schema.Number,
	isDisabled: Schema.Boolean,
	accentColor: Schema.String,
});
export type NavigationWorkspace = typeof NavigationWorkspace.Type;

export const NavigationView = Schema.Struct({
	name: Schema.String,
	slug: Schema.String,
	icon: Schema.String,
	sortOrder: Schema.Number,
	isDisabled: Schema.Boolean,
	accentColor: Schema.String,
	pluginSlug: Schema.NullOr(Schema.String),
});
export type NavigationView = typeof NavigationView.Type;

export const NavigationCollection = NavigationView;
export type NavigationCollection = typeof NavigationCollection.Type;

export const NavigationData = Schema.Struct({
	savedViews: Schema.Array(NavigationView),
	workspaces: Schema.Array(NavigationWorkspace),
	collections: Schema.Array(NavigationCollection),
});
export type NavigationData = typeof NavigationData.Type;

const decodeNavigationResult = Schema.decodeUnknownResult(navigationResponse);

export const buildNavigationDocument = () => {
	const plugin = table("plugin", "plugin");
	const state = table("pluginState", "state");
	const collection = table("entity", "collection");
	const savedView = table("savedView", "savedView");
	const metadata = jsonPath(column(plugin, "manifest"), "metadata");

	return document({
		workspaces: rows(plugin, {
			limit: 100,
			joins: [join("left", state, eq(column(plugin, "slug"), column(state, "pluginSlug")))],
			where: eq(column(plugin, "status"), literal("active")),
			orderBy: [ascending(column(plugin, "ingestedAt")), ascending(column(plugin, "slug"))],
			fields: [
				field("slug", column(plugin, "slug")),
				field("name", castText(jsonPath(metadata, "name"))),
				field("icon", castText(jsonPath(metadata, "icon"))),
				field("accentColor", castText(jsonPath(metadata, "accentColor"))),
				field("sortOrder", column(state, "sortOrder")),
				field("isDisabled", column(state, "isDisabled")),
			],
		}),
		savedViews: rows(savedView, {
			limit: 100,
			orderBy: [
				ascending(column(savedView, "pluginSlug")),
				ascending(column(savedView, "sortOrder")),
				ascending(column(savedView, "createdAt")),
			],
			fields: [
				field("slug", column(savedView, "slug")),
				field("name", column(savedView, "name")),
				field("icon", column(savedView, "icon")),
				field("accentColor", column(savedView, "accentColor")),
				field("sortOrder", column(savedView, "sortOrder")),
				field("isDisabled", column(savedView, "isDisabled")),
				field("pluginSlug", column(savedView, "pluginSlug")),
			],
		}),
		collections: rows(collection, {
			limit: 100,
			orderBy: [ascending(column(collection, "name"))],
			where: eq(column(collection, "entitySchemaSlug"), literal("collection")),
			fields: [field("id", column(collection, "id")), field("name", column(collection, "name"))],
		}),
	});
};

export const decodeNavigationResponse = (response: unknown) =>
	Result.map(
		decodeNavigationResult(response),
		({ data }) =>
			({
				workspaces: data.workspaces.items.map((row, index) => ({
					name: row.name.value,
					slug: row.slug.value,
					icon: row.icon.value,
					accentColor: row.accentColor.value,
					sortOrder: row.sortOrder.kind === "number" ? row.sortOrder.value : index,
					isDisabled: row.isDisabled.kind === "boolean" ? row.isDisabled.value : false,
				})),
				savedViews: data.savedViews.items.map((row) => ({
					name: row.name.value,
					slug: row.slug.value,
					icon: row.icon.value,
					sortOrder: row.sortOrder.value,
					isDisabled: row.isDisabled.value,
					accentColor: row.accentColor.value,
					pluginSlug: row.pluginSlug.kind === "text" ? row.pluginSlug.value : null,
				})),
				collections: data.collections.items.map((row, index) => ({
					accentColor: "",
					sortOrder: index,
					icon: "layers-3",
					pluginSlug: null,
					isDisabled: false,
					slug: row.id.value,
					name: row.name.value,
				})),
			}) satisfies NavigationData,
	);
