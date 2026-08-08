import type { JsonValue } from "@ryot/contract/modules/sandbox/wire";
import type { AssetLocator } from "@ryot/contract/modules/uploads/schemas";
import type { AppPropertyDefinition, AppSchema } from "@ryot/contract/schema/property-schema";
import { Effect } from "effect";

import type { V1Event, V1Relationship, V1UserEntity } from "#modules/backups/v1-codec";

import { archiveError, type BackupArchiveError } from "./archive-error";

type JsonObject = Record<string, JsonValue>;
type ReferenceMap = ReadonlyMap<string, string>;

export const backupV1EventReferenceRules = [
	{
		entityIdProperty: "entityId",
		relationshipIdProperty: "relationshipId",
		eventSchemaSlugs: [
			["collection", "add-entity-to-collection"].join(":"),
			["collection", "remove-entity-from-collection"].join(":"),
		],
	},
] as const;

export const backupV1EntityReferenceRules = [
	{
		itemsProperty: "exercises",
		referenceProperty: ["exer", "ciseId"].join(""),
		entitySchemaSlug: ["work", "out-template"].join(""),
	},
] as const;

const lookup = (mapping: ReferenceMap, id: string) => mapping.get(id);

const requiredReference = (
	mapping: ReferenceMap,
	id: string,
	kind: "asset" | "entity" | "relationship",
) => {
	const replacement = lookup(mapping, id);
	return replacement === undefined
		? Effect.fail(
				archiveError("missing_reference_mapping", `Missing ${kind} reference mapping for '${id}'`),
			)
		: Effect.succeed(replacement);
};

export const rewriteV1RelationshipReferences = Effect.fn(function* (
	relationship: V1Relationship,
	entityIds: ReferenceMap,
) {
	const sourceEntityId = yield* requiredReference(entityIds, relationship.sourceEntityId, "entity");
	const targetEntityId = yield* requiredReference(entityIds, relationship.targetEntityId, "entity");
	return { ...relationship, sourceEntityId, targetEntityId };
});

export const rewriteV1EventReferences = Effect.fn(function* (
	event: V1Event,
	entityIds: ReferenceMap,
	relationshipIds: ReferenceMap,
	rules: ReadonlyArray<{
		readonly entityIdProperty: string;
		readonly relationshipIdProperty: string;
		readonly eventSchemaSlugs: ReadonlyArray<string>;
	}> = [],
) {
	const entityId = yield* requiredReference(entityIds, event.entityId, "entity");
	const sessionEntityId =
		event.sessionEntityId === null
			? null
			: yield* requiredReference(entityIds, event.sessionEntityId, "entity");
	const rule = rules.find(({ eventSchemaSlugs }) =>
		eventSchemaSlugs.includes(event.eventSchemaSlug),
	);
	if (!rule) {
		return { ...event, entityId, sessionEntityId };
	}
	const properties = { ...event.properties };
	const propertyEntityId = properties[rule.entityIdProperty];
	const relationshipId = properties[rule.relationshipIdProperty];
	if (typeof propertyEntityId !== "string" || typeof relationshipId !== "string") {
		return yield* archiveError("invalid_entry", "Embedded event references must be strings");
	}
	properties[rule.entityIdProperty] = entityIds.get(propertyEntityId) ?? propertyEntityId;
	properties[rule.relationshipIdProperty] = relationshipIds.get(relationshipId) ?? relationshipId;
	return { ...event, entityId, sessionEntityId, properties };
});

export const rewriteV1EntityEmbeddedReferences = Effect.fn(function* (
	entity: V1UserEntity,
	entityIds: ReferenceMap,
	rules: ReadonlyArray<{
		readonly itemsProperty: string;
		readonly entitySchemaSlug: string;
		readonly referenceProperty: string;
	}> = [],
) {
	const rule = rules.find(({ entitySchemaSlug }) => entitySchemaSlug === entity.entitySchemaSlug);
	if (!rule) {
		return entity;
	}
	const items = entity.properties[rule.itemsProperty];
	if (items === null || items === undefined) {
		return entity;
	}
	if (!Array.isArray(items)) {
		return yield* archiveError("invalid_entry", "Embedded entity references must be an array");
	}
	const rewritten: JsonValue[] = [];
	for (const item of items) {
		const reference = isJsonObject(item) ? item[rule.referenceProperty] : undefined;
		if (!isJsonObject(item) || typeof reference !== "string") {
			return yield* archiveError("invalid_entry", "Embedded entity reference must be a string");
		}
		rewritten.push({
			...item,
			[rule.referenceProperty]: yield* requiredReference(entityIds, reference, "entity"),
		});
	}
	return { ...entity, properties: { ...entity.properties, [rule.itemsProperty]: rewritten } };
});

const isJsonObject = (value: JsonValue): value is JsonObject =>
	typeof value === "object" && value !== null && !Array.isArray(value);

type V1ManagedAssetLocator = Exclude<AssetLocator, { readonly type: "remote" }>;

const assetKey = (locator: V1ManagedAssetLocator) => `${locator.type}:${locator.key}`;

export const rewriteV1AssetLocatorForArchive = (
	locator: AssetLocator,
	sha256: string,
): AssetLocator => (locator.type === "remote" ? locator : { type: locator.type, key: sha256 });

const readAssetLocator = (value: JsonValue): AssetLocator | null => {
	if (!isJsonObject(value)) {
		return null;
	}
	if (value["type"] === "remote" && typeof value["url"] === "string") {
		return { type: "remote", url: value["url"] };
	}
	if ((value["type"] === "local" || value["type"] === "s3") && typeof value["key"] === "string") {
		return { type: value["type"], key: value["key"] };
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
			if (!isJsonObject(value)) {
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

export const rewriteV1ManagedAssetLocators = Effect.fn(function* (
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
	if (definition.type === "object" && isJsonObject(value)) {
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

export const redactV1SchemaSecrets = (value: JsonObject, schema: AppSchema, basePath = "") => {
	const redactions: string[] = [];
	const redacted = redactFields(schema.fields, value, basePath, redactions);
	return { redacted, redactions };
};
