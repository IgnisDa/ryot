import { resolveRequiredSlug, resolveRequiredString } from "@ryot/ts-utils";
import { resolveCustomEntitySchemaAccess } from "~/lib/app/entity-schema-access";
import { isUniqueConstraintError } from "~/lib/app/postgres";
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

export type EventSchemaServiceResult<T> =
	| { data: T }
	| { error: EventSchemaMutationError; message: string };

const customEntitySchemaError =
	"Built-in entity schemas do not support event schemas";
const duplicateSlugError = "Event schema slug already exists";
const entitySchemaNotFoundError = "Entity schema not found";
const eventSchemaUniqueConstraint =
	"event_schema_user_entity_schema_slug_unique";

const eventSchemaServiceDeps: EventSchemaServiceDeps = {
	createEventSchemaForUser,
	getEntitySchemaScopeForUser,
	getEventSchemaBySlugForUser,
	listEventSchemasByEntitySchemaForUser,
};

const createDataResult = <T>(data: T): EventSchemaServiceResult<T> => ({
	data,
});

const createErrorResult = <T>(input: {
	error: EventSchemaMutationError;
	message: string;
}): EventSchemaServiceResult<T> => ({
	error: input.error,
	message: input.message,
});

const resolveEventSchemaEntitySchemaIdResult = (
	entitySchemaId: string,
): EventSchemaServiceResult<string> => {
	try {
		return createDataResult(resolveEventSchemaEntitySchemaId(entitySchemaId));
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Entity schema id is required";
		return createErrorResult({ error: "validation", message });
	}
};

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
): EventSchemaServiceResult<
	ReturnType<typeof resolveEventSchemaCreateInput>
> => {
	try {
		return createDataResult(resolveEventSchemaCreateInput(input));
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: "Event schema payload is invalid";
		return createErrorResult({ error: "validation", message });
	}
};

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

	const foundEntitySchema = resolveCustomEntitySchemaAccess(
		await deps.getEntitySchemaScopeForUser({
			userId: input.userId,
			entitySchemaId: entitySchemaIdResult.data,
		}),
	);
	if (!("entitySchema" in foundEntitySchema)) {
		return createErrorResult({
			error:
				foundEntitySchema.error === "not_found" ? "not_found" : "validation",
			message:
				foundEntitySchema.error === "not_found"
					? entitySchemaNotFoundError
					: customEntitySchemaError,
		});
	}

	const eventSchemas = await deps.listEventSchemasByEntitySchemaForUser({
		entitySchemaId: entitySchemaIdResult.data,
		userId: input.userId,
	});
	return createDataResult(eventSchemas);
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

	const foundEntitySchema = resolveCustomEntitySchemaAccess(
		await deps.getEntitySchemaScopeForUser({
			entitySchemaId: entitySchemaIdResult.data,
			userId: input.userId,
		}),
	);
	if (!("entitySchema" in foundEntitySchema)) {
		return createErrorResult({
			error:
				foundEntitySchema.error === "not_found" ? "not_found" : "validation",
			message:
				foundEntitySchema.error === "not_found"
					? entitySchemaNotFoundError
					: customEntitySchemaError,
		});
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
		return createErrorResult({
			error: "validation",
			message: duplicateSlugError,
		});
	}

	try {
		const createdEventSchema = await deps.createEventSchemaForUser({
			userId: input.userId,
			name: eventSchemaInput.data.name,
			slug: eventSchemaInput.data.slug,
			entitySchemaId: entitySchemaIdResult.data,
			propertiesSchema: eventSchemaInput.data.propertiesSchema,
		});

		return createDataResult(createdEventSchema);
	} catch (error) {
		if (isUniqueConstraintError(error, eventSchemaUniqueConstraint)) {
			return createErrorResult({
				error: "validation",
				message: duplicateSlugError,
			});
		}

		throw error;
	}
};
