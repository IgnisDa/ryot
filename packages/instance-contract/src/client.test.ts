import { expect } from "bun:test";

import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { makeInstanceAdminClient } from "./client";
import { UserId } from "./user";

it.effect("provisions a user through the scoped admin API", () =>
	Effect.gen(function* () {
		const userId = UserId.make("provisioned-user");
		const transport = HttpClient.make((request, url) =>
			Effect.sync(() => {
				expect(url.href).toBe("https://app.example.test/api/instance-admin/users/provision");
				expect(request.method).toBe("POST");
				expect(request.headers["admin-access-token"]).toBe("admin-fixture");
				return HttpClientResponse.fromWeb(request, Response.json({ userId }, { status: 201 }));
			}),
		);
		const result = yield* Effect.gen(function* () {
			const client = yield* makeInstanceAdminClient(
				"https://app.example.test/api",
				"admin-fixture",
			);
			return yield* client.instanceAdmin.provisionUser({
				payload: { name: "User", provider: "credential", email: "user@example.test" },
			});
		}).pipe(Effect.provideService(HttpClient.HttpClient, transport));
		expect(result.userId).toBe(userId);
	}),
);
