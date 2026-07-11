import type { ChildProcess } from "node:child_process";

import { Effect } from "effect";
import getPort from "get-port";

import {
	type MockOidcServer,
	adminHeaders,
	createTestAuthClient,
	makeSession,
	oidcSignIn,
	performOidcSignIn,
	startMockOidcServer,
	stopMockOidcServer,
} from "~/fixtures";
import { requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";
import {
	buildBackendEnv,
	startCoreTestInfrastructure,
	spawnBackendProcess,
	stopBackendProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "~/support/provisioning";

const OIDC_CLIENT_ID = "test-client";
const S3_BUCKET_NAME = "ryot-oidc-test";
const OIDC_CLIENT_SECRET = "test-secret";
const OIDC_BUTTON_LABEL = "Sign in with TestOIDC";
const workspaceListQuery = { includeDisabled: false };
const godModeListQuery = (search: string) => ({ limit: 50, offset: 0, search });

const countUsersByEmail = (backendUrl: string, email: string) =>
	Effect.gen(function* () {
		const data = yield* makeSession(backendUrl).call(
			(c) => c.godMode.listUsers({ urlParams: godModeListQuery(email) }),
			adminHeaders,
		);
		return data.total;
	});

const findUserIdByEmail = (backendUrl: string, email: string) =>
	Effect.gen(function* () {
		const data = yield* makeSession(backendUrl).call(
			(c) => c.godMode.listUsers({ urlParams: godModeListQuery(email) }),
			adminHeaders,
		);
		return data.users[0]?.id ?? null;
	});

const listWorkspaceCount = (backendUrl: string, cookie: string) =>
	Effect.gen(function* () {
		const workspaces = yield* makeSession(backendUrl).call(
			(c) => c.definitions.listWorkspaces({ urlParams: workspaceListQuery }),
			{ Cookie: cookie },
		);
		return workspaces.length;
	});

let backendPortA: number;
let backendPortB: number;
let backendPortC: number;
let backendProcessA: ChildProcess | undefined;
let backendProcessB: ChildProcess | undefined;
let backendProcessC: ChildProcess | undefined;
let mockOidcServer: MockOidcServer | undefined;
let coreInfrastructure: Awaited<ReturnType<typeof startCoreTestInfrastructure>> | undefined;

function requireMockOidcServer() {
	return requirePresent(mockOidcServer, "Mock OIDC server is not initialised");
}

function getBackendUrlA() {
	return `http://127.0.0.1:${backendPortA}/api`;
}

function getBackendUrlB() {
	return `http://127.0.0.1:${backendPortB}/api`;
}

function getBackendUrlC() {
	return `http://127.0.0.1:${backendPortC}/api`;
}

function requireCoreInfrastructure() {
	return requirePresent(coreInfrastructure, "OIDC test infrastructure is not initialised");
}

beforeAll(async () => {
	coreInfrastructure = await startCoreTestInfrastructure({
		bucketName: S3_BUCKET_NAME,
	});

	mockOidcServer = await startMockOidcServer();

	[backendPortA, backendPortB, backendPortC] = await Promise.all([getPort(), getPort(), getPort()]);
	const backendOriginA = `http://127.0.0.1:${backendPortA}`;
	const backendOriginB = `http://127.0.0.1:${backendPortB}`;
	const backendOriginC = `http://127.0.0.1:${backendPortC}`;

	const infrastructure = requireCoreInfrastructure();
	const sharedEnv = {
		SERVER_OIDC_CLIENT_ID: OIDC_CLIENT_ID,
		SERVER_OIDC_CLIENT_SECRET: OIDC_CLIENT_SECRET,
		SERVER_OIDC_ISSUER_URL: requireMockOidcServer().issuerUrl,
	};
	const startBackend = (
		label: string,
		frontendUrl: string,
		port: number,
		extraEnv: Record<string, string> = {},
	) => {
		return spawnBackendProcess(
			buildBackendEnv({
				port,
				frontendUrl,
				label: `Backend ${label}`,
				dbUrl: infrastructure.dbUrl,
				s3BucketName: S3_BUCKET_NAME,
				redisUrl: infrastructure.redisUrl,
				s3Endpoint: infrastructure.s3Endpoint,
				extraEnv: { ...sharedEnv, ...extraEnv },
			}),
		);
	};

	backendProcessA = startBackend("A", backendOriginA, backendPortA, {
		FRONTEND_OIDC_BUTTON_LABEL: OIDC_BUTTON_LABEL,
	});
	await waitForHealthCheck(`http://127.0.0.1:${backendPortA}/api/system/health`, "OIDC Setup");

	backendProcessB = startBackend("B", backendOriginB, backendPortB, {
		USERS_DISABLE_LOCAL_AUTH: "true",
	});
	backendProcessC = startBackend("C", backendOriginC, backendPortC, {
		USERS_ALLOW_REGISTRATION: "false",
	});
	await Promise.all([
		waitForHealthCheck(`http://127.0.0.1:${backendPortB}/api/system/health`, "OIDC Setup"),
		waitForHealthCheck(`http://127.0.0.1:${backendPortC}/api/system/health`, "OIDC Setup"),
	]);
});

afterAll(async () => {
	await Promise.all([
		stopBackendProcess(backendProcessA),
		stopBackendProcess(backendProcessB),
		stopBackendProcess(backendProcessC),
	]);

	await Promise.all([
		stopCoreTestInfrastructure(coreInfrastructure),
		stopMockOidcServer(mockOidcServer),
	]);
});

describe("GET /system/config with OIDC enabled (Backend A)", () => {
	it.live("returns oidcEnabled: true", () =>
		Effect.gen(function* () {
			const client = makeSession(getBackendUrlA());
			const data = yield* client.call((c) => c.system.config());
			expect(data.auth.oidcEnabled).toBe(true);
		}),
	);

	it.live("returns oidcButtonLabel from env var", () =>
		Effect.gen(function* () {
			const client = makeSession(getBackendUrlA());
			const data = yield* client.call((c) => c.system.config());
			expect(data.auth.oidcButtonLabel).toBe(OIDC_BUTTON_LABEL);
		}),
	);
});

describe("GET /system/config with local auth disabled (Backend B)", () => {
	it.live("returns localAuthDisabled: true", () =>
		Effect.gen(function* () {
			const client = makeSession(getBackendUrlB());
			const data = yield* client.call((c) => c.system.config());
			expect(data.auth.signupAllowed).toBe(false);
			expect(data.auth.localAuthDisabled).toBe(true);
		}),
	);
});

describe("sign-up/email with local auth disabled (Backend B)", () => {
	it.live("returns an error and does not create a user", () =>
		Effect.gen(function* () {
			const email = "test@example.com";
			const authClient = createTestAuthClient(getBackendUrlB());
			const { error } = yield* Effect.promise(() =>
				authClient.signUp.email({ email, name: "Test", password: "password123" }),
			);
			expect(error).toBeDefined();
			expect(yield* countUsersByEmail(getBackendUrlB(), email)).toBe(0);
		}),
	);
});

describe("OIDC sign-in happy path (Backend A)", () => {
	it.live("first-time OIDC sign-in produces a valid session", () =>
		Effect.gen(function* () {
			const username = `user-${crypto.randomUUID()}`;
			const sessionCookie = yield* Effect.promise(() =>
				oidcSignIn(requireMockOidcServer(), username, getBackendUrlA()),
			);
			const client = makeSession(getBackendUrlA());
			yield* client.call((c) => c.definitions.listWorkspaces({ urlParams: workspaceListQuery }), {
				Cookie: sessionCookie,
			});
		}),
	);

	it.live("first-time OIDC sign-in creates a user row", () =>
		Effect.gen(function* () {
			const username = `user-${crypto.randomUUID()}`;
			yield* Effect.promise(() => oidcSignIn(requireMockOidcServer(), username, getBackendUrlA()));
			expect(yield* countUsersByEmail(getBackendUrlA(), `${username}@example.com`)).toBe(1);
		}),
	);

	it.live("first-time OIDC sign-in bootstraps the user with plugin workspace state", () =>
		Effect.gen(function* () {
			const username = `user-${crypto.randomUUID()}`;
			const sessionCookie = yield* Effect.promise(() =>
				oidcSignIn(requireMockOidcServer(), username, getBackendUrlA()),
			);
			expect(yield* listWorkspaceCount(getBackendUrlA(), sessionCookie)).toBeGreaterThan(0);
		}),
	);

	it.live("first-time OIDC sign-in bootstraps the user with the default notification rules", () =>
		Effect.gen(function* () {
			const username = `user-${crypto.randomUUID()}`;
			const sessionCookie = yield* Effect.promise(() =>
				oidcSignIn(requireMockOidcServer(), username, getBackendUrlA()),
			);

			const client = makeSession(getBackendUrlA());
			const headers = { Cookie: sessionCookie };
			const [catalog, rules] = yield* Effect.all([
				client.call((c) => c.automations.listCatalog(), headers),
				client.call((c) => c.automations.listRules(), headers),
			]);
			expect(rules).toHaveLength(catalog.length);
			expect(rules.map((rule) => rule.signalSchema.id).sort()).toEqual(
				catalog.map((schema) => schema.id).sort(),
			);
			expect(rules.every((rule) => rule.isActive)).toBe(true);
		}),
	);
});

describe("OIDC idempotency (Backend A)", () => {
	it.live("repeated OIDC sign-in with same identity reuses the same user row", () =>
		Effect.gen(function* () {
			const username = `user-${crypto.randomUUID()}`;

			const cookie1 = yield* Effect.promise(() =>
				oidcSignIn(requireMockOidcServer(), username, getBackendUrlA()),
			);
			const cookie2 = yield* Effect.promise(() =>
				oidcSignIn(requireMockOidcServer(), username, getBackendUrlA()),
			);

			expect(yield* countUsersByEmail(getBackendUrlA(), `${username}@example.com`)).toBe(1);

			const client = makeSession(getBackendUrlA());
			yield* Effect.all([
				client.call((c) => c.definitions.listWorkspaces({ urlParams: workspaceListQuery }), {
					Cookie: cookie1,
				}),
				client.call((c) => c.definitions.listWorkspaces({ urlParams: workspaceListQuery }), {
					Cookie: cookie2,
				}),
			]);
		}),
	);

	it.live("bootstrap idempotency: workspace count is the same after two sign-ins", () =>
		Effect.gen(function* () {
			const username = `user-${crypto.randomUUID()}`;

			const cookie1 = yield* Effect.promise(() =>
				oidcSignIn(requireMockOidcServer(), username, getBackendUrlA()),
			);
			const firstCount = yield* listWorkspaceCount(getBackendUrlA(), cookie1);
			expect(firstCount).toBeGreaterThan(0);

			const cookie2 = yield* Effect.promise(() =>
				oidcSignIn(requireMockOidcServer(), username, getBackendUrlA()),
			);
			const secondCount = yield* listWorkspaceCount(getBackendUrlA(), cookie2);
			expect(secondCount).toBe(firstCount);
		}),
	);
});

describe("Registration gating for OIDC (Backend C)", () => {
	it.live("first-time OIDC sign-in is rejected when registration is disabled", () =>
		Effect.gen(function* () {
			const username = `user-${crypto.randomUUID()}`;
			const backendUrl = getBackendUrlC();

			const step3Response = yield* Effect.promise(() =>
				performOidcSignIn(requireMockOidcServer(), username, backendUrl),
			);
			const step3Location = step3Response.headers.get("location");
			expect(step3Response.status).toBe(302);
			expect(step3Location).toMatch(/signup_disabled/i);

			const sessionCookie = step3Response.headers.get("set-cookie");
			const hasSessionCookie = sessionCookie?.includes("session_token") ?? false;
			expect(
				hasSessionCookie,
				"Backend C must not issue a session when registration is disabled",
			).toBe(false);

			expect(
				yield* countUsersByEmail(getBackendUrlC(), `${username}@example.com`),
				"No user row must be created when registration is disabled",
			).toBe(0);
		}),
	);

	it.live("existing OIDC users can still sign in when registration is disabled", () =>
		Effect.gen(function* () {
			const username = `user-${crypto.randomUUID()}`;
			const email = `${username}@example.com`;

			yield* Effect.promise(() => oidcSignIn(requireMockOidcServer(), username, getBackendUrlA()));
			const beforeId = yield* findUserIdByEmail(getBackendUrlA(), email);
			expect(beforeId).not.toBeNull();

			const sessionCookie = yield* Effect.promise(() =>
				oidcSignIn(requireMockOidcServer(), username, getBackendUrlC()),
			);
			const client = makeSession(getBackendUrlC());
			yield* client.call((c) => c.definitions.listWorkspaces({ urlParams: workspaceListQuery }), {
				Cookie: sessionCookie,
			});

			const afterId = yield* findUserIdByEmail(getBackendUrlC(), email);
			expect(afterId).toBe(beforeId);
		}),
	);
});
