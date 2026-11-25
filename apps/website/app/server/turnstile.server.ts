import { Context, Effect, Layer, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { getServerVariables } from "./config.server";

const TurnstileResponse = Schema.Struct({ success: Schema.Boolean });

export class Turnstile extends Context.Service<Turnstile>()(
	"@ryot-app/website/app/server/turnstile.server/Turnstile",
	{
		make: Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient;
			return {
				verify: Effect.fn(function* (request: Request, token: string) {
					const config = getServerVariables();
					const remoteip =
						request.headers.get("cf-connecting-ip")?.trim() ??
						request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
					const response = yield* HttpClientRequest.post(config.TURNSTILE_VERIFY_URL).pipe(
						HttpClientRequest.bodyUrlParams({
							remoteip,
							response: token,
							secret: config.TURNSTILE_SECRET_KEY,
						}),
						client.execute,
						Effect.flatMap(HttpClientResponse.schemaBodyJson(TurnstileResponse)),
					);
					return response.success;
				}),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const validateTurnstile = Effect.fn(function* (request: Request, token: string) {
	const turnstile = yield* Turnstile;
	const valid = yield* turnstile.verify(request, token).pipe(Effect.orElseSucceed(() => false));
	if (!valid) {
		return yield* Effect.fail(new Response(null, { status: 422 }));
	}
	return undefined;
});
