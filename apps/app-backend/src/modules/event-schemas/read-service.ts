import { resolveRequiredString } from "@ryot/ts-utils/slug";

import { checkReadAccess } from "~/lib/access";
import { type ServiceResult, serviceData, serviceError, wrapServiceValidator } from "~/lib/result";

import { getEntitySchemaScopeForUser, listEventSchemasByEntitySchemaForUser } from "./repository";
import type { ListedEventSchema } from "./schemas";

type EventSchemaReadError = "not_found" | "validation";

type EventSchemaReadResult<T> = ServiceResult<T, EventSchemaReadError>;

const entitySchemaNotFoundError = "Entity schema not found";

const resolveEventSchemaEntitySchemaId = (entitySchemaId: string) =>
	resolveRequiredString(entitySchemaId, "Entity schema id");

const resolveEventSchemaEntitySchemaIdResult = (entitySchemaId: string) =>
	wrapServiceValidator(
		() => resolveEventSchemaEntitySchemaId(entitySchemaId),
		"Entity schema id is required",
	);

export const listEventSchemas = async (input: {
	entitySchemaId: string;
	userId: string;
}): Promise<EventSchemaReadResult<ListedEventSchema[]>> => {
	const entitySchemaIdResult = resolveEventSchemaEntitySchemaIdResult(input.entitySchemaId);
	if ("error" in entitySchemaIdResult) {
		return entitySchemaIdResult;
	}

	const entitySchemaResult = checkReadAccess(
		await getEntitySchemaScopeForUser({
			userId: input.userId,
			entitySchemaId: entitySchemaIdResult.data,
		}),
		{ not_found: entitySchemaNotFoundError },
	);
	if ("error" in entitySchemaResult) {
		return serviceError("not_found", entitySchemaResult.message);
	}

	const eventSchemas = await listEventSchemasByEntitySchemaForUser({
		userId: input.userId,
		entitySchemaId: entitySchemaIdResult.data,
	});

	return serviceData(eventSchemas);
};
