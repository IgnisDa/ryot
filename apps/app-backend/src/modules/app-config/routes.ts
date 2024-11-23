import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthType } from "~/auth";
import { appConfigKeys } from "~/lib/app-config";
import { successResponse } from "~/lib/response";
import { setAppConfigValue } from "./repository";

const setAppConfigBody = z.object({
	key: z.enum(appConfigKeys),
	value: z.string().nullable(),
});

export const appConfigApi = new Hono<{ Variables: AuthType }>().post(
	"/set",
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
