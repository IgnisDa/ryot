import type {
	AppPropertyDefinition,
	AppSchema,
	AppSchemaRuleCondition,
} from "@ryot/ts-utils";
import {
	fromAppSchemaObject,
	getDefaultPropertyLabel,
	isAppPropertyRequired,
} from "@ryot/ts-utils";
import { match } from "ts-pattern";
import { z } from "zod";
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
	const properties: Record<string, unknown> = {};

	for (const [key, propertyDef] of Object.entries(schema.fields)) {
		if (!isPrimitiveProperty(propertyDef)) {
			continue;
		}

		const currentValue = currentProperties[key];
		if (isValidPropertyValue(propertyDef, currentValue)) {
			properties[key] = currentValue;
			continue;
		}

		const defaultValue = getDefaultValue(propertyDef);
		if (isAppPropertyRequired(propertyDef) && defaultValue !== undefined) {
			properties[key] = defaultValue;
		}
	}

	return properties;
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
	selectedCollection?: AppCollection,
) => {
	const schema = selectedCollection?.membershipPropertiesSchema;

	return z
		.object({
			collectionId: z.string().trim().min(1, "Collection is required"),
			properties: z.record(z.string(), z.unknown()),
		})
		.superRefine((value, ctx) => {
			if (!schema) {
				return;
			}

			const unsupportedRequiredProperties =
				getUnsupportedRequiredProperties(schema);
			if (unsupportedRequiredProperties.length > 0) {
				ctx.addIssue({
					code: "custom",
					path: ["properties"],
					message: getUnsupportedRequiredPropertiesMessage(
						unsupportedRequiredProperties,
					),
				});
			}

			const result = buildMembershipPropertiesSchema(schema).safeParse(
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
		? buildMembershipPropertiesSchema(schema).parse(values.properties)
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
		entries.push({
			key,
			label: definition.label || getDefaultPropertyLabel(key),
			definition,
		});
	}

	return entries;
}

export function getUnsupportedRequiredProperties(schema: AppSchema): string[] {
	return Object.entries(schema.fields)
		.filter(
			([, propertyDef]) =>
				isAppPropertyRequired(propertyDef) && !isPrimitiveProperty(propertyDef),
		)
		.map(([key]) => key);
}

export function getUnsupportedRequiredPropertiesMessage(
	propertyKeys: string[],
): string {
	return `This collection requires unsupported properties: ${propertyKeys.join(", ")}.`;
}

const getDefaultValue = (propertyDef: AppPropertyDefinition): unknown => {
	return match(propertyDef.type)
		.with("string", "date", "datetime", () => "")
		.with("number", "integer", () => 0)
		.with("boolean", () => false)
		.otherwise(() => undefined);
};

function isPrimitiveProperty(propertyDef: AppPropertyDefinition) {
	return match(propertyDef.type)
		.with(
			"boolean",
			"date",
			"datetime",
			"integer",
			"number",
			"string",
			() => true,
		)
		.otherwise(() => false);
}

function isValidPropertyValue(
	propertyDef: AppPropertyDefinition,
	value: unknown,
) {
	return match(propertyDef.type)
		.with("string", "date", "datetime", () => typeof value === "string")
		.with("number", () => typeof value === "number" && Number.isFinite(value))
		.with("integer", () => Number.isInteger(value))
		.with("boolean", () => typeof value === "boolean")
		.otherwise(() => false);
}

const buildMembershipPropertiesSchema = (propertiesSchema: AppSchema) => {
	const fields: AppSchema["fields"] = {};
	const supportedKeys = new Set<string>();

	for (const [key, propertyDef] of Object.entries(propertiesSchema.fields)) {
		if (!isPrimitiveProperty(propertyDef)) {
			continue;
		}

		supportedKeys.add(key);
		fields[key] = propertyDef;
	}

	return fromAppSchemaObject(
		{
			fields,
			rules: propertiesSchema.rules?.filter(
				(rule) =>
					isSupportedPrimitiveRuleCondition(rule.when, supportedKeys) &&
					rule.path.length === 1 &&
					supportedKeys.has(rule.path[0] ?? ""),
			),
		},
		{ unknownKeys: "strip" },
	);
};

function isSupportedPrimitiveRuleCondition(
	condition: AppSchemaRuleCondition,
	supportedKeys: Set<string>,
): boolean {
	return match(condition)
		.with({ operator: "all" }, { operator: "any" }, (cond) =>
			cond.conditions.every((value) =>
				isSupportedPrimitiveRuleCondition(value, supportedKeys),
			),
		)
		.otherwise(
			(cond) => cond.path.length === 1 && supportedKeys.has(cond.path[0] ?? ""),
		);
}
