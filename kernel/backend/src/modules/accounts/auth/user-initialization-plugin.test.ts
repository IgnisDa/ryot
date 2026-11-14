import { expect } from "bun:test";

import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { applySetCookies } from "better-auth/cookies";
import { Effect } from "effect";

import { userInitializationPlugin } from "./user-initialization-plugin";

const bootstrapCompletedAt = new Date("2026-09-28T00:00:00.000Z");

const makeAuth = () =>
	betterAuth({
		rateLimit: { enabled: false },
		baseURL: "http://localhost:3000",
		emailAndPassword: { enabled: true },
		plugins: [userInitializationPlugin()],
		secret: "initialization-test-secret-with-at-least-32-characters",
		database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
		user: {
			additionalFields: { bootstrapCompletedAt: { type: "date", input: false, required: false } },
		},
	});

const requestStatus = (auth: ReturnType<typeof makeAuth>, headers?: Headers) =>
	auth.handler(
		new Request(
			"http://localhost:3000/api/auth/initialization-status",
			headers ? { headers } : undefined,
		),
	);

it.effect(
	"returns 401 when no user is authenticated",
	() =>
		Effect.gen(function* () {
			const auth = yield* Effect.sync(makeAuth);
			const response = yield* Effect.promise(() => requestStatus(auth));

			expect(response.status).toBe(401);
			expect(yield* Effect.promise(() => response.json())).toEqual({
				code: "AUTHENTICATION_REQUIRED",
				message: "Authentication is required.",
			});
		}),
	testTimeout,
);

it.effect(
	"reports initializing until user bootstrap is complete",
	() =>
		Effect.gen(function* () {
			const auth = yield* Effect.sync(makeAuth);
			const signup = yield* Effect.promise(() =>
				auth.api.signUpEmail({
					returnHeaders: true,
					body: { name: "Test user", email: "user@example.com", password: "test-password-123" },
				}),
			);
			const headers = new Headers();
			applySetCookies(headers, signup.headers.getSetCookie());

			const pending = yield* Effect.promise(() => requestStatus(auth, headers));
			expect(pending.status).toBe(200);
			expect(yield* Effect.promise(() => pending.json())).toEqual({ status: "initializing" });

			const context = yield* Effect.promise(() => auth.$context);
			yield* Effect.promise(() =>
				context.adapter.update({
					model: "user",
					update: { bootstrapCompletedAt },
					where: [{ field: "id", value: signup.response.user.id }],
				}),
			);

			const ready = yield* Effect.promise(() => requestStatus(auth, headers));
			expect(ready.status).toBe(200);
			expect(yield* Effect.promise(() => ready.json())).toEqual({ status: "ready" });
		}),
	testTimeout,
);
