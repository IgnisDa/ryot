import type { AppPropertyDefinition, AppSchema } from "@ryot/ts-utils";
import { getDefaultPropertyLabel, isAppPropertyRequired } from "@ryot/ts-utils";
import { z } from "zod";
import type { AppEntity } from "~/features/entities/model";
import {
	buildPrimitivePropertiesSchema,
	getUnsupportedRequiredProperties,
	isPrimitiveProperty,
	reconcilePrimitiveProperties,
} from "../property-schemas/primitive-schema-utils";
import type { AppCollection } from "./model";

export type CollectionMembershipFormValues = {
	collectionId: string;
	properties: Record<string, unknown>;
};

export type CollectionMembershipPayload = {
	collectionId: string;
	entityId: string;
	properties: Record<string, unknown>;
};

export function getSelectedCollection(
	collections: AppCollection[],
	collectionId?: string,
): AppCollection | undefined {
	const trimmedId = collectionId?.trim();
	if (!trimmedId) {
		return collections[0];
	}
	return collections.find((c) => c.id === trimmedId) ?? collections[0];
}

export const buildMembershipPropertyDefaults = (
	schema: AppSchema,
): Record<string, unknown> => {
	return reconcileMembershipProperties(schema, {});
};

export function reconcileMembershipProperties(
	schema: AppSchema,
	currentProperties: Record<string, unknown>,
): Record<string, unknown> {
	return reconcilePrimitiveProperties(schema, currentProperties);
}

export const buildDefaultMembershipFormValues = (
	selectedCollection?: AppCollection,
): CollectionMembershipFormValues => {
	const schema = selectedCollection?.membershipPropertiesSchema;

	return {
		collectionId: selectedCollection?.id ?? "",
		properties: schema ? buildMembershipPropertyDefaults(schema) : {},
	};
};

/**
 * Derives initial membership form values from an entity's properties.
 * This helper maps compatible entity properties onto the collection template's
 * membership fields, falling back to defaults for fields that don't have
 * a matching entity property or have incompatible types.
 */
export function deriveInitialValuesFromEntity(
	selectedCollection: AppCollection | undefined,
	entity: AppEntity | undefined,
): CollectionMembershipFormValues {
	const schema = selectedCollection?.membershipPropertiesSchema;
	const entityProperties = entity?.properties ?? {};

	return {
		collectionId: selectedCollection?.id ?? "",
		properties: schema
			? reconcileMembershipProperties(schema, entityProperties)
			: {},
	};
}

export function syncMembershipFormValues(
	selectedCollection: AppCollection | undefined,
	values: CollectionMembershipFormValues,
): CollectionMembershipFormValues {
	const schema = selectedCollection?.membershipPropertiesSchema;

	return {
		collectionId: selectedCollection?.id ?? values.collectionId,
		properties: schema
			? reconcileMembershipProperties(schema, values.properties)
			: {},
	};
}

export function buildCollectionSelectionPatch(
	selectedCollection: AppCollection | undefined,
	values: CollectionMembershipFormValues,
): CollectionMembershipFormValues {
	return syncMembershipFormValues(selectedCollection, values);
}

export function getMembershipFormReconciliationState(
	selectedCollection?: AppCollection,
) {
	return {
		collectionId: selectedCollection?.id ?? "",
		propertiesSchema: selectedCollection?.membershipPropertiesSchema ?? {
			fields: {},
		},
	};
}

export const buildMembershipFormSchema = (
	collections: AppCollection[] = [],
) => {
	return z
		.object({
			collectionId: z.string().trim().min(1, "Collection is required"),
			properties: z.record(z.string(), z.unknown()),
		})
		.superRefine((value, ctx) => {
			const collection = collections.find(
				(item) => item.id === value.collectionId.trim(),
			);
			if (!collection) {
				ctx.addIssue({
					code: "custom",
					path: ["collectionId"],
					message: "Collection is invalid",
				});
				return;
			}

			const schema = collection?.membershipPropertiesSchema;
			if (!schema) {
				return;
			}

			const unsupportedRequiredKeys = getUnsupportedRequiredProperties(schema);
			if (unsupportedRequiredKeys.length > 0) {
				ctx.addIssue({
					code: "custom",
					path: ["properties"],
					message: getUnsupportedRequiredPropertiesMessage(
						unsupportedRequiredKeys,
					),
				});
			}

			for (const [key, propertyDef] of Object.entries(schema.fields)) {
				if (
					isPrimitiveProperty(propertyDef) &&
					isAppPropertyRequired(propertyDef) &&
					propertyDef.type === "string"
				) {
					const fieldValue = value.properties[key];
					if (
						fieldValue === undefined ||
						fieldValue === null ||
						(typeof fieldValue === "string" && fieldValue.trim() === "")
					) {
						ctx.addIssue({
							code: "custom",
							path: ["properties", key],
							message: `${propertyDef.label || key} is required`,
						});
					}
				}
			}

			const result = buildPrimitivePropertiesSchema(schema).safeParse(
				value.properties,
			);

			if (result.success) {
				return;
			}

			for (const issue of result.error.issues) {
				ctx.addIssue({
					...issue,
					path: ["properties", ...issue.path],
				});
			}
		});
};

export function toMembershipPayload(
	values: CollectionMembershipFormValues,
	entityId: string,
	selectedCollection?: AppCollection,
): CollectionMembershipPayload {
	const schema = selectedCollection?.membershipPropertiesSchema;
	const properties = schema
		? buildPrimitivePropertiesSchema(schema).parse(values.properties)
		: values.properties;

	return {
		collectionId: values.collectionId.trim(),
		entityId: entityId.trim(),
		properties,
	};
}

export function getMembershipPropertyEntries(
	schema: AppSchema | null | undefined,
): Array<{ key: string; label: string; definition: AppPropertyDefinition }> {
	if (!schema) {
		return [];
	}

	const entries: Array<{
		key: string;
		label: string;
		definition: AppPropertyDefinition;
	}> = [];

	for (const [key, definition] of Object.entries(schema.fields)) {
		if (!isPrimitiveProperty(definition)) {
			continue;
		}
		const label = definition.label || getDefaultPropertyLabel(key);
		entries.push({
			key,
			label,
			definition: { ...definition, label },
		});
	}

	return entries;
}

export function getUnsupportedRequiredPropertiesMessage(
	propertyKeys: string[],
): string {
	return `This collection requires unsupported properties: ${propertyKeys.join(", ")}.`;
}
