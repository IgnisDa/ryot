import { getOAuthEndpoint } from "@ryot-app/contract/oauth";
import { Data, Effect, Schema } from "effect";

import type { ServerOrigin } from "#/api/origin";

const OAuthErrorResponse = Schema.Struct({
	error: Schema.String,
	error_description: Schema.optional(Schema.String),
});

export class OAuthEndpointError extends Data.TaggedError("OAuthEndpointError")<{
	readonly code: string;
	readonly status: number;
	readonly description?: string;
}> {}

export class OAuthTransportError extends Data.TaggedError("OAuthTransportError")<{
	readonly cause: unknown;
}> {}

export type OAuthFetch = typeof fetch;

const readJson = (response: Response) =>
	Effect.tryPromise({
		try: () => response.json() as Promise<unknown>,
		catch: (cause) => new OAuthTransportError({ cause }),
	});

const endpointError = (status: number, payload: unknown) => {
	const decoded = Schema.decodeUnknownOption(OAuthErrorResponse)(payload);
	return new OAuthEndpointError({
		status,
		code: decoded._tag === "Some" ? decoded.value.error : "server_error",
		...(decoded._tag === "Some" && decoded.value.error_description
			? { description: decoded.value.error_description }
			: {}),
	});
};

export const postOAuthFormRequest = (
	fetcher: OAuthFetch,
	origin: ServerOrigin,
	path: string,
	body: URLSearchParams,
) =>
	Effect.gen(function* () {
		const response = yield* Effect.tryPromise({
			catch: (cause) => new OAuthTransportError({ cause }),
			try: () =>
				fetcher(getOAuthEndpoint(origin, path), {
					body,
					method: "POST",
					cache: "no-store",
					credentials: "omit",
					headers: { "content-type": "application/x-www-form-urlencoded" },
				}),
		});
		if (response.ok) {
			return response;
		}
		const payload = yield* readJson(response).pipe(Effect.catch(() => Effect.succeed(undefined)));
		return yield* endpointError(response.status, payload);
	});

export const postOAuthForm = <A>(
	fetcher: OAuthFetch,
	origin: ServerOrigin,
	path: string,
	body: URLSearchParams,
	schema: Schema.Codec<A, unknown>,
) =>
	Effect.gen(function* () {
		const response = yield* postOAuthFormRequest(fetcher, origin, path, body);
		const payload = yield* readJson(response);
		return yield* Schema.decodeUnknownEffect(schema)(payload);
	});
