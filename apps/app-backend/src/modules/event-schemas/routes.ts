import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
	resolveCustomEntityAccessError,
	resolveCustomEntitySchemaAccess,
} from "~/lib/app/entity-schema-access";
import { isUniqueConstraintError } from "~/lib/app/postgres";
import type { AuthType } from "~/lib/auth";
import {
	createAuthRoute,
	createCustomEntityAccessErrorResult,
	createValidationErrorResult,
	jsonResponse,
	notFoundResponse,
	payloadErrorResponse,
	resolveValidationResult,
	successResponse,
} from "~/lib/openapi";
import {
	createEventSchemaForUser,
	getEntitySchemaScopeForUser,
	getEventSchemaBySlugForUser,
	listEventSchemasByEntitySchemaForUser,
} from "./repository";
import {
	createEventSchemaBody,
	createEventSchemaResponseSchema,
	listEventSchemasQuery,
	listEventSchemasResponseSchema,
} from "./schemas";
import {
	resolveEventSchemaCreateInput,
	resolveEventSchemaEntitySchemaId,
} from "./service";

const listEventSchemasRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "get",
		tags: ["event-schemas"],
		request: { query: listEventSchemasQuery },
		summary: "List event schemas for a custom entity schema",
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Entity schema does not exist for this user"),
			200: jsonResponse(
				"Event schemas for the requested entity schema",
				listEventSchemasResponseSchema,
			),
		},
	}),
);

const createEventSchemaRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "post",
		tags: ["event-schemas"],
		summary: "Create an event schema for a custom entity schema",
		request: {
			body: {
				content: { "application/json": { schema: createEventSchemaBody } },
			},
		},
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Entity schema does not exist for this user"),
			200: jsonResponse(
				"Event schema was created",
				createEventSchemaResponseSchema,
			),
		},
	}),
);

const customEntitySchemaError =
	"Built-in entity schemas do not support event schemas";
const duplicateSlugError = "Event schema slug already exists";
const entitySchemaNotFoundError = "Entity schema not found";
const eventSchemaUniqueConstraint =
	"event_schema_user_entity_schema_slug_unique";

const resolveEntitySchemaAccessError = (error: "builtin" | "not_found") => {
	return createCustomEntityAccessErrorResult(
		resolveCustomEntityAccessError({
			error,
			builtinMessage: customEntitySchemaError,
			notFoundMessage: entitySchemaNotFoundError,
		}),
	);
};

export const eventSchemasApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(listEventSchemasRoute, async (c) => {
		const user = c.get("user");
		const query = c.req.valid("query");
		const entitySchemaId = resolveEventSchemaEntitySchemaId(
			query.entitySchemaId,
		);

		const foundEntitySchema = resolveCustomEntitySchemaAccess(
			await getEntitySchemaScopeForUser({
				userId: user.id,
				entitySchemaId,
			}),
		);
		if (!("entitySchema" in foundEntitySchema)) {
			const errorResult = resolveEntitySchemaAccessError(
				foundEntitySchema.error,
			);
			return c.json(errorResult.body, errorResult.status);
		}

		const eventSchemas = await listEventSchemasByEntitySchemaForUser({
			entitySchemaId,
			userId: user.id,
		});

		return c.json(successResponse(eventSchemas), 200);
	})
	.openapi(createEventSchemaRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const entitySchemaId = resolveEventSchemaEntitySchemaId(
			body.entitySchemaId,
		);

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

		const eventSchemaInput = resolveValidationResult(
			() => resolveEventSchemaCreateInput(body),
			"Event schema payload is invalid",
		);
		if ("error" in eventSchemaInput)
			return c.json(
				createValidationErrorResult(eventSchemaInput.error).body,
				400,
			);
		const eventSchemaData = eventSchemaInput.data;

		const existingEventSchema = await getEventSchemaBySlugForUser({
			entitySchemaId,
			userId: user.id,
			slug: eventSchemaData.slug,
		});
		if (existingEventSchema)
			return c.json(createValidationErrorResult(duplicateSlugError).body, 400);

		try {
			const createdEventSchema = await createEventSchemaForUser({
				entitySchemaId,
				userId: user.id,
				name: eventSchemaData.name,
				slug: eventSchemaData.slug,
				propertiesSchema: eventSchemaData.propertiesSchema,
			});

			return c.json(successResponse(createdEventSchema), 200);
		} catch (error) {
			if (isUniqueConstraintError(error, eventSchemaUniqueConstraint))
				return c.json(
					createValidationErrorResult(duplicateSlugError).body,
					400,
				);

			throw error;
		}
	});
