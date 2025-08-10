import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { ChildProcess } from "node:child_process";

import type { paths } from "@ryot/generated/openapi/app-backend";
import { config } from "dotenv";
import getPort from "get-port";
import createClient from "openapi-fetch";
import { Client as PgClient } from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

import { createTestAuthClient } from "../fixtures/auth";
import { oidcSignIn } from "../fixtures/auth-oidc";
import {
	attachProcessLogs,
	buildBackendEnv,
	startCoreTestInfrastructure,
	spawnBackendProcess,
	stopBackendProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "../test-support/provisioning";

config({ path: ".env" });

const OIDC_CLIENT_ID = "test-client";
const S3_BUCKET_NAME = "ryot-oidc-test";
const OIDC_CLIENT_SECRET = "test-secret";
const OIDC_BUTTON_LABEL = "Sign in with TestOIDC";

let backendPortA: number;
let backendPortB: number;
let backendPortC: number;
let oidcIssuerUrl: string;
let pgClientOidc: PgClient | undefined;
let backendProcessA: ChildProcess | undefined;
let backendProcessB: ChildProcess | undefined;
let backendProcessC: ChildProcess | undefined;
let oidcContainer: StartedTestContainer | undefined;
let coreInfrastructure: Awaited<ReturnType<typeof startCoreTestInfrastructure>> | undefined;

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
	if (!coreInfrastructure) {
		throw new Error("OIDC test infrastructure is not initialised");
	}

	return coreInfrastructure;
}

function requireOidcPgClient(): PgClient {
	if (!pgClientOidc) {
		throw new Error("OIDC PG client is not initialised");
	}
	return pgClientOidc;
}

