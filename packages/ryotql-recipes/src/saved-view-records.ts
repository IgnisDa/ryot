import { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { SavedViewRenderer } from "@ryot-app/contract/modules/saved-views/schemas";
import { PluginPackageId, SavedViewId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	literal,
	type Recipe,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

const savedView = table("savedView", "savedView");
const selection = {
	id: selectedField(column(savedView, "id"), SavedViewId),
	slug: selectedField(column(savedView, "slug"), Schema.String),
	name: selectedField(column(savedView, "name"), Schema.String),
	icon: selectedField(column(savedView, "icon"), Schema.String),
	isHidden: selectedField(column(savedView, "isHidden"), Schema.Boolean),
	sortOrder: selectedField(column(savedView, "sortOrder"), Schema.Finite),
	isBuiltin: selectedField(column(savedView, "isBuiltin"), Schema.Boolean),
	renderer: selectedField(column(savedView, "renderer"), SavedViewRenderer),
	reference: selectedField(column(savedView, "reference"), SavedViewReference),
	createdAt: selectedField(column(savedView, "createdAt"), Schema.NullOr(IsoDateString)),
	updatedAt: selectedField(column(savedView, "updatedAt"), Schema.NullOr(IsoDateString)),
	packageId: selectedField(column(savedView, "packageId"), Schema.NullOr(PluginPackageId)),
	dataSources: selectedField(column(savedView, "dataSources"), Schema.NullOr(RyotQLDocument)),
	settings: selectedField(column(savedView, "settings"), Schema.Record(Schema.String, JsonValue)),
};

export const savedViewRecordsRecipe = defineRecipe(
	(input: {
		readonly limit: number;
		readonly after?: string | undefined;
		readonly pluginId?: string | undefined;
		readonly includeHidden?: boolean | undefined;
	}) => {
		const predicates = [
			...((input.includeHidden ?? false)
				? []
				: [eq(column(savedView, "isHidden"), literal(false))]),
			...(input.pluginId ? [eq(column(savedView, "pluginId"), literal(input.pluginId))] : []),
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
						ascending(column(savedView, "packageId")),
						ascending(column(savedView, "sortOrder")),
						ascending(column(savedView, "slug")),
					],
				}),
			},
		};
	},
);

export const savedViewRecordRecipe = defineRecipe((reference: SavedViewReference) => ({
	map: ({ savedView: record }) => Result.succeed(record),
	queries: {
		savedView: selectedOptionalRow(savedView, {
			selection,
			orderBy: [ascending(column(savedView, "id"))],
			where: eq(column(savedView, "reference"), literal(reference)),
		}),
	},
}));

export type SavedViewRecordList = Recipe.Success<typeof savedViewRecordsRecipe>;
export type SavedViewRecord = NonNullable<Recipe.Success<typeof savedViewRecordRecipe>>;
