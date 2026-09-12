import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { and, column, eq, literal, table } from "@ryot-app/ryotql";

import {
	formatPropertyIssues,
	parseAppSchemaPropertiesSafe,
} from "#lib/property-schema/property-schema-runtime";

import type { DefinitionSource, SavedViewDefinition } from "./snapshot";

export const materializeSavedView = (
	definition: PluginManifest["savedViews"][number],
	pluginId: string,
	pluginSlug: string,
	client: PluginManifest["client"],
): SavedViewDefinition => {
	if (definition.renderer.kind === "plugin") {
		const page = client?.exports?.[definition.renderer.exportName];
		if (page?.kind !== "page") {
			throw new Error(
				`Invalid saved view ${definition.slug}: plugin renderer '${definition.renderer.exportName}' is not an advertised page export`,
			);
		}
		const parsed = parseAppSchemaPropertiesSafe({
			properties: definition.settings,
			propertiesSchema: page.settingsSchema,
		});
		if (!parsed.success) {
			throw new Error(
				`Invalid saved view ${definition.slug}: ${formatPropertyIssues(parsed.issues)}`,
			);
		}
		return {
			...definition,
			pluginId,
			pluginSlug,
			renderer: { pluginId, kind: "plugin" as const, exportName: definition.renderer.exportName },
		};
	}
	if (definition.renderer.name !== "entity-browser") {
		return { ...definition, pluginId, pluginSlug, renderer: definition.renderer };
	}
	const rawSourceName = definition.settings["sourceName"];
	const sourceName = typeof rawSourceName === "string" ? rawSourceName : undefined;
	const ownerField = definition.settings["ownerPluginIdField"];
	const source = sourceName === undefined ? undefined : definition.dataSources?.queries[sourceName];
	const ownerSelection =
		source?.output.type === "rows" && typeof ownerField === "string"
			? source.output.fields.find((selection) => "key" in selection && selection.key === ownerField)
			: undefined;
	const dataSources =
		definition.dataSources &&
		sourceName !== undefined &&
		source?.output.type === "rows" &&
		ownerSelection &&
		"expr" in ownerSelection &&
		ownerSelection.expr.type === "column"
			? {
					...definition.dataSources,
					queries: {
						...definition.dataSources.queries,
						[sourceName]: {
							...source,
							where: and(
								...(source.where ? [source.where] : []),
								eq(
									column(table("entity", ownerSelection.expr.tableAlias), "entitySchemaPluginId"),
									literal(pluginId),
								),
							),
						},
					},
				}
			: definition.dataSources;
	const addAction = definition.settings["addAction"];
	return {
		...definition,
		pluginId,
		pluginSlug,
		dataSources,
		renderer: definition.renderer,
		settings:
			typeof addAction === "object" && addAction !== null && !Array.isArray(addAction)
				? {
						...definition.settings,
						addAction: Object.assign({}, addAction, { ownerPluginId: pluginId }),
					}
				: definition.settings,
	};
};

export const revisionDefinitions = (
	pluginId: string,
	pluginSlug: string,
	manifest: PluginManifest,
) => ({
	integrationProviders: manifest.integrationProviders,
	signalSchemas: manifest.signalSchemas.map((definition) => ({ ...definition, pluginId })),
	relationshipSchemas: manifest.relationshipSchemas.map((definition) => ({
		...definition,
		pluginId,
	})),
	savedViews: manifest.savedViews.map((definition) =>
		materializeSavedView(definition, pluginId, pluginSlug, manifest.client),
	),
	importSources: manifest.importSources.map((source) => ({
		...source,
		workflowScriptSlug:
			manifest.workflows.find(({ slug }) => slug === source.workflowSlug)?.scriptSlug ?? null,
	})),
	entitySchemas: manifest.entitySchemas.map((definition) => ({
		...definition,
		pluginId,
		pluginSlug,
		mergeIdentityProperties: definition.mergeIdentityProperties ?? [],
		eventSchemas: definition.eventSchemas.map((eventSchema) => ({ ...eventSchema, pluginId })),
	})),
});

export type RevisionDefinitions = ReturnType<typeof revisionDefinitions>;

export const mergeManifestDefinitions = (
	base: DefinitionSource,
	plugins: ReadonlyArray<{
		readonly id: string;
		readonly slug: string;
		readonly manifest: PluginManifest;
	}>,
): DefinitionSource => {
	const revisions = plugins.map(({ id, slug, manifest }) =>
		revisionDefinitions(id, slug, manifest),
	);
	return {
		savedViews: [...base.savedViews, ...revisions.flatMap(({ savedViews }) => savedViews)],
		signalSchemas: [
			...base.signalSchemas,
			...revisions.flatMap(({ signalSchemas }) => signalSchemas),
		],
		entitySchemas: [
			...base.entitySchemas,
			...revisions.flatMap(({ entitySchemas }) => entitySchemas),
		],
		relationshipSchemas: [
			...revisions.flatMap(({ relationshipSchemas }) => relationshipSchemas),
			...base.relationshipSchemas,
		],
	};
};
