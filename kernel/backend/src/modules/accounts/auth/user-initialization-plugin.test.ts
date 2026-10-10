import { expect, it } from "@effect/vitest";
import { getTestInstance } from "better-auth/test";
import { Effect } from "effect";

import { userInitializationPlugin } from "./user-initialization-plugin";

const bootstrapCompletedAt = new Date("2026-09-28T00:00:00.000Z");

const makeAuth = () =>
	getTestInstance({
		plugins: [userInitializationPlugin()],
		user: {
			additionalFields: { bootstrapCompletedAt: { type: "date", input: false, required: false } },
		},
	});

const requestStatus = (auth: Awaited<ReturnType<typeof makeAuth>>["auth"], headers?: Headers) =>
	auth.handler(
		new Request(
			"http://localhost:3000/api/auth/initialization-status",
			headers ? { headers } : undefined,
		),
	);

it.effect("returns 401 when no user is authenticated", () =>
	Effect.gen(function* () {
		const { auth } = yield* Effect.promise(makeAuth);
		const response = yield* Effect.promise(() => requestStatus(auth));

		expect(response.status).toBe(401);
		expect(yield* Effect.promise(() => response.json())).toEqual({
			code: "AUTHENTICATION_REQUIRED",
			message: "Authentication is required.",
		});
	}),
);

it.effect("reports initializing until user bootstrap is complete", () =>
	Effect.gen(function* () {
		const instance = yield* Effect.promise(makeAuth);
		const { user, headers } = yield* Effect.promise(instance.signInWithTestUser);

		const pending = yield* Effect.promise(() => requestStatus(instance.auth, headers));
		expect(pending.status).toBe(200);
		expect(yield* Effect.promise(() => pending.json())).toEqual({ status: "initializing" });

		yield* Effect.promise(() =>
			instance.db.update({
				model: "user",
				update: { bootstrapCompletedAt },
				where: [{ field: "id", value: user.id }],
			}),
		);

		const ready = yield* Effect.promise(() => requestStatus(instance.auth, headers));
		expect(ready.status).toBe(200);
		expect(yield* Effect.promise(() => ready.json())).toEqual({ status: "ready" });
	}),
);
