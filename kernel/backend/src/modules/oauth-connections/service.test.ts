import { assert, describe, expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import type { OAuthConnectionClient } from "@ryot-app/contract/modules/oauth-connections/schemas";
import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import type { IntegrationId } from "@ryot-app/contract/schema/brands";
import { ImportRunId, OAuthConnectionId, UserId } from "@ryot-app/contract/schema/brands";
import { CryptoHasher } from "bun";
import { eq } from "drizzle-orm";
import {
	Cause,
	ConfigProvider,
	Context,
	Deferred,
	Effect,
	Exit,
	Fiber,
	Layer,
	Option,
	Ref,
} from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { ProKeyService } from "#lib/infrastructure/pro-key";
import { makeAppConfigLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { DataImportAdmission } from "#modules/imports/data-admission";
import { ImportsService } from "#modules/imports/service";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { IntegrationsService } from "#modules/integrations/service";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { IntegrationProviderCatalog } from "#modules/plugins/integration-provider-catalog";
import {
	installRevisionPackage,
	oauthRevisionPackage,
	revisionDatabaseLayer,
} from "#modules/plugins/revision.test-support";

import { OAuthConnectionsRepository } from "./repository";
import { OAUTH_ACCESS_TOKEN_MESSAGES, OAuthConnectionsService } from "./service";
import { OAuthTokenClient } from "./token-client";

const owner = UserId.make("owner");
const recipient = UserId.make("recipient");

const currentUser = (id: UserId): CurrentUserValue => ({
	id,
	image: null,
	name: "User",
	email: `${id}@example.test`,
	preferences: { language: null, disableIntegrations: false },
	accountGeneration: { userId: id, token: "test-account-generation" },
});

type TokenResponse = { readonly status: number; readonly body: unknown };

type RecordedTokenRequest = {
	readonly form: URLSearchParams;
	readonly authorization: string | undefined;
};

class FakeTokenEndpoint extends Context.Service<
	FakeTokenEndpoint,
	{
		readonly requests: Effect.Effect<ReadonlyArray<RecordedTokenRequest>>;
		readonly respond: (
			responder: (form: URLSearchParams) => Effect.Effect<TokenResponse>,
		) => Effect.Effect<void>;
		readonly handle: (request: RecordedTokenRequest) => Effect.Effect<TokenResponse>;
	}
>()("test/FakeTokenEndpoint") {}

const issuedTokens = (overrides: Record<string, unknown> = {}): TokenResponse => ({
	status: 200,
	body: {
		expires_in: 3600,
		token_type: "Bearer",
		access_token: "access-1",
		refresh_token: "refresh-1",
		...overrides,
	},
});

const fakeTokenEndpointLayer = Layer.effect(
	FakeTokenEndpoint,
	Effect.gen(function* () {
		const requests = yield* Ref.make<ReadonlyArray<RecordedTokenRequest>>([]);
		const responder = yield* Ref.make<(form: URLSearchParams) => Effect.Effect<TokenResponse>>(() =>
			Effect.succeed(issuedTokens()),
		);
		return {
			requests: Ref.get(requests),
			respond: (next) => Ref.set(responder, next),
			handle: (request) =>
				Ref.update(requests, (all) => [...all, request]).pipe(
					Effect.andThen(Ref.get(responder)),
					Effect.flatMap((respond) => respond(request.form)),
				),
		};
	}),
);

const fakeHttpClientLayer = Layer.effect(
	HttpClient.HttpClient,
	Effect.map(FakeTokenEndpoint, (endpoint) =>
		HttpClient.make((request) => {
			const form = new URLSearchParams(
				request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
			);
			return endpoint
				.handle({ form, authorization: request.headers["authorization"] })
				.pipe(
					Effect.map(({ body, status }) =>
						HttpClientResponse.fromWeb(request, Response.json(body, { status })),
					),
				);
		}),
	),
);

const serviceLayer = Layer.mergeAll(
	IntegrationsService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				IntegrationsRepository.layer,
				Layer.mock(DataImportAdmission)({}),
				Layer.mock(ImportsService)({}),
				Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
				Layer.mock(ProKeyService)({ isValidated: Effect.succeed(true) }),
			),
		),
	),
	IntegrationsRepository.layer,
).pipe(
	Layer.provideMerge(OAuthConnectionsService.layer),
	Layer.provideMerge(
		Layer.mergeAll(
			IntegrationProviderCatalog.layer,
			OAuthConnectionsRepository.layer,
			OAuthTokenClient.layer.pipe(Layer.provide(fakeHttpClientLayer)),
		),
	),
	Layer.provideMerge(fakeTokenEndpointLayer),
	Layer.provideMerge(makeAppConfigLayer()),
	Layer.provideMerge(revisionDatabaseLayer),
);

