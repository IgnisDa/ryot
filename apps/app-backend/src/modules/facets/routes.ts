import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/auth";
import { FacetMode } from "~/db/schema";
import {
	createAuthRoute,
	ERROR_CODES,
	errorResponse,
	jsonResponse,
	notFoundResponse,
	pathParamErrorResponse,
	payloadErrorResponse,
	successResponse,
} from "~/lib/openapi";
import {
	createFacetForUser,
	getFacetBySlugForUser,
	getVisibleFacetById,
	listFacetsByUser,
	setFacetEnabledForUser,
} from "./repository";
import {
	createFacetBody,
	createFacetResponseSchema,
	facetMutationResponseSchema,
	facetParams,
	listFacetsResponseSchema,
} from "./schemas";
import { resolveFacetSlug } from "./service";

const listFacetsRoute = createAuthRoute(
	createRoute({
		path: "/list",
		method: "get",
		tags: ["facets"],
		summary: "List facets available for the user",
		responses: {
			200: jsonResponse(
				"Facets available for the user",
				listFacetsResponseSchema,
			),
		},
	}),
);

const createFacetRoute = createAuthRoute(
	createRoute({
		method: "post",
		path: "/create",
		tags: ["facets"],
		summary: "Create and enable a custom facet",
		request: {
			body: { content: { "application/json": { schema: createFacetBody } } },
		},
		responses: {
			400: payloadErrorResponse(),
			200: jsonResponse("Facet was created", createFacetResponseSchema),
		},
	}),
);

const enableFacetRoute = createAuthRoute(
	createRoute({
		method: "post",
		tags: ["facets"],
		path: "/{facetId}/enable",
		summary: "Enable a facet for the user",
		request: { params: facetParams },
		responses: {
			400: pathParamErrorResponse(),
			404: notFoundResponse("Facet does not exist for this user"),
			200: jsonResponse("Facet was enabled", facetMutationResponseSchema),
		},
	}),
);

const disableFacetRoute = createAuthRoute(
	createRoute({
		method: "post",
		tags: ["facets"],
		path: "/{facetId}/disable",
		summary: "Disable a facet for the user",
		request: { params: facetParams },
		responses: {
			400: pathParamErrorResponse(),
			404: notFoundResponse("Facet does not exist for this user"),
			200: jsonResponse("Facet was disabled", facetMutationResponseSchema),
		},
	}),
);

export const facetsApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(listFacetsRoute, async (c) => {
		const user = c.get("user");
		const facets = await listFacetsByUser(user.id);
		return c.json(successResponse(facets), 200);
	})
	.openapi(createFacetRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		let slug = "";
		try {
			slug = resolveFacetSlug({ name: body.name, slug: body.slug });
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Facet slug is required";
			return c.json(errorResponse(ERROR_CODES.VALIDATION_FAILED, message), 400);
		}

		const existingFacet = await getFacetBySlugForUser({
			slug,
			userId: user.id,
		});
		if (existingFacet)
			return c.json(
				errorResponse(
					ERROR_CODES.VALIDATION_FAILED,
					"Facet slug already exists",
				),
				400,
			);

		const createdFacet = await createFacetForUser({
			slug,
			name: body.name,
			userId: user.id,
			icon: body.icon,
			mode: FacetMode.generated,
			description: body.description,
			accentColor: body.accentColor,
		});

		return c.json(successResponse(createdFacet), 200);
	})
	.openapi(enableFacetRoute, async (c) => {
		const user = c.get("user");
		const params = c.req.valid("param");

		const foundFacet = await getVisibleFacetById({
			userId: user.id,
			facetId: params.facetId,
		});
		if (!foundFacet)
			return c.json(
				errorResponse(ERROR_CODES.NOT_FOUND, "Facet not found"),
				404,
			);

		await setFacetEnabledForUser({
			enabled: true,
			userId: user.id,
			facetId: params.facetId,
		});

		return c.json(
			successResponse({ enabled: true, facetId: params.facetId }),
			200,
		);
	})
	.openapi(disableFacetRoute, async (c) => {
		const user = c.get("user");
		const params = c.req.valid("param");

		const foundFacet = await getVisibleFacetById({
			userId: user.id,
			facetId: params.facetId,
		});
		if (!foundFacet)
			return c.json(
				errorResponse(ERROR_CODES.NOT_FOUND, "Facet not found"),
				404,
			);

		await setFacetEnabledForUser({
			enabled: false,
			userId: user.id,
			facetId: params.facetId,
		});

		return c.json(
			successResponse({ enabled: false, facetId: params.facetId }),
			200,
		);
	});
