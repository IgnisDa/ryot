import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import { OAUTH_WEB_CLIENT_ID } from "@ryot-app/contract/oauth";
import { Effect, Fiber, Option, Stream } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";
import getPort from "get-port";

import {
	type MockOidcServer,
	adminHeaders,
	createTestAuthClient,
	listNotificationSubscriptionStates,
	makeSession,
	oidcSignIn,
	performOidcSignIn,
	startMockOidcServer,
	stopMockOidcServer,
} from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";
import { browserLayer } from "~/support/browser";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";
import {
	buildApiEnv,
	startCoreTestInfrastructure,
	spawnApiProcess,
	stopApiProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "~/support/provisioning";

const OIDC_CLIENT_ID = "test-client";
const S3_BUCKET_NAME = "ryot-oidc-test";
const OIDC_CLIENT_SECRET = "test-secret";
const OIDC_BUTTON_LABEL = "Sign in with TestOIDC";
const clientDist = fileURLToPath(new URL("../../../../../kernel/client/dist", import.meta.url));
const existingOidcUsername = `user-${crypto.randomUUID()}`;
const pluginListQuery = { includeDisabled: false };
const godModeListQuery = (search: string) => ({ limit: 50, offset: 0, search });
const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise(run).pipe(Effect.orDie);

const countUsersByEmail = (apiUrl: string, email: string) =>
	Effect.gen(function* () {
		const data = yield* makeSession(apiUrl).call(
			(c) => c.godMode.listUsers({ query: godModeListQuery(email) }),
			adminHeaders(),
		);
		return data.total;
	});

const findUserIdByEmail = (apiUrl: string, email: string) =>
	Effect.gen(function* () {
		const data = yield* makeSession(apiUrl).call(
			(c) => c.godMode.listUsers({ query: godModeListQuery(email) }),
			adminHeaders(),
		);
		return data.users[0]?.id ?? null;
	});

const listPluginCount = (apiUrl: string, token: string) =>
	Effect.gen(function* () {
		const plugins = yield* makeSession(apiUrl).call(
			(c) => c.definitions.listPlugins({ query: pluginListQuery }),
			{ Authorization: `Bearer ${token}` },
		);
		return plugins.length;
	});

let apiPortA: number;
let apiPortB: number;
let apiPortC: number;
let apiProcessA: ChildProcess | undefined;
let apiProcessB: ChildProcess | undefined;
let apiProcessC: ChildProcess | undefined;
let mockOidcServer: MockOidcServer | undefined;
let coreInfrastructure: Awaited<ReturnType<typeof startCoreTestInfrastructure>> | undefined;

function requireMockOidcServer() {
	return requirePresent(mockOidcServer, "Mock OIDC server is not initialised");
}

function getApiUrlA() {
	return `http://127.0.0.1:${apiPortA}/api`;
}

function getApiUrlB() {
	return `http://127.0.0.1:${apiPortB}/api`;
}

function getApiUrlC() {
	return `http://127.0.0.1:${apiPortC}/api`;
}

function requireCoreInfrastructure() {
	return requirePresent(coreInfrastructure, "OIDC test infrastructure is not initialised");
}

const startApi = (label: string, port: number, extraEnv: Record<string, string> = {}) => {
	const infrastructure = requireCoreInfrastructure();
	return spawnApiProcess(
		buildApiEnv({
			port,
			label: `API ${label}`,
			dbUrl: infrastructure.dbUrl,
			s3BucketName: S3_BUCKET_NAME,
			redisUrl: infrastructure.redisUrl,
			s3Endpoint: infrastructure.s3Endpoint,
			frontendUrl: `http://127.0.0.1:${port}`,
			extraEnv: {
				SERVER_CLIENT_DIR: clientDist,
				SERVER_OIDC_CLIENT_ID: OIDC_CLIENT_ID,
				SERVER_OIDC_CLIENT_SECRET: OIDC_CLIENT_SECRET,
				SERVER_OIDC_ISSUER_URL: requireMockOidcServer().issuerUrl,
				...extraEnv,
			},
		}),
	);
};

const waitForApi = (port: number) =>
	waitForHealthCheck(`http://127.0.0.1:${port}/api/system/health`, "OIDC Setup");

beforeAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			coreInfrastructure = yield* attempt(() =>
				startCoreTestInfrastructure({ bucketName: S3_BUCKET_NAME }),
			);
			mockOidcServer = yield* startMockOidcServer;
			[apiPortA, apiPortB, apiPortC] = yield* Effect.all(
				[attempt(() => getPort()), attempt(() => getPort()), attempt(() => getPort())],
				{ concurrency: "unbounded" },
			);
			apiProcessA = startApi("A", apiPortA, { FRONTEND_OIDC_BUTTON_LABEL: OIDC_BUTTON_LABEL });
			yield* attempt(() => waitForApi(apiPortA));
		}),
	);
});

