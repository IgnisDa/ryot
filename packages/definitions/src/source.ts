import {
	type AuthoredEntitySchemaBrowse,
	type EntitySchemaBrowse,
	resolveBrowseField,
} from "@ryot-app/contract/modules/filters/browse";
import { sourcePlanConfigKeys } from "@ryot-app/contract/modules/plugins/execution";
import type { PluginManifest, PluginProjection } from "@ryot-app/contract/modules/plugins/manifest";
import {
	type ManifestText,
	stampAppSchema,
} from "@ryot-app/contract/modules/plugins/manifest-text";
import {
	type AuthoredEntitySchemaReference,
	definitionOwner,
} from "@ryot-app/contract/modules/plugins/references";
import { resolvePluginDocument } from "@ryot-app/contract/modules/ryotql/authored";
import { bindArguments } from "@ryot-app/contract/modules/ryotql/parameters";
import { mapRowSourceQueryReferences } from "@ryot-app/contract/modules/ryotql/row-source";
import {
	AuthoredEntityBrowserSavedViewSettings,
	AuthoredResultsTableSavedViewSettings,
	mapEntityBrowserAddActionSchema,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { PluginId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { stampNamespace } from "@ryot-app/i18n/message";
import { Array as Arr, Result, Schema } from "effect";

import { deriveSavedViewQueries } from "./saved-view-queries";
import { pluginPageSettingsIssue } from "./saved-views";
import { materializeSignalSchedule } from "./signal-schedules";
import type { CalendarSourceDefinition, DefinitionSource, SavedViewDefinition } from "./snapshot";

export const materializeSavedView = (
	definition: PluginManifest["savedViews"][number],
	pluginId: string,
	client: PluginManifest["client"],
): SavedViewDefinition => {
	const dataSources =
		definition.dataSources === null
			? null
			: Result.getOrThrow(resolvePluginDocument(PluginId.make(pluginId), definition.dataSources));
	const parsedArguments = bindArguments(dataSources?.parameters, definition.arguments);
	if (Result.isFailure(parsedArguments)) {
		throw new Error(
			`Invalid saved view ${definition.slug}: ${parsedArguments.failure.map(({ message }) => message).join("; ")}`,
		);
	}
	const argumentsValue = Result.getOrThrow(
		Schema.decodeUnknownResult(Schema.Record(Schema.String, JsonValue))(parsedArguments.success),
	);
	if (definition.renderer.kind === "plugin") {
		const page = client?.exports?.[definition.renderer.exportName];
		const issue = pluginPageSettingsIssue(definition.settings, page?.kind === "page" ? page : null);
		if (issue) {
			throw new Error(
				`Invalid saved view ${definition.slug}: ${issue.code === "renderer-not-found" ? `plugin renderer '${definition.renderer.exportName}' is not an advertised page export` : issue.message}`,
			);
		}
		return {
			...definition,
			pluginId,
			dataSources,
			arguments: argumentsValue,
			renderer: { pluginId, kind: "plugin" as const, exportName: definition.renderer.exportName },
		};
	}
	const rendererName = definition.renderer.name;
	const invalidSettings = () =>
		new Error(`Invalid saved view ${definition.slug}: invalid ${rendererName} settings`);
	const stampColumns = <Column extends { readonly label: ManifestText }>(
		columns: Arr.NonEmptyReadonlyArray<Column>,
	) => Arr.map(columns, (column) => ({ ...column, label: stampNamespace(pluginId, column.label) }));
	let settings = definition.settings;
	if (rendererName === "entity-browser" || rendererName === "collection-browser") {
		const decoded = Schema.decodeUnknownResult(AuthoredEntityBrowserSavedViewSettings)(
			definition.settings,
		);
		if (Result.isFailure(decoded)) {
			throw invalidSettings();
		}
		const resolveSchema = ({ slug, owner }: AuthoredEntitySchemaReference) => ({
			slug,
			owner: owner.kind === "self" ? definitionOwner(pluginId) : owner,
		});
		const { subject, addAction, tableColumns } = decoded.success;
		settings = {
			...decoded.success,
			tableColumns: tableColumns === null ? null : stampColumns(tableColumns),
			subject: { ...subject, schemas: Arr.map(subject.schemas, resolveSchema) },
			addAction:
				addAction?.type === "provider-search"
					? {
							...mapEntityBrowserAddActionSchema(addAction, resolveSchema),
							library: {
								...addAction.library,
								entryEvent:
									addAction.library.entryEvent === null
										? null
										: {
												...addAction.library.entryEvent,
												label: stampNamespace(pluginId, addAction.library.entryEvent.label),
											},
							},
						}
					: addAction,
		};
	} else {
		const decoded = Schema.decodeUnknownResult(AuthoredResultsTableSavedViewSettings)(
			definition.settings,
		);
		if (Result.isFailure(decoded)) {
			throw invalidSettings();
		}
		settings = { ...decoded.success, columns: stampColumns(decoded.success.columns) };
	}
	return {
		...definition,
		pluginId,
		settings,
		arguments: argumentsValue,
		renderer: definition.renderer,
		dataSources:
			dataSources === null
				? null
				: Result.getOrThrow(deriveSavedViewQueries(definition.renderer, settings, dataSources)),
	};
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
	...(definition.instantAt === undefined ? {} : { instantAt: definition.instantAt }),
	art: definition.art ?? null,
	done: definition.done ?? null,
	precision: definition.precision,
	query: mapRowSourceQueryReferences(definition.query, (reference) =>
		reference.kind === "self" ? { kind: "local", pluginId: PluginId.make(pluginId) } : reference,
	),
	caption:
		definition.caption === undefined
			? null
			: {
					params: definition.caption.params,
					text: stampNamespace(pluginId, definition.caption.text),
				},
	subject: {
		entityAlias: definition.subject.entityAlias,
		schemas: Arr.map(definition.subject.schemas, ({ slug, owner }) => ({
			slug,
			owner: owner.kind === "self" ? definitionOwner(pluginId) : owner,
		})),
	},
});

const materializeBrowse = (
	browse: AuthoredEntitySchemaBrowse,
	pluginId: string,
): EntitySchemaBrowse => ({
	fields: browse.fields.map((browseField) =>
		resolveBrowseField(browseField, {
			text: (text) => stampNamespace(pluginId, text),
			owner: (owner) => (owner.kind === "self" ? definitionOwner(pluginId) : owner),
			reference: (reference) =>
				reference.kind === "self"
					? { kind: "local", pluginId: PluginId.make(pluginId) }
					: reference,
		}),
	),
});

const stampProjection = (pluginId: string, projection: undefined | PluginProjection) =>
	projection === undefined
		? {}
		: { projection: { propertiesSchema: stampAppSchema(pluginId, projection.propertiesSchema) } };

export const revisionDefinitions = (pluginId: string, manifest: PluginManifest) => ({
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
	signalSchedules: (manifest.signalSchedules ?? []).map((definition) =>
		materializeSignalSchedule(definition, pluginId),
	),
	integrationProviders: manifest.integrationProviders.map((definition) => ({
		...definition,
		settingsSchema: stampAppSchema(pluginId, definition.settingsSchema),
	})),
	signalSchemas: manifest.signalSchemas.map((definition) => ({
		...definition,
		pluginId,
		propertiesSchema: stampAppSchema(pluginId, definition.propertiesSchema),
	})),
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
	relationshipSchemas: manifest.relationshipSchemas.map(({ projection, ...definition }) => ({
		...definition,
		pluginId,
		...stampProjection(pluginId, projection),
		propertiesSchema: stampAppSchema(pluginId, definition.propertiesSchema),
	})),
	importSources: manifest.importSources.map((source) => ({
		...source,
		inputSchema: stampAppSchema(pluginId, source.inputSchema),
		requiredPluginConfigKeys: sourcePlanConfigKeys(manifest, source),
		workflowScriptSlug:
			manifest.workflows.find(({ slug }) => slug === source.workflowSlug)?.scriptSlug ?? null,
	})),
	entitySchemas: manifest.entitySchemas.map(({ browse, ...definition }) => ({
		...definition,
		pluginId,
		...(browse ? { browse: materializeBrowse(browse, pluginId) } : {}),
		mergeIdentityProperties: definition.mergeIdentityProperties ?? [],
		propertiesSchema: stampAppSchema(pluginId, definition.propertiesSchema),
		eventSchemas: definition.eventSchemas.map(({ projection, ...eventSchema }) => ({
			...eventSchema,
			pluginId,
			...stampProjection(pluginId, projection),
			propertiesSchema: stampAppSchema(pluginId, eventSchema.propertiesSchema),
		})),
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
