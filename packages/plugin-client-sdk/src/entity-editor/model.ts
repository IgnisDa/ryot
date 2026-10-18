import { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { EntityEditorSaveSubmission } from "@ryot-app/contract/modules/entities/editor";
import type { PluginEntityEditorRelationship } from "@ryot-app/contract/modules/plugins/manifest";
import type { EntitySchemaReference } from "@ryot-app/contract/modules/plugins/references";
import type { EntityId } from "@ryot-app/contract/schema/brands";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";
import { retainPropertySecrets } from "@ryot-app/contract/schema/property-secrets";
import {
	initialSchemaFormValues,
	type SchemaFormMode,
	type SchemaFormValues,
	toSchemaFormPayload,
} from "@ryot-app/plugin-ui-sdk/schema-form";
import { Schema } from "effect";

import { managedAssetKey } from "../assets/keys";

export type EditorProperties = Readonly<Record<string, unknown>>;

export type EditorRelationshipTarget = {
	readonly name: string;
	readonly entityId: EntityId;
	readonly properties: EditorProperties;
};

export type EditorRelationshipDefinition = {
	readonly name: string;
	readonly slug: string;
	readonly propertiesSchema: AppSchema;
	readonly relatedEntitySchemaSlug: string;
	readonly direction: PluginEntityEditorRelationship["direction"];
};

export type EditorRelationshipTargets = Readonly<
	Record<string, readonly EditorRelationshipTarget[]>
>;

const isManagedAsset = Schema.is(ManagedAssetLocator);

export const entityFormValues = (
	schema: AppSchema,
	properties: EditorProperties,
): SchemaFormValues => initialSchemaFormValues(schema, undefined, properties);

export const entityPropertiesPayload = (
	schema: AppSchema,
	values: SchemaFormValues,
	mode: SchemaFormMode,
	stored: EditorProperties,
): Record<string, unknown> =>
	retainPropertySecrets(
		schema,
		stored,
		toSchemaFormPayload(schema, values, mode, entityFormValues(schema, stored)),
	);

const propertyAssets = (
	property: AppPropertyDefinition,
	value: unknown,
): readonly ManagedAssetLocator[] => {
	if (property.type === "object" && property.validation?.asset) {
		return isManagedAsset(value) ? [value] : [];
	}
	if (property.type === "array" && Array.isArray(value)) {
		return value.flatMap((item) => propertyAssets(property.items, item));
	}
	if (
		property.type === "object" &&
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value)
	) {
		return Object.entries(property.properties).flatMap(([key, child]) =>
			propertyAssets(child, Reflect.get(value, key)),
		);
	}
	return [];
};

export const managedAssetsOf = (
	properties: EditorProperties,
	schema: AppSchema,
): readonly ManagedAssetLocator[] =>
	Object.entries(schema.fields).flatMap(([key, property]) =>
		propertyAssets(property, properties[key]),
	);

export const unreferencedUploads = (
	uploaded: ReadonlyMap<string, ManagedAssetLocator>,
	saved: EditorProperties,
	schema: AppSchema,
	relationshipAssets: readonly ManagedAssetLocator[] = [],
) => {
	const referenced = new Set(
		[...managedAssetsOf(saved, schema), ...relationshipAssets].map((asset) =>
			managedAssetKey(asset),
		),
	);
	return [...uploaded].flatMap(([key, asset]) => (referenced.has(key) ? [] : [asset]));
};

export const buildSubmission = (input: {
	name: string;
	entitySchema: EntitySchemaReference;
	properties: Record<string, unknown>;
	target: EntityEditorSaveSubmission["target"];
	relationships: EditorRelationshipTargets;
}): EntityEditorSaveSubmission => ({
	action: "save",
	target: input.target,
	name: input.name.trim(),
	properties: input.properties,
	entitySchema: input.entitySchema,
	relationships: entityRelationshipPayload(input.relationships),
});

export const entityRelationshipPayload = (
	relationships: EditorRelationshipTargets,
): EntityEditorSaveSubmission["relationships"] =>
	Object.entries(relationships).map(([relationshipSchemaSlug, targets]) => ({
		relationshipSchemaSlug,
		targets: targets.map(({ entityId, properties }) => ({
			entityId,
			properties: { ...properties },
		})),
	}));
