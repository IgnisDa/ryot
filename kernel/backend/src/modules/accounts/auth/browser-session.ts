import {
	BROWSER_SESSION_HEADER,
	BROWSER_SESSION_PATH,
	BrowserSessionExchange,
	getOAuthEndpoint,
	getOAuthResource,
	getWebOAuthCallbackUri,
	getWebOAuthLogoutCallbackUri,
	IMPERSONATION_SESSION_TTL_SECONDS,
	OAUTH_IMPERSONATION_WEB_CLIENT_ID,
	OAUTH_REFRESH_TOKEN_TTL_SECONDS,
	OAUTH_TOKEN_PATH,
	OAuthTokenResponse,
	WebOAuthClientId,
	WriteAccess,
} from "@ryot-app/contract/oauth";
import { AuthUnauthorized } from "@ryot-app/instance-contract/admin-auth";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { parseCookies } from "better-auth/cookies";
import { Clock, Effect, Schema } from "effect";

import { generateOpaqueTicket, isOpaqueTicket } from "#platform/http/opaque-tickets";
import type { TransientValues } from "#platform/transient-values";

import type { AuthRepository } from "./repository";
import type { ResolvedCredential } from "./service";

const Grant = Schema.Struct({
	userId: Schema.String,
	sessionId: Schema.String,
	writeAccess: WriteAccess,
	clientId: WebOAuthClientId,
});

const grantJson = Schema.fromJsonString(Grant);
const nonceJson = Schema.fromJsonString(Schema.Struct({ nonce: Schema.String }));
const unauthorized = () => new AuthUnauthorized({ reason: { code: "authentication-required" } });
const grantKey = (ticket: string) => `auth:browser-session:${sha256Hex(ticket)}`;
const mutation = (method: string) => !["GET", "HEAD", "OPTIONS"].includes(method);

const reply = (status: number, body?: unknown, cookies: ReadonlyArray<string> = []) => {
	const headers = new Headers({ "cache-control": "no-store", "x-content-type-options": "nosniff" });
	for (const value of cookies) {
		headers.append("set-cookie", value);
	}
	return body === undefined
		? new Response(null, { status, headers })
		: Response.json(body, { status, headers });
};

