import { getOAuthEndpoint } from "@ryot/contract/oauth";
import { Data, Schema } from "effect";

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

export type OAuthFetch = typeof fetch;

export async function postOAuthFormRequest(
	fetcher: OAuthFetch,
	origin: ServerOrigin,
	path: string,
	body: URLSearchParams,
) {
	const response = await fetcher(getOAuthEndpoint(origin, path), {
		body,
		method: "POST",
		cache: "no-store",
		credentials: "omit",
		headers: { "content-type": "application/x-www-form-urlencoded" },
	});
	if (!response.ok) {
		const payload: unknown = await response.json();
		const decoded = Schema.decodeUnknownOption(OAuthErrorResponse)(payload);
		throw new OAuthEndpointError({
			status: response.status,
			code: decoded._tag === "Some" ? decoded.value.error : "server_error",
			...(decoded._tag === "Some" && decoded.value.error_description
				? { description: decoded.value.error_description }
				: {}),
		});
	}
	return response;
}

export async function postOAuthForm<A>(
	fetcher: OAuthFetch,
	origin: ServerOrigin,
	path: string,
	body: URLSearchParams,
	schema: Schema.Codec<A, unknown>,
) {
	const response = await postOAuthFormRequest(fetcher, origin, path, body);
	const payload: unknown = await response.json();
	return Schema.decodeUnknownSync(schema)(payload);
}
