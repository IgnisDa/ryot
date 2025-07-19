import { createRoute, OpenAPIHono } from "@hono/zod-openapi";

import type { AuthType } from "~/lib/auth";
import {
	createAuthRoute,
	createNotFoundErrorResult,
	createServiceErrorResult,
	createStandardResponses,
	createSuccessResult,
	createValidationServiceErrorResult,
	jsonBody,
} from "~/lib/openapi";

import { getSavedViewBySlugForUser, listSavedViewsForUser } from "./repository";
import {
	createSavedViewBody,
	listSavedViewsQuery,
	listSavedViewsResponseSchema,
	reorderSavedViewsBody,
	reorderSavedViewsResponseSchema,
	savedViewParams,
	savedViewResponseSchema,
	updateSavedViewBody,
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
			successSchema: savedViewResponseSchema,
			successDescription: "Saved view was created",
		}),
	}),
);

const getSavedViewBySlugRoute = createAuthRoute(
	createRoute({
		method: "get",
		path: "/{viewSlug}",
		tags: ["saved-views"],
		summary: "Get a saved view by slug",
		request: { params: savedViewParams },
		responses: createStandardResponses({
			includePayloadError: false,
			successSchema: savedViewResponseSchema,
			notFoundDescription: "Saved view not found",
			successDescription: "Saved view was retrieved",
		}),
	}),
);

const updateSavedViewRoute = createAuthRoute(
	createRoute({
		method: "put",
		path: "/{viewSlug}",
		tags: ["saved-views"],
		summary: "Update a saved view by slug",
		description:
			"For user-defined views, all fields are applied. Built-in views only allow `isDisabled` to change; attempts to modify other fields are rejected.",
		request: {
			params: savedViewParams,
			body: jsonBody(updateSavedViewBody),
		},
		responses: createStandardResponses({
			successSchema: savedViewResponseSchema,
			notFoundDescription: "Saved view not found",
			successDescription: "Saved view was updated",
		}),
	}),
);

const deleteSavedViewRoute = createAuthRoute(
	createRoute({
		method: "delete",
		path: "/{viewSlug}",
		tags: ["saved-views"],
		summary: "Delete a user-defined saved view",
		request: { params: savedViewParams },
		responses: createStandardResponses({
			successSchema: savedViewResponseSchema,
			notFoundDescription: "Saved view not found",
			successDescription: "Saved view was deleted",
		}),
	}),
);

const cloneSavedViewRoute = createAuthRoute(
	createRoute({
		method: "post",
		tags: ["saved-views"],
		path: "/{viewSlug}/clone",
		request: { params: savedViewParams },
		summary: "Clone an existing saved view",
		responses: createStandardResponses({
			successSchema: savedViewResponseSchema,
			successDescription: "Saved view was cloned",
			notFoundDescription: "Saved view not found",
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

const savedViewNotFoundResult = createNotFoundErrorResult("Saved view not found");

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
	.openapi(getSavedViewBySlugRoute, async (c) => {
		const user = c.get("user");
		const params = c.req.valid("param");

		const view = await getSavedViewBySlugForUser({
			userId: user.id,
			viewSlug: params.viewSlug,
		});

		if (!view) {
			return c.json(savedViewNotFoundResult.body, savedViewNotFoundResult.status);
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
			viewSlug: params.viewSlug,
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
			userId: user.id,
			viewSlug: params.viewSlug,
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
			viewSlug: params.viewSlug,
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
