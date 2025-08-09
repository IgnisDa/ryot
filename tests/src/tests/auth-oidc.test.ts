import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";

import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { paths } from "@ryot/generated/openapi/app-backend";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { config } from "dotenv";
import getPort from "get-port";
import createClient from "openapi-fetch";
import { Client as PgClient } from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

import { oidcSignIn } from "../fixtures/auth-oidc";

config({ path: ".env" });

const S3_ACCESS_KEY = "rustfsadmin";
const S3_SECRET_KEY = "rustfsadmin";
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
let s3Container: StartedTestContainer | undefined;
let oidcContainer: StartedTestContainer | undefined;
let redisContainer: StartedTestContainer | undefined;
let pgContainer: StartedPostgreSqlContainer | undefined;

function getBackendUrlA() {
	return `http://127.0.0.1:${backendPortA}/api`;
}

function getBackendUrlB() {
	return `http://127.0.0.1:${backendPortB}/api`;
}

function getBackendUrlC() {
	return `http://127.0.0.1:${backendPortC}/api`;
}

function getOidcIssuerUrl() {
	return oidcIssuerUrl;
}

function requireOidcPgClient(): PgClient {
	if (!pgClientOidc) {
		throw new Error("OIDC PG client is not initialised");
	}
	return pgClientOidc;
}

function attachBackendLogs(label: string, proc: ChildProcess) {
	proc.stdout?.on("data", (data) => console.log(`[Backend ${label}] ${data}`));
	proc.stderr?.on("data", (data) => console.error(`[Backend ${label}] ${data}`));
}

function killBackend(proc: ChildProcess | undefined) {
	if (!proc || proc.killed) {
		return Promise.resolve();
	}
	return new Promise<void>((resolve) => {
		proc.once("exit", () => resolve());
		proc.kill("SIGINT");
	});
}

async function waitForHealthCheck(url: string, maxRetries = 30, retryDelay = 1000) {
	for (let i = 0; i < maxRetries; i++) {
		try {
			// oxlint-disable-next-line no-await-in-loop
			const response = await fetch(url);
			if (response.ok) {
				console.log(`[OIDC Setup] Health check passed for ${url}`);
				return;
			}
		} catch {}

		if (i < maxRetries - 1) {
			// oxlint-disable-next-line no-await-in-loop
			await new Promise((resolve) => setTimeout(resolve, retryDelay));
		}
	}
	throw new Error(`Health check failed for ${url} after ${maxRetries} retries`);
}

beforeAll(async () => {
	console.log("[OIDC Setup] Starting containers...");

	[pgContainer, redisContainer, s3Container, oidcContainer] = await Promise.all([
		new PostgreSqlContainer("postgres:18-alpine")
			.withDatabase("test_db")
			.withUsername("test_user")
			.withPassword("test_password")
			.withWaitStrategy(Wait.forLogMessage("database system is ready"))
			.start(),
		new GenericContainer("redis:alpine")
			.withExposedPorts(6379)
			.withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
			.start(),
		new GenericContainer("rustfs/rustfs")
			.withExposedPorts(9000)
			.withWaitStrategy(Wait.forHttp("/health", 9000))
			.start(),
		new GenericContainer("ghcr.io/navikt/mock-oauth2-server:2.1.10")
			.withExposedPorts(8080)
			.withWaitStrategy(Wait.forHttp("/default/.well-known/openid-configuration", 8080))
			.start(),
	]);

	const dbUrl = pgContainer.getConnectionUri();
	const redisHost = redisContainer.getHost();
	const redisPort = redisContainer.getMappedPort(6379);
	const s3Host = s3Container.getHost();
	const s3MappedPort = s3Container.getMappedPort(9000);
	const s3Endpoint = `http://${s3Host}:${s3MappedPort}`;
	const oidcHost = oidcContainer.getHost();
	const oidcMappedPort = oidcContainer.getMappedPort(8080);
	oidcIssuerUrl = `http://${oidcHost}:${oidcMappedPort}/default`;

	const s3Client = new S3Client({
		region: "us-east-1",
		endpoint: s3Endpoint,
		forcePathStyle: true,
		credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
	});

	await s3Client.send(new CreateBucketCommand({ Bucket: S3_BUCKET_NAME }));
	console.log(`[OIDC Setup] S3 bucket '${S3_BUCKET_NAME}' created at ${s3Endpoint}`);

	[backendPortA, backendPortB, backendPortC] = await Promise.all([getPort(), getPort(), getPort()]);
	const backendOriginA = `http://127.0.0.1:${backendPortA}`;
	const backendOriginB = `http://127.0.0.1:${backendPortB}`;
	const backendOriginC = `http://127.0.0.1:${backendPortC}`;

	const baseEnv = {
		...process.env,
		NODE_ENV: "test",
		DATABASE_URL: dbUrl,
		FILE_STORAGE_S3_URL: s3Endpoint,
		FILE_STORAGE_S3_REGION: "us-east-1",
		SERVER_OIDC_CLIENT_ID: OIDC_CLIENT_ID,
		SERVER_OIDC_ISSUER_URL: oidcIssuerUrl,
		FILE_STORAGE_S3_BUCKET_NAME: S3_BUCKET_NAME,
		FILE_STORAGE_S3_ACCESS_KEY_ID: S3_ACCESS_KEY,
		SERVER_OIDC_CLIENT_SECRET: OIDC_CLIENT_SECRET,
		SERVER_ADMIN_ACCESS_TOKEN: "test-admin-token",
		REDIS_URL: `redis://${redisHost}:${redisPort}`,
		FILE_STORAGE_S3_SECRET_ACCESS_KEY: S3_SECRET_KEY,
	};

	const spawnBackend = (env: Record<string, string | undefined>) => {
		const proc = spawn("bun", ["run", "src/index.ts"], {
			env,
			cwd: "../apps/app-backend",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return proc;
	};

	backendProcessA = spawnBackend({
		...baseEnv,
		FRONTEND_URL: backendOriginA,
		PORT: backendPortA.toString(),
		FRONTEND_OIDC_BUTTON_LABEL: OIDC_BUTTON_LABEL,
	});
	attachBackendLogs("A", backendProcessA);
	await waitForHealthCheck(`http://127.0.0.1:${backendPortA}/api/system/health`);

	backendProcessB = spawnBackend({
		...baseEnv,
		FRONTEND_URL: backendOriginB,
		PORT: backendPortB.toString(),
		USERS_DISABLE_LOCAL_AUTH: "true",
	});
	backendProcessC = spawnBackend({
		...baseEnv,
		FRONTEND_URL: backendOriginC,
		PORT: backendPortC.toString(),
		USERS_ALLOW_REGISTRATION: "false",
	});
	attachBackendLogs("B", backendProcessB);
	attachBackendLogs("C", backendProcessC);
	await Promise.all([
		waitForHealthCheck(`http://127.0.0.1:${backendPortB}/api/system/health`),
		waitForHealthCheck(`http://127.0.0.1:${backendPortC}/api/system/health`),
	]);

	pgClientOidc = new PgClient({ connectionString: dbUrl });
	await pgClientOidc.connect();

	console.log("[OIDC Setup] All backends ready!");
}, 120000);

afterAll(async () => {
	console.log("[OIDC Teardown] Stopping services...");

	await Promise.all([
		killBackend(backendProcessA),
		killBackend(backendProcessB),
		killBackend(backendProcessC),
	]);
	console.log("[OIDC Teardown] Backend processes stopped");

	await Promise.all([
		pgClientOidc?.end(),
		pgContainer?.stop(),
		s3Container?.stop(),
		redisContainer?.stop(),
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
		expect(data?.data.auth.localAuthDisabled).toBe(true);
	});
});

describe("POST /authentication/email with local auth disabled (Backend B)", () => {
	it("returns 400 and local auth disabled message", async () => {
		const response = await fetch(`${getBackendUrlB()}/authentication/email`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "test@example.com", name: "Test", password: "password123" }),
		});
		expect(response.status).toBe(400);
		const text = await response.text();
		expect(text).toContain("Local authentication is disabled");
	});
});

