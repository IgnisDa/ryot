import { sourcePlanConfigKeys } from "@ryot-app/contract/modules/plugins/execution";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { mapPluginIdentityReferences } from "@ryot-app/contract/modules/ryotql/language";
import { AuthoredEntityBrowserSavedViewSettings } from "@ryot-app/contract/modules/saved-views/schemas";
import { PluginId } from "@ryot-app/contract/schema/brands";
import { Result, Schema } from "effect";

import {
	formatPropertyIssues,
	parseAppSchemaPropertiesSafe,
} from "#modules/definitions/properties/runtime";

import type { DefinitionSource, SavedViewDefinition } from "./snapshot";

export const materializeSavedView = (
	definition: PluginManifest["savedViews"][number],
	pluginId: string,
	client: PluginManifest["client"],
): SavedViewDefinition => {
	const dataSources =
		definition.dataSources === null
			? null
			: mapPluginIdentityReferences(definition.dataSources, (reference) =>
					reference.kind === "self"
						? { kind: "local", pluginId: PluginId.make(pluginId) }
						: reference,
				);
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
			dataSources,
			renderer: { pluginId, kind: "plugin" as const, exportName: definition.renderer.exportName },
		};
	}
	let settings = definition.settings;
	if (
		definition.renderer.name === "entity-browser" ||
		definition.renderer.name === "collection-browser"
	) {
		const decoded = Schema.decodeUnknownResult(AuthoredEntityBrowserSavedViewSettings)(
			definition.settings,
		);
		if (Result.isFailure(decoded)) {
			throw new Error(
				`Invalid saved view ${definition.slug}: invalid ${definition.renderer.name} settings`,
			);
		}
		const addAction = decoded.success.addAction;
		settings = {
			...decoded.success,
			addAction:
				addAction === null || addAction.type === "plugin-route"
					? addAction
					: {
							...addAction,
							schema: {
								slug: addAction.schema.slug,
								owner:
									addAction.schema.owner.kind === "self"
										? definitionOwner(pluginId)
										: addAction.schema.owner,
							},
						},
		};
	}
	return { ...definition, pluginId, settings, dataSources, renderer: definition.renderer };
};

export const revisionDefinitions = (pluginId: string, manifest: PluginManifest) => ({
	integrationProviders: manifest.integrationProviders,
	signalSchemas: manifest.signalSchemas.map((definition) => ({ ...definition, pluginId })),
	relationshipSchemas: manifest.relationshipSchemas.map((definition) => ({
		...definition,
		pluginId,
	})),
	providers: manifest.providers.map(({ slug, rootEntitySchemaSlug }) => ({
		slug,
		rootEntitySchemaSlug,
	})),
	savedViews: manifest.savedViews.map((definition) =>
		materializeSavedView(definition, pluginId, manifest.client),
	),
	importSources: manifest.importSources.map((source) => ({
		...source,
		requiredPluginConfigKeys: sourcePlanConfigKeys(manifest, source),
		workflowScriptSlug:
			manifest.workflows.find(({ slug }) => slug === source.workflowSlug)?.scriptSlug ?? null,
	})),
	entitySchemas: manifest.entitySchemas.map((definition) => ({
		...definition,
		pluginId,
		mergeIdentityProperties: definition.mergeIdentityProperties ?? [],
		eventSchemas: definition.eventSchemas.map((eventSchema) => ({ ...eventSchema, pluginId })),
	})),
	providerOperations: manifest.providers.flatMap((provider) =>
		Object.entries(provider.operations).flatMap(([operation, scriptSlug]) =>
			scriptSlug === undefined
				? []
				: [
						{
							scriptSlug,
							providerSlug: provider.slug,
							operation: operation === "searchOptions" ? "search-options" : operation,
						},
					],
		),
	),
});

export type RevisionDefinitions = ReturnType<typeof revisionDefinitions>;

export const mergeManifestDefinitions = (
	base: DefinitionSource,
	plugins: ReadonlyArray<{ readonly id: string; readonly manifest: PluginManifest }>,
): DefinitionSource => {
	const revisions = plugins.map(({ id, manifest }) => revisionDefinitions(id, manifest));
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
