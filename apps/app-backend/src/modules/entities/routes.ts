import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AppSchema } from "@ryot/ts-utils";
import type { AuthType } from "~/auth";
import {
	resolveCustomEntityAccessError,
	resolveCustomEntitySchemaAccess,
} from "~/lib/entity-schema-access";
import {
	createAuthRoute,
	createNotFoundErrorResult,
	createValidationErrorResult,
	jsonResponse,
	notFoundResponse,
	payloadErrorResponse,
	resolveValidationResult,
	successResponse,
} from "~/lib/openapi";
import {
	createEntityForUser,
	getEntityByIdForUser,
	getEntitySchemaScopeForUser,
	getEntityScopeForUser,
	listEntitiesByEntitySchemaForUser,
} from "./repository";
import {
	createEntityBody,
	createEntityResponseSchema,
	entityParams,
	getEntityResponseSchema,
	listEntitiesQuery,
	listEntitiesResponseSchema,
} from "./schemas";
import {
	resolveEntityCreateInput,
	resolveEntityDetailAccess,
	resolveEntityId,
	resolveEntitySchemaId,
} from "./service";

const listEntitiesRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "get",
		tags: ["entities"],
		request: { query: listEntitiesQuery },
		summary: "List entities for a custom entity schema",
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Entity schema does not exist for this user"),
			200: jsonResponse(
				"Entities for the requested entity schema",
				listEntitiesResponseSchema,
			),
		},
	}),
);

const createEntityRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "post",
		tags: ["entities"],
		summary: "Create an entity for a custom entity schema",
		request: {
			body: {
				content: { "application/json": { schema: createEntityBody } },
			},
		},
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Entity schema does not exist for this user"),
			200: jsonResponse("Entity was created", createEntityResponseSchema),
		},
	}),
);

const getEntityRoute = createAuthRoute(
	createRoute({
		method: "get",
		path: "/{entityId}",
		tags: ["entities"],
		summary: "Get a single custom entity",
		request: { params: entityParams },
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Entity does not exist for this user"),
			200: jsonResponse("Requested entity", getEntityResponseSchema),
		},
	}),
);

const customEntitySchemaError =
	"Built-in entity schemas do not support manual entity creation";
const entitySchemaNotFoundError = "Entity schema not found";
const customEntityDetailError =
	"Built-in entity schemas do not support generated entity detail pages";
const entityNotFoundError = "Entity not found";

const resolveEntitySchemaAccessError = (error: "builtin" | "not_found") => {
	const accessError = resolveCustomEntityAccessError({
		error,
		builtinMessage: customEntitySchemaError,
		notFoundMessage: entitySchemaNotFoundError,
	});

	return {
		status: accessError.status,
		body:
			accessError.kind === "not_found"
				? createNotFoundErrorResult(accessError.message).body
				: createValidationErrorResult(accessError.message).body,
	};
};

const resolveAccessibleEntitySchema = async (input: {
	entitySchemaId: string;
	userId: string;
}) => {
	return resolveCustomEntitySchemaAccess(
		await getEntitySchemaScopeForUser({
			userId: input.userId,
			entitySchemaId: input.entitySchemaId,
		}),
	);
};

const resolveEntityAccessError = (error: "builtin" | "not_found") => {
	const accessError = resolveCustomEntityAccessError({
		error,
		notFoundMessage: entityNotFoundError,
		builtinMessage: customEntityDetailError,
	});

	return {
		status: accessError.status,
		body:
			accessError.kind === "not_found"
				? createNotFoundErrorResult(accessError.message).body
				: createValidationErrorResult(accessError.message).body,
	};
};

export const entitiesApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(listEntitiesRoute, async (c) => {
		const user = c.get("user");
		const query = c.req.valid("query");
		const entitySchemaId = resolveEntitySchemaId(query.entitySchemaId);

		const foundEntitySchema = await resolveAccessibleEntitySchema({
			entitySchemaId,
			userId: user.id,
		});
		if ("error" in foundEntitySchema) {
			const accessError =
				foundEntitySchema.error === "builtin" ? "builtin" : "not_found";
			const errorResult = resolveEntitySchemaAccessError(accessError);
			return c.json(errorResult.body, errorResult.status);
		}

		const entities = await listEntitiesByEntitySchemaForUser({
			entitySchemaId,
			userId: user.id,
		});

		return c.json(successResponse(entities), 200);
	})
	.openapi(getEntityRoute, async (c) => {
		const user = c.get("user");
		const params = c.req.valid("param");
		const entityId = resolveEntityId(params.entityId);

		const foundEntity = resolveEntityDetailAccess(
			await getEntityScopeForUser({ entityId, userId: user.id }),
		);
		if ("error" in foundEntity) {
			const errorResult = resolveEntityAccessError(foundEntity.error);
			return c.json(errorResult.body, errorResult.status);
		}

		const entity = await getEntityByIdForUser({ entityId, userId: user.id });
		if (!entity)
			return c.json(createNotFoundErrorResult(entityNotFoundError).body, 404);

		return c.json(successResponse(entity), 200);
	})
	.openapi(createEntityRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const entitySchemaId = resolveEntitySchemaId(body.entitySchemaId);

		const foundEntitySchema = await resolveAccessibleEntitySchema({
			entitySchemaId,
			userId: user.id,
		});
		if ("error" in foundEntitySchema) {
			const accessError =
				foundEntitySchema.error === "builtin" ? "builtin" : "not_found";
			const errorResult = resolveEntitySchemaAccessError(accessError);
			return c.json(errorResult.body, errorResult.status);
		}

		const entityInputResult = resolveValidationResult(
			() =>
				resolveEntityCreateInput({
					name: body.name,
					properties: body.properties,
					propertiesSchema: foundEntitySchema.entitySchema
						.propertiesSchema as AppSchema,
				}),
			"Entity payload is invalid",
		);
		if ("body" in entityInputResult)
			return c.json(entityInputResult.body, entityInputResult.status);

		const entityInput = entityInputResult.data;

		const createdEntity = await createEntityForUser({
			entitySchemaId,
			userId: user.id,
			name: entityInput.name,
			properties: entityInput.properties,
		});

		return c.json(successResponse(createdEntity), 200);
	});
