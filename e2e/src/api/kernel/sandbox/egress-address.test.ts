import { notificationOutcomeRecipe } from "@ryot-app/ryotql-recipes/notification-delivery";
import { startFakeHttpServerScoped } from "@ryot-app/testing/fake-http-server";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createNotificationChannel,
	pollUntil,
	runSandboxHttpCall,
	testNotificationChannels,
} from "~/fixtures/kernel";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { describe, expect, it } from "~/support/effect-test";

const METADATA_URL = "http://169.254.169.254/latest/meta-data/";

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
				expect([url, yield* runSandboxHttpCall("egress-address", url)]).toMatchObject([
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

			expect(yield* runSandboxHttpCall("egress-address", `${server.url}/plain`)).toMatchObject({
				success: true,
				data: { status: 200, body: "reached" },
			});
			expect(server.requests.map((request) => request.path)).toEqual(["/plain"]);
		}),
	);

	it.live("rejects notification redirects and unlisted destinations", () =>
		Effect.gen(function* () {
			const server = yield* redirectingServer;
			const ipv6Server = yield* startFakeHttpServerScoped(undefined, "::1");
			const { client } = yield* createAuthenticatedClient();
			for (const { key, baseUrl } of [
				{ key: "direct", baseUrl: server.url },
				{ key: "relative", baseUrl: server.url },
				{ key: "metadata", baseUrl: server.url },
				{ key: "ipv6", baseUrl: ipv6Server.url },
			]) {
				yield* createNotificationChannel(client, {
					channelSpecifics: { key, baseUrl, kind: "apprise" },
				});
			}

			const admitted = yield* testNotificationChannels(client);
			const outcome = yield* pollUntil(
				"settled notification outcome",
				executeRyotQLRecipe(client, notificationOutcomeRecipe, { id: admitted.id }).pipe(
					Effect.map((result) => (result?.state === "settled" ? result : null)),
				),
			);
			expect(outcome.outcome).toBe("partial");
			expect(server.requests.map((request) => request.path).sort()).toEqual([
				"/notify/direct",
				"/notify/metadata",
				"/notify/relative",
			]);
			const delivered = server.requests.find((request) => request.path === "/notify/direct");
			expect(delivered?.headers["host"]).toBe(new URL(server.url).host);
			expect(delivered?.body).toEqual({
				title: "Ryot",
				body: "This is a test notification sent through Apprise.",
			});
			expect(ipv6Server.requests).toEqual([]);
		}),
	);
});
