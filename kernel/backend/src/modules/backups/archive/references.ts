import type { JsonValue } from "@ryot-app/contract/modules/sandbox/wire";
import type { AssetLocator } from "@ryot-app/contract/modules/uploads/schemas";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Effect } from "effect";

import { archiveError, type BackupArchiveError } from "./error";
import {
	isArchiveJsonObject,
	type ArchiveRecords,
	type ArchiveEvent,
	type ArchiveRelationship,
} from "./schemas";

type JsonObject = Record<string, JsonValue>;
type ReferenceMap = ReadonlyMap<string, string>;

export const collectReferencedPluginKeys = (records: ArchiveRecords) => {
	const referenced = new Set<string>();
	const add = (key: string | null) => {
		if (key !== null) {
			referenced.add(key);
		}
	};
	for (const installation of records.installations) {
		add(installation.packageKey);
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
		if (view.renderer.kind === "plugin") {
			add(view.renderer.pluginKey);
		}
	}
	for (const subscription of records.notificationSubscriptions) {
		add(subscription.signalSchemaPluginKey);
	}
	return referenced;
};

const collectPropertyEntityIds = (
	definition: AppPropertyDefinition,
	value: unknown,
	ids: Set<string>,
) => {
	if (
		definition.type === "string" &&
		definition.reference?.kind === "entity-id" &&
		typeof value === "string"
	) {
		ids.add(value);
		return;
	}
	if (definition.type === "object" && isArchiveJsonObject(value)) {
		for (const [key, child] of Object.entries(definition.properties)) {
			collectPropertyEntityIds(child, value[key], ids);
		}
		return;
	}
	if (definition.type === "array" && Array.isArray(value)) {
		for (const item of value) {
			collectPropertyEntityIds(definition.items, item, ids);
		}
	}
};

export const collectEmbeddedEntityIds = (
	records: ReadonlyArray<{
		readonly propertiesSchema: AppSchema;
		readonly properties: Readonly<Record<string, unknown>>;
	}>,
) => {
	const ids = new Set<string>();
	for (const { properties, propertiesSchema } of records) {
		for (const [key, definition] of Object.entries(propertiesSchema.fields)) {
			collectPropertyEntityIds(definition, properties[key], ids);
		}
	}
	return [...ids].sort();
};

const requiredReference = (
	mapping: ReferenceMap,
	id: string,
	kind: "asset" | "entity" | "relationship",
) => {
	const replacement = mapping.get(id);
	return replacement === undefined
		? Effect.fail(
				archiveError("missing_reference_mapping", `Missing ${kind} reference mapping for '${id}'`),
			)
		: Effect.succeed(replacement);
};

export const rewriteRelationshipReferences = Effect.fn(function* (
	relationship: ArchiveRelationship,
	entityIds: ReferenceMap,
) {
	const sourceEntityId = yield* requiredReference(entityIds, relationship.sourceEntityId, "entity");
	const targetEntityId = yield* requiredReference(entityIds, relationship.targetEntityId, "entity");
	return { ...relationship, sourceEntityId, targetEntityId };
});

export const rewriteEventReferences = Effect.fn(function* (
	event: ArchiveEvent,
	propertiesSchema: AppSchema,
	entityIds: ReferenceMap,
	relationshipIds: ReferenceMap,
) {
	const entityId = yield* requiredReference(entityIds, event.entityId, "entity");
	const sessionEntityId =
		event.sessionEntityId === null
			? null
			: yield* requiredReference(entityIds, event.sessionEntityId, "entity");
	const properties = yield* rewritePropertyReferences(
		event.properties,
		propertiesSchema,
		entityIds,
		relationshipIds,
	);
	return { ...event, entityId, properties, sessionEntityId };
});

