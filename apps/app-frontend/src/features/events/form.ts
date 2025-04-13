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
import { z } from "zod";
import type { ApiPostRequestBody } from "#/lib/api/types";
import type { AppEventSchema } from "../event-schemas/model";

const datetimeLocalPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function formatDatetimeLocalValue(value: Date) {
	const year = value.getFullYear();
	const month = `${value.getMonth() + 1}`.padStart(2, "0");
	const day = `${value.getDate()}`.padStart(2, "0");
	const hours = `${value.getHours()}`.padStart(2, "0");
	const minutes = `${value.getMinutes()}`.padStart(2, "0");

	return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseOccurredAtInputValue(value: string) {
	const trimmedValue = value.trim();
	if (!trimmedValue) {
		return;
	}

	const occurredAt = new Date(trimmedValue);
	if (Number.isNaN(occurredAt.getTime())) {
		return;
	}

	if (datetimeLocalPattern.test(trimmedValue)) {
		if (formatDatetimeLocalValue(occurredAt) !== trimmedValue) {
			return;
		}
	}

	return occurredAt;
}

export function formatOccurredAtInputValue(value: string) {
	const trimmedValue = value.trim();
	if (!trimmedValue) {
		return "";
	}
	if (datetimeLocalPattern.test(trimmedValue)) {
		return trimmedValue;
	}

	const occurredAt = parseOccurredAtInputValue(trimmedValue);
	if (!occurredAt) {
		return "";
	}

	return formatDatetimeLocalValue(occurredAt);
}

export function normalizeOccurredAtInputValue(value: string) {
	const occurredAt = parseOccurredAtInputValue(value);
	if (!occurredAt) {
		return "";
	}

	return occurredAt.toISOString();
}

const zodRequiredEventSchemaId = z
	.string()
	.trim()
	.min(1, "Event schema is required");

const zodOccurredAt = z
	.string()
	.trim()
	.min(1, "Occurred at is required")
	.refine((value) => !!normalizeOccurredAtInputValue(value), {
		message: "Occurred at is invalid",
	});

const createEventFormSchema = z.object({
	occurredAt: zodOccurredAt,
	eventSchemaId: zodRequiredEventSchemaId,
	properties: z.record(z.string(), z.unknown()),
});

export type CreateEventFormValues = z.infer<typeof createEventFormSchema>;

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
	createEventFormSchema.superRefine((value, ctx) => {
		const selectedEventSchema = findEventSchema(
			eventSchemas,
			value.eventSchemaId,
		);

		if (!selectedEventSchema) {
			ctx.addIssue({
				code: "custom",
				path: ["eventSchemaId"],
				message: "Event schema is invalid",
			});
			return;
		}

		const unsupportedRequiredProperties = getUnsupportedRequiredEventProperties(
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
	now = new Date(),
	eventSchemaId?: string,
): CreateEventFormValues => {
	const selectedEventSchema = getSelectedEventSchema(
		eventSchemas,
		eventSchemaId,
	);

	return {
		eventSchemaId: selectedEventSchema?.id ?? "",
		occurredAt: formatOccurredAtInputValue(now.toISOString()),
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
	switch (propertyDef.type) {
		case "string":
		case "date":
			return "";
		case "number":
		case "integer":
			return 0;
		case "boolean":
			return false;
		default:
			return undefined;
	}
};

export function getUnsupportedRequiredPropertiesMessage(
	propertyKeys: string[],
) {
	return `This event schema cannot be logged here yet because it requires unsupported properties: ${propertyKeys.join(", ")}.`;
}

function isPrimitiveProperty(propertyDef: AppPropertyDefinition) {
	switch (propertyDef.type) {
		case "boolean":
		case "date":
		case "integer":
		case "number":
		case "string":
			return true;
		default:
			return false;
	}
}

function isValidPropertyValue(
	propertyDef: AppPropertyDefinition,
	value: unknown,
) {
	switch (propertyDef.type) {
		case "string":
		case "date":
			return typeof value === "string";
		case "number":
			return typeof value === "number" && Number.isFinite(value);
		case "integer":
			return Number.isInteger(value);
		case "boolean":
			return typeof value === "boolean";
		default:
			return false;
	}
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
	switch (condition.operator) {
		case "all":
		case "any":
			return condition.conditions.every((value) =>
				isSupportedPrimitiveRuleCondition(value, supportedKeys),
			);
		default:
			return (
				condition.path.length === 1 &&
				supportedKeys.has(condition.path[0] ?? "")
			);
	}
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
		occurredAt: normalizeOccurredAtInputValue(input.occurredAt),
	};

	return [item];
}
