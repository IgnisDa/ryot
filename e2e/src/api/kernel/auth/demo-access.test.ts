import type { ChildProcess } from "node:child_process";

import { DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import { integrationWebhookUrl as buildIntegrationWebhookUrl } from "@ryot-app/contract/modules/integrations/schemas";
import {
	OAuthTokenResponse,
	getOAuthEndpoint,
	getOAuthResource,
	OAUTH_DEMO_WEB_CLIENT_ID,
	OAUTH_NATIVE_CALLBACK_URIS,
	OAUTH_NATIVE_CLIENT_ID,
	OAUTH_TOKEN_PATH,
	OAUTH_WEB_CLIENT_ID,
	type OAuthClientId,
} from "@ryot-app/contract/oauth";
import { SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { column, document, eq, field, literal, rows, table } from "@ryot-app/ryotql";
import { integrationRecipe } from "@ryot-app/ryotql-recipes/integrations";
import { Effect, Option, Result, Schema } from "effect";
import getPort from "get-port";

import {
	createApiKey,
	createCollection,
	createEntity,
	createKodiIntegration,
	createTestUser,
	executeRyotQL,
	executeRyotQLRecipe,
	findBuiltinSchemaBySlug,
	getUserSettings,
	listEventSchemas,
	makeSession,
	mergeUserState,
	prepareOAuth,
	requireEventSchemaBySlug,
	requireRows,
	requireRyotQLText,
	responseCookie,
	searchProviderEntities,
	signInWithPassword,
	updateUserSettingsPreferences,
	type PendingOAuth,
} from "~/fixtures/kernel";
import {
	assertTaggedError,
	requireArray,
	requireObjectRecord,
	requirePresent,
	requireString,
} from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";
import {
	buildApiEnv,
	spawnApiProcess,
	startCoreTestInfrastructure,
	stopApiProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "~/support/provisioning";

const S3_BUCKET_NAME = "ryot-demo-access-test";
const DEMO_COLLECTION_NAME = `Demo acceptance ${crypto.randomUUID()}`;

let apiUrl: string;
let apiOrigin: string;
let apiProcess: ChildProcess | undefined;
let demoApiKey: string;
let demoUserId: string;
let demoEmail: string;
let demoPassword: string;
let integrationId: string;
let integrationWebhookUrl: string;
let ownerSessionCookie: string;
let infrastructure: Awaited<ReturnType<typeof startCoreTestInfrastructure>> | undefined;

const authControlPlaneRequests = (accountId: string, apiKeyId: string) =>
	[
		{ method: "GET", path: "/list-accounts", expectedStandardStatus: 200 },
		{ method: "POST", body: { accountId }, path: "/get-access-token" },
		{ method: "POST", body: { accountId }, path: "/refresh-token" },
		{ method: "GET", path: `/account-info?accountId=${encodeURIComponent(accountId)}` },
		{ method: "GET", path: "/list-sessions", expectedStandardStatus: 200 },
		{ method: "GET", path: "/api-key/list", expectedStandardStatus: 200 },
		{
			method: "GET",
			expectedStandardStatus: 200,
			path: `/api-key/get?id=${encodeURIComponent(apiKeyId)}`,
		},
		{ body: {}, method: "POST", path: "/two-factor/get-totp-uri" },
	] as const;

const callHostedAuth = (
	sessionCookie: string,
	request: ReturnType<typeof authControlPlaneRequests>[number],
) =>
	fetch(`${apiOrigin}/api/auth${request.path}`, {
		method: request.method,
		headers: {
			Cookie: sessionCookie,
			...(request.method === "POST" ? { "content-type": "application/json" } : {}),
		},
		...(request.method === "POST" ? { body: JSON.stringify(request.body) } : {}),
	});

const startApi = async (extraEnv: Record<string, string | undefined>) => {
	const activeInfrastructure = requirePresent(
		infrastructure,
		"Demo access test infrastructure is not initialised",
	);
	apiProcess = spawnApiProcess(
		buildApiEnv({
			extraEnv,
			frontendUrl: apiOrigin,
			s3BucketName: S3_BUCKET_NAME,
			label: "Demo access acceptance",
			dbUrl: activeInfrastructure.dbUrl,
			port: Number(new URL(apiOrigin).port),
			redisUrl: activeInfrastructure.redisUrl,
			s3Endpoint: activeInfrastructure.s3Endpoint,
		}),
	);
	await waitForHealthCheck(`${apiUrl}/system/health`, "Demo access acceptance", 90);
};

const exchangeTokens = async (
	pending: PendingOAuth,
	authorizationResponse: Response,
	clientId: OAuthClientId,
) => {
	const callback = new URL(
		requirePresent(
			authorizationResponse.headers.get("location"),
			"OAuth authorization did not redirect",
		),
		pending.serverOrigin,
	);
	const code = requirePresent(
		callback.searchParams.get("code"),
		"OAuth authorization returned no code",
	);
	const response = await fetch(getOAuthEndpoint(pending.serverOrigin, OAUTH_TOKEN_PATH), {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			code,
			client_id: clientId,
			grant_type: "authorization_code",
			redirect_uri: pending.redirectUri,
			code_verifier: pending.codeVerifier,
			resource: getOAuthResource(pending.frontendOrigin),
		}),
	});
	expect(response.status).toBe(200);
	return Schema.decodeUnknownSync(OAuthTokenResponse)(await response.json());
};

const authorize = async (sessionCookie: string, clientId: OAuthClientId, redirectUri?: string) => {
	const pending = await prepareOAuth(apiUrl);
	const authorizationUrl = new URL(pending.authorizationUrl);
	authorizationUrl.searchParams.set("client_id", clientId);
	if (redirectUri) {
		authorizationUrl.searchParams.set("redirect_uri", redirectUri);
	}
	const response = await fetch(authorizationUrl, {
		redirect: "manual",
		headers: { Cookie: sessionCookie },
	});
	return { pending, response };
};

const signInDemo = async () => {
	const response = await fetch(`${apiOrigin}/api/auth/demo/sign-in`, {
		method: "POST",
		headers: { Origin: apiOrigin },
	});
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ mode: "demo" });
	return requirePresent(responseCookie(response), "Demo sign-in did not set a session cookie");
};

