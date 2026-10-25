import { request as httpRequest } from "node:http";
import path from "node:path";
import { getGraphqlClient } from "src/utils";
import { beforeAll, describe, expect, it } from "vitest";
import { registerPasswordUser } from "../setup/authentication-fixtures";
import { withFrontendService } from "../setup/frontend-server";

describe("Frontend action origins without FRONTEND_URL", () => {
	const paths = ["/auth", "/auth.data"];
	const url = process.env.API_BASE_URL as string;
	let credentials: Awaited<ReturnType<typeof registerPasswordUser>>;

	beforeAll(async () => {
		credentials = await registerPasswordUser(getGraphqlClient(url));
	});

	const login = (
		route: string,
		headers: Record<string, string>,
		baseUrl = url,
	) =>
		new Promise<Response>((resolve, reject) => {
			const request = httpRequest(
				`${baseUrl}${route}?intent=login`,
				{
					method: "POST",
					headers: {
						...headers,
						"Content-Type": "application/x-www-form-urlencoded",
					},
				},
				(response) => {
					const chunks: Buffer[] = [];
					const responseHeaders = new Headers();
					for (let index = 0; index < response.rawHeaders.length; index += 2) {
						responseHeaders.append(
							response.rawHeaders[index],
							response.rawHeaders[index + 1],
						);
					}
					response.on("error", reject);
					response.on("data", (chunk: Buffer) => chunks.push(chunk));
					response.on("end", () => {
						resolve(
							new Response(Buffer.concat(chunks), {
								headers: responseHeaders,
								status: response.statusCode,
							}),
						);
					});
				},
			);
			request.on("error", reject);
			request.end(
				new URLSearchParams({
					tokenValidForDays: "1",
					username: credentials.username,
					password: credentials.password,
				}).toString(),
			);
		});

	const expectLogin = async (response: Response, route: string) => {
		if (route === "/auth") {
			expect(response.status).toBe(302);
			expect(response.headers.get("location")).toBe("/");
		} else {
			expect(response.status).toBe(202);
			expect(await response.text()).toContain("redirect");
		}
		expect(
			response.headers
				.getSetCookie()
				.some((cookie) => cookie.startsWith("Auth=")),
		).toBe(true);
	};

	it.each(paths)("allows direct HTTP login via %s", async (route) => {
		await expectLogin(await login(route, { Origin: url }), route);
	});

	it.each(paths)("allows HTTPS proxy login via %s", async (route) => {
		const origin = new URL(url);
		origin.protocol = "https:";
		const response = await login(route, {
			"X-Forwarded-Proto": "https",
			Origin: origin.origin,
		});
		await expectLogin(response, route);
	});

	it.each([
		"https://ryot.example.com",
		"https://ryot.example.com:8443",
		"http://192.168.1.50:8000",
		"http://[::1]:8000",
	])("allows the public host and port from %s", async (publicUrl) => {
		const origin = new URL(publicUrl);
		const response = await login("/auth.data", {
			Host: origin.host,
			Origin: origin.origin,
			"X-Forwarded-Proto": origin.protocol.slice(0, -1),
		});
		await expectLogin(response, "/auth.data");
	});

	it.each(paths)("rejects foreign origins via %s", async (route) => {
		const response = await login(route, {
			"X-Forwarded-Proto": "https",
			Origin: "https://attacker.example.com",
		});
		expect(response.status).toBe(400);
		expect(response.headers.getSetCookie()).toHaveLength(0);
	});

	it("rejects a protocol mismatch instead of allowlisting the host", async () => {
		const origin = new URL(url);
		origin.protocol = "https:";
		const response = await login("/auth.data", {
			"X-Forwarded-Proto": "http",
			Origin: origin.origin,
		});
		expect(response.status).toBe(400);
		expect(response.headers.getSetCookie()).toHaveLength(0);
	});

	it("rejects an origin with a different port", async () => {
		const origin = new URL(url);
		origin.port = "8443";
		const response = await login("/auth.data", { Origin: origin.origin });
		expect(response.status).toBe(400);
		expect(response.headers.getSetCookie()).toHaveLength(0);
	});

	it.each([
		undefined,
		"production",
	])("renders pages when NODE_ENV is %s", async (nodeEnv) => {
		await withFrontendService(
			process.execPath,
			["./server.mjs"],
			{
				FRONTEND_URL: "",
				NODE_ENV: nodeEnv,
				API_URL: `${url}/backend`,
			},
			async (frontendUrl) => {
				const response = await fetch(
					`${frontendUrl}/auth?autoOidcLaunch=false`,
				);
				expect(response.status).toBe(200);
				expect(await response.text()).toContain("Authentication | Ryot");
				await expectLogin(
					await login("/auth.data", { Origin: frontendUrl }, frontendUrl),
					"/auth.data",
				);
			},
		);
	});

	it("does not use FRONTEND_URL to validate login", async () => {
		await withFrontendService(
			process.execPath,
			["./server.mjs"],
			{
				API_URL: `${url}/backend`,
				FRONTEND_URL: "https://incorrect.example.com",
			},
			async (frontendUrl) => {
				const response = await login(
					"/auth.data",
					{ Origin: frontendUrl },
					frontendUrl,
				);
				await expectLogin(response, "/auth.data");
				const maliciousResponse = await login(
					"//attacker.example.com/auth.data",
					{
						"X-Forwarded-Proto": "https",
						Origin: "https://attacker.example.com",
					},
					frontendUrl,
				);
				expect(maliciousResponse.status).toBe(400);
				expect(maliciousResponse.headers.getSetCookie()).toHaveLength(0);
			},
		);
	});

	it("discards forwarding headers supplied by an untrusted peer", async () => {
		await withFrontendService(
			"caddy",
			["run", "--config", path.resolve(__dirname, "../../../ci/Caddyfile")],
			{
				CADDY_FRONTEND_TARGET: new URL(url).host,
				CADDY_BACKEND_TARGET: new URL(url).host,
				CADDY_TRUSTED_PROXIES: "192.0.2.0/24",
			},
			async (proxyUrl) => {
				const response = await login(
					"/auth.data",
					{
						Origin: "https://attacker.example.com",
						"X-Forwarded-Proto": "https",
						"X-Forwarded-Host": "attacker.example.com",
					},
					proxyUrl,
				);
				expect(response.status).toBe(400);
				expect(response.headers.getSetCookie()).toHaveLength(0);
			},
		);
	});
});
