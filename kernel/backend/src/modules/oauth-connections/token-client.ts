import type { PluginOAuthProvider } from "@ryot-app/contract/modules/plugins/manifest";
import { Context, Data, Duration, Effect, Layer, Option, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import { readSandboxByteLimitedText } from "#lib/infrastructure/sandbox-runtime/stream-utils";

const OAUTH_TOKEN_REQUEST_TIMEOUT = Duration.seconds(10);

export const OAUTH_TOKEN_RESPONSE_MAX_BYTES = 64 * 1024;

type OAuthClientCredentials = { readonly clientId: string; readonly clientSecret: string };

type OAuthTokenGrant =
	| {
			readonly code: string;
			readonly redirectUri: string;
			readonly codeVerifier?: string;
			readonly grantType: "authorization_code";
	  }
	| { readonly refreshToken: string; readonly grantType: "refresh_token" };

export class OAuthTokenEndpointError extends Data.TaggedError("OAuthTokenEndpointError")<{
	readonly reason: "failed" | "invalid-grant";
}> {}

const TokenResponse = Schema.Struct({
	token_type: Schema.String,
	access_token: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	expires_in: Schema.optional(Schema.Finite.pipe(Schema.check(Schema.isGreaterThan(0)))),
	refresh_token: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMinLength(1)))),
});

const TokenErrorResponse = Schema.Struct({ error: Schema.String });

const decodeTokenResponse = Schema.decodeUnknownOption(Schema.fromJsonString(TokenResponse));
const decodeTokenErrorResponse = Schema.decodeUnknownOption(
	Schema.fromJsonString(TokenErrorResponse),
);

const DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS = 3600;

const formEncode = (value: string) => encodeURIComponent(value).replaceAll("%20", "+");

const grantParameters = (grant: OAuthTokenGrant): Record<string, string> =>
	grant.grantType === "authorization_code"
		? {
				code: grant.code,
				grant_type: grant.grantType,
				redirect_uri: grant.redirectUri,
				...(grant.codeVerifier === undefined ? {} : { code_verifier: grant.codeVerifier }),
			}
		: { grant_type: grant.grantType, refresh_token: grant.refreshToken };

const failed = (reason: OAuthTokenEndpointError["reason"], logged: Record<string, unknown>) =>
	Effect.logWarning("OAuth token endpoint request failed").pipe(
		Effect.annotateLogs({ reason, ...logged }),
		Effect.andThen(Effect.fail(new OAuthTokenEndpointError({ reason }))),
	);

export class OAuthTokenClient extends Context.Service<OAuthTokenClient>()("OAuthTokenClient", {
	make: Effect.gen(function* () {
		const httpClient = yield* HttpClient.HttpClient;
		const requestToken = Effect.fn("OAuthTokenClient.requestToken")(function* (
			provider: PluginOAuthProvider,
			credentials: OAuthClientCredentials,
			grant: OAuthTokenGrant,
		) {
			const tokenUrl = new URL(provider.tokenUrl);
			if (tokenUrl.protocol !== "https:") {
				return yield* failed("failed", { stage: "url", provider: provider.slug });
			}
			const body = new URLSearchParams(grantParameters(grant));
			const headers: Record<string, string> = { accept: "application/json" };
			if (provider.tokenEndpointAuth === "client_secret_basic") {
				headers["authorization"] =
					`Basic ${Buffer.from(`${formEncode(credentials.clientId)}:${formEncode(credentials.clientSecret)}`).toString("base64")}`;
			} else {
				body.set("client_id", credentials.clientId);
				body.set("client_secret", credentials.clientSecret);
			}
			const request = HttpClientRequest.post(tokenUrl).pipe(
				HttpClientRequest.setHeaders(headers),
				HttpClientRequest.bodyText(body.toString(), "application/x-www-form-urlencoded"),
			);
			const exchanged = yield* httpClient.execute(request).pipe(
				Effect.flatMap((response) =>
					readSandboxByteLimitedText(
						response.stream,
						OAUTH_TOKEN_RESPONSE_MAX_BYTES,
						"oversized" as const,
					).pipe(Effect.map((text) => ({ text, status: response.status }))),
				),
				Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
				Effect.timeout(OAUTH_TOKEN_REQUEST_TIMEOUT),
				Effect.option,
			);
			if (Option.isNone(exchanged)) {
				return yield* failed("failed", { stage: "transport", provider: provider.slug });
			}
			const { text, status } = exchanged.value;
			if (status < 200 || status >= 300) {
				const error = Option.getOrUndefined(decodeTokenErrorResponse(text))?.error;
				return yield* failed(error === "invalid_grant" ? "invalid-grant" : "failed", {
					status,
					stage: "response",
					provider: provider.slug,
				});
			}
			const token = Option.getOrUndefined(decodeTokenResponse(text));
			if (token?.token_type.toLowerCase() !== "bearer") {
				return yield* failed("failed", { status, stage: "decode", provider: provider.slug });
			}
			return {
				accessToken: token.access_token,
				refreshToken: token.refresh_token ?? null,
				expiresInSeconds:
					token.expires_in ??
					provider.accessTokenLifetimeSeconds ??
					DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS,
			};
		});

		return { requestToken };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