const expectDemoSession = async (sessionCookie: string) => {
	const response = await fetch(`${apiOrigin}/api/auth/get-session`, {
		headers: { Cookie: sessionCookie },
	});
	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({
		user: { id: demoUserId },
		session: { userId: demoUserId, accessClass: "demo" },
	});
};

const getDemoToken = async (sessionCookie: string) => {
	const { pending, response } = await authorize(sessionCookie, OAUTH_DEMO_WEB_CLIENT_ID);
	expect(response.status).toBe(302);
	const tokens = await exchangeTokens(pending, response, OAUTH_DEMO_WEB_CLIENT_ID);
	return tokens.access_token;
};

beforeAll(async () => {
	const port = await getPort();
	apiOrigin = `http://127.0.0.1:${port}`;
	apiUrl = `${apiOrigin}/api`;
	infrastructure = await startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME });

	await startApi({ USERS_ALLOW_REGISTRATION: "true", USERS_DEMO_ACCOUNT_ID: undefined });
	const seeded = await Effect.runPromise(createTestUser(apiUrl));
	demoUserId = seeded.userId;
	demoEmail = seeded.email;
	demoPassword = seeded.password;
	ownerSessionCookie = seeded.sessionCookie;
	demoApiKey = await Effect.runPromise(
		createApiKey(seeded.sessionCookie, "Demo account key", apiUrl),
	);
	const owner = makeSession(apiUrl, { Authorization: `Bearer ${seeded.token}` });
	const integration = await Effect.runPromise(createKodiIntegration(owner));
	integrationId = integration.id;
	const detail = requirePresent(
		Option.getOrUndefined(
			await Effect.runPromise(executeRyotQLRecipe(owner, integrationRecipe({ id: integrationId }))),
		),
		"Seeded integration detail is missing",
	);
	const { frontendOrigin } = await Effect.runPromise(owner.call((c) => c.system.config()));
	integrationWebhookUrl = buildIntegrationWebhookUrl(
		frontendOrigin,
		requirePresent(detail.webhookToken, "Seeded integration did not expose its webhook token"),
	);

	await stopApiProcess(apiProcess);
	apiProcess = undefined;
	await startApi({ USERS_ALLOW_REGISTRATION: "false", USERS_DEMO_ACCOUNT_ID: demoUserId });
}, 300_000);