beforeAll(async () => {
	coreInfrastructure = await startCoreTestInfrastructure({
		logPrefix: "OIDC Setup",
		bucketName: S3_BUCKET_NAME,
	});

	oidcContainer = await new GenericContainer("ghcr.io/navikt/mock-oauth2-server:2.1.10")
		.withExposedPorts(8080)
		.withWaitStrategy(Wait.forHttp("/default/.well-known/openid-configuration", 8080))
		.start();

	const oidcHost = oidcContainer.getHost();
	const oidcMappedPort = oidcContainer.getMappedPort(8080);
	oidcIssuerUrl = `http://${oidcHost}:${oidcMappedPort}/default`;

	[backendPortA, backendPortB, backendPortC] = await Promise.all([getPort(), getPort(), getPort()]);
	const backendOriginA = `http://127.0.0.1:${backendPortA}`;
	const backendOriginB = `http://127.0.0.1:${backendPortB}`;
	const backendOriginC = `http://127.0.0.1:${backendPortC}`;

	const infrastructure = requireCoreInfrastructure();
	const sharedEnv = {
		SERVER_OIDC_CLIENT_ID: OIDC_CLIENT_ID,
		SERVER_OIDC_ISSUER_URL: oidcIssuerUrl,
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

	pgClientOidc = new PgClient({ connectionString: infrastructure.dbUrl });
	await pgClientOidc.connect();

	console.log("[OIDC Setup] All backends ready!");
}, 120000);

afterAll(async () => {
	console.log("[OIDC Teardown] Stopping services...");

	await Promise.all([
		stopBackendProcess(backendProcessA),
		stopBackendProcess(backendProcessB),
		stopBackendProcess(backendProcessC),
	]);
	console.log("[OIDC Teardown] Backend processes stopped");

	await Promise.all([
		pgClientOidc?.end(),
		stopCoreTestInfrastructure(coreInfrastructure),
		oidcContainer?.stop(),
	]);

	console.log("[OIDC Teardown] Complete!");
});

describe("GET /system/config with OIDC enabled (Backend A)", () => {
	it("returns oidcEnabled: true", async () => {
		const client = createClient<paths>({ baseUrl: getBackendUrlA() });
		const { data } = await client.GET("/system/config");
		expect(data?.data.auth.oidcEnabled).toBe(true);
	});

	it("returns oidcButtonLabel from env var", async () => {
		const client = createClient<paths>({ baseUrl: getBackendUrlA() });
		const { data } = await client.GET("/system/config");
		expect(data?.data.auth.oidcButtonLabel).toBe(OIDC_BUTTON_LABEL);
	});
});

describe("GET /system/config with local auth disabled (Backend B)", () => {
	it("returns localAuthDisabled: true", async () => {
		const client = createClient<paths>({ baseUrl: getBackendUrlB() });
		const { data } = await client.GET("/system/config");
		expect(data?.data.auth.signupAllowed).toBe(false);
		expect(data?.data.auth.localAuthDisabled).toBe(true);
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

		const pg = requireOidcPgClient();
		const result = await pg.query<{ count: string }>(
			`SELECT count(*) FROM "user" WHERE email = $1`,
			[email],
		);
		expect(Number(result.rows[0]?.count)).toBe(0);
	});
});

describe("OIDC sign-in happy path (Backend A)", () => {
	it("first-time OIDC sign-in produces a valid session", async () => {
		const username = `user-${crypto.randomUUID()}`;
		const sessionCookie = await oidcSignIn(username, getBackendUrlA());
		const client = createClient<paths>({ baseUrl: getBackendUrlA() });
		const { response } = await client.GET("/trackers", { headers: { Cookie: sessionCookie } });
		expect(response.status).toBe(200);
	});

	it("first-time OIDC sign-in creates a user row", async () => {
		const username = `user-${crypto.randomUUID()}`;
		await oidcSignIn(username, getBackendUrlA());
		const result = await requireOidcPgClient().query<{ id: string }>(
			`SELECT id FROM "user" WHERE email = $1`,
			[`${username}@example.com`],
		);
		expect(result.rows.length).toBe(1);
	});

	it("first-time OIDC sign-in bootstraps the user with tracker rows", async () => {
		const username = `user-${crypto.randomUUID()}`;
		await oidcSignIn(username, getBackendUrlA());
		const userResult = await requireOidcPgClient().query<{ id: string }>(
			`SELECT id FROM "user" WHERE email = $1`,
			[`${username}@example.com`],
		);
		const userId = userResult.rows[0]?.id;
		const trackerResult = await requireOidcPgClient().query<{ count: string }>(
			`SELECT count(*) FROM tracker WHERE user_id = $1`,
			[userId],
		);
		expect(Number(trackerResult.rows[0]?.count)).toBeGreaterThan(0);
	});
});

describe("OIDC idempotency (Backend A)", () => {
	it("repeated OIDC sign-in with same identity reuses the same user row", async () => {
		const username = `user-${crypto.randomUUID()}`;
		const pg = requireOidcPgClient();

		const cookie1 = await oidcSignIn(username, getBackendUrlA());
		const cookie2 = await oidcSignIn(username, getBackendUrlA());

		const userResult = await pg.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
			`${username}@example.com`,
		]);
		expect(userResult.rows.length).toBe(1);

		const client = createClient<paths>({ baseUrl: getBackendUrlA() });
		const [res1, res2] = await Promise.all([
			client.GET("/trackers", { headers: { Cookie: cookie1 } }),
			client.GET("/trackers", { headers: { Cookie: cookie2 } }),
		]);
		expect(res1.response.status).toBe(200);
		expect(res2.response.status).toBe(200);
	});

	it("bootstrap idempotency: tracker count is the same after two sign-ins", async () => {
		const username = `user-${crypto.randomUUID()}`;
		const pg = requireOidcPgClient();

		await oidcSignIn(username, getBackendUrlA());
		const userResult = await pg.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
			`${username}@example.com`,
		]);
		const userId = userResult.rows[0]?.id;

		const countAfterFirst = await pg.query<{ count: string }>(
			`SELECT count(*) FROM tracker WHERE user_id = $1`,
			[userId],
		);
		const firstCount = Number(countAfterFirst.rows[0]?.count);
		expect(firstCount).toBeGreaterThan(0);

		await oidcSignIn(username, getBackendUrlA());

		const countAfterSecond = await pg.query<{ count: string }>(
			`SELECT count(*) FROM tracker WHERE user_id = $1`,
			[userId],
		);
		expect(Number(countAfterSecond.rows[0]?.count)).toBe(firstCount);
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
		const authorizeUrl = step1Data.url;
		const stateCookieHeader = step1Response.headers.get("set-cookie");
		if (!authorizeUrl || !stateCookieHeader) {
			throw new Error(`Step 1 failed: url=${authorizeUrl}, cookie=${stateCookieHeader}`);
		}
		const [stateCookie] = stateCookieHeader.split(";");

		const resolvedClaims = { name: username, email: `${username}@example.com` };
		const formBody = new URLSearchParams();
		formBody.set("username", username);
		formBody.set("claims", JSON.stringify(resolvedClaims));
		const step2Response = await fetch(authorizeUrl, {
			method: "POST",
			redirect: "manual",
			body: formBody.toString(),
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
		});
		const callbackUrl = step2Response.headers.get("location");
		if (!callbackUrl) {
			throw new Error("Step 2 failed: no location header");
		}

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

		const result = await requireOidcPgClient().query<{ count: string }>(
			`SELECT count(*) FROM "user" WHERE email = $1`,
			[`${username}@example.com`],
		);
		expect(
			Number(result.rows[0]?.count),
			"No user row must be created when registration is disabled",
		).toBe(0);
	});

	it("existing OIDC users can still sign in when registration is disabled", async () => {
		const username = `user-${crypto.randomUUID()}`;
		const email = `${username}@example.com`;
		const pg = requireOidcPgClient();

		await oidcSignIn(username, getBackendUrlA());
		const beforeResult = await pg.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
			email,
		]);
		expect(beforeResult.rows.length).toBe(1);
		const userId = beforeResult.rows[0]?.id;

		const sessionCookie = await oidcSignIn(username, getBackendUrlC());
		const client = createClient<paths>({ baseUrl: getBackendUrlC() });
		const { response } = await client.GET("/trackers", { headers: { Cookie: sessionCookie } });
		expect(response.status).toBe(200);

		const afterResult = await pg.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
			email,
		]);
		expect(afterResult.rows.length).toBe(1);
		expect(afterResult.rows[0]?.id).toBe(userId);
	});
});

