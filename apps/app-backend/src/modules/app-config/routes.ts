import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AuthType } from "~/auth";
import { appConfigKeys } from "~/lib/app-config";
import {
	createAuthRoute,
	dataSchema,
	ERROR_CODES,
	errorJsonResponse,
	jsonResponse,
	payloadValidationErrorResponse,
	successResponse,
} from "~/lib/openapi";
import { setAppConfigValue } from "./repository";

const setAppConfigBody = z.object({
	value: z.string().nullable(),
	key: z.enum(appConfigKeys),
});

const setAppConfigResponseSchema = dataSchema(
	z.object({
		key: z.string(),
		updatedAt: z.string(),
		value: z.string().nullable(),
		updatedByUserId: z.string().nullable(),
	}),
);

const setAppConfigRoute = createAuthRoute(
	createRoute({
		path: "/set",
		method: "post",
		tags: ["app-config"],
		summary: "Set an app config key",
		request: {
			body: { content: { "application/json": { schema: setAppConfigBody } } },
		},
		responses: {
			400: payloadValidationErrorResponse,
			401: errorJsonResponse(
				"Request is unauthenticated",
				ERROR_CODES.UNAUTHENTICATED,
			),
			200: jsonResponse("Config value was saved", setAppConfigResponseSchema),
		},
	}),
);

export const appConfigApi = new OpenAPIHono<{ Variables: AuthType }>().openapi(
	setAppConfigRoute,
	async (c) => {
		const user = c.get("user");
		const parsed = c.req.valid("json");
		const value = parsed.value?.trim() || null;

		const configValue = await setAppConfigValue({
			value,
			key: parsed.key,
			updatedByUserId: user.id,
		});

		return c.json(
			successResponse({
				...configValue,
				updatedAt: configValue.updatedAt.toISOString(),
			}),
			200,
		);
	},
);
