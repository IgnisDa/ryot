import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { ChildProcess } from "node:child_process";

import getPort from "get-port";

import { adminHeaders, makeSession } from "~/fixtures";
import { createTestAuthClient } from "~/fixtures/auth";
import {
	type MockOidcServer,
	oidcSignIn,
	startMockOidcServer,
	stopMockOidcServer,
} from "~/fixtures/auth-oidc";
import { requirePresent } from "~/support/assertions";
import {
	attachProcessLogs,
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
const trackersListQuery = { includeDisabled: false };
const godModeListQuery = (search: string) => ({ limit: 50, offset: 0, search });

async function countUsersByEmail(backendUrl: string, email: string) {
	const data = await makeSession(backendUrl).run(
		(c) => c.godMode.listUsers({ urlParams: godModeListQuery(email) }),
		adminHeaders,
	);
	return data.total;
}

async function findUserIdByEmail(backendUrl: string, email: string) {
	const data = await makeSession(backendUrl).run(
		(c) => c.godMode.listUsers({ urlParams: godModeListQuery(email) }),
		adminHeaders,
	);
	return data.users[0]?.id ?? null;
}

async function listTrackerCount(backendUrl: string, cookie: string) {
	const trackers = await makeSession(backendUrl).run(
		(c) => c.trackers.list({ urlParams: trackersListQuery }),
		{ Cookie: cookie },
	);
	return trackers.length;
}

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
		SERVER_OIDC_ISSUER_URL: requireMockOidcServer().issuerUrl,
		SERVER_OIDC_CLIENT_SECRET: OIDC_CLIENT_SECRET,
	};
	const startBackend = (
		label: string,
		frontendUrl: string,
		port: number,
		extraEnv: Record<string, string> = {},
	) => {
		const proc = spawnBackendProcess(
			buildBackendEnv({
				port,
				frontendUrl,
				dbUrl: infrastructure.dbUrl,
				s3BucketName: S3_BUCKET_NAME,
				redisUrl: infrastructure.redisUrl,
				s3Endpoint: infrastructure.s3Endpoint,
				extraEnv: { ...sharedEnv, ...extraEnv },
			}),
		);
		attachProcessLogs(proc, `Backend ${label}`);
		return proc;
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
	it("returns oidcEnabled: true", async () => {
		const client = makeSession(getBackendUrlA());
		const data = await client.run((c) => c.system.config());
		expect(data.auth.oidcEnabled).toBe(true);
	});

	it("returns oidcButtonLabel from env var", async () => {
		const client = makeSession(getBackendUrlA());
		const data = await client.run((c) => c.system.config());
		expect(data.auth.oidcButtonLabel).toBe(OIDC_BUTTON_LABEL);
	});
});

describe("GET /system/config with local auth disabled (Backend B)", () => {
	it("returns localAuthDisabled: true", async () => {
		const client = makeSession(getBackendUrlB());
		const data = await client.run((c) => c.system.config());
		expect(data.auth.signupAllowed).toBe(false);
		expect(data.auth.localAuthDisabled).toBe(true);
	});
});

describe("sign-up/email with local auth disabled (Backend B)", () => {
	it("returns an error and does not create a user", async () => {
		const email = "test@example.com";
		const authClient = createTestAuthClient(getBackendUrlB());
		const { error } = await authClient.signUp.email({
			email,
			name: "Test",
			password: "password123",
		});
		expect(error).toBeDefined();
		expect(await countUsersByEmail(getBackendUrlB(), email)).toBe(0);
	});
});

describe("OIDC sign-in happy path (Backend A)", () => {
	it("first-time OIDC sign-in produces a valid session", async () => {
		const username = `user-${crypto.randomUUID()}`;
		const sessionCookie = await oidcSignIn(requireMockOidcServer(), username, getBackendUrlA());
		const client = makeSession(getBackendUrlA());
		await client.run((c) => c.trackers.list({ urlParams: trackersListQuery }), {
			Cookie: sessionCookie,
		});
	});

	it("first-time OIDC sign-in creates a user row", async () => {
		const username = `user-${crypto.randomUUID()}`;
		await oidcSignIn(requireMockOidcServer(), username, getBackendUrlA());
		expect(await countUsersByEmail(getBackendUrlA(), `${username}@example.com`)).toBe(1);
	});

	it("first-time OIDC sign-in bootstraps the user with tracker rows", async () => {
		const username = `user-${crypto.randomUUID()}`;
		const sessionCookie = await oidcSignIn(requireMockOidcServer(), username, getBackendUrlA());
		expect(await listTrackerCount(getBackendUrlA(), sessionCookie)).toBeGreaterThan(0);
	});
});

