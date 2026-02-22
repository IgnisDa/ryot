import { createRoute, OpenAPIHono } from "@hono/zod-openapi";

import type { AuthType } from "~/lib/auth";
import {
	createAuthRoute,
	createServiceErrorResult,
	createStandardResponses,
	createSuccessResult,
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
} from "./schemas";
import {
	getContinueItems,
	getLibraryStats,
	getRateTheseItems,
	getRecentActivityItems,
	getUpNextItems,
	getWeekActivity,
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
			400: validationErrorResponse("Built-in media overview configuration is invalid"),
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
			400: validationErrorResponse("Built-in media overview configuration is invalid"),
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
			400: validationErrorResponse("Built-in media overview configuration is invalid"),
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
		responses: {
			...createStandardResponses({
				includePayloadError: false,
				successDescription: "Recent media activity items",
				successSchema: builtInMediaOverviewRecentActivityResponseSchema,
			}),
			400: validationErrorResponse("Built-in media overview configuration is invalid"),
			404: notFoundResponse(
				"Built-in media overview configuration is missing required built-in schemas",
			),
		},
	}),
);

const getMediaOverviewWeekActivityRoute = createAuthRoute(
	createRoute({
		method: "get",
		tags: ["media"],
		path: "/overview/week",
		summary: "Get the current week's media activity histogram",
		responses: {
			...createStandardResponses({
				includePayloadError: false,
				successDescription: "Current week media activity buckets",
				successSchema: builtInMediaOverviewWeekActivityResponseSchema,
			}),
			400: validationErrorResponse("Built-in media overview configuration is invalid"),
			404: notFoundResponse(
				"Built-in media overview configuration is missing required built-in schemas",
			),
		},
	}),
);

const getMediaOverviewLibraryRoute = createAuthRoute(
	createRoute({
		method: "get",
		tags: ["media"],
		path: "/overview/library",
		summary: "Get the library statistics overview",
		responses: {
			...createStandardResponses({
				includePayloadError: false,
				successDescription: "Library statistics overview",
				successSchema: builtInMediaOverviewLibraryResponseSchema,
			}),
			400: validationErrorResponse("Built-in media overview configuration is invalid"),
			404: notFoundResponse(
				"Built-in media overview configuration is missing required built-in schemas",
			),
		},
	}),
);

export const mediaApi = new OpenAPIHono<{ Variables: AuthType }>()
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
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(getMediaOverviewWeekActivityRoute, async (c) => {
		const user = c.get("user");

		const result = await getWeekActivity(user.id);
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

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
