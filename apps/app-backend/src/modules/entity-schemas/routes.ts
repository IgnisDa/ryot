import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { isUniqueConstraintError } from "~/lib/app/postgres";
import type { AuthType } from "~/lib/auth";
import {
	createAuthRoute,
	createNotFoundErrorResult,
	createValidationErrorResult,
	jsonResponse,
	notFoundResponse,
	payloadErrorResponse,
	resolveValidationData,
	successResponse,
} from "~/lib/openapi";
import {
	customTrackerError,
	resolveCustomTrackerAccess,
	resolveTrackerReadAccess,
	trackerNotFoundError,
} from "../trackers/access";
import { getTrackerScopeForUser } from "../trackers/repository";
import {
	createEntitySchemaForUser,
	getEntitySchemaBySlugForUser,
	listEntitySchemasByTracker,
} from "./repository";
import {
	createEntitySchemaBody,
	createEntitySchemaResponseSchema,
	listEntitySchemasQuery,
	listEntitySchemasResponseSchema,
} from "./schemas";
import {
	resolveEntitySchemaCreateInput,
	resolveEntitySchemaTrackerId,
} from "./service";

const listEntitySchemasRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "get",
		tags: ["entity-schemas"],
		request: { query: listEntitySchemasQuery },
		summary: "List entity schemas for a tracker",
		responses: {
			404: notFoundResponse("Tracker does not exist for this user"),
			200: jsonResponse(
				"Entity schemas for the requested tracker",
				listEntitySchemasResponseSchema,
			),
		},
	}),
);

const createEntitySchemaRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "post",
		tags: ["entity-schemas"],
		summary: "Create an entity schema for a custom tracker",
		request: {
			body: {
				content: { "application/json": { schema: createEntitySchemaBody } },
			},
		},
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Tracker does not exist for this user"),
			200: jsonResponse(
				"Entity schema was created",
				createEntitySchemaResponseSchema,
			),
		},
	}),
);

const duplicateSlugError = "Entity schema slug already exists";
const entitySchemaUniqueConstraint = "entity_schema_user_slug_unique";
const duplicateSlugErrorResult =
	createValidationErrorResult(duplicateSlugError);

export const entitySchemasApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(listEntitySchemasRoute, async (c) => {
		const user = c.get("user");
		const query = c.req.valid("query");
		const trackerId = resolveEntitySchemaTrackerId(query.trackerId);

		const foundTracker = resolveTrackerReadAccess(
			await getTrackerScopeForUser({
				trackerId,
				userId: user.id,
			}),
		);
		const listTrackerError = foundTracker.error;
		if (listTrackerError) {
			return c.json(createNotFoundErrorResult(trackerNotFoundError).body, 404);
		}

		const entitySchemas = await listEntitySchemasByTracker({
			trackerId,
		});

		return c.json(successResponse(entitySchemas), 200);
	})
	.openapi(createEntitySchemaRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const trackerId = resolveEntitySchemaTrackerId(body.trackerId);

		const foundTracker = resolveCustomTrackerAccess(
			await getTrackerScopeForUser({ trackerId, userId: user.id }),
		);
		const createTrackerError = foundTracker.error;
		if (createTrackerError) {
			const errorBody =
				createTrackerError === "not_found"
					? createNotFoundErrorResult(trackerNotFoundError).body
					: createValidationErrorResult(customTrackerError).body;
			const errorStatus = createTrackerError === "not_found" ? 404 : 400;
			return c.json(errorBody, errorStatus);
		}

		const entitySchemaInput = resolveValidationData(
			() => resolveEntitySchemaCreateInput(body),
			"Entity schema payload is invalid",
		);
		if ("status" in entitySchemaInput)
			return c.json(entitySchemaInput.body, entitySchemaInput.status);
		const entitySchemaData = entitySchemaInput.data;

		const existingEntitySchema = await getEntitySchemaBySlugForUser({
			userId: user.id,
			slug: entitySchemaData.slug,
		});
		if (existingEntitySchema)
			return c.json(
				duplicateSlugErrorResult.body,
				duplicateSlugErrorResult.status,
			);

		try {
			const createdEntitySchema = await createEntitySchemaForUser({
				trackerId,
				userId: user.id,
				icon: entitySchemaData.icon,
				name: entitySchemaData.name,
				slug: entitySchemaData.slug,
				accentColor: entitySchemaData.accentColor,
				propertiesSchema: entitySchemaData.propertiesSchema,
			});

			return c.json(successResponse(createdEntitySchema), 200);
		} catch (error) {
			if (isUniqueConstraintError(error, entitySchemaUniqueConstraint))
				return c.json(
					duplicateSlugErrorResult.body,
					duplicateSlugErrorResult.status,
				);

			throw error;
		}
	});
