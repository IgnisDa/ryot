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
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import {
	ascending,
	column,
	defineRecipe,
	type Recipe,
	selectedField,
	type SelectedRow,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

const source = table("importSource", "source");
const exportHelp = Schema.NullOr(PluginImportExportHelp);

const sourceSelection = {
	id: selectedField(column(source, "id"), Schema.String),
	exportHelp: selectedField(column(source, "exportHelp"), exportHelp),
	plan: selectedField(column(source, "plan"), Schema.NullOr(SourcePlan)),
	isStartable: selectedField(column(source, "isStartable"), Schema.Boolean),
	slug: selectedField(column(source, "slug"), PluginImportSource.fields.slug),
	name: selectedField(column(source, "name"), PluginImportSource.fields.name),
	pluginId: selectedField(column(source, "pluginId"), Schema.NullOr(PluginId)),
	packageId: selectedField(column(source, "packageId"), Schema.NullOr(PluginPackageId)),
	installationId: selectedField(column(source, "installationId"), Schema.NullOr(Schema.String)),
	inputSchema: selectedField(column(source, "inputSchema"), PluginImportSource.fields.inputSchema),
	description: selectedField(column(source, "description"), PluginImportSource.fields.description),
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
};

export const evaluateImportSourceReadiness = (
	item: Pick<
		SelectedRow<typeof sourceSelection>,
		"plan" | "isStartable" | "inputSchema" | "workflowSlug" | "readinessMetadata"
	>,
	settings?: Readonly<Record<string, unknown>>,
) => {
	const readiness =
		item.readinessMetadata === null
			? { plan: null, blockReasons: [], ready: item.isStartable }
			: evaluateIngestionReadiness({
					settings,
					kind: "workflow",
					operation: item.workflowSlug,
					settingsSchema: item.inputSchema,
					metadata: item.readinessMetadata,
					sourcePlan: item.plan ?? undefined,
				});
	return { ...readiness, ready: readiness.ready && item.isStartable };
};

export const importSourcesRecipe = defineRecipe(
	(input: { readonly limit: number; readonly after?: string }) => ({
		queries: {
			sources: selectedRows(source, {
				after: input.after,
				limit: input.limit,
				selection: sourceSelection,
				orderBy: [ascending(column(source, "name")), ascending(column(source, "id"))],
			}),
		},
		map: ({ sources }) =>
			Result.try(() => ({
				...sources,
				items: sources.items.map((item) => ({
					reference: { slug: item.slug, owner: definitionOwner(item.pluginId) },
					...item,
					readiness: evaluateImportSourceReadiness(item),
				})),
			})),
	}),
);

export type ImportSourcesPage = Recipe.Success<typeof importSourcesRecipe>;
