import type {
	AppPropertyDefinition,
	AppSchema,
	AppSchemaRuleCondition,
} from "@ryot/ts-utils";
import {
	fromAppSchemaObject,
	isAppPropertyRequired,
	trimmedOrUndefined,
} from "@ryot/ts-utils";
import { match } from "ts-pattern";
import { z } from "zod";
import type { ApiPostRequestBody } from "#/lib/api/types";
import type { AppEventSchema } from "../event-schemas/model";

export type CreateEventFormValues = {
	eventSchemaId: string;
	properties: Record<string, unknown>;
};

export type CreateEventPayload = ApiPostRequestBody<"/events">;

export type CreateEventSinglePayload = CreateEventPayload[number];

export function getSelectedEventSchema(
	eventSchemas: AppEventSchema[],
	eventSchemaId?: string,
) {
	const selectedEventSchema = findEventSchema(eventSchemas, eventSchemaId);
	if (selectedEventSchema) {
		return selectedEventSchema;
	}

	return eventSchemas[0];
}

export const buildEventPropertyDefaults = (propertiesSchema: AppSchema) => {
	return reconcileEventProperties(propertiesSchema, {});
};

export function getUnsupportedRequiredEventProperties(
	propertiesSchema: AppSchema,
) {
	return Object.entries(propertiesSchema.fields)
		.filter(
			([, propertyDef]) =>
				isAppPropertyRequired(propertyDef) && !isPrimitiveProperty(propertyDef),
		)
		.map(([key]) => key);
}

export function reconcileEventProperties(
	propertiesSchema: AppSchema,
	currentProperties: Record<string, unknown>,
) {
	const properties: Record<string, unknown> = {};

	for (const [key, propertyDef] of Object.entries(propertiesSchema.fields)) {
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

export const buildCreateEventFormSchema = (
	eventSchemas: AppEventSchema[] = [],
) =>
	z
		.object({
			eventSchemaId: z.string().trim().min(1, "Event schema is required"),
			properties: z.record(z.string(), z.unknown()),
		})
		.superRefine((value, ctx) => {
			const selectedEventSchema = findEventSchema(
				eventSchemas,
				String(value.eventSchemaId ?? ""),
			);

			if (!selectedEventSchema) {
				ctx.addIssue({
					code: "custom",
					path: ["eventSchemaId"],
					message: "Event schema is invalid",
				});
				return;
			}

			const unsupportedRequiredProperties =
				getUnsupportedRequiredEventProperties(
					selectedEventSchema.propertiesSchema,
				);
			if (unsupportedRequiredProperties.length > 0) {
				ctx.addIssue({
					code: "custom",
					path: ["properties"],
					message: getUnsupportedRequiredPropertiesMessage(
						unsupportedRequiredProperties,
					),
				});
			}

			const result = buildEventPropertiesSchema(
				selectedEventSchema.propertiesSchema,
			).safeParse(value.properties);

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

export const buildDefaultEventFormValues = (
	eventSchemas: AppEventSchema[],
	eventSchemaId?: string,
): CreateEventFormValues => {
	const selectedEventSchema = getSelectedEventSchema(
		eventSchemas,
		eventSchemaId,
	);

	return {
		eventSchemaId: selectedEventSchema?.id ?? "",
		properties: buildEventPropertyDefaults(
			selectedEventSchema?.propertiesSchema ?? { fields: {} },
		),
	};
};

export function syncCreateEventFormValues(
	eventSchemas: AppEventSchema[],
	values: CreateEventFormValues,
) {
	const selectedEventSchema = getSelectedEventSchema(
		eventSchemas,
		values.eventSchemaId,
	);

	return {
		eventSchemaId: selectedEventSchema?.id ?? "",
		properties: reconcileEventProperties(
			selectedEventSchema?.propertiesSchema ?? { fields: {} },
			values.properties,
		),
	};
}

export function buildEventSchemaSelectionPatch(
	eventSchemas: AppEventSchema[],
	values: CreateEventFormValues,
	eventSchemaId: string,
) {
	return syncCreateEventFormValues(eventSchemas, {
		...values,
		eventSchemaId,
	});
}

export function getEventFormReconciliationState(
	eventSchemas: AppEventSchema[],
	eventSchemaId?: string,
) {
	const selectedEventSchema = getSelectedEventSchema(
		eventSchemas,
		eventSchemaId,
	);

	return {
		eventSchemaId: selectedEventSchema?.id ?? "",
		propertiesSchema: selectedEventSchema?.propertiesSchema ?? { fields: {} },
	};
}

const getDefaultValue = (propertyDef: AppPropertyDefinition): unknown => {
	return match(propertyDef.type)
		.with("string", "date", "datetime", () => "")
		.with("number", "integer", () => 0)
		.with("boolean", () => false)
		.otherwise(() => undefined);
};

export function getUnsupportedRequiredPropertiesMessage(
	propertyKeys: string[],
) {
	return `This event schema cannot be logged here yet because it requires unsupported properties: ${propertyKeys.join(", ")}.`;
}

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

const buildEventPropertiesSchema = (propertiesSchema: AppSchema) => {
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

function findEventSchema(
	eventSchemas: AppEventSchema[],
	eventSchemaId?: string,
) {
	const selectedEventSchemaId = trimmedOrUndefined(eventSchemaId ?? "");
	if (!selectedEventSchemaId) {
		return;
	}

	return eventSchemas.find((schema) => schema.id === selectedEventSchemaId);
}

export function toCreateEventPayload(
	input: CreateEventFormValues,
	entityId: string,
	eventSchemas: AppEventSchema[] = [],
): CreateEventPayload {
	const selectedEventSchema = findEventSchema(
		eventSchemas,
		input.eventSchemaId,
	);
	const properties = selectedEventSchema
		? buildEventPropertiesSchema(selectedEventSchema.propertiesSchema).parse(
				input.properties,
			)
		: input.properties;

	const item: CreateEventSinglePayload = {
		properties,
		entityId: entityId.trim(),
		eventSchemaId: input.eventSchemaId.trim(),
	};

	return [item];
}
