import {
	getMcpOAuthResource,
	getMcpResourceMetadataUrl,
	getOAuthEndpoint,
	getOAuthIssuer,
	OAUTH_CONSENT_DETAILS_PATH,
	OAUTH_MCP_SCOPES,
	OAUTH_TOKEN_PATH,
	OAuthConsentDetails,
	OAuthConsentDetailsRequest,
	OAuthTokenResponse,
} from "@ryot-app/contract/oauth";
import { Effect, Schema } from "effect";

import { createApiKey, createTestUser, prepareOAuth } from "~/fixtures/kernel/auth";
import { requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { getApiUrl, getFrontendUrl } from "~/support/harness-target";
import { webRequest } from "~/support/web-request";

const Registration = Schema.Struct({ client_id: Schema.String });
const Redirect = Schema.Struct({ url: Schema.String });
const Tools = Schema.Struct({
	result: Schema.Struct({
		tools: Schema.Array(
			Schema.Struct({
				name: Schema.String,
				annotations: Schema.Struct({ readOnlyHint: Schema.Boolean }),
			}),
		),
	}),
});
const CallResult = Schema.Struct({
	result: Schema.Struct({
		isError: Schema.optional(Schema.Boolean),
		content: Schema.Array(Schema.Struct({ text: Schema.String, type: Schema.Literal("text") })),
	}),
});

const postJson = (url: string, body: unknown, headers?: Record<string, string>) =>
	Effect.gen(function* () {
		return yield* webRequest(url, {
			method: "POST",
			headers: { "content-type": "application/json", ...headers },
			body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(body),
		});
	});
const rpc = (headers: Record<string, string>, method: string, params: unknown, session?: string) =>
	postJson(
		`${getApiUrl()}/mcp`,
		{ id: 1, method, params, jsonrpc: "2.0" },
		{
			...headers,
			accept: "application/json, text/event-stream",
			...(session ? { "mcp-session-id": session, "mcp-protocol-version": "2025-06-18" } : {}),
		},
	);
const resultBody = (response: Response) =>
	Effect.gen(function* () {
		const text = yield* Effect.promise(() => response.text());
		const frame = text.split("\n").find((line) => line.startsWith("data: "));
		return yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(
			frame ? frame.slice(6) : text,
		);
	});
const connect = (headers: Record<string, string>) =>
	Effect.gen(function* () {
		const response = yield* rpc(headers, "initialize", {
			capabilities: {},
			protocolVersion: "2025-06-18",
			clientInfo: { version: "1", name: "Ryot E2E" },
		});
		expect(response.status).toBe(200);
		yield* resultBody(response);
		return requirePresent(
			response.headers.get("mcp-session-id"),
			"MCP initialization omitted session",
		);
	});
const describeData = (headers: Record<string, string>, session: string) =>
	Effect.gen(function* () {
		const listed = yield* rpc(headers, "tools/list", {}, session);
		expect(listed.status).toBe(200);
		const tools = yield* Schema.decodeUnknownEffect(Tools)(yield* resultBody(listed));
		expect(tools.result.tools.map(({ name }) => name)).toEqual([
			"search",
			"execute",
			"read_docs",
			"page_write",
			"page_publish",
		]);
		expect(tools.result.tools.find(({ name }) => name === "search")?.annotations.readOnlyHint).toBe(
			true,
		);
		const called = yield* rpc(
			headers,
			"tools/call",
			{
				name: "execute",
				arguments: {
					code: 'return await ryot.call("kernel:data.describe", { limit: 50, namespace: "kernel", detail: "names" });',
				},
			},
			session,
		);
		expect(called.status).toBe(200);
		const result = yield* Schema.decodeUnknownEffect(CallResult)(yield* resultBody(called));
		expect(result.result.isError).not.toBe(true);
		expect(result.result.content[0]?.text).toContain("kernel:tables/entity");
	});

describe("MCP Streamable HTTP", () => {
	it.live(
		"discovers, lists and calls with an API key while isolating credentials and audiences",
		() =>
			Effect.gen(function* () {
				const origin = new URL(getApiUrl()).origin;
				const challenge = yield* rpc({}, "tools/list", {});
				expect(challenge.status).toBe(401);
				expect(challenge.headers.get("www-authenticate")).toContain(
					getMcpResourceMetadataUrl(getFrontendUrl()),
				);
				const metadata = yield* webRequest(getMcpResourceMetadataUrl(origin));
				expect(yield* Effect.promise(() => metadata.json())).toMatchObject({
					resource: getMcpOAuthResource(getFrontendUrl()),
					authorization_servers: [getOAuthIssuer(getFrontendUrl())],
				});
				const discovery = yield* webRequest(
					`${origin}/.well-known/oauth-authorization-server/api/auth`,
				);
				expect(discovery.status).toBe(200);
				expect(yield* Effect.promise(() => discovery.json())).toHaveProperty(
					"registration_endpoint",
				);
				const owner = yield* createTestUser();
				const key = yield* createApiKey(owner.sessionCookie);
				const headers = { "x-api-key": key };
				const session = yield* connect(headers);
				yield* describeData(headers, session);
				const other = yield* createTestUser();
				const otherKey = yield* createApiKey(other.sessionCookie);
				const foreign = yield* rpc({ "x-api-key": otherKey }, "tools/list", {}, session);
				expect(foreign.status).toBe(404);
				yield* Effect.promise(() => foreign.text());
				const wrongAudience = yield* rpc(
					{ Authorization: `Bearer ${owner.token}` },
					"tools/list",
					{},
				);
				expect(wrongAudience.status).toBe(401);
			}),
	);

	it.live(
		"registers a public OAuth client, requires consent, exchanges an MCP token and calls tools",
		() =>
			Effect.gen(function* () {
				const owner = yield* createTestUser();
				const pending = yield* prepareOAuth(getApiUrl());
				const registered = yield* postJson(`${getApiUrl()}/auth/oauth2/register`, {
					response_types: ["code"],
					client_name: "E2E MCP Client",
					scope: OAUTH_MCP_SCOPES.join(" "),
					token_endpoint_auth_method: "none",
					redirect_uris: ["https://client.example/callback"],
					grant_types: ["authorization_code", "refresh_token"],
				});
				expect(registered.status).toBe(201);
				const { client_id } = yield* Schema.decodeUnknownEffect(Registration)(
					yield* Effect.promise(() => registered.json()),
				);
				const authorize = new URL(pending.authorizationUrl);
				authorize.searchParams.set("client_id", client_id);
				authorize.searchParams.set("redirect_uri", "https://client.example/callback");
				authorize.searchParams.set("resource", getMcpOAuthResource(pending.frontendOrigin));
				authorize.searchParams.set("scope", OAUTH_MCP_SCOPES.join(" "));
				const begin = () =>
					webRequest(authorize, { redirect: "manual", headers: { cookie: owner.sessionCookie } });
				const response = yield* begin();
				const consent = new URL(
					requirePresent(response.headers.get("location"), "Missing consent redirect"),
					pending.serverOrigin,
				);
				expect(consent.pathname).toBe("/oauth/consent");
				const signed = consent.search.slice(1);
				const detailsResponse = yield* webRequest(
					getOAuthEndpoint(pending.serverOrigin, OAUTH_CONSENT_DETAILS_PATH),
					{
						method: "POST",
						headers: { cookie: owner.sessionCookie, "content-type": "application/json" },
						body: yield* Schema.encodeEffect(Schema.fromJsonString(OAuthConsentDetailsRequest))({
							oauth_query: signed,
						}),
					},
				);
				expect(detailsResponse.status).toBe(200);
				const details = yield* Schema.decodeUnknownEffect(OAuthConsentDetails)(
					yield* Effect.promise(() => detailsResponse.json()),
				);
				expect(details).toEqual({
					scope: "ryot:api",
					clientName: "E2E MCP Client",
					redirectOrigin: "https://client.example",
				});
				const decision = yield* postJson(
					`${getApiUrl()}/auth/oauth2/consent`,
					{ accept: true, oauth_query: signed },
					{ cookie: owner.sessionCookie },
				);
				expect(decision.status).toBe(200);
				const redirect = yield* Schema.decodeUnknownEffect(Redirect)(
					yield* Effect.promise(() => decision.json()),
				);
				const code = requirePresent(
					new URL(redirect.url).searchParams.get("code"),
					"Consent omitted code",
				);
				const exchanged = yield* webRequest(
					getOAuthEndpoint(pending.serverOrigin, OAUTH_TOKEN_PATH),
					{
						method: "POST",
						headers: { "content-type": "application/x-www-form-urlencoded" },
						body: new URLSearchParams({
							code,
							client_id,
							grant_type: "authorization_code",
							code_verifier: pending.codeVerifier,
							redirect_uri: "https://client.example/callback",
							resource: getMcpOAuthResource(pending.frontendOrigin),
						}),
					},
				);
				expect(exchanged.status).toBe(200);
				const tokens = yield* Schema.decodeUnknownEffect(OAuthTokenResponse)(
					yield* Effect.promise(() => exchanged.json()),
				);
				const headers = { Authorization: `Bearer ${tokens.access_token}` };
				yield* describeData(headers, yield* connect(headers));
				const refreshedResponse = yield* webRequest(
					getOAuthEndpoint(pending.serverOrigin, OAUTH_TOKEN_PATH),
					{
						method: "POST",
						headers: { "content-type": "application/x-www-form-urlencoded" },
						body: new URLSearchParams({
							client_id,
							grant_type: "refresh_token",
							resource: getMcpOAuthResource(pending.frontendOrigin),
							refresh_token: requirePresent(
								tokens.refresh_token,
								"offline_access did not issue a refresh token",
							),
						}),
					},
				);
				expect(refreshedResponse.status).toBe(200);
				const refreshed = yield* Schema.decodeUnknownEffect(OAuthTokenResponse)(
					yield* Effect.promise(() => refreshedResponse.json()),
				);
				const refreshedHeaders = { Authorization: `Bearer ${refreshed.access_token}` };
				yield* describeData(refreshedHeaders, yield* connect(refreshedHeaders));

				const genericApi = yield* webRequest(`${getApiUrl()}/ryotql/execute`, {
					headers,
					method: "POST",
				});
				expect(genericApi.status).toBe(401);
				const repeated = yield* begin();
				expect(
					new URL(
						requirePresent(repeated.headers.get("location"), "Missing repeated consent"),
						pending.serverOrigin,
					).pathname,
				).toBe("/oauth/consent");
			}),
	);
});
