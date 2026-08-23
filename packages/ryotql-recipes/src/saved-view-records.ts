import { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { SavedViewRenderer } from "@ryot-app/contract/modules/saved-views/schemas";
import { PluginSlug, SavedViewId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
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
	sortOrder: selectedField(column(savedView, "sortOrder"), Schema.Number),
	createdAt: selectedField(column(savedView, "createdAt"), IsoDateString),
	updatedAt: selectedField(column(savedView, "updatedAt"), IsoDateString),
	isBuiltin: selectedField(column(savedView, "isBuiltin"), Schema.Boolean),
	renderer: selectedField(column(savedView, "renderer"), SavedViewRenderer),
	isDisabled: selectedField(column(savedView, "isDisabled"), Schema.Boolean),
	pluginSlug: selectedField(column(savedView, "pluginSlug"), Schema.NullOr(PluginSlug)),
	dataSources: selectedField(column(savedView, "dataSources"), Schema.NullOr(RyotQLDocument)),
	settings: selectedField(column(savedView, "settings"), Schema.Record(Schema.String, JsonValue)),
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
			map: ({ savedViews }) => Result.succeed(savedViews),
			queries: {
				savedViews: selectedRows(savedView, {
					selection,
					after: input.after,
					limit: input.limit,
					where: predicates.length > 0 ? and(...predicates) : undefined,
					orderBy: [
						ascending(column(savedView, "pluginSlug")),
						ascending(column(savedView, "sortOrder")),
						ascending(column(savedView, "createdAt")),
					],
				}),
			},
		};
	},
);

export const savedViewRecordRecipe = defineRecipe((input: { readonly slug: string }) => ({
	map: ({ savedView: record }) => Result.succeed(record),
	queries: {
		savedView: selectedOptionalRow(savedView, {
			selection,
			orderBy: [ascending(column(savedView, "id"))],
			where: eq(column(savedView, "slug"), literal(input.slug)),
		}),
	},
}));

export type SavedViewRecordList = Recipe.Success<typeof savedViewRecordsRecipe>;
export type SavedViewRecord = NonNullable<Recipe.Success<typeof savedViewRecordRecipe>>;
