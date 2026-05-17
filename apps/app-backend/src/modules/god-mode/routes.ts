import { randomUUID } from "node:crypto";

import { createRoute, OpenAPIHono } from "@hono/zod-openapi";

import { auth, createAdminRoute } from "~/lib/auth";
import { clearPendingReset, storePendingReset } from "~/lib/auth/password-reset";
import { config } from "~/lib/config";
import {
	commonErrors,
	createErrorResponse,
	createInternalErrorResult,
	createStandardResponses,
	createSuccessResult,
	createValidationErrorResult,
} from "~/lib/openapi";
import { ERROR_CODES, errorResponse } from "~/lib/openapi/errors";
import { redis } from "~/lib/redis";

import {
	provisionUserBodySchema,
	provisionUserResponseSchema,
	resetPasswordPathParamsSchema,
	resetPasswordResponseSchema,
	setUserBanBodySchema,
	setUserBanPathParamsSchema,
	setUserBanResponseSchema,
	userListQuerySchema,
	userListResponseSchema,
} from "./schemas";
import { checkResetEligibility, listUsers, provisionUser, setUserBan } from "./service";

const listUsersRoute = createAdminRoute(
	createRoute({
		method: "get",
		path: "/users",
		tags: ["god-mode"],
		request: { query: userListQuerySchema },
		summary: "List all users with auth state classification",
		responses: {
			...createStandardResponses({
				includePayloadError: false,
				successSchema: userListResponseSchema,
				successDescription: "User list with auth states",
			}),
		},
	}),
);

const resetPasswordRoute = createAdminRoute(
	createRoute({
		method: "post",
		tags: ["god-mode"],
		path: "/users/{userId}/reset-password",
		summary: "Generate a password reset link for a user",
		request: { params: resetPasswordPathParamsSchema },
		responses: {
			400: createErrorResponse("Validation error", commonErrors.validationFailed),
			500: createErrorResponse(
				"Password reset request failed or timed out",
				commonErrors.internalError,
				commonErrors.timeout,
			),
			...createStandardResponses({
				includePayloadError: false,
				successSchema: resetPasswordResponseSchema,
				successDescription: "Password reset link generated successfully",
			}),
		},
	}),
);

const provisionUserRoute = createAdminRoute(
	createRoute({
		method: "post",
		tags: ["god-mode"],
		path: "/users/provision",
		summary: "Provision a new user account, bypassing registration restrictions",
		request: { body: { content: { "application/json": { schema: provisionUserBodySchema } } } },
		responses: {
			400: createErrorResponse("Validation error", commonErrors.validationFailed),
			500: createErrorResponse("User provisioning failed", commonErrors.internalError),
			...createStandardResponses({
				includePayloadError: false,
				successSchema: provisionUserResponseSchema,
				successDescription: "User provisioned successfully",
			}),
		},
	}),
);

const setUserBanRoute = createAdminRoute(
	createRoute({
		method: "post",
		tags: ["god-mode"],
		path: "/users/{userId}/ban/set",
		summary: "Explicitly enable or disable a user account",
		request: {
			params: setUserBanPathParamsSchema,
			body: { content: { "application/json": { schema: setUserBanBodySchema } } },
		},
		responses: {
			400: createErrorResponse("Validation error", commonErrors.validationFailed),
			500: createErrorResponse("Ban state update failed", commonErrors.internalError),
			...createStandardResponses({
				includePayloadError: false,
				successSchema: setUserBanResponseSchema,
				successDescription: "User ban state updated successfully",
			}),
		},
	}),
);

const RESET_LINK_TIMEOUT_MS = 10_000;