const rewritePropertyValueReferences = (
	definition: AppPropertyDefinition,
	value: JsonValue,
	entityIds: ReferenceMap,
	relationshipIds: ReferenceMap,
): Effect.Effect<JsonValue, BackupArchiveError> =>
	Effect.gen(function* () {
		if (definition.type === "string" && definition.reference && typeof value === "string") {
			const kind = definition.reference.kind === "entity-id" ? "entity" : "relationship";
			const mapping = kind === "entity" ? entityIds : relationshipIds;
			const replacement = mapping.get(value);
			if (replacement !== undefined) {
				return replacement;
			}
			return definition.reference.required === true
				? yield* requiredReference(mapping, value, kind)
				: value;
		}
		if (definition.type === "object" && isArchiveJsonObject(value)) {
			const rewritten: JsonObject = { ...value };
			for (const [key, child] of Object.entries(definition.properties)) {
				const childValue = value[key];
				if (childValue !== undefined) {
					rewritten[key] = yield* rewritePropertyValueReferences(
						child,
						childValue,
						entityIds,
						relationshipIds,
					);
				}
			}
			return rewritten;
		}
		if (definition.type === "array" && Array.isArray(value)) {
			const rewritten: JsonValue[] = [];
			for (const item of value) {
				rewritten.push(
					yield* rewritePropertyValueReferences(definition.items, item, entityIds, relationshipIds),
				);
			}
			return rewritten;
		}
		return value;
	});

export const rewritePropertyReferences = Effect.fn(function* (
	value: JsonObject,
	schema: AppSchema,
	entityIds: ReferenceMap,
	relationshipIds: ReferenceMap,
) {
	const rewritten: JsonObject = { ...value };
	for (const [key, definition] of Object.entries(schema.fields)) {
		const property = value[key];
		if (property !== undefined) {
			rewritten[key] = yield* rewritePropertyValueReferences(
				definition,
				property,
				entityIds,
				relationshipIds,
			);
		}
	}
	return rewritten;
});

type ArchivedManagedAssetLocator = Exclude<AssetLocator, { readonly type: "remote" }>;

const assetKey = (locator: ArchivedManagedAssetLocator) => `${locator.type}:${locator.key}`;

export const rewriteAssetLocatorForArchive = (
	locator: AssetLocator,
	sha256: string,
): AssetLocator => (locator.type === "remote" ? locator : { key: sha256, type: locator.type });

const readAssetLocator = (value: JsonValue): AssetLocator | null => {
	if (!isArchiveJsonObject(value)) {
		return null;
	}
	if (value["type"] === "remote" && typeof value["url"] === "string") {
		return { type: "remote", url: value["url"] };
	}
	if ((value["type"] === "local" || value["type"] === "s3") && typeof value["key"] === "string") {
		return { key: value["key"], type: value["type"] };
	}
	return null;
};

const rewritePropertyAssets = (
	definition: AppPropertyDefinition,
	value: JsonValue,
	locators: ReadonlyMap<string, AssetLocator>,
): Effect.Effect<JsonValue, BackupArchiveError> =>
	Effect.gen(function* () {
		if (definition.type === "object") {
			if (definition.validation?.asset === true) {
				const locator = readAssetLocator(value);
				if (locator === null) {
					return yield* archiveError("invalid_entry", "Invalid managed asset locator");
				}
				if (locator.type === "remote") {
					return value;
				}
				const replacement = locators.get(assetKey(locator));
				if (replacement === undefined) {
					return yield* archiveError(
						"missing_reference_mapping",
						`Missing asset reference mapping for '${assetKey(locator)}'`,
					);
				}
				return replacement;
			}
			if (!isArchiveJsonObject(value)) {
				return value;
			}
			const rewritten: JsonObject = { ...value };
			for (const [key, child] of Object.entries(definition.properties)) {
				const childValue = value[key];
				if (childValue !== undefined) {
					rewritten[key] = yield* rewritePropertyAssets(child, childValue, locators);
				}
			}
			return rewritten;
		}
		if (definition.type === "array" && Array.isArray(value)) {
			const rewritten: JsonValue[] = [];
			for (const item of value) {
				rewritten.push(yield* rewritePropertyAssets(definition.items, item, locators));
			}
			return rewritten;
		}
		return value;
	});

export const rewriteManagedAssetLocators = Effect.fn(function* (
	value: JsonObject,
	schema: AppSchema,
	locators: ReadonlyMap<string, AssetLocator>,
) {
	const rewritten: JsonObject = { ...value };
	for (const [key, definition] of Object.entries(schema.fields)) {
		const property = value[key];
		if (property !== undefined) {
			rewritten[key] = yield* rewritePropertyAssets(definition, property, locators);
		}
	}
	return rewritten;
});

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
		if (definition.secret === true) {
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
