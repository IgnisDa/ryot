import { BunServices } from "@effect/platform-bun";
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
	DateTime,
	Deferred,
	Effect,
	Exit,
	Fiber,
	Layer,
	Option,
	Ref,
} from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { HmacSigner } from "#lib/infrastructure/hmac-signer";
import { LocalStorageService } from "#lib/infrastructure/local-storage";
import { ProKeyService } from "#lib/infrastructure/pro-key";
import { S3Service } from "#lib/infrastructure/s3";
import { makeAppConfigLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { ingestionRetirementTestLayer } from "#lib/test-utils/ingestion-retirement";
import { integrationCrudIngestionLayer } from "#lib/test-utils/integration-crud";
import { DataImportAdmission } from "#modules/imports/data-admission";
import { ImportsRepository } from "#modules/imports/repository";
import { ImportsService } from "#modules/imports/service";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { IntegrationsService } from "#modules/integrations/service";
import { AdmittedWorkflowCatalogue } from "#modules/mutations/workflow-catalogue";
import { PluginConfigRevisions } from "#modules/plugins/config-revisions";
import { ImportSourceCatalog } from "#modules/plugins/import-source-catalog";
import { IngestionReadinessService } from "#modules/plugins/ingestion-readiness-service";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { IntegrationProviderCatalog } from "#modules/plugins/integration-provider-catalog";
import { PluginRepository } from "#modules/plugins/repository";
import {
	installRevisionPackage,
	oauthRevisionPackage,
	revisionDatabaseLayer,
} from "#modules/plugins/revision.test-support";
import { ObjectStorageService } from "#modules/uploads/object-storage/service";

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

const serviceLayer = (isProKeyValidated = true) =>
	Layer.mergeAll(
		IntegrationsService.layer.pipe(
			Layer.provide(
				Layer.mergeAll(
					IntegrationsRepository.layer,
					ImportsRepository.layer,
					integrationCrudIngestionLayer.pipe(
						Layer.provideMerge(ingestionRetirementTestLayer),
						Layer.provide(ObjectStorageService.layer),
						Layer.provide(Layer.succeed(AdmittedWorkflowCatalogue, Object.freeze([]))),
						Layer.provide(
							Layer.mergeAll(
								S3Service.layer,
								LocalStorageService.layer.pipe(Layer.provide(HmacSigner.layer)),
							),
						),
						Layer.provide(BunServices.layer),
						Layer.provide(Layer.succeed(WorkflowEngine, makeWorkflowEngine())),
					),
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
		Layer.provideMerge(Layer.effect(IngestionReadinessService, IngestionReadinessService.make)),
		Layer.provideMerge(
			Layer.mergeAll(
				ImportSourceCatalog.layer,
				IntegrationProviderCatalog.layer,
				OAuthConnectionsRepository.layer,
				OAuthTokenClient.layer.pipe(Layer.provide(fakeHttpClientLayer)),
			),
		),
		Layer.provideMerge(fakeTokenEndpointLayer),
		Layer.provideMerge(
			Layer.mock(ProKeyService)({ isValidated: Effect.succeed(isProKeyValidated) }),
		),
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

const installOAuthPlugin = (
	slug: string,
	integrationProviderSlug: string,
	options: Parameters<typeof oauthRevisionPackage>[2] = {},
) =>
	installRevisionPackage(oauthRevisionPackage(slug, integrationProviderSlug, options)).pipe(
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
	assert(integration.pluginInstallationId);
	const resolved = yield* (yield* IntegrationProviderCatalog).resolveOwnedForUser(
		UserId.make(integration.userId),
		integration.provider,
		integration.pluginInstallationId,
	);
	assert(resolved?.script);
	const runId = ImportRunId.make(`run-${crypto.randomUUID()}`);
	const pins = {
		executionId: runId,
		scriptId: resolved.script.id,
		pluginRevisionId: resolved.provider.configContext.pluginRevisionId,
		pluginConfigRevisionId: resolved.provider.configContext.pluginConfigRevisionId,
	};
	yield* session.run((db) =>
		db
			.insert(tables.importRun)
			.values({
				pins,
				status,
				id: runId,
				integrationId,
				integrationLot: "yank",
				userId: integration.userId,
				source: integration.provider,
				accountGeneration: "test-account-generation",
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
	readonly connectionId: OAuthConnectionId;
	readonly pluginId: string;
	readonly integrationId: IntegrationId;
	readonly integrationRunId: ImportRunId;
	readonly userId?: UserId;
}) =>
	Effect.flatMap(OAuthConnectionsService, (service) =>
		service.accessTokenForIntegrationRun({ userId: owner, field: "account", ...input }),
	);

const invalidateAccessToken = (input: {
	readonly connectionId: OAuthConnectionId;
	readonly pluginId: string;
	readonly integrationId: IntegrationId;
	readonly integrationRunId: ImportRunId;
	readonly accessToken: string;
	readonly userId?: UserId;
}) =>
	Effect.flatMap(OAuthConnectionsService, (service) =>
		service.invalidateAccessTokenForIntegrationRun({ userId: owner, field: "account", ...input }),
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
	body: () => Effect.Effect<A, E, Layer.Success<ReturnType<typeof serviceLayer>>>,
	isProKeyValidated = true,
) => layer(serviceLayer(isProKeyValidated))((test) => test.effect(name, body));

describe("OAuth connections", () => {
	isolated("connects private OAuth providers through their own installation configuration", () =>
		Effect.gen(function* () {
			const installed = yield* installRevisionPackage(
				oauthRevisionPackage("oauth-test", "oauth-yank"),
				owner,
			);
			const missing = yield* Effect.flip(
				authorize(owner).pipe(
					Effect.provideService(ConfigProvider.ConfigProvider, environmentConfig),
				),
			);
			expect(missing).toMatchObject({ reason: { code: "oauth-client-not-configured" } });
			yield* (yield* PluginInstallationRepository).updateState({
				sortOrder: 0,
				isHidden: false,
				id: installed.installation.id,
				config: { clientId: "private-client", clientSecret: "private-secret" },
			});
			const connectionId = yield* connect(owner);
			const { id: integrationId } = yield* createIntegration(owner, { account: connectionId });
			const integrationRunId = yield* startRun(integrationId);
			const token = yield* accessToken({
				connectionId,
				integrationId,
				integrationRunId,
				pluginId: installed.pluginId,
			});
			expect(token.accessToken).toBe("access-1");
			expect((yield* (yield* FakeTokenEndpoint).requests)[0]?.authorization).toBe(
				`Basic ${Buffer.from("private-client:private-secret").toString("base64")}`,
			);
		}),
	);

	isolated(
		"requires a validated Pro key before creating a pending OAuth connection",
		() =>
			Effect.gen(function* () {
				yield* installOAuthPlugin("oauth-test", "oauth-yank", { requiresProKey: true });
				const service = yield* OAuthConnectionsService;
				const failure = yield* Effect.flip(
					service.create(currentUser(owner), {
						field: "account",
						client: { kind: "web" },
						integrationProvider: "oauth-yank",
					}),
				);
				const connections = yield* (yield* DatabaseSession).run((db) =>
					db.select().from(tables.oauthConnection),
				);

				assert(failure._tag === "OAuthConnectionRequestError");
				expect(failure.reason).toEqual({ code: "pro-key-required" });
				expect(connections).toEqual([]);
			}),
		false,
	);

	isolated("completes an OAuth exchange without PKCE and uses the provider token lifetime", () =>
		Effect.gen(function* () {
			yield* installOAuthPlugin("oauth-test", "oauth-yank", {
				pkce: "none",
				accessTokenLifetimeSeconds: 31_536_000,
			});
			const service = yield* OAuthConnectionsService;
			const endpoint = yield* FakeTokenEndpoint;
			yield* endpoint.respond(() =>
				Effect.succeed({
					status: 200,
					body: { token_type: "Bearer", access_token: "long-lived-access" },
				}),
			);

			const { state, authorizeUrl, connectionId } = yield* authorize(owner);
			const authorizeParameters = new URL(authorizeUrl).searchParams;
			expect(authorizeParameters.get("state")).toBe(state);
			expect(authorizeParameters.has("code_challenge")).toBe(false);
			expect(authorizeParameters.has("code_challenge_method")).toBe(false);
			expect((yield* connectionRow(connectionId))?.codeVerifier).toBeNull();
			const secret = fragmentOf(yield* callback(state)).get("secret");
			assert(secret);
			yield* service.complete(currentUser(owner), connectionId, secret);

			const [exchange] = yield* endpoint.requests;
			assert(exchange);
			expect(Object.fromEntries(exchange.form)).toEqual({
				code: "auth-code-1",
				grant_type: "authorization_code",
				redirect_uri: authorizeParameters.get("redirect_uri"),
			});
			expect((yield* connectionRow(connectionId))?.accessTokenExpiresAt?.toISOString()).toBe(
				"1971-01-01T00:00:00.000Z",
			);
		}),
	);

	isolated("connects an account and hands its access token to the running integration", () =>
		Effect.gen(function* () {
			const installed = yield* installOAuthPlugin("oauth-test", "oauth-yank", {
				accessTokenLifetimeSeconds: 31_536_000,
			});
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
				yield* accessToken({
					connectionId,
					integrationId,
					integrationRunId,
					pluginId: installed.pluginId,
				}),
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
			const { connectionId, integrationId, integrationRunId } = yield* connectedIntegration();
			const { id: siblingIntegrationId } = yield* createIntegration(owner, {});
			const siblingRunId = yield* startRun(siblingIntegrationId);
			const finishedRunId = yield* startRun(integrationId, "completed");
			for (const input of [
				{ connectionId, integrationId, integrationRunId, pluginId: other.pluginId },
				{
					connectionId,
					integrationId,
					pluginId: installed.pluginId,
					integrationRunId: finishedRunId,
				},
				{
					connectionId,
					integrationId,
					pluginId: installed.pluginId,
					integrationRunId: siblingRunId,
				},
				{
					connectionId,
					integrationId,
					integrationRunId,
					userId: recipient,
					pluginId: installed.pluginId,
				},
			]) {
				const exit = yield* Effect.exit(accessToken(input));
				assert(Exit.isFailure(exit));
				expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject({
					message: OAUTH_ACCESS_TOKEN_MESSAGES.unavailable,
				});
			}
			const token = yield* accessToken({
				connectionId,
				integrationId,
				integrationRunId,
				pluginId: installed.pluginId,
			});
			expect(token.accessToken).toBe("access-1");
			yield* (yield* DatabaseSession).run((db) =>
				db
					.update(tables.importRun)
					.set({ pins: null })
					.where(eq(tables.importRun.id, integrationRunId)),
			);
			expect(
				(yield* Effect.flip(
					accessToken({
						connectionId,
						integrationId,
						integrationRunId,
						pluginId: installed.pluginId,
					}),
				)).message,
			).toBe(OAUTH_ACCESS_TOKEN_MESSAGES.unavailable);
		}),
	);

	isolated(
		"refreshes with accepted config under a shared lease and persists the rotated refresh token",
		() =>
			Effect.gen(function* () {
				const installed = yield* installOAuthPlugin("oauth-test", "oauth-yank");
				const endpoint = yield* FakeTokenEndpoint;
				const run = yield* connectedIntegration(issuedTokens({ expires_in: 30 }));
				const input = { ...run, pluginId: installed.pluginId };
				const changedConfig = yield* (yield* PluginConfigRevisions).create({
					ownerUserId: null,
					scope: "environment",
					pluginInstallationId: null,
					pluginRevisionId: installed.revisionId,
					properties: { clientId: "changed-client", clientSecret: "changed-secret" },
				});
				yield* (yield* PluginRepository).setEnvironmentConfigRevision(
					installed.pluginId,
					changedConfig,
				);
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
					(yield* endpoint.requests).map(
						({ form }) => form.get("refresh_token") ?? form.get("code"),
					),
				).toEqual(["auth-code-1", "refresh-1", "rotated-from-refresh-1"]);
				expect((yield* endpoint.requests).map(({ authorization }) => authorization)).toEqual([
					`Basic ${Buffer.from("client-1:client-secret-1").toString("base64")}`,
					`Basic ${Buffer.from("client-1:client-secret-1").toString("base64")}`,
					`Basic ${Buffer.from("client-1:client-secret-1").toString("base64")}`,
				]);
			}),
	);

	isolated("uses retained OAuth declarations after the current provider is removed", () =>
		Effect.gen(function* () {
			const installed = yield* installOAuthPlugin("oauth-test", "oauth-yank");
			const run = yield* connectedIntegration(issuedTokens({ expires_in: 30 }));
			const next = oauthRevisionPackage("oauth-test", "oauth-yank");
			yield* installRevisionPackage({
				...next,
				sourceHash: "oauth-next",
				manifest: {
					...next.manifest,
					oauthProviders: [],
					integrationProviders: [],
					metadata: { ...next.manifest.metadata, version: "next" },
				},
			});
			expect(
				yield* (yield* IntegrationProviderCatalog).findOwnedForUser(
					owner,
					"oauth-yank",
					installed.installation.id,
				),
			).toBeNull();
			expect((yield* accessToken({ ...run, pluginId: installed.pluginId })).accessToken).toBe(
				"access-1",
			);
		}),
	);

	isolated("expires a connected token only when the current integration run submits it", () =>
		Effect.gen(function* () {
			const installed = yield* installOAuthPlugin("oauth-test", "oauth-yank");
			const run = yield* connectedIntegration();
			const input = { ...run, pluginId: installed.pluginId };

			yield* invalidateAccessToken({ ...input, accessToken: "stale-access-token" });
			expect(yield* connectionStatus(owner, run.connectionId)).toBe("connected");

			const current = yield* accessToken(input);
			yield* invalidateAccessToken({ ...input, accessToken: current.accessToken });
			expect(yield* connectionStatus(owner, run.connectionId)).toBe("expired");
			const stored = yield* connectionRow(run.connectionId);
			expect(stored?.accessToken).toBeNull();
			expect(stored?.refreshToken).toBeNull();
		}),
	);

	isolated("pins OAuth access to the connection admitted for each integration run", () =>
		Effect.gen(function* () {
			const installed = yield* installOAuthPlugin("oauth-test", "oauth-yank");
			const endpoint = yield* FakeTokenEndpoint;
			const admittedRun = yield* connectedIntegration();
			yield* endpoint.respond(() =>
				Effect.succeed(issuedTokens({ access_token: "access-2", refresh_token: "refresh-2" })),
			);
			const replacementConnectionId = yield* connect(owner);
			yield* (yield* IntegrationsService).update(owner, admittedRun.integrationId, {
				providerSpecifics: { account: replacementConnectionId },
			});
			const requestsBeforeStaleRun = yield* endpoint.requests;

			expect(yield* connectionRow(admittedRun.connectionId)).toBeUndefined();
			expect(
				(yield* Effect.flip(accessToken({ ...admittedRun, pluginId: installed.pluginId }))).message,
			).toBe(OAUTH_ACCESS_TOKEN_MESSAGES.unavailable);
			expect(
				(yield* Effect.flip(
					invalidateAccessToken({
						...admittedRun,
						accessToken: "access-1",
						pluginId: installed.pluginId,
					}),
				)).message,
			).toBe(OAUTH_ACCESS_TOKEN_MESSAGES.unavailable);
			expect(yield* connectionStatus(owner, replacementConnectionId)).toBe("connected");
			expect((yield* endpoint.requests).length).toBe(requestsBeforeStaleRun.length);

			const settled = yield* (yield* ImportsRepository.make).settleIngestion({
				status: "failed",
				finishedAt: yield* DateTime.nowAsDate,
				scope: {
					userId: owner,
					runId: admittedRun.integrationRunId,
					accountGeneration: currentUser(owner).accountGeneration,
				},
			});
			assert(settled);
			const freshRunId = yield* startRun(admittedRun.integrationId);
			const freshToken = yield* accessToken({
				integrationRunId: freshRunId,
				pluginId: installed.pluginId,
				connectionId: replacementConnectionId,
				integrationId: admittedRun.integrationId,
			});
			expect(freshToken.accessToken).toBe("access-2");
			expect((yield* endpoint.requests).length).toBe(requestsBeforeStaleRun.length);
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
