import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/auth";
import {
	createAuthRoute,
	ERROR_CODES,
	errorResponse,
	jsonResponse,
	notFoundResponse,
	payloadErrorResponse,
	successResponse,
} from "~/lib/openapi";
import {
	createEntitySchemaForUser,
	getEntitySchemaBySlugForUser,
	getFacetScopeForEntitySchemas,
	listEntitySchemasByFacetForUser,
} from "./repository";
import {
	createEntitySchemaBody,
	createEntitySchemaResponseSchema,
	listEntitySchemasQuery,
	listEntitySchemasResponseSchema,
} from "./schemas";
import {
	resolveEntitySchemaCreateInput,
	resolveEntitySchemaFacetId,
} from "./service";

const listEntitySchemasRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "get",
		tags: ["entity-schemas"],
		request: { query: listEntitySchemasQuery },
		summary: "List entity schemas for a custom facet",
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Facet does not exist for this user"),
			200: jsonResponse(
				"Entity schemas for the requested facet",
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
		summary: "Create an entity schema for a custom facet",
		request: {
			body: {
				content: { "application/json": { schema: createEntitySchemaBody } },
			},
		},
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Facet does not exist for this user"),
			200: jsonResponse(
				"Entity schema was created",
				createEntitySchemaResponseSchema,
			),
		},
	}),
);

const duplicateSlugError = "Entity schema slug already exists";
const entitySchemaUniqueConstraint = "entity_schema_user_slug_unique";
const customFacetError = "Built-in facets do not support entity schemas";

const isUniqueSlugConstraintError = (error: unknown) => {
	if (!error || typeof error !== "object") return false;

	const code = "code" in error ? error.code : undefined;
	const constraint = "constraint" in error ? error.constraint : undefined;

	return code === "23505" && constraint === entitySchemaUniqueConstraint;
};

const getCustomFacetScope = async (input: {
	userId: string;
	facetId: string;
}) => {
	const foundFacet = await getFacetScopeForEntitySchemas(input);
	if (!foundFacet)
		return {
			status: 404 as const,
			body: errorResponse(ERROR_CODES.NOT_FOUND, "Facet not found"),
		};
	if (foundFacet.isBuiltin)
		return {
			status: 400 as const,
			body: errorResponse(ERROR_CODES.VALIDATION_FAILED, customFacetError),
		};

	return { facet: foundFacet };
};

export const entitySchemasApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(listEntitySchemasRoute, async (c) => {
		const user = c.get("user");
		const query = c.req.valid("query");
		const facetId = resolveEntitySchemaFacetId(query.facetId);

		const foundFacet = await getCustomFacetScope({
			facetId,
			userId: user.id,
		});
		if ("body" in foundFacet) return c.json(foundFacet.body, foundFacet.status);

		const entitySchemas = await listEntitySchemasByFacetForUser({
			facetId,
			userId: user.id,
		});

		return c.json(successResponse(entitySchemas), 200);
	})
	.openapi(createEntitySchemaRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const facetId = resolveEntitySchemaFacetId(body.facetId);

		const foundFacet = await getCustomFacetScope({
			facetId,
			userId: user.id,
		});
		if ("body" in foundFacet) return c.json(foundFacet.body, foundFacet.status);

		let entitySchemaInput: ReturnType<typeof resolveEntitySchemaCreateInput>;
		try {
			entitySchemaInput = resolveEntitySchemaCreateInput(body);
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "Entity schema payload is invalid";
			return c.json(errorResponse(ERROR_CODES.VALIDATION_FAILED, message), 400);
		}

		const existingEntitySchema = await getEntitySchemaBySlugForUser({
			userId: user.id,
			slug: entitySchemaInput.slug,
		});
		if (existingEntitySchema)
			return c.json(
				errorResponse(ERROR_CODES.VALIDATION_FAILED, duplicateSlugError),
				400,
			);

		try {
			const createdEntitySchema = await createEntitySchemaForUser({
				facetId,
				userId: user.id,
				name: entitySchemaInput.name,
				slug: entitySchemaInput.slug,
				propertiesSchema: entitySchemaInput.propertiesSchema,
			});

			return c.json(successResponse(createdEntitySchema), 200);
		} catch (error) {
			if (isUniqueSlugConstraintError(error))
				return c.json(
					errorResponse(ERROR_CODES.VALIDATION_FAILED, duplicateSlugError),
					400,
				);

			throw error;
		}
	});