const environmentConfig = ConfigProvider.fromUnknown(
	Object.fromEntries(
		["oauth-test", "oauth-other"].flatMap((slug) => [
			[pluginConfigEnvironmentKey(slug, "clientId"), "client-1"],
			[pluginConfigEnvironmentKey(slug, "clientSecret"), "client-secret-1"],
		]),
	),
);

const installOAuthPlugin = (slug: string, integrationProviderSlug: string) =>
	installRevisionPackage(oauthRevisionPackage(slug, integrationProviderSlug)).pipe(
		Effect.provideService(ConfigProvider.ConfigProvider, environmentConfig),
	);

const fragmentOf = (location: string) => new URLSearchParams(location.split("#")[1] ?? "");

const authorize = Effect.fn(function* (
	user: UserId,
	options: { readonly field?: string; readonly client?: OAuthConnectionClient } = {},
) {
	const service = yield* OAuthConnectionsService;
	const created = yield* service.create(currentUser(user), {
		field: options.field ?? "account",
		integrationProvider: "oauth-yank",
		client: options.client ?? { kind: "web" },
	});
	const state = new URL(created.authorizeUrl).searchParams.get("state");
	assert(state);
	return { ...created, state };
});

const callback = (state: string, overrides: Record<string, string> = {}) =>
	Effect.flatMap(OAuthConnectionsService, (service) =>
		service.callback(
			{ pluginSlug: "oauth-test", oauthProviderSlug: "account" },
			{ state, code: "auth-code-1", ...overrides },
		),
	);

const connect = Effect.fn(function* (user: UserId, field = "account") {
	const service = yield* OAuthConnectionsService;
	const { state, connectionId } = yield* authorize(user, { field });
	const secret = fragmentOf(yield* callback(state)).get("secret");
	assert(secret);
	yield* service.complete(currentUser(user), connectionId, secret);
	return connectionId;
});

const createIntegration = (
	user: UserId,
	settings: Record<string, unknown>,
	provider = "oauth-yank",
) =>
	Effect.flatMap(IntegrationsService, (integrations) =>
		integrations.create(currentUser(user), { provider, providerSpecifics: settings }),
	);

const startRun = Effect.fn(function* (
	integrationId: IntegrationId,
	status: "completed" | "running" = "running",
) {
	const session = yield* DatabaseSession;
	const [integration] = yield* session.run((db) =>
		db.select().from(tables.integration).where(eq(tables.integration.id, integrationId)),
	);
	assert(integration);
	const runId = ImportRunId.make(`run-${crypto.randomUUID()}`);
	yield* session.run((db) =>
		db
			.insert(tables.importRun)
			.values({
				status,
				id: runId,
				integrationId,
				integrationLot: "yank",
				userId: integration.userId,
				source: integration.provider,
				pluginInstallationId: integration.pluginInstallationId,
			}),
	);
	return runId;
});

const connectionRow = (id: OAuthConnectionId) =>
	Effect.flatMap(DatabaseSession, (session) =>
		session.run((db) =>
			db.select().from(tables.oauthConnection).where(eq(tables.oauthConnection.id, id)),
		),
	).pipe(Effect.map(([row]) => row));

const connectionStatus = (user: UserId, id: OAuthConnectionId) =>
	Effect.flatMap(OAuthConnectionsService, (service) =>
		service.status(currentUser(user), id).pipe(Effect.map(({ status }) => status)),
	);

const accessToken = (input: {
	readonly pluginId: string;
	readonly integrationId: IntegrationId;
	readonly integrationRunId: ImportRunId;
	readonly userId?: UserId;
}) =>
	Effect.flatMap(OAuthConnectionsService, (service) =>
		service.accessTokenForIntegrationRun({ userId: owner, field: "account", ...input }),
	);

const connectedIntegration = Effect.fn(function* (tokens: TokenResponse = issuedTokens()) {
	const endpoint = yield* FakeTokenEndpoint;
	yield* endpoint.respond(() => Effect.succeed(tokens));
	const connectionId = yield* connect(owner);
	const { id: integrationId } = yield* createIntegration(owner, { account: connectionId });
	return { connectionId, integrationId, integrationRunId: yield* startRun(integrationId) };
});

