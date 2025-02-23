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
	countVisibleFacetsByIdsForUser,
	createFacetForUser,
	getFacetBySlugForUser,
	getOwnedFacetById,
	getVisibleFacetById,
	listFacetsByUser,
	listUserFacetIdsInOrder,
	persistFacetOrderForUser,
	setFacetEnabledForUser,
	updateFacetForUser,
} from "./repository";
import {
	createFacetBody,
	createFacetResponseSchema,
	facetMutationResponseSchema,
	facetParams,
	listFacetsResponseSchema,
	reorderFacetsBody,
	reorderFacetsResponseSchema,
	updateFacetBody,
} from "./schemas";
import {
	buildFacetOrder,
	resolveFacetPatch,
	resolveFacetSlug,
} from "./service";

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

const updateFacetRoute = createAuthRoute(
	createRoute({
		method: "patch",
		tags: ["facets"],
		path: "/{facetId}",
		summary: "Update a custom facet",
		request: {
			params: facetParams,
			body: { content: { "application/json": { schema: updateFacetBody } } },
		},
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Facet does not exist for this user"),
			200: jsonResponse("Facet was updated", createFacetResponseSchema),
		},
	}),
);

const reorderFacetsRoute = createAuthRoute(
	createRoute({
		method: "post",
		tags: ["facets"],
		path: "/reorder",
		summary: "Reorder facets for the user",
		request: {
			body: { content: { "application/json": { schema: reorderFacetsBody } } },
		},
		responses: {
			400: payloadErrorResponse(),
			200: jsonResponse("Facet order was updated", reorderFacetsResponseSchema),
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
	})
	.openapi(updateFacetRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const params = c.req.valid("param");

		const ownedFacet = await getOwnedFacetById({
			userId: user.id,
			facetId: params.facetId,
		});
		if (!ownedFacet)
			return c.json(
				errorResponse(ERROR_CODES.NOT_FOUND, "Facet not found"),
				404,
			);

		let patch;
		try {
			patch = resolveFacetPatch({ current: ownedFacet, input: body });
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Facet slug is required";
			return c.json(errorResponse(ERROR_CODES.VALIDATION_FAILED, message), 400);
		}

		const conflictingFacet = await getFacetBySlugForUser({
			slug: patch.slug,
			userId: user.id,
			excludeFacetId: params.facetId,
		});
		if (conflictingFacet)
			return c.json(
				errorResponse(
					ERROR_CODES.VALIDATION_FAILED,
					"Facet slug already exists",
				),
				400,
			);

		const updatedFacet = await updateFacetForUser({
			name: patch.name,
			slug: patch.slug,
			icon: patch.icon,
			userId: user.id,
			facetId: params.facetId,
			description: patch.description,
			accentColor: patch.accentColor,
		});

		return c.json(successResponse(updatedFacet), 200);
	})
	.openapi(reorderFacetsRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const visibleFacetCount = await countVisibleFacetsByIdsForUser({
			userId: user.id,
			facetIds: body.facetIds,
		});
		if (visibleFacetCount !== body.facetIds.length)
			return c.json(
				errorResponse(
					ERROR_CODES.VALIDATION_FAILED,
					"Facet ids contain unknown facets",
				),
				400,
			);

		const currentFacetIds = await listUserFacetIdsInOrder(user.id);
		const nextFacetIds = buildFacetOrder({
			currentFacetIds,
			requestedFacetIds: body.facetIds,
		});
		const facetIds = await persistFacetOrderForUser({
			userId: user.id,
			facetIds: nextFacetIds,
		});

		return c.json(successResponse({ facetIds }), 200);
	});
