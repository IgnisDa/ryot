import type { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import {
	type DefinitionOwner,
	definitionOwner,
	type PluginIdentityReference,
	pluginPackageKey,
	type PluginPackageReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	mapPluginIdentityReferences,
	pluginIdentityReferences,
	type RyotQLDocument,
} from "@ryot-app/contract/modules/ryotql/authored";
import { decodeEntitySourceReference } from "@ryot-app/contract/modules/ryotql/entity-source";
import {
	EntityBrowserSavedViewSettings,
	mapEntityBrowserAddActionSchema,
	ResultsTableSavedViewSettings,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { PluginId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";
import { isEntityBrowserRenderer } from "@ryot-app/definitions/saved-views";
import {
	type DisplayText,
	isNestedMessage,
	KERNEL_NAMESPACE,
	type Message,
	type MessageParam,
	unavailableMessage,
} from "@ryot-app/i18n/message";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isUnknownArray } from "@ryot-app/ts-utils/predicates";
import { Array as Arr, Effect, Result, Schema } from "effect";

import {
	type DataReferenceError,
	requiredReference,
	rewritePropertyReferences,
} from "#modules/backups/data-references";

import { rewriteSavedArgumentSources } from "../saved-arguments";
import { archiveError, type BackupArchiveError } from "./error";
import {
	type ArchiveDisplayText,
	ArchiveEntityBrowserSavedViewSettings,
	type ArchiveEvent,
	type ArchiveMessage,
	type ArchiveMessageParam,
	type ArchiveRecords,
	type ArchiveRelationship,
	ArchiveResultsTableSavedViewSettings,
	decodeArchiveJsonObject,
	isArchiveJsonObject,
} from "./schemas";
import { decodeArchiveJson } from "./streaming";

type JsonObject = Record<string, JsonValue>;
type ReferenceMap = ReadonlyMap<string, string>;

/** A message from a plugin the backup does not carry is archived as `message.unavailable`. */
export const archiveMessage = (pluginKeys: ReferenceMap, message: Message): ArchiveMessage => {
	const pluginKey =
		message.namespace === KERNEL_NAMESPACE ? null : pluginKeys.get(message.namespace);
	if (pluginKey === undefined) {
		return { pluginKey: null, key: unavailableMessage.key };
	}
	if (message.params === undefined) {
		return { pluginKey, key: message.key };
	}
	const params: Record<string, ArchiveMessageParam> = {};
	for (const [name, value] of Object.entries(message.params)) {
		params[name] = isNestedMessage(value) ? archiveMessage(pluginKeys, value) : value;
	}
	return { params, pluginKey, key: message.key };
};

export const archiveDisplayText = (
	pluginKeys: ReferenceMap,
	text: DisplayText,
): ArchiveDisplayText => (typeof text === "string" ? text : archiveMessage(pluginKeys, text));

const restoredMessage = (
	pluginIds: ReferenceMap,
	message: ArchiveMessage,
): Effect.Effect<Message, BackupArchiveError> =>
	Effect.gen(function* () {
		const namespace =
			message.pluginKey === null ? KERNEL_NAMESPACE : pluginIds.get(message.pluginKey);
		if (namespace === undefined) {
			return yield* archiveError(
				"missing_reference_mapping",
				`Backup message references unmapped plugin key '${message.pluginKey}'`,
			);
		}
		if (message.params === undefined) {
			return { namespace, key: message.key };
		}
		const params: Record<string, MessageParam> = {};
		for (const [name, value] of Object.entries(message.params)) {
			params[name] = isNestedMessage(value) ? yield* restoredMessage(pluginIds, value) : value;
		}
		return { params, namespace, key: message.key };
	});

export const restoredDisplayText = (
	pluginIds: ReferenceMap,
	text: ArchiveDisplayText,
): Effect.Effect<DisplayText, BackupArchiveError> =>
	typeof text === "string" ? Effect.succeed(text) : restoredMessage(pluginIds, text);

const archiveMessagePluginKeys = (text: ArchiveDisplayText, add: (key: null | string) => void) => {
	if (typeof text === "string") {
		return;
	}
	add(text.pluginKey);
	for (const value of Object.values(text.params ?? {})) {
		if (isNestedMessage(value)) {
			archiveMessagePluginKeys(value, add);
		}
	}
};

const isResultsTableRenderer = (renderer: { readonly kind: string; readonly name?: string }) =>
	renderer.kind === "kernel" && renderer.name === "results-table";

const settingsObject = <E extends { readonly message: string }>(
	encoded: Effect.Effect<unknown, E>,
) =>
	encoded.pipe(
		Effect.flatMap(decodeArchiveJsonObject),
		Effect.mapError((error) => archiveError("invalid_entry", error.message)),
	);

export const exportRendererSettings = Effect.fn(function* (
	renderer: { readonly kind: string; readonly name?: string },
	settings: Readonly<Record<string, JsonValue>>,
	pluginKeys: ReferenceMap,
) {
	if (isResultsTableRenderer(renderer)) {
		const decoded = yield* Schema.decodeUnknownEffect(ResultsTableSavedViewSettings)(settings).pipe(
			Effect.mapError((error) => archiveError("invalid_entry", error.message)),
		);
		return yield* settingsObject(
			Schema.encodeEffect(ArchiveResultsTableSavedViewSettings)({
				...decoded,
				columns: Arr.map(decoded.columns, (column) => ({
					...column,
					label: archiveDisplayText(pluginKeys, column.label),
				})),
			}),
		);
	}
	if (!isEntityBrowserRenderer(renderer)) {
		return settings;
	}
	const decoded = yield* Schema.decodeUnknownEffect(EntityBrowserSavedViewSettings)(settings).pipe(
		Effect.mapError((error) => archiveError("invalid_entry", error.message)),
	);
	const action = decoded.addAction;
	const references = [
		...decoded.subject.schemas,
		...(action?.type === "provider-search" ? [action.schema] : []),
	];
	if (references.some(({ owner }) => owner.kind === "plugin" && !pluginKeys.has(owner.pluginId))) {
		return yield* archiveError(
			"missing_reference_mapping",
			"Backup renderer references unavailable plugin",
		);
	}
	const toArchive = <Slug extends string>({
		slug,
		owner,
	}: {
		readonly slug: Slug;
		readonly owner: DefinitionOwner;
	}) => ({
		slug,
		pluginKey: (owner.kind === "plugin" ? pluginKeys.get(owner.pluginId) : null) ?? null,
	});
	return yield* settingsObject(
		Schema.encodeEffect(ArchiveEntityBrowserSavedViewSettings)({
			...decoded,
			addAction: mapEntityBrowserAddActionSchema(action, toArchive),
			subject: { ...decoded.subject, schemas: Arr.map(decoded.subject.schemas, toArchive) },
			tableColumns:
				decoded.tableColumns === null
					? null
					: Arr.map(decoded.tableColumns, (column) => ({
							...column,
							label: archiveDisplayText(pluginKeys, column.label),
						})),
		}),
	);
});

const restoredColumns = <Column extends { readonly label: ArchiveDisplayText }>(
	columns: Arr.NonEmptyReadonlyArray<Column>,
	pluginIds: ReferenceMap,
) =>
	Effect.forEach(columns, (column) =>
		Effect.map(restoredDisplayText(pluginIds, column.label), (label) => ({ ...column, label })),
	);

export const importRendererSettings = Effect.fn(function* (
	renderer: { readonly kind: string; readonly name?: string },
	settings: Readonly<Record<string, JsonValue>>,
	pluginIds: ReferenceMap,
) {
	if (isResultsTableRenderer(renderer)) {
		const decoded = yield* Schema.decodeUnknownEffect(ArchiveResultsTableSavedViewSettings)(
			settings,
		).pipe(Effect.mapError((error) => archiveError("invalid_entry", error.message)));
		const columns = yield* restoredColumns(decoded.columns, pluginIds);
		return yield* settingsObject(
			Schema.encodeUnknownEffect(ResultsTableSavedViewSettings)({ ...decoded, columns }),
		);
	}
	if (!isEntityBrowserRenderer(renderer)) {
		return settings;
	}
	const decoded = yield* Schema.decodeUnknownEffect(ArchiveEntityBrowserSavedViewSettings)(
		settings,
	).pipe(Effect.mapError((error) => archiveError("invalid_entry", error.message)));
	const action = decoded.addAction;
	const references = [
		...decoded.subject.schemas,
		...(action?.type === "provider-search" ? [action.schema] : []),
	];
	if (references.some(({ pluginKey }) => pluginKey != null && !pluginIds.has(pluginKey))) {
		return yield* archiveError(
			"missing_reference_mapping",
			"Backup renderer plugin mapping is incomplete",
		);
	}
	const toLocal = <Slug extends string>({
		slug,
		pluginKey,
	}: {
		readonly slug: Slug;
		readonly pluginKey: null | string;
	}) => ({
		slug,
		owner: definitionOwner(pluginKey == null ? null : (pluginIds.get(pluginKey) ?? null)),
	});
	const tableColumns =
		decoded.tableColumns === null ? null : yield* restoredColumns(decoded.tableColumns, pluginIds);
	return yield* settingsObject(
		Schema.encodeUnknownEffect(EntityBrowserSavedViewSettings)({
			...decoded,
			tableColumns,
			addAction: mapEntityBrowserAddActionSchema(action, toLocal),
			subject: { ...decoded.subject, schemas: Arr.map(decoded.subject.schemas, toLocal) },
		}),
	);
});

const rewriteQueryReferences = Effect.fn(function* (
	document: RyotQLDocument,
	resolve: (
		reference: PluginIdentityReference,
	) => Effect.Effect<PluginIdentityReference, BackupArchiveError>,
) {
	const resolved = new Map<string, PluginIdentityReference>();
	for (const reference of pluginIdentityReferences(document)) {
		resolved.set(stableStringify(reference), yield* resolve(reference));
	}
	return yield* Effect.fromResult(
		mapPluginIdentityReferences(
			document,
			(reference) => resolved.get(stableStringify(reference)) ?? reference,
		),
	).pipe(Effect.mapError((error) => archiveError("invalid_entry", error.message)));
});

export const exportQueryPluginReferences = Effect.fn(function* (
	document: null | RyotQLDocument,
	packages: ReadonlyMap<string, PluginPackageReference>,
) {
	if (document === null) {
		return null;
	}
	return yield* rewriteQueryReferences(
		document,
		Effect.fnUntraced(function* (reference) {
			if (reference.kind === "package") {
				return reference;
			}
			if (reference.kind === "self") {
				return yield* archiveError(
					"missing_reference_mapping",
					"Backup query contains an unbound self reference",
				);
			}
			const target = packages.get(reference.pluginId);
			if (!target) {
				return yield* archiveError(
					"missing_reference_mapping",
					`Backup query references unavailable plugin '${reference.pluginId}'`,
				);
			}
			return { kind: "package", ...target };
		}),
	);
});

export const importQueryPluginReferences = Effect.fn(function* (
	document: null | RyotQLDocument,
	pluginIds: ReferenceMap,
) {
	if (document === null) {
		return null;
	}
	return yield* rewriteQueryReferences(
		document,
		Effect.fnUntraced(function* (reference) {
			const id = reference.kind === "package" ? pluginIds.get(pluginPackageKey(reference)) : null;
			if (!id) {
				return yield* archiveError(
					"missing_reference_mapping",
					"Backup query contains an unresolved plugin reference",
				);
			}
			return { kind: "local", pluginId: PluginId.make(id) };
		}),
	);
});

export const exportSavedArguments = (
	document: null | RyotQLDocument,
	values: Readonly<Record<string, JsonValue>>,
	pluginKeys: ReferenceMap,
	partial = false,
) =>
	rewriteSavedArgumentSources(
		document,
		values,
		Effect.fn(function* (source) {
			if (source.kind !== "saved-view" || source.reference.kind !== "plugin") {
				return source;
			}
			const key = pluginKeys.get(source.reference.pluginId);
			if (!key) {
				return yield* archiveError(
					"missing_reference_mapping",
					"Saved argument references an unavailable plugin",
				);
			}
			return { ...source, reference: { ...source.reference, pluginId: PluginId.make(key) } };
		}),
		partial,
	);

const archiveReferenceError = (error: DataReferenceError) =>
	archiveError(error.code, error.message);

const requiredArchiveReference = (
	mapping: ReferenceMap,
	id: string,
	kind: "asset" | "entity" | "relationship",
) => requiredReference(mapping, id, kind).pipe(Effect.mapError(archiveReferenceError));

export const collectReferencedPluginKeys = (records: ArchiveRecords) => {
	const referenced = new Set<string>();
	const add = (key: null | string) => {
		if (key !== null) {
			referenced.add(key);
		}
	};
	const addQueryPackages = (document: null | RyotQLDocument) => {
		if (document === null) {
			return;
		}
		for (const reference of pluginIdentityReferences(document)) {
			if (reference.kind === "package") {
				add(pluginPackageKey(reference));
			}
		}
	};
	for (const plugin of records.privatePlugins) {
		for (const dependency of Object.values(plugin.manifest.dependencies ?? {})) {
			add(pluginPackageKey(dependency));
		}
		for (const view of plugin.manifest.savedViews) {
			for (const [name, property] of Object.entries(view.dataSources?.parameters?.fields ?? {})) {
				if (property.type !== "string" || property.reference?.kind !== "entity-source") {
					continue;
				}
				const value = Object.hasOwn(view.arguments ?? {}, name)
					? view.arguments?.[name]
					: property.defaultValue;
				if (typeof value !== "string") {
					continue;
				}
				const source = Result.getOrThrow(decodeEntitySourceReference(value));
				if (source.kind === "saved-view" && source.reference.kind === "plugin") {
					add(source.reference.pluginId);
				}
			}
		}
	}
	for (const installation of records.installations) {
		add(installation.packageKey);
		if (installation.homeSavedView?.kind === "plugin") {
			add(installation.homeSavedView.pluginKey);
		}
	}
	for (const integration of records.integrations) {
		add(integration.packageKey);
	}
	for (const entity of records.entities) {
		add(entity.entitySchemaPluginKey);
		add(entity.provider?.pluginKey ?? null);
	}
	for (const entity of records.entityDependencies) {
		add(entity.entitySchemaPluginKey);
		add(entity.provider?.pluginKey ?? null);
		if (entity.identity.kind !== "unmanaged") {
			add(entity.identity.pluginKey);
		}
	}
	for (const relationship of records.relationships) {
		add(relationship.relationshipSchemaPluginKey);
	}
	for (const override of records.calendarSourceOverrides) {
		add(override.pluginKey);
	}
	for (const view of records.savedViews) {
		add(view.pluginKey);
		if (view.kind === "custom" && view.renderer.kind === "plugin") {
			add(view.renderer.pluginKey);
		}
		if (view.kind === "custom") {
			archiveMessagePluginKeys(view.name, add);
			addQueryPackages(view.dataSources);
			for (const [name, property] of Object.entries(view.dataSources?.parameters?.fields ?? {})) {
				if (property.type !== "string" || property.reference?.kind !== "entity-source") {
					continue;
				}
				const value = Object.hasOwn(view.arguments, name)
					? view.arguments[name]
					: property.defaultValue;
				if (typeof value !== "string") {
					continue;
				}
				const source = Result.getOrThrow(decodeEntitySourceReference(value));
				if (source.kind === "saved-view" && source.reference.kind === "plugin") {
					add(source.reference.pluginId);
				}
			}
		}
		if (view.kind === "custom" && isResultsTableRenderer(view.renderer)) {
			const { columns } = decodeArchiveJson(
				ArchiveResultsTableSavedViewSettings,
				view.settings,
				"saved-views.ndjson",
			);
			for (const { label } of columns) {
				archiveMessagePluginKeys(label, add);
			}
		}
		if (view.kind === "custom" && isEntityBrowserRenderer(view.renderer)) {
			const { subject, addAction, tableColumns } = decodeArchiveJson(
				ArchiveEntityBrowserSavedViewSettings,
				view.settings,
				"saved-views.ndjson",
			);
			for (const { pluginKey } of subject.schemas) {
				add(pluginKey);
			}
			if (addAction?.type === "provider-search") {
				add(addAction.schema.pluginKey);
			}
			for (const { label } of tableColumns ?? []) {
				archiveMessagePluginKeys(label, add);
			}
		}
	}
	for (const subscription of records.notificationSubscriptions) {
		add(subscription.signalSchemaPluginKey);
	}
	for (const publication of records.publications) {
		for (const reference of pluginIdentityReferences(publication.document)) {
			if (reference.kind === "package") {
				add(pluginPackageKey(reference));
			}
		}
		for (const definition of publication.snapshot?.page
			? [publication.snapshot.page.definition]
			: []) {
			for (const reference of Object.values(definition.pluginDependencies)) {
				add(pluginPackageKey(reference));
			}
		}
		for (const values of [
			publication.definition.arguments,
			...(publication.snapshot ? [publication.snapshot.arguments] : []),
		]) {
			for (const [key, property] of Object.entries(publication.document.parameters?.fields ?? {})) {
				const value = values[key];
				if (
					property.type !== "string" ||
					property.reference?.kind !== "entity-source" ||
					typeof value !== "string"
				) {
					continue;
				}
				const source = Result.getOrThrow(decodeEntitySourceReference(value));
				if (source.kind === "saved-view" && source.reference.kind === "plugin") {
					add(source.reference.pluginId);
				}
			}
		}
	}
	return referenced;
};

export const rewriteRelationshipReferences = Effect.fn(function* (
	relationship: ArchiveRelationship,
	entityIds: ReferenceMap,
) {
	const sourceEntityId = yield* requiredArchiveReference(
		entityIds,
		relationship.sourceEntityId,
		"entity",
	);
	const targetEntityId = yield* requiredArchiveReference(
		entityIds,
		relationship.targetEntityId,
		"entity",
	);
	return { ...relationship, sourceEntityId, targetEntityId };
});

export const rewriteEventReferences = Effect.fn(function* (
	event: ArchiveEvent,
	propertiesSchema: AppSchema<unknown>,
	entityIds: ReferenceMap,
	relationshipIds: ReferenceMap,
	eventId: (id: string) => string | undefined,
) {
	const entityId = yield* requiredArchiveReference(entityIds, event.entityId, "entity");
	const sessionEntityId =
		event.sessionEntityId === null
			? null
			: yield* requiredArchiveReference(entityIds, event.sessionEntityId, "entity");
	const properties = yield* rewritePropertyReferences(
		event.properties,
		propertiesSchema,
		entityIds,
		relationshipIds,
		eventId,
	).pipe(Effect.mapError(archiveReferenceError));
	return { ...event, entityId, properties, sessionEntityId };
});

export const rewriteAssetLocatorForArchive = (
	locator: AssetLocator,
	sha256: string,
): AssetLocator => (locator.type === "remote" ? locator : { key: sha256, type: locator.type });

export const escapePointer = (value: string) => value.replaceAll("~", "~0").replaceAll("/", "~1");

const redactProperty = (
	definition: AppPropertyDefinition<unknown>,
	value: JsonValue,
	path: string,
	paths: string[],
): JsonValue => {
	if (definition.type === "object" && isArchiveJsonObject(value)) {
		return redactFields(definition.properties, value, path, paths);
	}
	if (definition.type === "array" && isUnknownArray(value)) {
		if (definition.items.secret === true) {
			for (let index = 0; index < value.length; index += 1) {
				paths.push(`${path}/${index}`);
			}
			return [];
		}
		return value.map((item, index) =>
			redactProperty(definition.items, item, `${path}/${index}`, paths),
		);
	}
	return value;
};

const redactFields = (
	fields: AppSchema<unknown>["fields"],
	value: JsonObject,
	path: string,
	paths: string[],
) => {
	const redacted: JsonObject = { ...value };
	for (const [key, definition] of Object.entries(fields)) {
		const childPath = `${path}/${escapePointer(key)}`;
		if (
			definition.secret === true ||
			(definition.type === "string" && definition.format?.kind === "oauth-connection")
		) {
			if (Object.hasOwn(value, key)) {
				Reflect.deleteProperty(redacted, key);
				paths.push(childPath);
			}
		} else if (value[key] !== undefined) {
			redacted[key] = redactProperty(definition, value[key], childPath, paths);
		}
	}
	return redacted;
};

export const redactSchemaSecrets = (
	value: JsonObject,
	schema: AppSchema<unknown>,
	basePath = "",
) => {
	const redactions: string[] = [];
	const redacted = redactFields(schema.fields, value, basePath, redactions);
	return { redacted, redactions };
};
