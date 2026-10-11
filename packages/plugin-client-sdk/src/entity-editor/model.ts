import { AssetLocator, ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { EntityEditorSubmission } from "@ryot-app/contract/modules/entities/editor";
import type { EntityId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import {
	describeSchemaFormFields,
	initialSchemaFormValues,
	toSchemaFormPayload,
	type SchemaFormMode,
	type SchemaFormValue,
	type SchemaFormValues,
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
	readonly targetEntitySchemaSlug: string | null;
};

export type EditorRelationshipTargets = Readonly<
	Record<string, readonly EditorRelationshipTarget[]>
>;

const SchemaFormValueSchema = Schema.Union([
	Schema.String,
	Schema.Finite,
	Schema.Boolean,
	Schema.Array(Schema.Union([Schema.String, Schema.Finite, Schema.Boolean])),
	Schema.Array(AssetLocator),
]);

const isSchemaFormValue = Schema.is(SchemaFormValueSchema);
const isManagedAsset = Schema.is(ManagedAssetLocator);

export const entityFormValues = (
	schema: AppSchema,
	properties: EditorProperties,
): SchemaFormValues => {
	const stored = Object.fromEntries(
		Object.entries(properties).filter((entry): entry is [string, SchemaFormValue] =>
			isSchemaFormValue(entry[1]),
		),
	);
	return { ...initialSchemaFormValues(schema), ...stored };
};

export const entityPropertiesPayload = (
	schema: AppSchema,
	values: SchemaFormValues,
	mode: SchemaFormMode,
	stored: EditorProperties,
): Record<string, unknown> => {
	const { unsupported } = describeSchemaFormFields(schema, values, mode);
	return {
		...Object.fromEntries(
			unsupported.flatMap((key) => (key in stored ? [[key, stored[key]]] : [])),
		),
		...toSchemaFormPayload(schema, values),
	};
};

export const managedAssetsOf = (properties: EditorProperties): readonly ManagedAssetLocator[] =>
	Object.values(properties).flatMap((value) =>
		Array.isArray(value) ? value.filter((item) => isManagedAsset(item)) : [],
	);

export const unreferencedUploads = (
	uploaded: ReadonlyMap<string, ManagedAssetLocator>,
	saved: EditorProperties,
) => {
	const referenced = new Set(managedAssetsOf(saved).map((asset) => managedAssetKey(asset)));
	return [...uploaded].flatMap(([key, asset]) => (referenced.has(key) ? [] : [asset]));
};

export const buildSubmission = (input: {
	name: string;
	entitySchemaSlug: string;
	properties: Record<string, unknown>;
	target: EntityEditorSubmission["target"];
	relationships: EditorRelationshipTargets;
}): EntityEditorSubmission => ({
	target: input.target,
	name: input.name.trim(),
	properties: input.properties,
	entitySchemaSlug: input.entitySchemaSlug,
	relationships: Object.entries(input.relationships).map(([relationshipSchemaSlug, targets]) => ({
		relationshipSchemaSlug,
		targets: targets.map(({ entityId, properties }) => ({
			entityId,
			properties: { ...properties },
		})),
	})),
});