afterAll(async () => {
	await stopApiProcess(apiProcess);
	await stopCoreTestInfrastructure(infrastructure);
});

describe("shared demo access acceptance", () => {
	it.live("enters the configured account and issues restricted demo OAuth authority", () =>
		Effect.gen(function* () {
			const config = yield* makeSession(apiUrl).call((c) => c.system.config());
			expect(config.auth.signupAllowed).toBe(false);

			const sessionCookie = yield* Effect.promise(signInDemo);
			yield* Effect.promise(() => expectDemoSession(sessionCookie));
			const token = yield* Effect.promise(() => getDemoToken(sessionCookie));
			const demoClient = makeSession(apiUrl, { Authorization: `Bearer ${token}` });

			const collection = yield* createCollection(demoClient, {
				name: DEMO_COLLECTION_NAME,
				description: "Persists between demo sessions",
			});
			expect(collection.name).toBe(DEMO_COLLECTION_NAME);
			const rawProtectedResponse = yield* Effect.promise(() =>
				fetch(`${apiUrl}/user-settings/preferences`, {
					method: "PATCH",
					body: JSON.stringify({ language: "de" }),
					headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
				}),
			);
			expect(rawProtectedResponse.status).toBe(403);
			expect(yield* Effect.promise(() => rawProtectedResponse.json())).toEqual({
				_tag: "DemoOperationProtected",
				reason: { code: "demo-operation-protected" },
			});
			const pluginStateResponse = yield* Effect.promise(() =>
				fetch(`${apiUrl}/plugins/media/state`, {
					method: "PATCH",
					body: JSON.stringify({ isDisabled: true }),
					headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
				}),
			);
			expect(pluginStateResponse.status).toBe(403);
			expect(yield* Effect.promise(() => pluginStateResponse.json())).toEqual({
				_tag: "DemoOperationProtected",
				reason: { code: "demo-operation-protected" },
			});

			const protectedError = yield* Effect.flip(
				updateUserSettingsPreferences(demoClient, { language: "de" }),
			);
			expect(protectedError).toEqual(
				new DemoOperationProtected({ reason: { code: "demo-operation-protected" } }),
			);
			expect((yield* getUserSettings(demoClient)).id).toBe(demoUserId);
			yield* Effect.promise(() => expectDemoSession(sessionCookie));
		}),
	);

	it.live("keeps owner OAuth unrestricted for the same configured user", () =>
		Effect.gen(function* () {
			const ownerSignIn = yield* signInWithPassword(demoEmail, demoPassword, apiUrl);
			expect(ownerSignIn.error).toBeNull();
			const ownerCookie = requirePresent(
				ownerSignIn.sessionCookie,
				"Owner sign-in returned no session",
			);
			const sessionResponse = yield* Effect.promise(() =>
				fetch(`${apiOrigin}/api/auth/get-session`, { headers: { Cookie: ownerCookie } }),
			);
			expect(yield* Effect.promise(() => sessionResponse.json())).toMatchObject({
				user: { id: demoUserId },
				session: { accessClass: "standard" },
			});

			const ownerClient = makeSession(apiUrl, {
				Authorization: `Bearer ${requirePresent(ownerSignIn.token, "Owner sign-in returned no token")}`,
			});
			yield* updateUserSettingsPreferences(ownerClient, { language: "en" });
			expect((yield* getUserSettings(ownerClient)).preferences.language).toBe("en");
		}),
	);

	it.live("does not let alternate credentials or normal clients bypass demo restrictions", () =>
		Effect.gen(function* () {
			const apiKeyClient = makeSession(apiUrl, { "X-Api-Key": demoApiKey });
			const apiKeyError = yield* Effect.flip(
				updateUserSettingsPreferences(apiKeyClient, { language: "fr" }),
			);
			assertTaggedError(apiKeyError, "DemoOperationProtected");
			expect(apiKeyError.reason.code).toBe("demo-operation-protected");

			const sessionCookie = yield* Effect.promise(signInDemo);
			for (const [clientId, redirectUri] of [
				[OAUTH_WEB_CLIENT_ID, undefined],
				[OAUTH_NATIVE_CLIENT_ID, OAUTH_NATIVE_CALLBACK_URIS[0]],
			] as const) {
				const { response } = yield* Effect.promise(() =>
					authorize(sessionCookie, clientId, redirectUri),
				);
				expect(response.status).toBe(403);
				expect(yield* Effect.promise(() => response.json())).toMatchObject({
					code: "DEMO_OPERATION_PROTECTED",
				});
			}
		}),
	);

	it.live("protects Better Auth credential reads while preserving standard hosted access", () =>
		Effect.gen(function* () {
			const standardAccountsResponse = yield* Effect.promise(() =>
				fetch(`${apiOrigin}/api/auth/list-accounts`, { headers: { Cookie: ownerSessionCookie } }),
			);
			expect(standardAccountsResponse.status).toBe(200);
			const standardAccounts: unknown = yield* Effect.promise(() =>
				standardAccountsResponse.json(),
			);
			const account = requireObjectRecord(
				requirePresent(
					requireArray(standardAccounts, "Account list was invalid")[0],
					"Standard account list was empty",
				),
				"Standard account was invalid",
			);
			const accountId = requireString(account.id, "Account ID was missing");

			const standardApiKeysResponse = yield* Effect.promise(() =>
				fetch(`${apiOrigin}/api/auth/api-key/list`, { headers: { Cookie: ownerSessionCookie } }),
			);
			expect(standardApiKeysResponse.status).toBe(200);
			const standardApiKeys: unknown = yield* Effect.promise(() => standardApiKeysResponse.json());
			const apiKeys = requireArray(
				requireObjectRecord(standardApiKeys, "API-key list was invalid").apiKeys,
				"API-key list items were invalid",
			);
			const apiKey = requireObjectRecord(
				requirePresent(apiKeys[0], "Standard API-key list was empty"),
				"Standard API key was invalid",
			);
			const apiKeyId = requireString(apiKey.id, "API-key ID was missing");
			const demoCookie = yield* Effect.promise(signInDemo);

			for (const request of authControlPlaneRequests(accountId, apiKeyId)) {
				const demoResponse = yield* Effect.promise(() => callHostedAuth(demoCookie, request));
				expect(demoResponse.status).toBe(403);
				expect(yield* Effect.promise(() => demoResponse.json())).toMatchObject({
					code: "DEMO_OPERATION_PROTECTED",
				});

				const standardResponse = yield* Effect.promise(() =>
					callHostedAuth(ownerSessionCookie, request),
				);
				const standardBody = yield* Effect.promise(() => standardResponse.json());
				expect(standardResponse.status).not.toBe(403);
				expect(standardBody).not.toMatchObject({ code: "DEMO_OPERATION_PROTECTED" });
				if ("expectedStandardStatus" in request) {
					expect(standardResponse.status).toBe(request.expectedStandardStatus);
				}
			}
		}),
	);

	it.live("allows provider, event tracking, and user-state routes to reach domain behavior", () =>
		Effect.gen(function* () {
			const sessionCookie = yield* Effect.promise(signInDemo);
			const token = yield* Effect.promise(() => getDemoToken(sessionCookie));
			const demoClient = makeSession(apiUrl, { Authorization: `Bearer ${token}` });
			const missingProviderId = SandboxProviderId.make(crypto.randomUUID());
			const searchError = yield* Effect.flip(
				searchProviderEntities(demoClient, {
					page: 1,
					pageSize: 5,
					query: "demo",
					providerId: missingProviderId,
				}),
			);
			assertTaggedError(searchError, "ProviderEntityNotFound");
			expect(searchError.reason.code).toBe("provider-not-found");
			const importError = yield* Effect.flip(
				demoClient.call((c) =>
					c.providerEntities.import({
						payload: { externalId: "demo-record", providerId: missingProviderId },
					}),
				),
			);
			assertTaggedError(importError, "ProviderEntityNotFound");
			expect(importError.reason.code).toBe("provider-not-found");

			const { schema } = yield* findBuiltinSchemaBySlug(demoClient, "book");
			const mergeFrom = yield* createEntity(demoClient, {
				properties: {},
				name: "Demo merge source",
				entitySchemaSlug: schema.id,
			});
			const mergeInto = yield* createEntity(demoClient, {
				properties: {},
				name: "Demo merge target",
				entitySchemaSlug: schema.id,
			});
			const eventSchemas = yield* listEventSchemas(demoClient, schema.id);
			const review = requireEventSchemaBySlug(eventSchemas, "review");
			const eventResult = yield* demoClient.call((c) =>
				c.events.create({
					payload: [
						{ entityId: mergeFrom.id, properties: { rating: 5 }, eventSchemaSlug: review.id },
					],
				}),
			);
			expect(eventResult.count).toBe(1);

			const merged = yield* mergeUserState(demoClient, {
				mergeFrom: mergeFrom.id,
				mergeInto: mergeInto.id,
			});
			expect(merged).toMatchObject({
				warnings: [],
				movedEventsCount: 2,
				mergeFrom: mergeFrom.id,
				mergeInto: mergeInto.id,
			});
		}),
	);

	it.live(
		"denies sensitive kernel RyotQL integration detail to demo users while preserving domain changes",
		() =>
			Effect.gen(function* () {
				const sessionCookie = yield* Effect.promise(signInDemo);
				const token = yield* Effect.promise(() => getDemoToken(sessionCookie));
				const demoClient = makeSession(apiUrl, { Authorization: `Bearer ${token}` });

				const detailRecipe = integrationRecipe({ id: integrationId });
				const restricted = yield* Effect.flip(
					demoClient.call((c) => c.ryotql.executePlugin({ payload: detailRecipe.document })),
				);
				assertTaggedError(restricted, "RyotQLBadRequest");
				expect(restricted.reason.code).toBe("invalid-query");
				expect(JSON.stringify(restricted).includes(integrationWebhookUrl)).toBe(false);

				const outcome = yield* Effect.result(executeRyotQLRecipe(demoClient, detailRecipe));
				if (Result.isSuccess(outcome)) {
					throw new Error("Demo credentials read protected kernel integration detail");
				}
				const integrationError = outcome.failure;
				assertTaggedError(integrationError, "DemoOperationProtected");
				expect(integrationError.reason.code).toBe("demo-operation-protected");
				expect(JSON.stringify(integrationError).includes(integrationWebhookUrl)).toBe(false);

				const collectionEntity = table("entity", "demoCollection");
				const result = yield* executeRyotQL(
					demoClient,
					document({
						collection: rows(collectionEntity, {
							fields: [field("name", column(collectionEntity, "name"))],
							where: eq(column(collectionEntity, "name"), literal(DEMO_COLLECTION_NAME)),
						}),
					}),
				);
				const collections = requireRows(result.data.collection, "collection");
				expect(collections.items).toHaveLength(1);
				expect(
					requireRyotQLText(requirePresent(collections.items[0], "Collection is missing"), "name"),
				).toBe(DEMO_COLLECTION_NAME);
			}),
	);
});