const isolated = <A, E>(
	name: string,
	body: () => Effect.Effect<A, E, Layer.Success<typeof serviceLayer>>,
) => layer(serviceLayer)((test) => test.effect(name, body));

describe("OAuth connections", () => {
	isolated("connects an account and hands its access token to the running integration", () =>
		Effect.gen(function* () {
			const installed = yield* installOAuthPlugin("oauth-test", "oauth-yank");
			const service = yield* OAuthConnectionsService;
			const endpoint = yield* FakeTokenEndpoint;

			const { state, authorizeUrl, connectionId } = yield* authorize(owner);
			const authorizeParameters = new URL(authorizeUrl).searchParams;
			expect(authorizeUrl.startsWith("https://accounts.example.test/authorize?")).toBe(true);
			expect(Object.fromEntries(authorizeParameters)).toMatchObject({
				state,
				prompt: "consent",
				scope: "read offline",
				response_type: "code",
				client_id: "client-1",
				code_challenge_method: "S256",
				redirect_uri:
					"http://localhost:3000/api/oauth-connections/providers/oauth-test/account/callback",
			});
			expect(yield* connectionStatus(owner, connectionId)).toBe("pending");

			const location = yield* callback(state);
			expect(location.startsWith("http://localhost:3000/settings/oauth-return#")).toBe(true);
			expect(fragmentOf(location).get("connection")).toBe(connectionId);
			const secret = fragmentOf(location).get("secret");
			assert(secret);
			expect(location).not.toContain("auth-code-1");
			expect(yield* connectionStatus(owner, connectionId)).toBe("authorized");
			expect(yield* endpoint.requests).toEqual([]);

			expect(yield* service.complete(currentUser(owner), connectionId, secret)).toEqual({
				id: connectionId,
			});
			expect(yield* connectionStatus(owner, connectionId)).toBe("connected");
			const [exchange] = yield* endpoint.requests;
			assert(exchange);
			const verifier = exchange.form.get("code_verifier");
			assert(verifier);
			expect(
				Buffer.from(new CryptoHasher("sha256").update(verifier).digest()).toString("base64url"),
			).toBe(authorizeParameters.get("code_challenge"));
			expect(Object.fromEntries(exchange.form)).toEqual({
				code: "auth-code-1",
				code_verifier: verifier,
				grant_type: "authorization_code",
				redirect_uri: authorizeParameters.get("redirect_uri"),
			});
			expect(exchange.authorization).toBe(
				`Basic ${Buffer.from("client-1:client-secret-1").toString("base64")}`,
			);
			const stored = yield* connectionRow(connectionId);
			assert(stored);
			expect(stored.code).toBeNull();
			expect(stored.codeVerifier).toBeNull();
			expect(stored.completionSecretHash).toBeNull();
			for (const envelope of [stored.accessToken, stored.refreshToken]) {
				assert(envelope);
				expect(Buffer.from(envelope.ciphertext, "base64").toString()).not.toMatch(
					/access-1|refresh-1/,
				);
			}

			const { id: integrationId } = yield* createIntegration(owner, { account: connectionId });
			expect((yield* connectionRow(connectionId))?.integrationId).toBe(integrationId);
			expect((yield* connectionRow(connectionId))?.expiresAt).toBeNull();
			const integrationRunId = yield* startRun(integrationId);

			expect(
				yield* accessToken({ integrationId, integrationRunId, pluginId: installed.pluginId }),
			).toEqual({ accessToken: "access-1", expiresAt: "1970-01-01T01:00:00.000Z" });

			const client = yield* (yield* IntegrationsRepository).getClientForUser({
				userId: owner,
				integrationId,
			});
			expect(client?.providerSpecifics).toEqual({ account: connectionId });
		}),
	);

	isolated("refuses completion by another user or without the one-time secret", () =>
		Effect.gen(function* () {
			const installed = yield* installOAuthPlugin("oauth-test", "oauth-yank");
			yield* (yield* PluginInstallationRepository).upsertState({
				config: {},
				sortOrder: 0,
				health: "ready",
				isHidden: false,
				userId: recipient,
				pluginId: installed.pluginId,
			});
			const service = yield* OAuthConnectionsService;
			const endpoint = yield* FakeTokenEndpoint;
			const { state, connectionId } = yield* authorize(owner);
			const secret = fragmentOf(yield* callback(state)).get("secret");
			assert(secret);

			for (const attempt of [
				service.complete(currentUser(recipient), connectionId, secret),
				service.complete(currentUser(owner), connectionId, "guessed-secret"),
			]) {
				const exit = yield* Effect.exit(attempt);
				assert(Exit.isFailure(exit));
				expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject({
					_tag: "OAuthConnectionNotFoundError",
					reason: { code: "oauth-connection-not-found" },
				});
			}
			expect(
				Exit.isFailure(yield* Effect.exit(service.status(currentUser(recipient), connectionId))),
			).toBe(true);
			expect(yield* endpoint.requests).toEqual([]);
			expect(yield* connectionStatus(owner, connectionId)).toBe("authorized");

			yield* service.complete(currentUser(owner), connectionId, secret);
			const reused = yield* Effect.exit(service.complete(currentUser(owner), connectionId, secret));
			expect(Exit.isFailure(reused)).toBe(true);
			expect((yield* endpoint.requests).length).toBe(1);
		}),
	);

	isolated("consumes callback state once, before it expires, on its own provider path", () =>
		Effect.gen(function* () {
			yield* installOAuthPlugin("oauth-test", "oauth-yank");
			const service = yield* OAuthConnectionsService;
			const failedWeb = "http://localhost:3000/settings/oauth-return#status=failed";

			const reused = yield* authorize(owner);
			expect(fragmentOf(yield* callback(reused.state)).get("secret")).toBeTruthy();
			expect(yield* callback(reused.state)).toBe(failedWeb);

			const mismatched = yield* authorize(owner);
			const wrongPath = yield* service.callback(
				{ pluginSlug: "oauth-test", oauthProviderSlug: "other" },
				{ code: "auth-code-1", state: mismatched.state },
			);
			expect(Object.fromEntries(fragmentOf(wrongPath))).toEqual({
				status: "failed",
				connection: mismatched.connectionId,
			});
			expect(yield* connectionStatus(owner, mismatched.connectionId)).toBe("failed");
			expect(yield* callback(mismatched.state)).toBe(failedWeb);

			const denied = yield* authorize(owner);
			expect(
				fragmentOf(yield* callback(denied.state, { error: "access_denied" })).get("status"),
			).toBe("failed");

			const expired = yield* authorize(owner);
			yield* TestClock.adjust("11 minutes");
			expect(yield* callback(expired.state)).toBe(failedWeb);
			expect(yield* connectionStatus(owner, expired.connectionId)).toBe("expired");
		}),
	);

	isolated("returns native connections to the recorded application", () =>
		Effect.gen(function* () {
			yield* installOAuthPlugin("oauth-test", "oauth-yank");
			const { state, connectionId } = yield* authorize(owner, {
				client: { kind: "native", applicationId: "io.ryot.app.dev" },
			});
			const location = yield* callback(state);
			expect(location.startsWith("io.ryot.app.dev:/settings/oauth-return#")).toBe(true);
			expect(fragmentOf(location).get("connection")).toBe(connectionId);
			const failed = yield* callback(state);
			expect(failed).toBe("http://localhost:3000/settings/oauth-return#status=failed");
		}),
	);

	isolated("binds a connection only to its owner's integration, installation, and field", () =>
		Effect.gen(function* () {
			const installed = yield* installOAuthPlugin("oauth-test", "oauth-yank");
			yield* installOAuthPlugin("oauth-other", "oauth-other-yank");
			yield* (yield* PluginInstallationRepository).upsertState({
				config: {},
				sortOrder: 0,
				health: "ready",
				isHidden: false,
				userId: recipient,
				pluginId: installed.pluginId,
			});
			const connectionId = yield* connect(owner);
			const rejected = [
				createIntegration(recipient, { account: connectionId }),
				createIntegration(owner, { backup: connectionId }),
				createIntegration(owner, { account: connectionId }, "oauth-other-yank"),
				createIntegration(owner, { account: OAuthConnectionId.make("unknown-connection") }),
			];
			for (const attempt of rejected) {
				const exit = yield* Effect.exit(attempt);
				assert(Exit.isFailure(exit));
				expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject({
					_tag: "IntegrationRequestError",
					reason: { code: "invalid-provider-settings" },
				});
			}
			expect((yield* connectionRow(connectionId))?.integrationId).toBeNull();
			const session = yield* DatabaseSession;
			expect((yield* session.run((db) => db.select().from(tables.integration))).length).toBe(0);

			const { id: first } = yield* createIntegration(owner, { account: connectionId });
			const second = yield* Effect.exit(createIntegration(owner, { account: connectionId }));
			expect(Exit.isFailure(second)).toBe(true);
			expect((yield* connectionRow(connectionId))?.integrationId).toBe(first);

			const replacement = yield* connect(owner);
			yield* (yield* IntegrationsService).update(owner, first, {
				providerSpecifics: { account: replacement },
			});
			expect((yield* connectionRow(replacement))?.integrationId).toBe(first);
			expect(yield* connectionRow(connectionId)).toBeUndefined();
		}),
	);

	isolated("serves tokens only to a running run of the integration's own plugin", () =>
		Effect.gen(function* () {
			const installed = yield* installOAuthPlugin("oauth-test", "oauth-yank");
			const other = yield* installOAuthPlugin("oauth-other", "oauth-other-yank");
			const { integrationId, integrationRunId } = yield* connectedIntegration();
			const { id: siblingIntegrationId } = yield* createIntegration(owner, {});
			const siblingRunId = yield* startRun(siblingIntegrationId);
			const finishedRunId = yield* startRun(integrationId, "completed");
			for (const input of [
				{ integrationId, integrationRunId, pluginId: other.pluginId },
				{ integrationId, pluginId: installed.pluginId, integrationRunId: finishedRunId },
				{ integrationId, pluginId: installed.pluginId, integrationRunId: siblingRunId },
				{ integrationId, integrationRunId, userId: recipient, pluginId: installed.pluginId },
			]) {
				const exit = yield* Effect.exit(accessToken(input));
				assert(Exit.isFailure(exit));
				expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject({
					message: OAUTH_ACCESS_TOKEN_MESSAGES.unavailable,
				});
			}
			expect(
				(yield* accessToken({ integrationId, integrationRunId, pluginId: installed.pluginId }))
					.accessToken,
			).toBe("access-1");
		}),
	);

	isolated("refreshes once under a shared lease and persists the rotated refresh token", () =>
		Effect.gen(function* () {
			const installed = yield* installOAuthPlugin("oauth-test", "oauth-yank");
			const endpoint = yield* FakeTokenEndpoint;
			const run = yield* connectedIntegration(issuedTokens({ expires_in: 30 }));
			const input = { ...run, pluginId: installed.pluginId };
			const entered = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			yield* endpoint.respond((form) =>
				Deferred.succeed(entered, undefined).pipe(
					Effect.andThen(Deferred.await(release)),
					Effect.as(
						issuedTokens({
							access_token: `access-for-${form.get("refresh_token")}`,
							refresh_token: `rotated-from-${form.get("refresh_token")}`,
						}),
					),
				),
			);

			const first = yield* Effect.forkChild(accessToken(input));
			yield* Deferred.await(entered);
			const second = yield* Effect.forkChild(accessToken(input));
			yield* Deferred.succeed(release, undefined);
			expect((yield* Fiber.join(first)).accessToken).toBe("access-for-refresh-1");
			while (second.pollUnsafe() === undefined) {
				yield* TestClock.adjust("250 millis");
				yield* TestClock.withLive(Effect.sleep("5 millis"));
			}
			expect((yield* Fiber.join(second)).accessToken).toBe("access-for-refresh-1");

			yield* TestClock.adjust("2 hours");
			expect((yield* accessToken(input)).accessToken).toBe("access-for-rotated-from-refresh-1");
			expect(
				(yield* endpoint.requests).map(({ form }) => form.get("refresh_token") ?? form.get("code")),
			).toEqual(["auth-code-1", "refresh-1", "rotated-from-refresh-1"]);
		}),
	);

	isolated("expires a connection whose refresh grant is rejected", () =>
		Effect.gen(function* () {
			const installed = yield* installOAuthPlugin("oauth-test", "oauth-yank");
			const endpoint = yield* FakeTokenEndpoint;
			const run = yield* connectedIntegration(issuedTokens({ expires_in: 30 }));
			yield* endpoint.respond(() =>
				Effect.succeed({ status: 400, body: { error: "invalid_grant" } }),
			);
			for (let attempt = 0; attempt < 2; attempt += 1) {
				const exit = yield* Effect.exit(accessToken({ ...run, pluginId: installed.pluginId }));
				assert(Exit.isFailure(exit));
				expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject({
					message: OAUTH_ACCESS_TOKEN_MESSAGES.expired,
				});
			}
			expect((yield* endpoint.requests).length).toBe(2);
			expect(yield* connectionStatus(owner, run.connectionId)).toBe("expired");
			const stored = yield* connectionRow(run.connectionId);
			expect(stored?.refreshToken).toBeNull();
			expect(stored?.accessToken).toBeNull();
		}),
	);
});
