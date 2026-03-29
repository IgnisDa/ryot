import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AppSchema } from "@ryot/ts-utils";
import {
	resolveCustomEntityAccessError,
	resolveCustomEntitySchemaAccess,
} from "~/lib/app/entity-schema-access";
import type { AuthType } from "~/lib/auth";
import {
	createAuthRoute,
	createCustomEntityAccessErrorResult,
	createNotFoundErrorResult,
	jsonResponse,
	notFoundResponse,
	payloadErrorResponse,
	resolveValidationData,
	successResponse,
} from "~/lib/openapi";
import {
	createEntityForUser,
	getEntityByIdForUser,
	getEntitySchemaScopeForUser,
	getEntityScopeForUser,
} from "./repository";
import {
	createEntityBody,
	createEntityResponseSchema,
	entityParams,
	getEntityResponseSchema,
} from "./schemas";
import {
	resolveEntityCreateInput,
	resolveEntityDetailAccess,
	resolveEntityId,
	resolveEntitySchemaId,
} from "./service";

const createEntityRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "post",
		tags: ["entities"],
		summary: "Create an entity for a custom entity schema",
		request: {
			body: { content: { "application/json": { schema: createEntityBody } } },
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
	return createCustomEntityAccessErrorResult(
		resolveCustomEntityAccessError({
			error,
			builtinMessage: customEntitySchemaError,
			notFoundMessage: entitySchemaNotFoundError,
		}),
	);
};

const resolveEntityAccessError = (error: "builtin" | "not_found") => {
	return createCustomEntityAccessErrorResult(
		resolveCustomEntityAccessError({
			error,
			notFoundMessage: entityNotFoundError,
			builtinMessage: customEntityDetailError,
		}),
	);
};

export const entitiesApi = new OpenAPIHono<{ Variables: AuthType }>()
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
		if (!entity) {
			return c.json(createNotFoundErrorResult(entityNotFoundError).body, 404);
		}

		return c.json(successResponse(entity), 200);
	})
	.openapi(createEntityRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const entitySchemaId = resolveEntitySchemaId(body.entitySchemaId);

		const foundEntitySchema = resolveCustomEntitySchemaAccess(
			await getEntitySchemaScopeForUser({
				entitySchemaId,
				userId: user.id,
			}),
		);
		if (!("entitySchema" in foundEntitySchema)) {
			const errorResult = resolveEntitySchemaAccessError(
				foundEntitySchema.error,
			);
			return c.json(errorResult.body, errorResult.status);
		}

		const entityInput = resolveValidationData(
			() =>
				resolveEntityCreateInput({
					name: body.name,
					image: body.image,
					properties: body.properties,
					propertiesSchema: foundEntitySchema.entitySchema
						.propertiesSchema as AppSchema,
				}),
			"Entity payload is invalid",
		);
		if ("status" in entityInput) {
			return c.json(entityInput.body, entityInput.status);
		}
		const entityData = entityInput.data;

		const createdEntity = await createEntityForUser({
			entitySchemaId,
			userId: user.id,
			name: entityData.name,
			image: entityData.image,
			properties: entityData.properties,
		});

		return c.json(successResponse(createdEntity), 200);
	});
