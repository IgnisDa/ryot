import type { AppSchema } from "@ryot/ts-utils";
import { trimmedOrUndefined } from "@ryot/ts-utils";
import { z } from "zod";
import type { ApiPostRequestBody } from "~/lib/api/types";
import type { AppEventSchema } from "../event-schemas/model";
import {
	buildPrimitivePropertiesSchema,
	getUnsupportedRequiredProperties,
	reconcilePrimitiveProperties,
} from "../property-schemas/primitive-schema-utils";

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
	return getUnsupportedRequiredProperties(propertiesSchema);
}

export function reconcileEventProperties(
	propertiesSchema: AppSchema,
	currentProperties: Record<string, unknown>,
) {
	return reconcilePrimitiveProperties(propertiesSchema, currentProperties);
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

			const result = buildPrimitivePropertiesSchema(
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

export function getUnsupportedRequiredPropertiesMessage(
	propertyKeys: string[],
) {
	return `This event schema cannot be logged here yet because it requires unsupported properties: ${propertyKeys.join(", ")}.`;
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
		? buildPrimitivePropertiesSchema(
				selectedEventSchema.propertiesSchema,
			).parse(input.properties)
		: input.properties;

	const item: CreateEventSinglePayload = {
		properties,
		entityId: entityId.trim(),
		eventSchemaId: input.eventSchemaId.trim(),
	};

	return [item];
}
