import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/lib/auth";
import {
	createAuthRoute,
	createNotFoundErrorResult,
	createServiceErrorResult,
	createSuccessResult,
	createValidationServiceErrorResult,
	jsonResponse,
	notFoundResponse,
	payloadErrorResponse,
} from "~/lib/openapi";
import { getSavedViewByIdForUser, listSavedViewsForUser } from "./repository";
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
import {
	cloneSavedView,
	createSavedView,
	deleteSavedView,
	updateSavedView,
} from "./service";

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

		const response = createSuccessResult(views);
		return c.json(response.body, response.status);
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

		const response = createSuccessResult(view);
		return c.json(response.body, response.status);
	})
	.openapi(updateSavedViewRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const params = c.req.valid("param");

		const result = await updateSavedView({
			body,
			userId: user.id,
			viewId: params.viewId,
		});
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(createSavedViewRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const result = await createSavedView({ body, userId: user.id });
		if ("error" in result) {
			const response = createValidationServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(deleteSavedViewRoute, async (c) => {
		const user = c.get("user");
		const params = c.req.valid("param");

		const result = await deleteSavedView({
			viewId: params.viewId,
			userId: user.id,
		});
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(cloneSavedViewRoute, async (c) => {
		const user = c.get("user");
		const params = c.req.valid("param");

		const result = await cloneSavedView({
			userId: user.id,
			viewId: params.viewId,
		});
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	});
