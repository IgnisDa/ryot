import { Hono } from "hono";
import { describeRoute, validator as zValidator } from "hono-openapi";
import { z } from "zod";
import type { AuthType } from "~/auth";
import { appConfigKeys } from "~/lib/app-config";
import {
	jsonResponse,
	payloadValidationErrorResponse,
	protectedRouteSpec,
} from "~/lib/openapi";
import { successResponse } from "~/lib/response";
import { setAppConfigValue } from "./repository";

const setAppConfigBody = z.object({
	value: z.string().nullable(),
	key: z.enum(appConfigKeys),
});

const appConfigValueSchema = z.object({
	updatedAt: z.string(),
	updatedByUserId: z.string(),
	value: z.string().nullable(),
	key: z.enum(appConfigKeys),
});

const setAppConfigResponseSchema = z.object({
	config_value: appConfigValueSchema,
});

export const appConfigApi = new Hono<{ Variables: AuthType }>().post(
	"/set",
	describeRoute(
		protectedRouteSpec({
			tags: ["app-config"],
			summary: "Set an app config key",
			responses: {
				400: payloadValidationErrorResponse,
				200: jsonResponse("Config value was saved", setAppConfigResponseSchema),
			},
		}),
	),
	zValidator("json", setAppConfigBody),
	async (c) => {
		const user = c.get("user");
		const parsed = c.req.valid("json");
		const value = parsed.value?.trim() || null;

		const configValue = await setAppConfigValue({
			value,
			key: parsed.key,
			updatedByUserId: user.id,
		});

		return successResponse(c, { config_value: configValue });
	},
);
