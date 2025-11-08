import { type AppSchema, resolveRequiredString } from "@ryot/ts-utils";
import { z } from "zod";
import { resolveCustomEntitySchemaAccess } from "~/lib/app/entity-schema-access";
import { parseAppSchemaProperties } from "~/lib/app/schema-validation";

export type EventPropertiesShape = Record<string, unknown>;

export const occurredAtStringSchema = z.string().trim().pipe(z.iso.datetime());

type EntityEventScope = {
	entityId: string;
	isBuiltin: boolean;
	entitySchemaId: string;
};

export type EventCreateScope = EntityEventScope & {
	eventSchemaId: string | null;
	eventSchemaName: string | null;
	eventSchemaSlug: string | null;
	propertiesSchema: AppSchema | null;
	eventSchemaEntitySchemaId: string | null;
};

type EntityEventAccess =
	| { error: "builtin" | "not_found" }
	| { access: EntityEventScope };

type EventCreateAccess =
	| {
			error:
				| "builtin"
				| "not_found"
				| "event_schema_mismatch"
				| "event_schema_not_found";
	  }
	| {
			access: {
				entityId: string;
				eventSchemaId: string;
				entitySchemaId: string;
				eventSchemaName: string;
				eventSchemaSlug: string;
				propertiesSchema: AppSchema;
			};
	  };

export const resolveEventEntityId = (entityId: string) =>
	resolveRequiredString(entityId, "Entity id");

export const resolveEventSchemaId = (eventSchemaId: string) =>
	resolveRequiredString(eventSchemaId, "Event schema id");

export const resolveOccurredAt = (occurredAt: unknown) => {
	const parsedOccurredAt = occurredAtStringSchema.safeParse(occurredAt);
	if (!parsedOccurredAt.success)
		throw new Error("Occurred at must be a valid datetime");

	return new Date(parsedOccurredAt.data);
};

export const parseEventProperties = (input: {
	properties: unknown;
	propertiesSchema: AppSchema;
}) =>
	parseAppSchemaProperties({
		kind: "Event",
		properties: input.properties,
		propertiesSchema: input.propertiesSchema,
	}) as EventPropertiesShape;

export const resolveEntityEventAccess = (
	scope: EntityEventScope | undefined,
): EntityEventAccess => {
	const entityAccess = resolveCustomEntitySchemaAccess(scope);
	if (!("entitySchema" in entityAccess)) return { error: entityAccess.error };

	return { access: entityAccess.entitySchema };
};

export const resolveEventCreateAccess = (
	scope: EventCreateScope | undefined,
): EventCreateAccess => {
	const entityAccess = resolveEntityEventAccess(scope);
	if ("error" in entityAccess) return entityAccess;

	const scopedEvent = scope;

	if (
		!scopedEvent?.eventSchemaId ||
		!scopedEvent.eventSchemaName ||
		!scopedEvent.eventSchemaSlug ||
		!scopedEvent.propertiesSchema
	)
		return { error: "event_schema_not_found" as const };

	if (scopedEvent.eventSchemaEntitySchemaId !== scopedEvent.entitySchemaId)
		return { error: "event_schema_mismatch" as const };

	return {
		access: {
			entityId: scopedEvent.entityId,
			eventSchemaId: scopedEvent.eventSchemaId,
			entitySchemaId: scopedEvent.entitySchemaId,
			eventSchemaName: scopedEvent.eventSchemaName,
			eventSchemaSlug: scopedEvent.eventSchemaSlug,
			propertiesSchema: scopedEvent.propertiesSchema,
		},
	};
};

export const resolveEventCreateInput = (input: {
	entityId: string;
	occurredAt: unknown;
	properties: unknown;
	eventSchemaId: string;
	propertiesSchema: AppSchema;
}) => {
	const entityId = resolveEventEntityId(input.entityId);
	const occurredAt = resolveOccurredAt(input.occurredAt);
	const eventSchemaId = resolveEventSchemaId(input.eventSchemaId);
	const properties = parseEventProperties({
		properties: input.properties,
		propertiesSchema: input.propertiesSchema,
	});

	return { entityId, occurredAt, properties, eventSchemaId };
};
