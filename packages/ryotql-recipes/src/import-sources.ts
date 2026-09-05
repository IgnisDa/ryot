import {
	PluginImportExportHelp,
	PluginImportSource,
} from "@ryot-app/contract/modules/plugins/manifest";
import {
	ascending,
	column,
	defineRecipe,
	selectedField,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

const source = table("importSource", "source");
const exportHelp = Schema.NullOr(PluginImportExportHelp);

export const importSourcesRecipe = defineRecipe(
	(input: { readonly after?: string; readonly limit: number }) => ({
		map: ({ sources }) => Result.succeed(sources),
		queries: {
			sources: selectedRows(source, {
				after: input.after,
				limit: input.limit,
				orderBy: [ascending(column(source, "name")), ascending(column(source, "id"))],
				selection: {
					id: selectedField(column(source, "id"), Schema.String),
					exportHelp: selectedField(column(source, "exportHelp"), exportHelp),
					pluginSlug: selectedField(column(source, "pluginSlug"), Schema.String),
					isStartable: selectedField(column(source, "isStartable"), Schema.Boolean),
					slug: selectedField(column(source, "slug"), PluginImportSource.fields.slug),
					name: selectedField(column(source, "name"), PluginImportSource.fields.name),
					inputSchema: selectedField(
						column(source, "inputSchema"),
						PluginImportSource.fields.inputSchema,
					),
					description: selectedField(
						column(source, "description"),
						PluginImportSource.fields.description,
					),
					workflowSlug: selectedField(
						column(source, "workflowSlug"),
						PluginImportSource.fields.workflowSlug,
					),
					missingPluginConfigKeys: selectedField(
						column(source, "missingPluginConfigKeys"),
						Schema.Array(Schema.String),
					),
					requiredPluginConfigKeys: selectedField(
						column(source, "requiredPluginConfigKeys"),
						PluginImportSource.fields.requiredPluginConfigKeys,
					),
				},
			}),
		},
	}),
);

export type ImportSourcesPage = Recipe.Success<typeof importSourcesRecipe>;
