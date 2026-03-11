import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { isAPIError } from "better-auth/api";
import { auth, type MaybeAuthType } from "~/lib/auth";
import {
	createAuthRoute,
	createValidationErrorResult,
	jsonResponse,
	payloadErrorResponse,
	resolveValidationResult,
	successResponse,
} from "~/lib/openapi";
import { meResponseSchema, signUpBody, signUpResponseSchema } from "./schemas";
import { resolveAuthenticationName } from "./service";

const meRoute = createAuthRoute(
	createRoute({
		path: "/me",
		method: "get",
		tags: ["authentication"],
		summary: "Get the current user session",
		responses: {
			200: jsonResponse("Authenticated session details", meResponseSchema),
		},
	}),
);

const signUpRoute = createRoute({
	path: "/email",
	method: "post",
	tags: ["authentication"],
	summary: "Create a user account",
	request: {
		body: { content: { "application/json": { schema: signUpBody } } },
	},
	responses: {
		400: payloadErrorResponse(),
		200: jsonResponse("User account was created", signUpResponseSchema),
	},
});

export const authenticationApi = new OpenAPIHono<{ Variables: MaybeAuthType }>()
	.openapi(meRoute, async (c) => {
		const user = c.get("user");
		const session = c.get("session");
		return c.json(successResponse({ user, session }), 200);
	})
	.openapi(signUpRoute, async (c) => {
		const body = c.req.valid("json");

		const nameResult = resolveValidationResult(
			() => resolveAuthenticationName(body.name),
			"Signup name is invalid",
		);
		if ("error" in nameResult)
			return c.json(createValidationErrorResult(nameResult.error).body, 400);

		try {
			await auth.api.signUpEmail({
				body: {
					email: body.email,
					name: nameResult.data,
					password: body.password,
				},
			});
		} catch (error) {
			if (isAPIError(error)) {
				const message = error.message || "Could not create account";
				return c.json(createValidationErrorResult(message).body, 400);
			}

			throw error;
		}

		return c.json(successResponse({ created: true as const }), 200);
	});
