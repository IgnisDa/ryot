import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/auth";
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
import { isUniqueConstraintError } from "~/lib/postgres";
import { resolveCustomEntitySchemaAccess } from "./access";
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
	if (error === "not_found")
		return {
			status: 404 as const,
			body: createNotFoundErrorResult(entitySchemaNotFoundError).body,
		};

	return {
		status: 400 as const,
		body: createValidationErrorResult(customEntitySchemaError).body,
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

export const eventSchemasApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(listEventSchemasRoute, async (c) => {
		const user = c.get("user");
		const query = c.req.valid("query");
		const entitySchemaId = resolveEventSchemaEntitySchemaId(
			query.entitySchemaId,
		);

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

		const eventSchemaInputResult = resolveValidationResult(
			() => resolveEventSchemaCreateInput(body),
			"Event schema payload is invalid",
		);
		if ("body" in eventSchemaInputResult)
			return c.json(eventSchemaInputResult.body, eventSchemaInputResult.status);

		const eventSchemaInput = eventSchemaInputResult.data;

		const existingEventSchema = await getEventSchemaBySlugForUser({
			entitySchemaId,
			userId: user.id,
			slug: eventSchemaInput.slug,
		});
		if (existingEventSchema)
			return c.json(createValidationErrorResult(duplicateSlugError).body, 400);

		try {
			const createdEventSchema = await createEventSchemaForUser({
				entitySchemaId,
				userId: user.id,
				name: eventSchemaInput.name,
				slug: eventSchemaInput.slug,
				propertiesSchema: eventSchemaInput.propertiesSchema,
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
