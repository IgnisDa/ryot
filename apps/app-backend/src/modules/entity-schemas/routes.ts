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
import {
	customFacetError,
	facetNotFoundError,
	resolveCustomFacetAccess,
} from "../facets/access";
import { getFacetScopeForUser } from "../facets/repository";
import {
	createEntitySchemaForUser,
	getEntitySchemaBySlugForUser,
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

export const entitySchemasApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(listEntitySchemasRoute, async (c) => {
		const user = c.get("user");
		const query = c.req.valid("query");
		const facetId = resolveEntitySchemaFacetId(query.facetId);

		const foundFacet = resolveCustomFacetAccess(
			await getFacetScopeForUser({
				facetId,
				userId: user.id,
			}),
		);
		if ("error" in foundFacet)
			return c.json(
				foundFacet.error === "not_found"
					? createNotFoundErrorResult(facetNotFoundError).body
					: createValidationErrorResult(customFacetError).body,
				foundFacet.error === "not_found" ? 404 : 400,
			);

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

		const foundFacet = resolveCustomFacetAccess(
			await getFacetScopeForUser({
				facetId,
				userId: user.id,
			}),
		);
		if ("error" in foundFacet)
			return c.json(
				foundFacet.error === "not_found"
					? createNotFoundErrorResult(facetNotFoundError).body
					: createValidationErrorResult(customFacetError).body,
				foundFacet.error === "not_found" ? 404 : 400,
			);

		const entitySchemaInput = resolveValidationResult(
			() => resolveEntitySchemaCreateInput(body),
			"Entity schema payload is invalid",
		);
		if ("error" in entitySchemaInput)
			return c.json(
				createValidationErrorResult(entitySchemaInput.error).body,
				400,
			);
		const entitySchemaData = entitySchemaInput.data;

		const existingEntitySchema = await getEntitySchemaBySlugForUser({
			userId: user.id,
			slug: entitySchemaData.slug,
		});
		if (existingEntitySchema)
			return c.json(createValidationErrorResult(duplicateSlugError).body, 400);

		try {
			const createdEntitySchema = await createEntitySchemaForUser({
				facetId,
				userId: user.id,
				name: entitySchemaData.name,
				slug: entitySchemaData.slug,
				propertiesSchema: entitySchemaData.propertiesSchema,
			});

			return c.json(successResponse(createdEntitySchema), 200);
		} catch (error) {
			if (isUniqueConstraintError(error, entitySchemaUniqueConstraint))
				return c.json(
					createValidationErrorResult(duplicateSlugError).body,
					400,
				);

			throw error;
		}
	});