afterAll(async () => {
	await Effect.runPromise(
		Effect.all(
			[
				attempt(() => stopApiProcess(apiProcessA)),
				attempt(() => stopApiProcess(apiProcessB)),
				attempt(() => stopApiProcess(apiProcessC)),
			],
			{ concurrency: "unbounded", discard: true },
		).pipe(
			Effect.andThen(
				Effect.all(
					[
						attempt(() => stopCoreTestInfrastructure(coreInfrastructure)),
						stopMockOidcServer(mockOidcServer),
					],
					{ concurrency: "unbounded", discard: true },
				),
			),
		),
	);
});

describe("GET /system/config with OIDC enabled (API A)", () => {
	it.live("returns oidcEnabled: true", () =>
		Effect.gen(function* () {
			const client = makeSession(getApiUrlA());
			const data = yield* client.call((c) => c.system.config());
			expect(data.auth.oidcEnabled).toBe(true);
		}),
	);

	it.live("returns oidcButtonLabel from env var", () =>
		Effect.gen(function* () {
			const client = makeSession(getApiUrlA());
			const data = yield* client.call((c) => c.system.config());
			expect(data.auth.oidcButtonLabel).toBe(OIDC_BUTTON_LABEL);
		}),
	);
});

describe("Local auth disabled (API B)", () => {
	beforeAll(async () => {
		await Effect.runPromise(
			attempt(() => stopApiProcess(apiProcessA)).pipe(
				Effect.andThen(
					Effect.sync(() => {
						apiProcessB = startApi("B", apiPortB, { USERS_DISABLE_LOCAL_AUTH: "true" });
					}),
				),
				Effect.andThen(attempt(() => waitForApi(apiPortB))),
			),
		);
	});

	it.live("returns localAuthDisabled: true", () =>
		Effect.gen(function* () {
			const client = makeSession(getApiUrlB());
			const data = yield* client.call((c) => c.system.config());
			expect(data.auth.signupAllowed).toBe(false);
			expect(data.auth.localAuthDisabled).toBe(true);
		}),
	);

	it.live("returns an error and does not create a user", () =>
		Effect.gen(function* () {
			const email = "test@example.com";
			const authClient = createTestAuthClient(getApiUrlB());
			const { error } = yield* attempt(() =>
				authClient.signUp.email({ email, name: "Test", password: "password123" }),
			);
			expect(error).toBeDefined();
			expect(yield* countUsersByEmail(getApiUrlB(), email)).toBe(0);
		}),
	);

	it.live("auto-launches OIDC through the hosted browser flow", () =>
		Effect.gen(function* () {
			const mockServer = requireMockOidcServer();
			const frontendUrl = new URL(getApiUrlB()).origin;
			const issuer = new URL(mockServer.issuerUrl);
			const browser = yield* Playwright.Browser;
			const page = yield* browser.newPage();
			const request = (pathname: string) =>
				page.eventStream("request").pipe(
					Stream.filter((item) => new URL(item.url()).pathname === pathname),
					Stream.runHead,
					Effect.map(Option.getOrThrow),
					Effect.forkChild({ startImmediately: true }),
				);
			const hostedLoginRequest = yield* request("/oauth/login");
			const hostedSignInRequest = yield* request("/api/auth/sign-in/social");
			const tokenResponse = yield* page.eventStream("response").pipe(
				Stream.filter((response) => new URL(response.url()).pathname === "/api/auth/oauth2/token"),
				Stream.runHead,
				Effect.map(Option.getOrThrow),
				Effect.forkChild({ startImmediately: true }),
			);
			const providerObservation = yield* page.eventStream("request").pipe(
				Stream.filter((item) => {
					const url = new URL(item.url());
					return url.origin === issuer.origin && url.pathname === "/authorize";
				}),
				Stream.runHead,
				Effect.map(Option.getOrThrow),
				Effect.flatMap((req) =>
					page
						.context()
						.cookies(frontendUrl)
						.pipe(
							Effect.map((cookies) => ({
								request: req,
								stateCookieObserved: cookies.some((cookie) => cookie.name.endsWith(".state")),
							})),
						),
				),
				Effect.forkChild({ startImmediately: true }),
			);

			const username = `browser-${crypto.randomUUID()}`;
			mockServer.setNextClaims({ sub: username, name: username, email: `${username}@example.com` });
			yield* page.goto(`${frontendUrl}/auth`);

			const loginRequest = yield* Fiber.join(hostedLoginRequest);
			const signInRequest = yield* Fiber.join(hostedSignInRequest);
			const { request: oidcRequest, stateCookieObserved } = yield* Fiber.join(providerObservation);
			const oauthResponse = yield* Fiber.join(tokenResponse);
			expect(new URL(loginRequest.url()).searchParams.get("client_id")).toBe(OAUTH_WEB_CLIENT_ID);
			const body: unknown = Option.getOrThrow(yield* signInRequest.postDataJSON);
			const oauthQuery = body && typeof body === "object" ? Reflect.get(body, "oauth_query") : null;
			expect(typeof oauthQuery).toBe("string");
			expect(new URL(oidcRequest.url()).searchParams.get("client_id")).toBe(OIDC_CLIENT_ID);
			expect(stateCookieObserved).toBe(true);
			expect(oauthResponse.ok()).toBe(true);
			yield* page.getByTestId("authenticated-shell").waitFor({ state: "visible" });
			expect(new URL(page.url()).pathname).not.toMatch(/^\/auth(?:\/|$)/);
		}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
	);

	afterAll(async () => {
		await Effect.runPromise(
			attempt(() => stopApiProcess(apiProcessB)).pipe(
				Effect.andThen(
					Effect.sync(() => {
						apiProcessA = startApi("A", apiPortA, {
							FRONTEND_OIDC_BUTTON_LABEL: OIDC_BUTTON_LABEL,
						});
					}),
				),
				Effect.andThen(attempt(() => waitForApi(apiPortA))),
			),
		);
	});
});

describe("OIDC sign-in happy path (API A)", () => {
	it.live("first-time OIDC sign-in produces a valid session", () =>
		Effect.gen(function* () {
			const username = `user-${crypto.randomUUID()}`;
			const sessionToken = yield* oidcSignIn(requireMockOidcServer(), username, getApiUrlA());
			const client = makeSession(getApiUrlA());
			yield* client.call((c) => c.definitions.listPlugins({ query: pluginListQuery }), {
				Authorization: `Bearer ${sessionToken}`,
			});
		}),
	);

	it.live("first-time OIDC sign-in creates a user row", () =>
		Effect.gen(function* () {
			const username = `user-${crypto.randomUUID()}`;
			yield* oidcSignIn(requireMockOidcServer(), username, getApiUrlA());
			expect(yield* countUsersByEmail(getApiUrlA(), `${username}@example.com`)).toBe(1);
		}),
	);

	it.live("first-time OIDC sign-in bootstraps the user with plugin state", () =>
		Effect.gen(function* () {
			const username = `user-${crypto.randomUUID()}`;
			const sessionToken = yield* oidcSignIn(requireMockOidcServer(), username, getApiUrlA());
			expect(yield* listPluginCount(getApiUrlA(), sessionToken)).toBeGreaterThan(0);
		}),
	);

	it.live("first-time OIDC sign-in bootstraps the user with the default notification rules", () =>
		Effect.gen(function* () {
			const username = `user-${crypto.randomUUID()}`;
			const sessionToken = yield* oidcSignIn(requireMockOidcServer(), username, getApiUrlA());

			const headers = { Authorization: `Bearer ${sessionToken}` };
			const client = makeSession(getApiUrlA(), headers);
			const [catalog, rules] = yield* Effect.all([
				client.call((c) => c.automations.listCatalog()),
				listNotificationSubscriptionStates(client, { limit: 100 }),
			]);
			expect(rules).toHaveLength(catalog.length);
			expect(rules.map((rule) => rule.signalSchemaSlug).sort()).toEqual(
				catalog.map((schema) => schema.id).sort(),
			);
			expect(rules.every((rule) => rule.isActive)).toBe(true);
		}),
	);
});

describe("OIDC idempotency (API A)", () => {
	it.live("repeated OIDC sign-in with same identity reuses the same user row", () =>
		Effect.gen(function* () {
			const username = `user-${crypto.randomUUID()}`;

			const token1 = yield* oidcSignIn(requireMockOidcServer(), username, getApiUrlA());
			const token2 = yield* oidcSignIn(requireMockOidcServer(), username, getApiUrlA());

			expect(yield* countUsersByEmail(getApiUrlA(), `${username}@example.com`)).toBe(1);

			const client = makeSession(getApiUrlA());
			yield* Effect.all([
				client.call((c) => c.definitions.listPlugins({ query: pluginListQuery }), {
					Authorization: `Bearer ${token1}`,
				}),
				client.call((c) => c.definitions.listPlugins({ query: pluginListQuery }), {
					Authorization: `Bearer ${token2}`,
				}),
			]);
		}),
	);

	it.live("bootstrap idempotency: plugin count is the same after two sign-ins", () =>
		Effect.gen(function* () {
			const username = `user-${crypto.randomUUID()}`;

			const token1 = yield* oidcSignIn(requireMockOidcServer(), username, getApiUrlA());
			const firstCount = yield* listPluginCount(getApiUrlA(), token1);
			expect(firstCount).toBeGreaterThan(0);

			const token2 = yield* oidcSignIn(requireMockOidcServer(), username, getApiUrlA());
			const secondCount = yield* listPluginCount(getApiUrlA(), token2);
			expect(secondCount).toBe(firstCount);
		}),
	);
});

describe("Registration gating for OIDC (API C)", () => {
	beforeAll(async () => {
		await Effect.runPromise(
			oidcSignIn(requireMockOidcServer(), existingOidcUsername, getApiUrlA()).pipe(
				Effect.andThen(attempt(() => stopApiProcess(apiProcessA))),
				Effect.andThen(
					Effect.sync(() => {
						apiProcessC = startApi("C", apiPortC, { USERS_ALLOW_REGISTRATION: "false" });
					}),
				),
				Effect.andThen(attempt(() => waitForApi(apiPortC))),
			),
		);
	});

	it.live("first-time OIDC sign-in is rejected when registration is disabled", () =>
		Effect.gen(function* () {
			const username = `user-${crypto.randomUUID()}`;
			const apiUrl = getApiUrlC();

			const { response: step3Response } = yield* performOidcSignIn(
				requireMockOidcServer(),
				username,
				apiUrl,
			);
			expect(step3Response.status).toBe(302);

			expect(
				yield* countUsersByEmail(getApiUrlC(), `${username}@example.com`),
				"No user row must be created when registration is disabled",
			).toBe(0);
		}),
	);

	it.live("existing OIDC users can still sign in when registration is disabled", () =>
		Effect.gen(function* () {
			const email = `${existingOidcUsername}@example.com`;

			const beforeId = yield* findUserIdByEmail(getApiUrlC(), email);
			expect(beforeId).not.toBeNull();

			const sessionToken = yield* oidcSignIn(
				requireMockOidcServer(),
				existingOidcUsername,
				getApiUrlC(),
			);
			const client = makeSession(getApiUrlC());
			yield* client.call((c) => c.definitions.listPlugins({ query: pluginListQuery }), {
				Authorization: `Bearer ${sessionToken}`,
			});

			const afterId = yield* findUserIdByEmail(getApiUrlC(), email);
			expect(afterId).toBe(beforeId);
		}),
	);
});
