import { createRoute, OpenAPIHono } from "@hono/zod-openapi";

import {
	createValidationErrorResult,
	jsonResponse,
	payloadErrorResponse,
	resolveValidationData,
	successResponse,
} from "~/lib/openapi";

import { signUpAndInitializeUser } from "./bootstrap/sign-up";
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

	const nameResult = resolveValidationData(
		() => resolveAuthenticationName(body.name),
		"Signup name is invalid",
	);
	if ("status" in nameResult) {
		return c.json(nameResult.body, nameResult.status);
	}

	const signUpResult = await signUpAndInitializeUser({
		email: body.email,
		name: nameResult.data,
		password: body.password,
		preferences: defaultUserPreferences,
	});
	if ("error" in signUpResult) {
		const response = createValidationErrorResult(signUpResult.message);
		return c.json(response.body, response.status);
	}

	return c.json(successResponse(signUpResult.data), 200);
});
