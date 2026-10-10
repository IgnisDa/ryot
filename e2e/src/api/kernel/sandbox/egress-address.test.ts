import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createNotificationChannel,
	enqueueSandboxScript,
	httpCallFailureSandboxSource,
	installSandboxScriptScoped,
	pollSandboxResult,
	pollUntil,
	requireCompletedSandboxValue,
	testNotificationChannels,
} from "~/fixtures/kernel";
import { describe, expect, it } from "~/support/effect-test";
import { startFakeHttpServerScoped } from "~/support/fake-http-server";

const METADATA_URL = "http://169.254.169.254/latest/meta-data/";

const runHttpCall = (url: string) =>
	Effect.gen(function* () {
		const { client, userId } = yield* createAuthenticatedClient();
		const slug = `egress-address-${crypto.randomUUID()}`;
		const { scriptId } = yield* installSandboxScriptScoped({
			slug,
			client,
			name: "egress-address",
			capabilities: ["httpCall"],
			source: httpCallFailureSandboxSource({ url, slug, name: "egress-address" }),
		});
		const { jobId } = yield* enqueueSandboxScript(userId, { scriptId, lane: "interactive" });
		return requireCompletedSandboxValue(yield* pollSandboxResult(userId, jobId));
	});

const redirectingServer = startFakeHttpServerScoped((url) => {
	if (url.pathname.endsWith("/metadata")) {
		return new Response(null, { status: 307, headers: { location: METADATA_URL } });
	}
	if (url.pathname.endsWith("/relative")) {
		return new Response(null, { status: 307, headers: { location: "landed" } });
	}
	return new Response("reached");
});

describe("outbound HTTP address policy", () => {
	it.live("denies special-purpose destinations from sandbox httpCall", () =>
		Effect.gen(function* () {
			const server = yield* redirectingServer;
			const port = new URL(server.url).port;

			for (const url of [
				METADATA_URL,
				`http://[::1]:${port}/`,
				`http://0.0.0.0:${port}/`,
				`${server.url}/metadata`,
			]) {
				expect([url, yield* runHttpCall(url)]).toMatchObject([
					url,
					{ success: false, data: { code: "destination-denied" } },
				]);
			}
			expect(server.requests.map((request) => request.path)).toEqual(["/metadata"]);
		}),
	);

	it.live("reaches an allowlisted loopback server from sandbox httpCall", () =>
		Effect.gen(function* () {
			const server = yield* redirectingServer;

			expect(yield* runHttpCall(`${server.url}/plain`)).toMatchObject({
				success: true,
				data: { status: 200, body: "reached" },
			});
			expect(server.requests.map((request) => request.path)).toEqual(["/plain"]);
		}),
	);

	it.live("re-checks every notification delivery hop", () =>
		Effect.gen(function* () {
			const server = yield* redirectingServer;
			const ipv6Server = yield* startFakeHttpServerScoped(undefined, "::1");
			const { client } = yield* createAuthenticatedClient();
			for (const { key, baseUrl } of [
				{ key: "relative", baseUrl: server.url },
				{ key: "metadata", baseUrl: server.url },
				{ key: "ipv6", baseUrl: ipv6Server.url },
			]) {
				yield* createNotificationChannel(client, {
					channel: "apprise",
					channelSpecifics: { key, baseUrl, kind: "apprise" },
				});
			}

			yield* testNotificationChannels(client);

			yield* pollUntil(
				"redirected notification delivery",
				Effect.sync(() =>
					server.requests.some((request) => request.path === "/notify/landed") ? true : null,
				),
			);
			yield* Effect.sleep("1 second");

			expect(server.requests.map((request) => request.path).sort()).toEqual([
				"/notify/landed",
				"/notify/metadata",
				"/notify/relative",
			]);
			const landed = server.requests.find((request) => request.path === "/notify/landed");
			expect(landed?.headers["host"]).toBe(new URL(server.url).host);
			expect(landed?.body).toEqual({
				title: "Ryot",
				body: "This is a test notification for channel: apprise",
			});
			expect(ipv6Server.requests).toEqual([]);
		}),
	);
});
