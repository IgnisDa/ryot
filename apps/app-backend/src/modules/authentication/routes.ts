import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { isAPIError } from "better-auth/api";

import { auth } from "~/lib/auth";
import { config } from "~/lib/config";
import {
	createValidationErrorResult,
	jsonResponse,
	payloadErrorResponse,
	resolveValidationData,
	successResponse,
} from "~/lib/openapi";

import { bootstrapNewUser } from "./bootstrap/sign-up";
import { defaultUserPreferences, signUpBody, signUpResponseSchema } from "./schemas";
import { resolveAuthenticationName } from "./service";

const signUpRoute = createRoute({
	path: "/email",
	method: "post",
	tags: ["authentication"],
	summary: "Create a user account and initialize default data",
	request: {
		body: { content: { "application/json": { schema: signUpBody } } },
	},
	responses: {
		400: payloadErrorResponse(),
		200: jsonResponse("User account was created", signUpResponseSchema),
	},
});

export const authenticationApi = new OpenAPIHono().openapi(signUpRoute, async (c) => {
	const body = c.req.valid("json");

	if (config.users.disableLocalAuth) {
		const response = createValidationErrorResult("Local authentication is disabled");
		return c.json(response.body, response.status);
	}

	const nameResult = resolveValidationData(
		() => resolveAuthenticationName(body.name),
		"Signup name is invalid",
	);
	if ("status" in nameResult) {
		return c.json(nameResult.body, nameResult.status);
	}

	let userId!: string;
	try {
		const result = await auth.api.signUpEmail({
			body: {
				email: body.email,
				name: nameResult.data,
				password: body.password,
				preferences: defaultUserPreferences,
			},
		});
		userId = result.user.id;
	} catch (error) {
		if (isAPIError(error)) {
			const response = createValidationErrorResult(error.message || "Could not create account");
			return c.json(response.body, response.status);
		}
		throw error;
	}

	await bootstrapNewUser(userId);

	return c.json(successResponse({ created: true as const }), 200);
});
