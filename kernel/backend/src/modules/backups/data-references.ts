import { type AssetLocator, ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Effect, Schema } from "effect";

import { managedAssetLocatorKey } from "#lib/domain/managed-asset-locators";

import { isArchiveJsonObject } from "./archive/schemas";

type JsonObject = Record<string, JsonValue>;
type ReferenceMap = ReadonlyMap<string, string>;

const isManagedAssetLocator = Schema.is(ManagedAssetLocator);

export class DataReferenceError extends Schema.TaggedError<
	DataReferenceError,
	{ readonly brand: unique symbol }
>()("DataReferenceError", {
	message: Schema.String,
	code: Schema.Literals(["missing_reference_mapping", "invalid_entry"]),
}) {}

export const requiredReference = (
	mapping: ReferenceMap,
	id: string,
	kind: "asset" | "entity" | "relationship",
) => {
	const replacement = mapping.get(id);
	return replacement === undefined
		? Effect.fail(
				new DataReferenceError({
					code: "missing_reference_mapping",
					message: `Missing ${kind} reference mapping for '${id}'`,
				}),
			)
		: Effect.succeed(replacement);
};

const collectPropertyReferenceIds = (
	definition: AppPropertyDefinition,
	value: unknown,
	ids: Set<string>,
	kind: "entity-id" | "relationship-id",
) => {
	if (
		definition.type === "string" &&
		definition.reference?.kind === kind &&
		typeof value === "string"
	) {
		ids.add(value);
		return;
	}
	if (definition.type === "object" && isArchiveJsonObject(value)) {
		for (const [key, child] of Object.entries(definition.properties)) {
			collectPropertyReferenceIds(child, value[key], ids, kind);
		}
		return;
	}
	if (definition.type === "array" && Array.isArray(value)) {
		for (const item of value) {
			collectPropertyReferenceIds(definition.items, item, ids, kind);
		}
	}
};

export const collectEmbeddedReferenceIds = (
	records: ReadonlyArray<{
		readonly propertiesSchema: AppSchema;
		readonly properties: Readonly<Record<string, unknown>>;
	}>,
	kind: "entity-id" | "relationship-id",
) => {
	const ids = new Set<string>();
	for (const { properties, propertiesSchema } of records) {
		for (const [key, definition] of Object.entries(propertiesSchema.fields)) {
			collectPropertyReferenceIds(definition, properties[key], ids, kind);
		}
	}
	return [...ids].sort();
};

export const collectEmbeddedEntityIds = (
	records: Parameters<typeof collectEmbeddedReferenceIds>[0],
) => collectEmbeddedReferenceIds(records, "entity-id");

const rewritePropertyValueReferences = (
	definition: AppPropertyDefinition,
	value: JsonValue,
	entityIds: ReferenceMap,
	relationshipIds: ReferenceMap,
	eventId: ((id: string) => string) | undefined,
): Effect.Effect<JsonValue, DataReferenceError> =>
	Effect.gen(function* () {
		if (definition.type === "string" && definition.reference && typeof value === "string") {
			if (definition.reference.kind === "event-id") {
				return eventId
					? eventId(value)
					: yield* new DataReferenceError({
							code: "missing_reference_mapping",
							message: `Missing event reference mapping for '${value}'`,
						});
			}
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
						eventId,
					);
				}
			}
			return rewritten;
		}
		if (definition.type === "array" && Array.isArray(value)) {
			const rewritten: JsonValue[] = [];
			for (const item of value) {
				rewritten.push(
					yield* rewritePropertyValueReferences(
						definition.items,
						item,
						entityIds,
						relationshipIds,
						eventId,
					),
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
	eventId?: (id: string) => string,
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
				eventId,
			);
		}
	}
	return rewritten;
});

const readAssetLocator = (value: JsonValue): AssetLocator | null => {
	if (!isArchiveJsonObject(value)) {
		return null;
	}
	if (value["type"] === "remote" && typeof value["url"] === "string") {
		return { type: "remote", url: value["url"] };
	}
	if (isManagedAssetLocator(value)) {
		return { key: value.key, type: value.type };
	}
	return null;
};

const rewritePropertyAssets = (
	definition: AppPropertyDefinition,
	value: JsonValue,
	locators: ReadonlyMap<string, AssetLocator>,
): Effect.Effect<JsonValue, DataReferenceError> =>
	Effect.gen(function* () {
		if (definition.type === "object") {
			if (definition.validation?.asset === true) {
				const locator = readAssetLocator(value);
				if (locator === null) {
					return yield* new DataReferenceError({
						code: "invalid_entry",
						message: "Invalid managed asset locator",
					});
				}
				if (locator.type === "remote") {
					return value;
				}
				const key = managedAssetLocatorKey(locator);
				const replacement = locators.get(key);
				if (replacement === undefined) {
					return yield* new DataReferenceError({
						code: "missing_reference_mapping",
						message: `Missing asset reference mapping for '${key}'`,
					});
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
