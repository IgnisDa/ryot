import { resolveRequiredSlug, resolveRequiredString } from "@ryot/ts-utils";
import { checkCustomAccess, checkReadAccess } from "~/lib/access";
import { isUniqueConstraintError } from "~/lib/app/postgres";
import {
	type ServiceResult,
	serviceData,
	serviceError,
	wrapServiceValidator,
} from "~/lib/result";
import { parseLabeledPropertySchemaInput } from "../property-schemas/service";
import {
	createEventSchemaForUser,
	getEntitySchemaScopeForUser,
	getEventSchemaBySlugForUser,
	listEventSchemasByEntitySchemaForUser,
} from "./repository";
import type { CreateEventSchemaBody, ListedEventSchema } from "./schemas";

export type EventSchemaPropertiesShape =
	CreateEventSchemaBody["propertiesSchema"];

type EventSchemaMutationError = "not_found" | "validation";

export type EventSchemaServiceDeps = {
	createEventSchemaForUser: typeof createEventSchemaForUser;
	getEntitySchemaScopeForUser: typeof getEntitySchemaScopeForUser;
	getEventSchemaBySlugForUser: typeof getEventSchemaBySlugForUser;
	listEventSchemasByEntitySchemaForUser: typeof listEventSchemasByEntitySchemaForUser;
};

export type EventSchemaServiceResult<T> = ServiceResult<
	T,
	EventSchemaMutationError
>;

const duplicateSlugError = "Event schema slug already exists";
const customEntitySchemaError =
	"Built-in entity schemas do not support event schema creation";
const entitySchemaNotFoundError = "Entity schema not found";
const eventSchemaUniqueConstraint =
	"event_schema_user_entity_schema_slug_unique";

const eventSchemaServiceDeps: EventSchemaServiceDeps = {
	createEventSchemaForUser,
	getEntitySchemaScopeForUser,
	getEventSchemaBySlugForUser,
	listEventSchemasByEntitySchemaForUser,
};

const resolveEventSchemaEntitySchemaIdResult = (entitySchemaId: string) =>
	wrapServiceValidator(
		() => resolveEventSchemaEntitySchemaId(entitySchemaId),
		"Entity schema id is required",
	);

export const resolveEventSchemaName = (name: string) =>
	resolveRequiredString(name, "Event schema name");

export const resolveEventSchemaEntitySchemaId = (entitySchemaId: string) =>
	resolveRequiredString(entitySchemaId, "Entity schema id");

export const resolveEventSchemaSlug = (
	input: Pick<CreateEventSchemaBody, "name" | "slug">,
) => {
	return resolveRequiredSlug({
		name: input.name,
		slug: input.slug,
		label: "Event schema",
	});
};

export const parseEventSchemaPropertiesSchema = (input: unknown) =>
	parseLabeledPropertySchemaInput(
		input,
		"Event schema properties",
	) as EventSchemaPropertiesShape;

export const resolveEventSchemaCreateInput = (
	input: Pick<CreateEventSchemaBody, "name" | "propertiesSchema" | "slug">,
) => {
	const name = resolveEventSchemaName(input.name);
	const slug = resolveEventSchemaSlug({ name, slug: input.slug });
	const propertiesSchema = parseEventSchemaPropertiesSchema(
		input.propertiesSchema,
	);

	return { name, slug, propertiesSchema };
};

const resolveEventSchemaCreateInputResult = (
	input: Pick<CreateEventSchemaBody, "name" | "propertiesSchema" | "slug">,
) =>
	wrapServiceValidator(
		() => resolveEventSchemaCreateInput(input),
		"Event schema payload is invalid",
	);

export const listEventSchemas = async (
	input: { entitySchemaId: string; userId: string },
	deps: EventSchemaServiceDeps = eventSchemaServiceDeps,
): Promise<EventSchemaServiceResult<ListedEventSchema[]>> => {
	const entitySchemaIdResult = resolveEventSchemaEntitySchemaIdResult(
		input.entitySchemaId,
	);
	if ("error" in entitySchemaIdResult) {
		return entitySchemaIdResult;
	}

	const entitySchemaResult = checkReadAccess(
		await deps.getEntitySchemaScopeForUser({
			userId: input.userId,
			entitySchemaId: entitySchemaIdResult.data,
		}),
		{ not_found: entitySchemaNotFoundError },
	);
	if ("error" in entitySchemaResult) {
		return serviceError("not_found", entitySchemaResult.message);
	}

	const eventSchemas = await deps.listEventSchemasByEntitySchemaForUser({
		entitySchemaId: entitySchemaIdResult.data,
		userId: input.userId,
	});
	return serviceData(eventSchemas);
};

export const createEventSchema = async (
	input: { body: CreateEventSchemaBody; userId: string },
	deps: EventSchemaServiceDeps = eventSchemaServiceDeps,
): Promise<EventSchemaServiceResult<ListedEventSchema>> => {
	const entitySchemaIdResult = resolveEventSchemaEntitySchemaIdResult(
		input.body.entitySchemaId,
	);
	if ("error" in entitySchemaIdResult) {
		return entitySchemaIdResult;
	}

	const entitySchemaResult = checkCustomAccess(
		await deps.getEntitySchemaScopeForUser({
			entitySchemaId: entitySchemaIdResult.data,
			userId: input.userId,
		}),
		{
			not_found: entitySchemaNotFoundError,
			builtin_resource: customEntitySchemaError,
		},
	);
	if ("error" in entitySchemaResult) {
		return serviceError(
			entitySchemaResult.error === "not_found" ? "not_found" : "validation",
			entitySchemaResult.message,
		);
	}

	const eventSchemaInput = resolveEventSchemaCreateInputResult({
		name: input.body.name,
		slug: input.body.slug,
		propertiesSchema: input.body.propertiesSchema,
	});
	if ("error" in eventSchemaInput) {
		return eventSchemaInput;
	}

	const existingEventSchema = await deps.getEventSchemaBySlugForUser({
		entitySchemaId: entitySchemaIdResult.data,
		userId: input.userId,
		slug: eventSchemaInput.data.slug,
	});
	if (existingEventSchema) {
		return serviceError("validation", duplicateSlugError);
	}

	try {
		const createdEventSchema = await deps.createEventSchemaForUser({
			userId: input.userId,
			name: eventSchemaInput.data.name,
			slug: eventSchemaInput.data.slug,
			entitySchemaId: entitySchemaIdResult.data,
			propertiesSchema: eventSchemaInput.data.propertiesSchema,
		});

		return serviceData(createdEventSchema);
	} catch (error) {
		if (isUniqueConstraintError(error, eventSchemaUniqueConstraint)) {
			return serviceError("validation", duplicateSlugError);
		}

		throw error;
	}
};
