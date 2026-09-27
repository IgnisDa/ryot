import { SourcePlan } from "@ryot-app/contract/modules/plugins/execution";
import { SandboxExecutionMetadata } from "@ryot-app/contract/modules/plugins/execution-metadata";
import {
	evaluateIngestionReadiness,
	IngestionReadinessMetadata,
} from "@ryot-app/contract/modules/plugins/ingestion-readiness";
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
	(input: {
		readonly after?: string;
		readonly limit: number;
		readonly selected?: {
			readonly slug: string;
			readonly settings: Readonly<Record<string, unknown>>;
		};
	}) => ({
		map: ({ sources }) =>
			Result.try(() => ({
				...sources,
				items: sources.items.map((item) => {
					const readiness =
						item.readinessMetadata === null
							? { plan: null, blockReasons: [], ready: item.isStartable }
							: evaluateIngestionReadiness({
									kind: "workflow",
									operation: item.workflowSlug,
									settingsSchema: item.inputSchema,
									metadata: item.readinessMetadata,
									sourcePlan: item.plan ?? undefined,
									settings:
										input.selected?.slug === item.slug ? input.selected.settings : undefined,
								});
					return {
						...item,
						readiness: { ...readiness, ready: readiness.ready && item.isStartable },
					};
				}),
			})),
		queries: {
			sources: selectedRows(source, {
				after: input.after,
				limit: input.limit,
				orderBy: [ascending(column(source, "name")), ascending(column(source, "id"))],
				selection: {
					id: selectedField(column(source, "id"), Schema.String),
					exportHelp: selectedField(column(source, "exportHelp"), exportHelp),
					plan: selectedField(column(source, "plan"), Schema.NullOr(SourcePlan)),
					isStartable: selectedField(column(source, "isStartable"), Schema.Boolean),
					slug: selectedField(column(source, "slug"), PluginImportSource.fields.slug),
					name: selectedField(column(source, "name"), PluginImportSource.fields.name),
					pluginSlug: selectedField(column(source, "pluginSlug"), Schema.NullOr(Schema.String)),
					installationId: selectedField(
						column(source, "installationId"),
						Schema.NullOr(Schema.String),
					),
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
					pluginScope: selectedField(
						column(source, "pluginScope"),
						Schema.NullOr(Schema.Literals(["system", "user"])),
					),
					missingPluginConfigKeys: selectedField(
						column(source, "missingPluginConfigKeys"),
						Schema.Array(Schema.String),
					),
					readinessMetadata: selectedField(
						column(source, "readinessMetadata"),
						Schema.NullOr(IngestionReadinessMetadata),
					),
					requiredPluginConfigKeys: selectedField(
						column(source, "requiredPluginConfigKeys"),
						SandboxExecutionMetadata.fields.requiredPluginConfigKeys,
					),
				},
			}),
		},
	}),
);

export type ImportSourcesPage = Recipe.Success<typeof importSourcesRecipe>;
