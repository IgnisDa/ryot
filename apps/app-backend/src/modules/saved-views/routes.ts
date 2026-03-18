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
	cloneSavedViewByIdForUser,
	createSavedViewForUser,
	deleteSavedViewByIdForUser,
	getSavedViewByIdForUser,
	listSavedViewsForUser,
	updateSavedViewByIdForUser,
} from "./repository";
import {
	createSavedViewBody,
	createSavedViewResponseSchema,
	deleteSavedViewParams,
	listSavedViewsQuery,
	listSavedViewsResponseSchema,
	savedViewParams,
	updateSavedViewBody,
	updateSavedViewResponseSchema,
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
		summary: "Create a user-defined saved view",
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

const getSavedViewByIdRoute = createAuthRoute(
	createRoute({
		method: "get",
		path: "/{viewId}",
		tags: ["saved-views"],
		summary: "Get a saved view by ID",
		request: { params: savedViewParams },
		responses: {
			404: notFoundResponse("Saved view not found"),
			200: jsonResponse(
				"Saved view was retrieved",
				createSavedViewResponseSchema,
			),
		},
	}),
);

const updateSavedViewRoute = createAuthRoute(
	createRoute({
		method: "put",
		path: "/{viewId}",
		tags: ["saved-views"],
		summary: "Update a user-defined saved view by ID",
		request: {
			params: savedViewParams,
			body: {
				content: { "application/json": { schema: updateSavedViewBody } },
			},
		},
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Saved view not found"),
			200: jsonResponse(
				"Saved view was updated",
				updateSavedViewResponseSchema,
			),
		},
	}),
);

const deleteSavedViewRoute = createAuthRoute(
	createRoute({
		method: "delete",
		path: "/{viewId}",
		tags: ["saved-views"],
		summary: "Delete a user-defined saved view",
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

const cloneSavedViewRoute = createAuthRoute(
	createRoute({
		method: "post",
		tags: ["saved-views"],
		path: "/{viewId}/clone",
		request: { params: savedViewParams },
		summary: "Clone an existing saved view",
		responses: {
			400: payloadErrorResponse(),
			404: notFoundResponse("Saved view not found"),
			200: jsonResponse("Saved view was cloned", createSavedViewResponseSchema),
		},
	}),
);

const builtinViewError = "Cannot modify built-in saved views";
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
			trackerId: query.trackerId,
		});

		return c.json(successResponse(views), 200);
	})
	.openapi(getSavedViewByIdRoute, async (c) => {
		const user = c.get("user");
		const params = c.req.valid("param");

		const view = await getSavedViewByIdForUser({
			userId: user.id,
			viewId: params.viewId,
		});

		if (!view) {
			return c.json(
				savedViewNotFoundResult.body,
				savedViewNotFoundResult.status,
			);
		}

		return c.json(successResponse(view), 200);
	})
	.openapi(updateSavedViewRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const params = c.req.valid("param");

		const existingView = await getSavedViewByIdForUser({
			userId: user.id,
			viewId: params.viewId,
		});

		if (!existingView) {
			return c.json(
				savedViewNotFoundResult.body,
				savedViewNotFoundResult.status,
			);
		}

		const protection = resolveIsBuiltinProtected(existingView.isBuiltin);
		if (protection.protected) {
			return c.json(builtinViewErrorResult.body, builtinViewErrorResult.status);
		}

		const nameResult = resolveValidationData(
			() => resolveSavedViewName(body.name),
			"Saved view name is invalid",
		);
		if ("status" in nameResult) {
			return c.json(nameResult.body, nameResult.status);
		}

		const updatedView = await updateSavedViewByIdForUser({
			userId: user.id,
			viewId: params.viewId,
			data: { ...body, name: nameResult.data },
		});

		if (!updatedView) {
			return c.json(
				savedViewNotFoundResult.body,
				savedViewNotFoundResult.status,
			);
		}

		return c.json(successResponse(updatedView), 200);
	})
	.openapi(createSavedViewRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const nameResult = resolveValidationData(
			() => resolveSavedViewName(body.name),
			"Saved view name is invalid",
		);
		if ("status" in nameResult) {
			return c.json(nameResult.body, nameResult.status);
		}

		const createdView = await createSavedViewForUser({
			icon: body.icon,
			userId: user.id,
			isBuiltin: false,
			name: nameResult.data,
			trackerId: body.trackerId,
			accentColor: body.accentColor,
			queryDefinition: body.queryDefinition,
			displayConfiguration: body.displayConfiguration,
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

		if (!existingView) {
			return c.json(
				savedViewNotFoundResult.body,
				savedViewNotFoundResult.status,
			);
		}

		const protection = resolveIsBuiltinProtected(existingView.isBuiltin);
		if (protection.protected) {
			return c.json(builtinViewErrorResult.body, builtinViewErrorResult.status);
		}

		const deletedView = await deleteSavedViewByIdForUser({
			userId: user.id,
			viewId: params.viewId,
		});

		if (!deletedView) {
			return c.json(
				savedViewNotFoundResult.body,
				savedViewNotFoundResult.status,
			);
		}

		return c.json(successResponse(deletedView), 200);
	})
	.openapi(cloneSavedViewRoute, async (c) => {
		const user = c.get("user");
		const params = c.req.valid("param");

		const sourceView = await getSavedViewByIdForUser({
			userId: user.id,
			viewId: params.viewId,
		});

		if (!sourceView) {
			return c.json(
				savedViewNotFoundResult.body,
				savedViewNotFoundResult.status,
			);
		}

		const clonedName = `${sourceView.name} (Copy)`;
		const nameResult = resolveValidationData(
			() => resolveSavedViewName(clonedName),
			"Cloned view name is invalid",
		);
		if ("status" in nameResult) {
			return c.json(nameResult.body, nameResult.status);
		}

		const clonedView = await cloneSavedViewByIdForUser({
			userId: user.id,
			viewId: params.viewId,
			clonedName: nameResult.data,
		});

		if (!clonedView) {
			return c.json(
				savedViewNotFoundResult.body,
				savedViewNotFoundResult.status,
			);
		}

		return c.json(successResponse(clonedView), 200);
	});
