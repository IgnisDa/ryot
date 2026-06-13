import { SavedViewLayouts } from "@ryot-app/contract/modules/saved-views/schemas";
import { EntitySchemaSlug, PluginSlug, SavedViewId } from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	literal,
	table,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	type Recipe,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

const savedView = table("savedView", "savedView");
const selection = {
	id: selectedField(column(savedView, "id"), SavedViewId),
	slug: selectedField(column(savedView, "slug"), Schema.String),
	name: selectedField(column(savedView, "name"), Schema.String),
	icon: selectedField(column(savedView, "icon"), Schema.String),
	layouts: selectedField(column(savedView, "layouts"), SavedViewLayouts),
	sortOrder: selectedField(column(savedView, "sortOrder"), Schema.Number),
	createdAt: selectedField(column(savedView, "createdAt"), IsoDateString),
	updatedAt: selectedField(column(savedView, "updatedAt"), IsoDateString),
	isBuiltin: selectedField(column(savedView, "isBuiltin"), Schema.Boolean),
	isDisabled: selectedField(column(savedView, "isDisabled"), Schema.Boolean),
	pluginSlug: selectedField(column(savedView, "pluginSlug"), Schema.NullOr(PluginSlug)),
	entitySchemaSlug: selectedField(
		column(savedView, "entitySchemaSlug"),
		Schema.NullOr(EntitySchemaSlug),
	),
};

export const savedViewRecordsRecipe = defineRecipe(
	(input: {
		readonly after?: string | undefined;
		readonly limit: number;
		readonly pluginSlug?: string | undefined;
		readonly includeDisabled?: boolean | undefined;
	}) => {
		const predicates = [
			...((input.includeDisabled ?? false)
				? []
				: [eq(column(savedView, "isDisabled"), literal(false))]),
			...(input.pluginSlug ? [eq(column(savedView, "pluginSlug"), literal(input.pluginSlug))] : []),
		];
		return {
			queries: {
				savedViews: selectedRows(savedView, {
					after: input.after,
					limit: input.limit,
					selection,
					where: predicates.length > 0 ? and(...predicates) : undefined,
					orderBy: [
						ascending(column(savedView, "pluginSlug")),
						ascending(column(savedView, "sortOrder")),
						ascending(column(savedView, "createdAt")),
					],
				}),
			},
			map: ({ savedViews }) => Result.succeed(savedViews),
		};
	},
);

export const savedViewRecordRecipe = defineRecipe((input: { readonly slug: string }) => ({
	queries: {
		savedView: selectedOptionalRow(savedView, {
			selection,
			orderBy: [ascending(column(savedView, "id"))],
			where: eq(column(savedView, "slug"), literal(input.slug)),
		}),
	},
	map: ({ savedView: record }) => Result.succeed(record),
}));

export type SavedViewRecordList = Recipe.Success<typeof savedViewRecordsRecipe>;
export type SavedViewRecord = NonNullable<Recipe.Success<typeof savedViewRecordRecipe>>;