export const makeBrowserSessions = (options: {
	readonly origin: string;
	readonly values: TransientValues["Service"];
	readonly exchange: (request: Request) => Promise<Response>;
	readonly findSession: AuthRepository["Service"]["findSession"];
	readonly verify: (token: string) => Effect.Effect<ResolvedCredential, unknown>;
	readonly endSession: (
		headers: Headers,
		sessionId: string,
	) => Effect.Effect<ReadonlyArray<string>>;
}) => {
	const { origin, values } = options;
	const secure = new URL(origin).protocol === "https:";
	const cookieName = secure ? "__Host-ryot-session" : "ryot-session";
	const cookie = (ticket: string, maxAge: number) =>
		`${cookieName}=${ticket}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
	const ticketFrom = (headers: Headers) => {
		const ticket = parseCookies(headers.get("cookie") ?? "").get(cookieName);
		return ticket !== undefined && isOpaqueTicket(ticket) ? ticket : null;
	};

	const allowed = (headers: Headers, method: string) => {
		const supplied = headers.get("origin");
		const site = headers.get("sec-fetch-site");
		return (
			supplied === origin ||
			(!mutation(method) && supplied === null && site !== "same-site" && site !== "cross-site")
		);
	};

	const read = Effect.fn("BrowserSessions.read")(function* (headers: Headers, method: string) {
		const ticket = ticketFrom(headers);
		if (ticket === null || !allowed(headers, method)) {
			return yield* unauthorized();
		}
		const id = sha256Hex(ticket);
		const expected = headers.get(BROWSER_SESSION_HEADER);
		if (expected !== null && expected !== id) {
			return yield* unauthorized();
		}
		const encoded = yield* values.get(grantKey(ticket)).pipe(Effect.orDie);
		if (encoded === null) {
			return yield* unauthorized();
		}
		const grant = yield* Schema.decodeEffect(grantJson)(encoded).pipe(
			Effect.mapError(unauthorized),
		);
		const session = yield* options.findSession(grant.sessionId).pipe(Effect.orDie);
		if (
			session?.userId !== grant.userId ||
			session.disabledAt ||
			session.expiresAt.getTime() <= (yield* Clock.currentTimeMillis)
		) {
			return yield* unauthorized();
		}
		return { id, grant, ticket };
	});

	const establish = Effect.fn("BrowserSessions.establish")(function* (request: Request) {
		if (
			request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
			"application/json"
		) {
			return reply(415);
		}
		const input = yield* Effect.tryPromise({
			catch: unauthorized,
			try: (): Promise<unknown> => request.json(),
		}).pipe(Effect.flatMap(Schema.decodeUnknownEffect(BrowserSessionExchange)), Effect.option);
		if (input._tag === "None") {
			return reply(400);
		}
		const { code, nonce, clientId, codeVerifier } = input.value;
		const exchange = yield* Effect.promise(() =>
			options.exchange(
				new Request(getOAuthEndpoint(origin, OAUTH_TOKEN_PATH), {
					method: "POST",
					body: new URLSearchParams({
						code,
						client_id: clientId,
						code_verifier: codeVerifier,
						grant_type: "authorization_code",
						resource: getOAuthResource(origin),
						redirect_uri: getWebOAuthCallbackUri(origin),
					}),
				}),
			),
		);
		if (!exchange.ok) {
			return reply(401);
		}
		const tokens = yield* Effect.tryPromise({
			catch: unauthorized,
			try: (): Promise<unknown> => exchange.json(),
		}).pipe(Effect.flatMap(Schema.decodeUnknownEffect(OAuthTokenResponse)), Effect.option);
		if (tokens._tag === "None") {
			return reply(401);
		}
		const payload = tokens.value.id_token?.split(".")[1];
		const claims =
			payload === undefined
				? undefined
				: Schema.decodeOption(nonceJson)(Buffer.from(payload, "base64url").toString("utf8"));
		if (claims?._tag !== "Some" || claims.value.nonce !== nonce) {
			return reply(401);
		}
		const account = yield* options.verify(tokens.value.access_token).pipe(Effect.option);
		if (account._tag === "None") {
			return reply(401);
		}
		const { user, authorization } = account.value;
		const { credential, writeAccess } = authorization;
		if (
			credential.kind !== "oauth" ||
			credential.clientId !== clientId ||
			credential.sessionId === undefined
		) {
			return reply(401);
		}
		const ttl =
			clientId === OAUTH_IMPERSONATION_WEB_CLIENT_ID
				? IMPERSONATION_SESSION_TTL_SECONDS
				: OAUTH_REFRESH_TOKEN_TTL_SECONDS;
		const ticket = generateOpaqueTicket();
		const grant = yield* Schema.encodeEffect(grantJson)({
			clientId,
			writeAccess,
			userId: user.id,
			sessionId: credential.sessionId,
		}).pipe(Effect.orDie);
		const previous = ticketFrom(request.headers);
		yield* Effect.uninterruptible(
			values
				.set(grantKey(ticket), grant, ttl * 1000)
				.pipe(
					Effect.andThen(previous === null ? Effect.void : values.remove(grantKey(previous))),
					Effect.orDie,
				),
		);
		return reply(204, undefined, [cookie(ticket, ttl)]);
	});

	const handle = Effect.fn("BrowserSessions.handle")(function* (
		request: Request,
		resolve: (grant: typeof Grant.Type) => Effect.Effect<ResolvedCredential, unknown>,
	) {
		const { method, headers } = request;
		if (!allowed(headers, method)) {
			return reply(403);
		}
		if (method === "POST") {
			return yield* establish(request);
		}
		if (method !== "GET" && method !== "DELETE") {
			return reply(405);
		}
		const session = yield* read(headers, method).pipe(Effect.option);
		if (session._tag === "None") {
			return reply(401);
		}
		const { id, grant, ticket } = session.value;
		if (method === "DELETE") {
			const cookies = yield* options.endSession(headers, grant.sessionId);
			yield* values.remove(grantKey(ticket)).pipe(Effect.orDie);
			const logout = new URL(getWebOAuthLogoutCallbackUri(origin));
			if (grant.clientId === OAUTH_IMPERSONATION_WEB_CLIENT_ID) {
				logout.searchParams.set("state", "impersonation");
			}
			return reply(200, { url: logout.toString() }, [cookie("", 0), ...cookies]);
		}
		const account = yield* resolve(grant).pipe(Effect.option);
		if (account._tag === "None") {
			return reply(401);
		}
		const { user, authorization } = account.value;
		return reply(200, {
			session: id,
			sub: user.id,
			name: user.name,
			email: user.email,
			picture: user.image,
			accessClass: authorization.accessClass,
			impersonation: authorization.impersonation,
		});
	});

	return { read, handle };
};

export const isBrowserSessionRequest = (request: Request) =>
	new URL(request.url).pathname === BROWSER_SESSION_PATH;
