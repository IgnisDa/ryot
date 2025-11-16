import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/lib/auth";
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

const ERROR_FACET_NOT_FOUND = "Facet not found";
const ERROR_FACET_SLUG_EXISTS = "Facet slug already exists";
const ERROR_MISSING_FIELDS = "At least one field must be provided";

async function refreshUpdatedFacet(userId: string, facetId: string) {
	const facets = await listFacetsByUser(userId);
	const foundFacet = facets.find((facet) => facet.id === facetId);
	if (!foundFacet) return { error: ERROR_FACET_NOT_FOUND };
	return { data: foundFacet };
}

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

const updateFacetRoute = createAuthRoute(
	createRoute({
		method: "patch",
		tags: ["facets"],
		path: "/{facetId}",
		summary: "Update a facet",
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

		const slugResult = resolveValidationResult(
			() => resolveFacetSlug({ name: body.name, slug: body.slug }),
			"Facet slug is required",
		);
		if ("error" in slugResult)
			return c.json(createValidationErrorResult(slugResult.error).body, 400);

		const slug = slugResult.data;

		const existingFacet = await getFacetBySlugForUser({
			slug,
			userId: user.id,
		});
		if (existingFacet)
			return c.json(
				createValidationErrorResult(ERROR_FACET_SLUG_EXISTS).body,
				400,
			);

		const createdFacet = await createFacetForUser({
			slug,
			name: body.name,
			userId: user.id,
			icon: body.icon,
			description: body.description,
			accentColor: body.accentColor,
		});

		return c.json(successResponse(createdFacet), 200);
	})
	.openapi(updateFacetRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const params = c.req.valid("param");
		const enabled = body.enabled;
		const hasEnabledUpdate = enabled !== undefined;
		const hasFacetConfigUpdate =
			body.icon !== undefined ||
			body.slug !== undefined ||
			body.name !== undefined ||
			body.description !== undefined ||
			body.accentColor !== undefined;

		if (!hasFacetConfigUpdate) {
			if (enabled === undefined)
				return c.json(
					createValidationErrorResult(ERROR_MISSING_FIELDS).body,
					400,
				);

			const visibleFacet = await getVisibleFacetById({
				userId: user.id,
				facetId: params.facetId,
			});
			if (!visibleFacet)
				return c.json(
					createNotFoundErrorResult(ERROR_FACET_NOT_FOUND).body,
					404,
				);

			await setFacetEnabledForUser({
				enabled,
				userId: user.id,
				facetId: params.facetId,
			});

			const refreshResult = await refreshUpdatedFacet(user.id, params.facetId);
			if ("error" in refreshResult)
				return c.json(createNotFoundErrorResult(refreshResult.error).body, 404);

			return c.json(successResponse(refreshResult.data), 200);
		}

		const ownedFacet = await getOwnedFacetById({
			userId: user.id,
			facetId: params.facetId,
		});
		if (!ownedFacet)
			return c.json(createNotFoundErrorResult(ERROR_FACET_NOT_FOUND).body, 404);

		const patchResult = resolveValidationResult(
			() => resolveFacetPatch({ current: ownedFacet, input: body }),
			"Facet slug is required",
		);
		if ("error" in patchResult)
			return c.json(createValidationErrorResult(patchResult.error).body, 400);

		const patch = patchResult.data;

		const conflictingFacet = await getFacetBySlugForUser({
			slug: patch.slug,
			userId: user.id,
			excludeFacetId: params.facetId,
		});
		if (conflictingFacet)
			return c.json(
				createValidationErrorResult(ERROR_FACET_SLUG_EXISTS).body,
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

		if (!hasEnabledUpdate) return c.json(successResponse(updatedFacet), 200);

		await setFacetEnabledForUser({
			enabled,
			userId: user.id,
			facetId: params.facetId,
		});

		const refreshResult = await refreshUpdatedFacet(user.id, params.facetId);
		if ("error" in refreshResult)
			return c.json(createNotFoundErrorResult(refreshResult.error).body, 404);

		return c.json(successResponse(refreshResult.data), 200);
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
				createValidationErrorResult("Facet ids contain unknown facets").body,
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