describe("OIDC sign-in happy path (Backend A)", () => {
	it("first-time OIDC sign-in produces a valid session", async () => {
		const username = `user-${crypto.randomUUID()}`;
		const sessionCookie = await oidcSignIn(username, getBackendUrlA(), getOidcIssuerUrl());
		const client = createClient<paths>({ baseUrl: getBackendUrlA() });
		const { response } = await client.GET("/trackers", { headers: { Cookie: sessionCookie } });
		expect(response.status).toBe(200);
	});

	it("first-time OIDC sign-in creates a user row", async () => {
		const username = `user-${crypto.randomUUID()}`;
		await oidcSignIn(username, getBackendUrlA(), getOidcIssuerUrl());
		const result = await requireOidcPgClient().query<{ id: string }>(
			`SELECT id FROM "user" WHERE email = $1`,
			[`${username}@example.com`],
		);
		expect(result.rows.length).toBe(1);
	});

	it("first-time OIDC sign-in bootstraps the user with tracker rows", async () => {
		const username = `user-${crypto.randomUUID()}`;
		await oidcSignIn(username, getBackendUrlA(), getOidcIssuerUrl());
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

		const cookie1 = await oidcSignIn(username, getBackendUrlA(), getOidcIssuerUrl());
		const cookie2 = await oidcSignIn(username, getBackendUrlA(), getOidcIssuerUrl());

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

		await oidcSignIn(username, getBackendUrlA(), getOidcIssuerUrl());
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

		await oidcSignIn(username, getBackendUrlA(), getOidcIssuerUrl());

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

		const formBody = new URLSearchParams();
		formBody.set("username", username);
		const step2Response = await fetch(authorizeUrl, {
			body: formBody.toString(),
			method: "POST",
			redirect: "manual",
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
});

describe("OIDC account linking (Backend A)", () => {
	it("OIDC sign-in with email matching existing local user links to that account", async () => {
		const username = `user-${crypto.randomUUID()}`;
		const email = `${username}@example.com`;
		const pg = requireOidcPgClient();

		const registerResponse = await fetch(`${getBackendUrlA()}/authentication/email`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, name: "Test", password: "password123" }),
		});
		expect(registerResponse.status).toBe(200);

		const localResult = await pg.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
			email,
		]);
		expect(localResult.rows.length).toBe(1);
		const localUserId = localResult.rows[0]?.id;

		const sessionCookie = await oidcSignIn(username, getBackendUrlA(), getOidcIssuerUrl(), {
			email,
			name: "Test User",
		});

		const afterResult = await pg.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [
			email,
		]);
		expect(afterResult.rows.length).toBe(1);
		expect(afterResult.rows[0]?.id).toBe(localUserId);

		const client = createClient<paths>({ baseUrl: getBackendUrlA() });
		const { response } = await client.GET("/trackers", { headers: { Cookie: sessionCookie } });
		expect(response.status).toBe(200);
	});
});
