import type { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import {
	pluginPackageKey,
	type PluginIdentityReference,
	type PluginPackageReference,
	definitionOwner,
} from "@ryot-app/contract/modules/plugins/references";
import {
	mapPluginIdentityReferences,
	type RyotQLDocument,
} from "@ryot-app/contract/modules/ryotql/language";
import {
	EntityBrowserSavedViewSettings,
	mapEntityBrowserAddActionSchema,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { PluginId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Schema } from "effect";

import {
	requiredReference,
	rewritePropertyReferences,
	type DataReferenceError,
} from "#modules/backups/data-references";
import { pluginIdentityReferences } from "#modules/ryotql/binding";
import { isEntityBrowserRenderer } from "#modules/saved-views/definition-validation";

import { archiveError, type BackupArchiveError } from "./error";
import {
	isArchiveJsonObject,
	ArchiveEntityBrowserSavedViewSettings,
	decodeArchiveJsonObject,
	type ArchiveRecords,
	type ArchiveEvent,
	type ArchiveRelationship,
} from "./schemas";

type JsonObject = Record<string, JsonValue>;
type ReferenceMap = ReadonlyMap<string, string>;

export const exportRendererSettings = Effect.fn(function* (
	renderer: { readonly kind: string; readonly name?: string },
	settings: Readonly<Record<string, JsonValue>>,
	pluginKeys: ReferenceMap,
) {
	if (!isEntityBrowserRenderer(renderer)) {
		return settings;
	}
	const decoded = yield* Schema.decodeUnknownEffect(EntityBrowserSavedViewSettings)(settings).pipe(
		Effect.mapError((error) => archiveError("invalid_entry", error.message)),
	);
	const action = decoded.addAction;
	const owner = action?.type === "provider-search" ? action.schema.owner : undefined;
	const key = owner?.kind === "plugin" ? pluginKeys.get(owner.pluginId) : null;
	if (owner?.kind === "plugin" && !key) {
		return yield* archiveError(
			"missing_reference_mapping",
			"Backup renderer references unavailable plugin",
		);
	}
	const encoded = yield* Schema.encodeEffect(ArchiveEntityBrowserSavedViewSettings)({
		...decoded,
		addAction: mapEntityBrowserAddActionSchema(action, ({ slug }) => ({
			slug,
			pluginKey: key ?? null,
		})),
	}).pipe(Effect.mapError((error) => archiveError("invalid_entry", error.message)));
	return decodeArchiveJsonObject(encoded);
});

export const importRendererSettings = Effect.fn(function* (
	renderer: { readonly kind: string; readonly name?: string },
	settings: Readonly<Record<string, JsonValue>>,
	pluginIds: ReferenceMap,
) {
	if (!isEntityBrowserRenderer(renderer)) {
		return settings;
	}
	const decoded = yield* Schema.decodeUnknownEffect(ArchiveEntityBrowserSavedViewSettings)(
		settings,
	).pipe(Effect.mapError((error) => archiveError("invalid_entry", error.message)));
	const action = decoded.addAction;
	const key = action?.type === "provider-search" ? action.schema.pluginKey : null;
	const id = key == null ? null : pluginIds.get(key);
	if (key != null && !id) {
		return yield* archiveError(
			"missing_reference_mapping",
			"Backup renderer plugin mapping is incomplete",
		);
	}
	const encoded = yield* Schema.encodeUnknownEffect(EntityBrowserSavedViewSettings)({
		...decoded,
		addAction: mapEntityBrowserAddActionSchema(action, ({ slug }) => ({
			slug,
			owner: definitionOwner(id ?? null),
		})),
	}).pipe(Effect.mapError((error) => archiveError("invalid_entry", error.message)));
	return decodeArchiveJsonObject(encoded);
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
	return mapPluginIdentityReferences(
		document,
		(reference) => resolved.get(stableStringify(reference)) ?? reference,
	);
});

export const exportQueryPluginReferences = Effect.fn(function* (
	document: RyotQLDocument | null,
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
	document: RyotQLDocument | null,
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

const archiveReferenceError = (error: DataReferenceError) =>
	archiveError(error.code, error.message);

const requiredArchiveReference = (
	mapping: ReferenceMap,
	id: string,
	kind: "asset" | "entity" | "relationship",
) => requiredReference(mapping, id, kind).pipe(Effect.mapError(archiveReferenceError));

export const collectReferencedPluginKeys = (records: ArchiveRecords) => {
	const referenced = new Set<string>();
	const add = (key: string | null) => {
		if (key !== null) {
			referenced.add(key);
		}
	};
	const addQueryPackages = (document: RyotQLDocument | null) => {
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
		for (const dependency of Object.values(plugin.manifest.client?.pluginDependencies ?? {})) {
			add(pluginPackageKey(dependency));
		}
		for (const view of plugin.manifest.savedViews) {
			addQueryPackages(view.dataSources);
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
	for (const view of records.savedViews) {
		add(view.pluginKey);
		if (view.kind === "custom" && view.renderer.kind === "plugin") {
			add(view.renderer.pluginKey);
		}
		if (view.kind === "custom") {
			addQueryPackages(view.dataSources);
		}
		if (view.kind === "custom" && isEntityBrowserRenderer(view.renderer)) {
			const action = Schema.decodeUnknownSync(ArchiveEntityBrowserSavedViewSettings)(
				view.settings,
			).addAction;
			if (action?.type === "provider-search") {
				add(action.schema.pluginKey);
			}
		}
	}
	for (const subscription of records.notificationSubscriptions) {
		add(subscription.signalSchemaPluginKey);
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
	propertiesSchema: AppSchema,
	entityIds: ReferenceMap,
	relationshipIds: ReferenceMap,
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
	).pipe(Effect.mapError(archiveReferenceError));
	return { ...event, entityId, properties, sessionEntityId };
});

export const rewriteAssetLocatorForArchive = (
	locator: AssetLocator,
	sha256: string,
): AssetLocator => (locator.type === "remote" ? locator : { key: sha256, type: locator.type });

const escapePointer = (value: string) => value.replaceAll("~", "~0").replaceAll("/", "~1");

const redactProperty = (
	definition: AppPropertyDefinition,
	value: JsonValue,
	path: string,
	paths: string[],
): JsonValue => {
	if (definition.type === "object" && isArchiveJsonObject(value)) {
		return redactFields(definition.properties, value, path, paths);
	}
	if (definition.type === "array" && Array.isArray(value)) {
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
	fields: AppSchema["fields"],
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

export const redactSchemaSecrets = (value: JsonObject, schema: AppSchema, basePath = "") => {
	const redactions: string[] = [];
	const redacted = redactFields(schema.fields, value, basePath, redactions);
	return { redacted, redactions };
};
