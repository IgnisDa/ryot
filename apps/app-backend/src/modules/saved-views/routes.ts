import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/lib/auth";
import {
	createAuthRoute,
	createNotFoundErrorResult,
	createServiceErrorResult,
	createStandardResponses,
	createSuccessResult,
	createValidationErrorResult,
	createValidationServiceErrorResult,
	jsonBody,
} from "~/lib/openapi";
import {
	ViewRuntimeNotFoundError,
	ViewRuntimeValidationError,
} from "~/lib/views/errors";
import { validateSavedViewBody } from "~/lib/views/validator";
import { getSavedViewByIdForUser, listSavedViewsForUser } from "./repository";
import {
	createSavedViewBody,
	createSavedViewResponseSchema,
	deleteSavedViewParams,
	listSavedViewsQuery,
	listSavedViewsResponseSchema,
	reorderSavedViewsBody,
	reorderSavedViewsResponseSchema,
	savedViewParams,
	updateSavedViewBody,
	updateSavedViewResponseSchema,
} from "./schemas";
import {
	cloneSavedView,
	createSavedView,
	deleteSavedView,
	reorderSavedViews,
	updateSavedView,
} from "./service";

const listSavedViewsRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "get",
		tags: ["saved-views"],
		request: { query: listSavedViewsQuery },
		summary: "List saved views for the authenticated user",
		responses: createStandardResponses({
			successSchema: listSavedViewsResponseSchema,
			successDescription: "Saved views for the user",
		}),
	}),
);

const createSavedViewRoute = createAuthRoute(
	createRoute({
		path: "/",
		method: "post",
		tags: ["saved-views"],
		summary: "Create a user-defined saved view",
		request: { body: jsonBody(createSavedViewBody) },
		responses: createStandardResponses({
			successDescription: "Saved view was created",
			successSchema: createSavedViewResponseSchema,
		}),
	}),
);

const getSavedViewByIdRoute = createAuthRoute(
	createRoute({
		method: "get",
		path: "/{viewId}",
		tags: ["saved-views"],
		summary: "Get a saved view by ID",
		request: { params: savedViewParams },
		responses: createStandardResponses({
			includePayloadError: false,
			notFoundDescription: "Saved view not found",
			successSchema: createSavedViewResponseSchema,
			successDescription: "Saved view was retrieved",
		}),
	}),
);

const updateSavedViewRoute = createAuthRoute(
	createRoute({
		method: "put",
		path: "/{viewId}",
		tags: ["saved-views"],
		summary: "Update a saved view by ID",
		description:
			"For user-defined views, all fields are applied. For built-in views, only `isDisabled` is applied — all other fields in the request body are ignored.",
		request: {
			params: savedViewParams,
			body: jsonBody(updateSavedViewBody),
		},
		responses: createStandardResponses({
			notFoundDescription: "Saved view not found",
			successDescription: "Saved view was updated",
			successSchema: updateSavedViewResponseSchema,
		}),
	}),
);

const deleteSavedViewRoute = createAuthRoute(
	createRoute({
		method: "delete",
		path: "/{viewId}",
		tags: ["saved-views"],
		summary: "Delete a user-defined saved view",
		request: { params: deleteSavedViewParams },
		responses: createStandardResponses({
			notFoundDescription: "Saved view not found",
			successDescription: "Saved view was deleted",
			successSchema: createSavedViewResponseSchema,
		}),
	}),
);

const cloneSavedViewRoute = createAuthRoute(
	createRoute({
		method: "post",
		tags: ["saved-views"],
		path: "/{viewId}/clone",
		request: { params: savedViewParams },
		summary: "Clone an existing saved view",
		responses: createStandardResponses({
			successDescription: "Saved view was cloned",
			notFoundDescription: "Saved view not found",
			successSchema: createSavedViewResponseSchema,
		}),
	}),
);

const reorderSavedViewsRoute = createAuthRoute(
	createRoute({
		method: "post",
		path: "/reorder",
		tags: ["saved-views"],
		summary: "Reorder saved views for the authenticated user",
		request: { body: jsonBody(reorderSavedViewsBody) },
		responses: createStandardResponses({
			successSchema: reorderSavedViewsResponseSchema,
			successDescription: "Saved view order was updated",
		}),
	}),
);

const savedViewNotFoundResult = createNotFoundErrorResult(
	"Saved view not found",
);

export const resolveSavedViewValidationErrorResult = (error: unknown) => {
	if (
		error instanceof ViewRuntimeNotFoundError ||
		error instanceof ViewRuntimeValidationError
	) {
		return createValidationErrorResult(error.message);
	}

	throw error;
};

export const savedViewsApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(listSavedViewsRoute, async (c) => {
		const user = c.get("user");
		const query = c.req.valid("query");

		const views = await listSavedViewsForUser({
			userId: user.id,
			trackerId: query.trackerId,
			includeDisabled: query.includeDisabled,
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
		const currentView = await getSavedViewByIdForUser({
			userId: user.id,
			viewId: params.viewId,
		});

		if (!currentView) {
			return c.json(
				savedViewNotFoundResult.body,
				savedViewNotFoundResult.status,
			);
		}

		if (!currentView.isBuiltin) {
			try {
				await validateSavedViewBody(body, user.id);
			} catch (error) {
				const result = resolveSavedViewValidationErrorResult(error);
				return c.json(result.body, result.status);
			}
		}

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

		try {
			await validateSavedViewBody(body, user.id);
		} catch (error) {
			const result = resolveSavedViewValidationErrorResult(error);
			return c.json(result.body, result.status);
		}

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
	})
	.openapi(reorderSavedViewsRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const result = await reorderSavedViews({ body, userId: user.id });
		if ("error" in result) {
			const response = createValidationServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	});
