import { fileURLToPath } from "node:url";

import { startFakeHttpServerScoped } from "@ryot-app/testing/fake-http-server";
import { postgresTestSetup } from "@ryot-app/testing/postgres-container";
import { stopTestProcess } from "@ryot-app/testing/process";
import { waitForHttpProcess } from "@ryot-app/testing/process-readiness";
import { webRequest } from "@ryot-app/testing/web-request";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { Effect } from "effect";
import getPort from "get-port";

import { customer, customerPurchase } from "../../../app/drizzle/schema.server";
import { fromPromise, WebsiteFailure } from "../../../app/server/effect.server";
import { startInbox } from "./inbox";

export const paddleSecret = "website-e2e-paddle";
export const polarSecret = "website-e2e-polar";

const cwd = fileURLToPath(new URL("../../..", import.meta.url));
const cli = fileURLToPath(
	new URL("./bin.cjs", import.meta.resolve("@react-router/serve/package.json")),
);

export const startWebsite = Effect.fn(function* (
	input: { instance?: { origin: string; adminToken: string } } = {},
) {
	const dbUrl = yield* postgresTestSetup({ label: "website" });
	const inbox = yield* startInbox();
	const port = yield* fromPromise(() => getPort());
	const origin = `http://127.0.0.1:${port}`;
	const turnstile = yield* startFakeHttpServerScoped((_url, req) =>
		Effect.promise(() => req.text()).pipe(
			Effect.map((body) =>
				Response.json({ success: new URLSearchParams(body).get("response") === "valid-captcha" }),
			),
		),
	);
	let keyCount = 0;
	const unkey = yield* startFakeHttpServerScoped((url, req) => {
		const meta = { requestId: "req_website_e2e" };
		switch (url.pathname) {
			case "/v2/keys.createKey":
				keyCount++;
				return Response.json({
					meta,
					data: { keyId: `key_${keyCount}`, key: `ryot-key-${keyCount}` },
				});
			case "/v2/keys.updateKey":
				return Response.json({ meta, data: {} });
			case "/v2/keys.verifyKey":
				return fromPromise(() => req.json()).pipe(
					Effect.orDie,
					Effect.map((payload: unknown) => {
						if (typeof payload === "object" && payload && "key" in payload) {
							if (payload.key === "upstream-failure") {
								return new Response(null, { status: 502 });
							}
							if (payload.key === "valid-key") {
								return Response.json({
									meta,
									data: { valid: true, code: "VALID", meta: { expiry: "2031-01-01" } },
								});
							}
						}
						return Response.json({ meta, data: { valid: false, code: "NOT_FOUND" } });
					}),
				);
			default:
				return new Response(null, { status: 404 });
		}
	});
	const child = yield* Effect.acquireRelease(
		Effect.sync(() =>
			Bun.spawn([process.execPath, "--no-orphans", cli, "./build/server/index.js"], {
				cwd,
				stdin: "ignore",
				stdout: "inherit",
				stderr: "inherit",
				env: {
					...process.env,
					HOST: "127.0.0.1",
					PORT: String(port),
					DATABASE_URL: dbUrl,
					FRONTEND_URL: origin,
					SERVER_SMTP_USER: "",
					POLAR_SANDBOX: "true",
					POLAR_AB_PERCENT: "0",
					NODE_ENV: "production",
					PADDLE_SANDBOX: "true",
					SERVER_SMTP_PASSWORD: "",
					SERVER_SMTP_SECURE: "false",
					UNKEY_SERVER_URL: unkey.url,
					SERVER_SMTP_SERVER: "127.0.0.1",
					UNKEY_API_ID: "api_website_e2e",
					UNKEY_ROOT_KEY: "test-unkey-root",
					POLAR_ACCESS_TOKEN: "test-website",
					PADDLE_CLIENT_TOKEN: "test-website",
					PADDLE_SERVER_TOKEN: "test-website",
					TURNSTILE_VERIFY_URL: turnstile.url,
					SERVER_OIDC_CLIENT_ID: "test-client",
					SERVER_SMTP_MAILBOX: "e2e@ryot.test",
					SERVER_SMTP_PORT: String(inbox.port),
					POLAR_WEBHOOK_SECRET_KEY: polarSecret,
					PADDLE_WEBHOOK_SECRET_KEY: paddleSecret,
					TURNSTILE_SITE_KEY: "turnstile-e2e-site",
					SERVER_OIDC_ISSUER_URL: "http://127.0.0.1:1",
					TURNSTILE_SECRET_KEY: "turnstile-e2e-secret",
					SERVER_OIDC_CLIENT_SECRET: "test-client-secret",
					UNKEY_PRO_VERIFICATION_KEY: "test-unkey-verify",
					RYOT_BASE_URL: input.instance?.origin ?? "http://127.0.0.1:1",
					SERVER_ADMIN_ACCESS_TOKEN: input.instance?.adminToken ?? "test-website-admin-key",
				},
			}),
		),
		(process) => stopTestProcess(process, "2 seconds"),
	);
	yield* waitForHttpProcess(`${origin}/health`, "Website", child);
	const db = yield* Effect.acquireRelease(
		Effect.sync(() => drizzle(dbUrl, { schema: { customer, customerPurchase } })),
		(connection) => Effect.promise(() => connection.$client.end()),
	);
	const customerIdFor = Effect.fn(function* (email: string) {
		const account = yield* fromPromise(() =>
			db.query.customer.findFirst({ where: eq(customer.email, email) }),
		);
		if (!account) {
			return yield* new WebsiteFailure({ cause: "Customer not found" });
		}
		return account.id;
	});
	const purchasesFor = (customerId: string) =>
		fromPromise(() =>
			db.query.customerPurchase.findMany({
				orderBy: [desc(customerPurchase.createdOn)],
				where: eq(customerPurchase.customerId, customerId),
			}),
		);
	return { inbox, unkey, origin, purchasesFor, customerIdFor };
});

export const postWebsiteForm = (origin: string, intent: string, fields: Record<string, string>) =>
	webRequest(new URL(`/?index&intent=${intent}`, origin), {
		method: "POST",
		redirect: "manual",
		body: new URLSearchParams(fields),
	});

export const readLoginCode = Effect.fn(function* (
	inbox: Effect.Success<ReturnType<typeof startInbox>>,
	email: string,
) {
	const message = yield* inbox.findMessage(email);
	const code = /\b[0-9]{6}\b/.exec(message.text ?? "")?.[0];
	if (!code) {
		return yield* new WebsiteFailure({ cause: "Login code absent from email" });
	}
	return code;
});

export const signInThroughWebsite = Effect.fn(function* (
	website: Effect.Success<ReturnType<typeof startWebsite>>,
	email: string,
) {
	const { inbox, origin } = website;
	const requested = yield* postWebsiteForm(origin, "sendLoginCode", {
		email,
		turnstileToken: "valid-captcha",
	});
	if (requested.status !== 302) {
		return yield* new WebsiteFailure({ cause: `Login code request returned ${requested.status}` });
	}
	const otpCode = yield* readLoginCode(inbox, email);
	const verified = yield* postWebsiteForm(origin, "registerWithEmail", { email, otpCode });
	const cookie = verified.headers.getSetCookie()[0]?.split(";")[0];
	if (verified.status !== 302 || !cookie) {
		return yield* new WebsiteFailure({
			cause: `Login code verification returned ${verified.status}`,
		});
	}
	return cookie;
});