describe("OIDC account linking (Backend A)", () => {
	it("OIDC sign-in with email matching existing local user links to that account", async () => {
		const username = `user-${crypto.randomUUID()}`;
		const email = `${username}@example.com`;
		const pg = requireOidcPgClient();
		const authClient = createTestAuthClient(getBackendUrlA());

		const { error } = await authClient.signUp.email({
			email,
			name: "Test",
			password: "password123",
		});
		expect(error).toBeNull();

		const localResult = await pg.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
			email,
		]);
		expect(localResult.rows.length).toBe(1);
		const localUserId = localResult.rows[0]?.id;

		// `signUp.email` leaves the row unverified, and Better Auth only auto-links verified local users.
		await pg.query(`UPDATE "user" SET email_verified = true WHERE email = $1`, [email]);

		const sessionCookie = await oidcSignIn(username, getBackendUrlA(), {
			email,
			name: "Test User",
		});

		const afterResult = await pg.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
			email,
		]);
		expect(afterResult.rows.length).toBe(1);
		expect(afterResult.rows[0]?.id).toBe(localUserId);

		const accountResult = await pg.query<{
			accountId: string;
			providerId: string;
			userId: string;
		}>(
			`SELECT account_id AS "accountId", provider_id AS "providerId", user_id AS "userId" FROM account WHERE user_id = $1 AND provider_id = $2`,
			[localUserId, "oidc"],
		);
		expect(accountResult.rows.length).toBe(1);
		expect(accountResult.rows[0]?.providerId).toBe("oidc");
		expect(accountResult.rows[0]?.userId).toBe(localUserId);
		expect(accountResult.rows[0]?.accountId).toBe(username);

		const client = createClient<paths>({ baseUrl: getBackendUrlA() });
		const { response } = await client.GET("/trackers", { headers: { Cookie: sessionCookie } });
		expect(response.status).toBe(200);
	});
});
