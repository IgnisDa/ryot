import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
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
	createSavedViewForUser,
	deleteSavedViewByIdForUser,
	getSavedViewByIdForUser,
	listSavedViewsForUser,
} from "./repository";
import {
	createSavedViewBody,
	createSavedViewResponseSchema,
	deleteSavedViewParams,
	listSavedViewsQuery,
	listSavedViewsResponseSchema,
} from "./schemas";
import { resolveIsBuiltinProtected, resolveSavedViewName } from "./service";

const listSavedViewsRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "get",
		tags: ["saved-views"],
		request: { query: listSavedViewsQuery },
		summary: "List saved views for the authenticated user",
		responses: {
			400: payloadErrorResponse(),
			200: jsonResponse(
				"Saved views for the user",
				listSavedViewsResponseSchema,
			),
		},
	}),
);

const createSavedViewRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "post",
		tags: ["saved-views"],
		summary: "Create a saved view",
		request: {
			body: {
				content: { "application/json": { schema: createSavedViewBody } },
			},
		},
		responses: {
			400: payloadErrorResponse(),
			200: jsonResponse(
				"Saved view was created",
				createSavedViewResponseSchema,
			),
		},
	}),
);

const deleteSavedViewRoute = createAuthRoute(
	createRoute({
		method: "delete",
		path: "/{viewId}",
		tags: ["saved-views"],
		summary: "Delete a saved view",
		request: { params: deleteSavedViewParams },
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Saved view not found"),
			200: jsonResponse(
				"Saved view was deleted",
				createSavedViewResponseSchema,
			),
		},
	}),
);

const builtinViewError = "Cannot delete built-in saved views";
const builtinViewErrorResult = createValidationErrorResult(builtinViewError);
const savedViewNotFoundResult = createNotFoundErrorResult(
	"Saved view not found",
);

export const savedViewsApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(listSavedViewsRoute, async (c) => {
		const user = c.get("user");
		const query = c.req.valid("query");

		const views = await listSavedViewsForUser({
			userId: user.id,
			facetId: query.facetId,
		});

		return c.json(successResponse(views), 200);
	})
	.openapi(createSavedViewRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const nameResult = resolveValidationData(
			() => resolveSavedViewName(body.name),
			"Saved view name is invalid",
		);
		if ("status" in nameResult)
			return c.json(nameResult.body, nameResult.status);

		const createdView = await createSavedViewForUser({
			icon: body.icon,
			userId: user.id,
			isBuiltin: false,
			name: nameResult.data,
			facetId: body.facetId,
			accentColor: body.accentColor,
			queryDefinition: body.queryDefinition,
		});

		return c.json(successResponse(createdView), 200);
	})
	.openapi(deleteSavedViewRoute, async (c) => {
		const user = c.get("user");
		const params = c.req.valid("param");

		const existingView = await getSavedViewByIdForUser({
			userId: user.id,
			viewId: params.viewId,
		});

		if (!existingView)
			return c.json(
				savedViewNotFoundResult.body,
				savedViewNotFoundResult.status,
			);

		const protection = resolveIsBuiltinProtected(existingView.isBuiltin);
		if (protection.protected)
			return c.json(builtinViewErrorResult.body, builtinViewErrorResult.status);

		const deletedView = await deleteSavedViewByIdForUser({
			userId: user.id,
			viewId: params.viewId,
		});

		if (!deletedView)
			return c.json(
				savedViewNotFoundResult.body,
				savedViewNotFoundResult.status,
			);

		return c.json(successResponse(deletedView), 200);
	});
