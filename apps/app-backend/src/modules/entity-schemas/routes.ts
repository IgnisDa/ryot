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
const duplicateSlugErrorResult =
	createValidationErrorResult(duplicateSlugError);

const resolveFacetAccessError = (error: "builtin" | "not_found") => ({
	body:
		error === "not_found"
			? createNotFoundErrorResult(facetNotFoundError).body
			: createValidationErrorResult(customFacetError).body,
	status: error === "not_found" ? (404 as const) : (400 as const),
});

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
		const listFacetError = foundFacet.error;
		if (listFacetError) {
			const errorResult = resolveFacetAccessError(listFacetError);
			return c.json(errorResult.body, errorResult.status);
		}

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
		const createFacetError = foundFacet.error;
		if (createFacetError) {
			const errorResult = resolveFacetAccessError(createFacetError);
			return c.json(errorResult.body, errorResult.status);
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
				facetId,
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