describe("OIDC idempotency (Backend A)", () => {
	it("repeated OIDC sign-in with same identity reuses the same user row", async () => {
		const username = `user-${crypto.randomUUID()}`;

		const cookie1 = await oidcSignIn(requireMockOidcServer(), username, getBackendUrlA());
		const cookie2 = await oidcSignIn(requireMockOidcServer(), username, getBackendUrlA());

		expect(await countUsersByEmail(getBackendUrlA(), `${username}@example.com`)).toBe(1);

		const client = makeSession(getBackendUrlA());
		await Promise.all([
			client.run((c) => c.trackers.list({ urlParams: trackersListQuery }), { Cookie: cookie1 }),
			client.run((c) => c.trackers.list({ urlParams: trackersListQuery }), { Cookie: cookie2 }),
		]);
	});

	it("bootstrap idempotency: tracker count is the same after two sign-ins", async () => {
		const username = `user-${crypto.randomUUID()}`;

		const cookie1 = await oidcSignIn(requireMockOidcServer(), username, getBackendUrlA());
		const firstCount = await listTrackerCount(getBackendUrlA(), cookie1);
		expect(firstCount).toBeGreaterThan(0);

		const cookie2 = await oidcSignIn(requireMockOidcServer(), username, getBackendUrlA());
		const secondCount = await listTrackerCount(getBackendUrlA(), cookie2);
		expect(secondCount).toBe(firstCount);
	});
});

describe("Registration gating for OIDC (Backend C)", () => {
	it("first-time OIDC sign-in is rejected when registration is disabled", async () => {
		const username = `user-${crypto.randomUUID()}`;
		const backendUrl = getBackendUrlC();

		const step1Response = await fetch(`${backendUrl}/auth/sign-in/oauth2`, {
			method: "POST",
			redirect: "manual",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ providerId: "oidc", callbackURL: `${new URL(backendUrl).origin}/` }),
		});
		const step1Data: { url?: string } = await step1Response.json();
		const stateCookieHeader = requirePresent(
			step1Response.headers.get("set-cookie"),
			`Step 1 failed: url=${step1Data.url}, cookie=${step1Response.headers.get("set-cookie")}`,
		);
		const authorizeUrl = requirePresent(
			step1Data.url,
			`Step 1 failed: url=${step1Data.url}, cookie=${stateCookieHeader}`,
		);
		const [stateCookie] = stateCookieHeader.split(";");

		requireMockOidcServer().setNextClaims({
			sub: username,
			name: username,
			email: `${username}@example.com`,
		});
		const step2Response = await fetch(authorizeUrl, { redirect: "manual" });
		const callbackUrl = requirePresent(
			step2Response.headers.get("location"),
			"Step 2 failed: no location header",
		);

		const cookieValue = stateCookie ?? "";
		const step3Response = await fetch(callbackUrl, {
			redirect: "manual",
			headers: { Cookie: cookieValue },
		});
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
			await countUsersByEmail(getBackendUrlC(), `${username}@example.com`),
			"No user row must be created when registration is disabled",
		).toBe(0);
	});

	it("existing OIDC users can still sign in when registration is disabled", async () => {
		const username = `user-${crypto.randomUUID()}`;
		const email = `${username}@example.com`;

		await oidcSignIn(requireMockOidcServer(), username, getBackendUrlA());
		const beforeId = await findUserIdByEmail(getBackendUrlA(), email);
		expect(beforeId).not.toBeNull();

		const sessionCookie = await oidcSignIn(requireMockOidcServer(), username, getBackendUrlC());
		const client = makeSession(getBackendUrlC());
		await client.run((c) => c.trackers.list({ urlParams: trackersListQuery }), {
			Cookie: sessionCookie,
		});

		const afterId = await findUserIdByEmail(getBackendUrlC(), email);
		expect(afterId).toBe(beforeId);
	});
});
