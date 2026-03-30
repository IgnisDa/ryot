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
import { builtInMediaOverviewResponseSchema } from "./schemas";
import { getBuiltInMediaOverview } from "./service";

const getMediaOverviewRoute = createAuthRoute(
	createRoute({
		method: "get",
		tags: ["media"],
		path: "/overview",
		summary: "Get the built-in media overview",
		responses: {
			...createStandardResponses({
				includePayloadError: false,
				successSchema: builtInMediaOverviewResponseSchema,
				successDescription: "Built-in media overview sections",
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

export const mediaApi = new OpenAPIHono<{ Variables: AuthType }>().openapi(
	getMediaOverviewRoute,
	async (c) => {
		const user = c.get("user");

		const result = await getBuiltInMediaOverview({ userId: user.id });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	},
);
