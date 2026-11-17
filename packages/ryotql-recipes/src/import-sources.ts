import { SourcePlan } from "@ryot-app/contract/modules/plugins/execution";
import { SandboxExecutionMetadata } from "@ryot-app/contract/modules/plugins/execution-metadata";
import {
	evaluateIngestionReadiness,
	IngestionReadinessMetadata,
} from "@ryot-app/contract/modules/plugins/ingestion-readiness";
import { PluginImportSource } from "@ryot-app/contract/modules/plugins/manifest";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { HttpUrl } from "@ryot-app/contract/schema/utils";
import { Message } from "@ryot-app/i18n/message";
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
const exportHelp = Schema.NullOr(
	Schema.Struct({
		docsUrl: Schema.optional(HttpUrl),
		steps: Schema.optional(Schema.Array(Message)),
	}),
);

const sourceSelection = {
	name: selectedField(column(source, "name"), Message),
	id: selectedField(column(source, "id"), Schema.String),
	description: selectedField(column(source, "description"), Message),
	exportHelp: selectedField(column(source, "exportHelp"), exportHelp),
	inputSchema: selectedField(column(source, "inputSchema"), AppSchema),
	plan: selectedField(column(source, "plan"), Schema.NullOr(SourcePlan)),
	isStartable: selectedField(column(source, "isStartable"), Schema.Boolean),
	slug: selectedField(column(source, "slug"), PluginImportSource.fields.slug),
	pluginId: selectedField(column(source, "pluginId"), Schema.NullOr(PluginId)),
	packageId: selectedField(column(source, "packageId"), Schema.NullOr(PluginPackageId)),
	installationId: selectedField(column(source, "installationId"), Schema.NullOr(Schema.String)),
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

export const importSourcesRecipe = defineRecipe({
	queries: {
		sources: selectedRows(source, {
			limit: 20,
			maxLimit: 1000,
			selection: sourceSelection,
			orderBy: [ascending(column(source, "slug")), ascending(column(source, "id"))],
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
});

export type ImportSourcesPage = Recipe.Success<typeof importSourcesRecipe>;
