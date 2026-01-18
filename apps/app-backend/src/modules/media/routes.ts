import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/lib/auth";
import {
	createAuthRoute,
	createServiceErrorResult,
	createStandardResponses,
	createSuccessResult,
	jsonBody,
	notFoundResponse,
	validationErrorResponse,
} from "~/lib/openapi";
import {
	builtInMediaOverviewContinueResponseSchema,
	builtInMediaOverviewLibraryResponseSchema,
	builtInMediaOverviewRateTheseResponseSchema,
	builtInMediaOverviewRecentActivityResponseSchema,
	builtInMediaOverviewUpNextResponseSchema,
	builtInMediaOverviewWeekActivityResponseSchema,
	importMediaBody,
	importMediaResponseSchema,
	mediaImportJobParams,
	mediaImportResultResponseSchema,
} from "./schemas";
import {
	getContinueItems,
	getLibraryStats,
	getMediaImportResult,
	getRateTheseItems,
	getRecentActivityItems,
	getUpNextItems,
	getWeekActivity,
	importMedia,
} from "./service";

const getMediaOverviewUpNextRoute = createAuthRoute(
	createRoute({
		method: "get",
		tags: ["media"],
		path: "/overview/up-next",
		summary: "Get the up next section",
		responses: {
			...createStandardResponses({
				includePayloadError: false,
				successSchema: builtInMediaOverviewUpNextResponseSchema,
				successDescription: "Up next section items",
			}),
			400: validationErrorResponse(
				"Built-in media overview configuration is invalid",
			),
			404: notFoundResponse(
				"Built-in media overview configuration is missing required built-in schemas",
			),
		},
	}),
);

const getMediaOverviewContinueRoute = createAuthRoute(
	createRoute({
		method: "get",
		tags: ["media"],
		path: "/overview/continue",
		summary: "Get the continue section",
		responses: {
			...createStandardResponses({
				includePayloadError: false,
				successSchema: builtInMediaOverviewContinueResponseSchema,
				successDescription: "Continue section items",
			}),
			400: validationErrorResponse(
				"Built-in media overview configuration is invalid",
			),
			404: notFoundResponse(
				"Built-in media overview configuration is missing required built-in schemas",
			),
		},
	}),
);

const getMediaOverviewRateTheseRoute = createAuthRoute(
	createRoute({
		method: "get",
		tags: ["media"],
		path: "/overview/review",
		summary: "Get the review (rate these) section",
		responses: {
			...createStandardResponses({
				includePayloadError: false,
				successSchema: builtInMediaOverviewRateTheseResponseSchema,
				successDescription: "Review section items",
			}),
			400: validationErrorResponse(
				"Built-in media overview configuration is invalid",
			),
			404: notFoundResponse(
				"Built-in media overview configuration is missing required built-in schemas",
			),
		},
	}),
);

const getMediaOverviewRecentActivityRoute = createAuthRoute(
	createRoute({
		method: "get",
		tags: ["media"],
		path: "/overview/activity",
		summary: "Get the recent media activity feed",
		responses: createStandardResponses({
			includePayloadError: false,
			successDescription: "Recent media activity items",
			successSchema: builtInMediaOverviewRecentActivityResponseSchema,
		}),
	}),
);

const getMediaOverviewWeekActivityRoute = createAuthRoute(
	createRoute({
		method: "get",
		tags: ["media"],
		path: "/overview/week",
		summary: "Get the current week's media activity histogram",
		responses: createStandardResponses({
			includePayloadError: false,
			successDescription: "Current week media activity buckets",
			successSchema: builtInMediaOverviewWeekActivityResponseSchema,
		}),
	}),
);

const getMediaOverviewLibraryRoute = createAuthRoute(
	createRoute({
		method: "get",
		tags: ["media"],
		path: "/overview/library",
		summary: "Get the library statistics overview",
		responses: createStandardResponses({
			includePayloadError: false,
			successDescription: "Library statistics overview",
			successSchema: builtInMediaOverviewLibraryResponseSchema,
		}),
	}),
);

const importMediaRoute = createAuthRoute(
	createRoute({
		method: "post",
		tags: ["media"],
		path: "/import",
		request: { body: jsonBody(importMediaBody) },
		summary: "Enqueue a media item import from a sandbox script",
		responses: createStandardResponses({
			successSchema: importMediaResponseSchema,
			successDescription: "Media import job enqueued",
		}),
	}),
);

const getMediaImportResultRoute = createAuthRoute(
	createRoute({
		method: "get",
		tags: ["media"],
		path: "/import/{jobId}",
		request: { params: mediaImportJobParams },
		summary: "Poll the result of a media import job",
		responses: createStandardResponses({
			successSchema: mediaImportResultResponseSchema,
			successDescription: "Media import job result",
			notFoundDescription: "Media import job not found",
		}),
	}),
);

export const mediaApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(importMediaRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const result = await importMedia({ body, userId: user.id });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(getMediaImportResultRoute, async (c) => {
		const user = c.get("user");
		const params = c.req.valid("param");

		const result = await getMediaImportResult({
			userId: user.id,
			jobId: params.jobId,
		});
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(getMediaOverviewUpNextRoute, async (c) => {
		const user = c.get("user");

		const result = await getUpNextItems(user.id);
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(getMediaOverviewContinueRoute, async (c) => {
		const user = c.get("user");

		const result = await getContinueItems(user.id);
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(getMediaOverviewRateTheseRoute, async (c) => {
		const user = c.get("user");

		const result = await getRateTheseItems(user.id);
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(getMediaOverviewRecentActivityRoute, async (c) => {
		const user = c.get("user");

		const result = await getRecentActivityItems(user.id);
		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(getMediaOverviewWeekActivityRoute, async (c) => {
		const user = c.get("user");

		const result = await getWeekActivity(user.id);
		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(getMediaOverviewLibraryRoute, async (c) => {
		const user = c.get("user");

		const result = await getLibraryStats(user.id);
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	});
