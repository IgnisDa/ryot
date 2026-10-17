import { mapCalendarSourceQueryReferences } from "@ryot-app/contract/modules/calendar-sources/schemas";
import { mapFilterFieldReference } from "@ryot-app/contract/modules/filters/schemas";
import { sourcePlanConfigKeys } from "@ryot-app/contract/modules/plugins/execution";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	type AuthoredDefinitionOwner,
	type AuthoredEntitySchemaReference,
	definitionOwner,
} from "@ryot-app/contract/modules/plugins/references";
import { mapPluginIdentityReferences } from "@ryot-app/contract/modules/ryotql/language";
import {
	AuthoredEntityBrowserSavedViewSettings,
	mapEntityBrowserAddActionSchema,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { PluginId } from "@ryot-app/contract/schema/brands";
import { parseAppSchemaPropertiesSafe } from "@ryot-app/contract/schema/property-values";
import { Array as Arr, Result, Schema } from "effect";

import { formatPropertyIssues } from "#modules/definitions/properties/runtime";

import type { CalendarSourceDefinition, DefinitionSource, SavedViewDefinition } from "./snapshot";

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
		const resolveSchema = ({ slug, owner }: AuthoredEntitySchemaReference) => ({
			slug,
			owner: owner.kind === "self" ? definitionOwner(pluginId) : owner,
		});
		const resolveFilterReference = <Slug extends string>({
			slug,
			owner,
		}: {
			readonly slug: Slug;
			readonly owner: AuthoredDefinitionOwner;
		}) => ({ slug, owner: owner.kind === "self" ? definitionOwner(pluginId) : owner });
		const { subject, addAction, filterFields } = decoded.success;
		settings = {
			...decoded.success,
			addAction: mapEntityBrowserAddActionSchema(addAction, resolveSchema),
			subject: { ...subject, schemas: Arr.map(subject.schemas, resolveSchema) },
			...(filterFields
				? {
						filterFields: filterFields.map((filterField) =>
							mapFilterFieldReference(filterField, resolveFilterReference),
						),
					}
				: {}),
		};
	}
	return { ...definition, pluginId, settings, dataSources, renderer: definition.renderer };
};

export const materializeCalendarSource = (
	definition: NonNullable<PluginManifest["calendarSources"]>[number],
	pluginId: string,
): CalendarSourceDefinition => ({
	pluginId,
	icon: definition.icon,
	name: definition.name,
	slug: definition.slug,
	startAt: definition.startAt,
	art: definition.art ?? null,
	done: definition.done ?? null,
	precision: definition.precision,
	caption: definition.caption ?? null,
	query: mapCalendarSourceQueryReferences(definition.query, (reference) =>
		reference.kind === "self" ? { kind: "local", pluginId: PluginId.make(pluginId) } : reference,
	),
	subject: {
		entityAlias: definition.subject.entityAlias,
		schemas: Arr.map(definition.subject.schemas, ({ slug, owner }) => ({
			slug,
			owner: owner.kind === "self" ? definitionOwner(pluginId) : owner,
		})),
	},
});

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
	calendarSources: (manifest.calendarSources ?? []).map((definition) =>
		materializeCalendarSource(definition, pluginId),
	),
	providerOperations: manifest.scripts.flatMap((script) =>
		script.kind === "provider"
			? [
					{
						scriptSlug: script.slug,
						providerSlug: script.providerSlug,
						operation: script.providerOperation,
					},
				]
			: [],
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
		calendarSources: [
			...base.calendarSources,
			...revisions.flatMap(({ calendarSources }) => calendarSources),
		],
		relationshipSchemas: [
			...revisions.flatMap(({ relationshipSchemas }) => relationshipSchemas),
			...base.relationshipSchemas,
		],
	};
};