const godModeApi = new OpenAPIHono()
	.openapi(provisionUserRoute, async (c) => {
		const body = c.req.valid("json");

		const ctx = await auth.$context;
		const deps = ctx.internalAdapter;

		const result = await provisionUser(body, {
			findUserByEmail: (email) => deps.findUserByEmail(email),
			createUser: (data) => deps.createUser({ ...data }),
			createAccount: (data) => deps.createAccount({ ...data }),
		});

		if ("error" in result) {
			if (result.error === "internal") {
				const response = createInternalErrorResult(result.message);
				return c.json(response.body, response.status);
			}
			const response = createValidationErrorResult(result.message);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(setUserBanRoute, async (c) => {
		const { userId } = c.req.valid("param");
		const body = c.req.valid("json");

		const ctx = await auth.$context;
		const deps = ctx.internalAdapter;

		const result = await setUserBan(userId, body, {
			now: () => new Date(),
			findUserById: (id) => deps.findUserById(id),
			deleteUserSessions: (id) => deps.deleteUserSessions(id),
			updateUser: (id, input) => deps.updateUser(id, input),
		});

		if ("error" in result) {
			if (result.error === "internal") {
				const response = createInternalErrorResult(result.message);
				return c.json(response.body, response.status);
			}
			const response = createValidationErrorResult(result.message);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(listUsersRoute, async (c) => {
		const query = c.req.valid("query");

		const ctx = await auth.$context;
		const deps = ctx.internalAdapter;

		const result = await listUsers(query, deps);

		if ("error" in result) {
			const response = createInternalErrorResult(result.message);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})

	.openapi(resetPasswordRoute, async (c) => {
		if (config.users.disableLocalAuth) {
			return c.json(
				errorResponse(
					ERROR_CODES.VALIDATION_FAILED,
					"Local authentication is disabled on this instance",
				),
				400,
			);
		}

		const { userId } = c.req.valid("param");

		const ctx = await auth.$context;
		const deps = ctx.internalAdapter;

		const user = await deps.findUserById(userId);

		if (!user) {
			return c.json(
				errorResponse(ERROR_CODES.VALIDATION_FAILED, `User with id '${userId}' not found`),
				400,
			);
		}

		const eligibility = await checkResetEligibility(user, {
			findAccounts: (id: string) => deps.findAccounts(id),
		});

		if ("error" in eligibility) {
			return c.json(errorResponse(ERROR_CODES.VALIDATION_FAILED, eligibility.message), 400);
		}

		const correlationId = randomUUID();
		const subscriber = redis.duplicate();
		const channel = `god-mode:reset:${correlationId}`;

		try {
			const stored = await storePendingReset(user.email, correlationId);
			if (!stored) {
				return c.json(
					errorResponse(
						ERROR_CODES.VALIDATION_FAILED,
						"A password reset link is already being generated for this user. Please try again shortly.",
					),
					400,
				);
			}

			const messagePromise = new Promise<{ resetUrl: string; email: string } | null>((resolve) => {
				let settled = false;
				const settle = (value: { resetUrl: string; email: string } | null) => {
					if (settled) {
						return;
					}
					settled = true;
					resolve(value);
				};
				const timeoutHandle = setTimeout(() => {
					settle(null);
				}, RESET_LINK_TIMEOUT_MS);

				subscriber.on("message", (ch, message) => {
					if (ch !== channel) {
						return;
					}
					clearTimeout(timeoutHandle);
					try {
						const parsed = JSON.parse(message);
						settle(parsed);
					} catch {
						settle(null);
					}
				});
			});

			await subscriber.subscribe(channel);

			await auth.api.requestPasswordReset({ body: { email: user.email } });

			const message = await messagePromise;

			if (!message?.resetUrl) {
				return c.json(
					errorResponse(ERROR_CODES.TIMEOUT, "Reset link capture timed out — please try again"),
					500,
				);
			}

			const response = createSuccessResult({
				email: message.email,
				resetUrl: message.resetUrl,
			});
			return c.json(response.body, response.status);
		} finally {
			await clearPendingReset(user.email, correlationId).catch((error) => {
				console.error("[god-mode] pending reset cleanup failed", error);
			});
			await subscriber.unsubscribe(channel).catch((error) => {
				console.error("[god-mode] subscriber unsubscribe failed", error);
			});
			await subscriber.quit().catch((error) => {
				console.error("[god-mode] subscriber quit failed", error);
			});
		}
	});

export { godModeApi };
