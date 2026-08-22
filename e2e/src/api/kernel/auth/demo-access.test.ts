import type { ChildProcess } from "node:child_process";

import { DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
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
import { IntegrationId } from "@ryot-app/contract/schema/brands";
import { column, document, eq, field, literal, rows, table } from "@ryot-app/ryotql";
import { Effect, Schema } from "effect";
import getPort from "get-port";

import {
	createApiKey,
	createCollection,
	createKodiIntegration,
	createTestUser,
	executeRyotQL,
	getUserSettings,
	makeSession,
	prepareOAuth,
	requireRows,
	requireRyotQLText,
	responseCookie,
	signInWithPassword,
	updateUserSettingsPreferences,
	type PendingOAuth,
} from "~/fixtures/kernel";
import { assertTaggedError, requirePresent } from "~/support/assertions";
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
let infrastructure: Awaited<ReturnType<typeof startCoreTestInfrastructure>> | undefined;

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
	demoApiKey = await Effect.runPromise(
		createApiKey(seeded.sessionCookie, "Demo account key", apiUrl),
	);
	const owner = makeSession(apiUrl, { Authorization: `Bearer ${seeded.token}` });
	const integration = await Effect.runPromise(createKodiIntegration(owner));
	integrationId = integration.id;
	integrationWebhookUrl = requirePresent(
		integration.webhookUrl,
		"Seeded integration did not expose its webhook URL",
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
			expect((yield* updateUserSettingsPreferences(ownerClient, { language: "en" })).language).toBe(
				"en",
			);
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

	it.live(
		"rejects sensitive integration detail and preserves domain changes in a new session",
		() =>
			Effect.gen(function* () {
				const sessionCookie = yield* Effect.promise(signInDemo);
				const token = yield* Effect.promise(() => getDemoToken(sessionCookie));
				const demoClient = makeSession(apiUrl, { Authorization: `Bearer ${token}` });

				const integrationError = yield* Effect.flip(
					demoClient.call((c) =>
						c.integrations.get({ params: { integrationId: IntegrationId.make(integrationId) } }),
					),
				);
				expect(integrationError).toEqual(
					new DemoOperationProtected({ reason: { code: "demo-operation-protected" } }),
				);
				expect(JSON.stringify(integrationError)).not.toContain(integrationWebhookUrl);

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
