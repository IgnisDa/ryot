import type { JsonValue } from "@ryot-app/contract/modules/sandbox/wire";
import type { AssetLocator } from "@ryot-app/contract/modules/uploads/schemas";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Effect } from "effect";

import {
	requiredReference,
	rewritePropertyReferences,
	type DataReferenceError,
} from "#lib/domain/data-references";

import { archiveError } from "./error";
import {
	isArchiveJsonObject,
	type ArchiveRecords,
	type ArchiveEvent,
	type ArchiveRelationship,
} from "./schemas";

type JsonObject = Record<string, JsonValue>;
type ReferenceMap = ReadonlyMap<string, string>;

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
		if (view.kind === "custom" && view.renderer.kind === "plugin") {
			add(view.renderer.pluginKey);
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
