import { describe, expect, it } from "@effect/vitest";
import { ImpersonationAuthorization } from "@ryot-app/contract/oauth";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { HttpClient, HttpClientResponse, type HttpClientRequest } from "effect/unstable/http";

import { AdminApi, makeAdminApi } from "#/api/admin";
import { GodModeApi } from "#/api/god-mode";
import { decodeServerOrigin } from "#/api/origin";

const origin = decodeServerOrigin("https://ryot.example");

const authorization: ImpersonationAuthorization = {
	nonce: "nonce-1",
	state: "state-1",
	codeChallenge: "challenge-1",
	clientId: "ryot-impersonation-web",
	redirectUri: "https://ryot.example/auth/callback",
};

const request = { payload: authorization, params: { userId: UserId.make("user-1") } };

const startUserImpersonation = Effect.flatMap(GodModeApi, (api) =>
	api.startUserImpersonation(origin, "admin-secret", request),
);

describe("God Mode API", () => {
	it.live("sends an impersonation request through the admin contract client", () => {
		const seen: Array<{
			readonly url: string;
			readonly request: HttpClientRequest.HttpClientRequest;
		}> = [];
		const http = HttpClient.make((httpRequest, url) => {
			seen.push({ url: url.toString(), request: httpRequest });
			return Effect.succeed(
				HttpClientResponse.fromWeb(
					httpRequest,
					Response.json({ ticket: "handoff-ticket", expiresAt: 1_800_000_000_000 }),
				),
			);
		});
		const runtime = ManagedRuntime.make(
			GodModeApi.layer.pipe(
				Layer.provide(Layer.succeed(AdminApi, makeAdminApi(http, { download: () => Effect.void }))),
			),
		);

		return Effect.gen(function* () {
			expect(yield* Effect.promise(() => runtime.runPromise(startUserImpersonation))).toEqual({
				ticket: "handoff-ticket",
				expiresAt: 1_800_000_000_000,
			});

			expect(seen).toHaveLength(1);
			const sent = seen[0];
			expect(sent.url).toBe("https://ryot.example/api/god-mode/users/user-1/impersonate");
			expect(sent.request.method).toBe("POST");
			expect(sent.request.headers).toMatchObject({ "admin-access-token": "admin-secret" });
			const body = sent.request.body;
			expect(body._tag).toBe("Uint8Array");
			if (body._tag === "Uint8Array") {
				const payload = yield* Schema.decodeEffect(
					Schema.fromJsonString(ImpersonationAuthorization),
				)(new TextDecoder().decode(body.body));
				expect(payload).toEqual(authorization);
			}
		}).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
	});
});
