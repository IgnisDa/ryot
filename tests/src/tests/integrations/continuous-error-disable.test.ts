import { Duration, Effect } from "effect";

import {
	createAuthenticatedClient,
	createIntegration,
	createNotificationChannel,
	getIntegration,
	pollUntil,
	postIntegrationWebhookAndWait,
	startFakeAppriseServer,
} from "~/fixtures";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";
import type { FakeHttpServer } from "~/support/fake-http-server";

let fakeApprise: FakeHttpServer;

beforeAll(async () => {
	fakeApprise = await startFakeAppriseServer();
});

afterAll(() => {
	fakeApprise.stop();
});

describe("integration auto-disable on continuous errors", () => {
	it.live(
		"disables after 5 consecutive failed runs and notifies through its subscription once",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();

				yield* createNotificationChannel(client, {
					channel: "apprise",
					channelSpecifics: { baseUrl: fakeApprise.url, key: "enabled", kind: "apprise" },
				});
				yield* createNotificationChannel(client, {
					isDisabled: true,
					channel: "apprise",
					channelSpecifics: { baseUrl: fakeApprise.url, key: "disabled", kind: "apprise" },
				});

				const { id } = yield* createIntegration(client, {
					provider: "kodi",
					providerSpecifics: { kind: "kodi" },
					extraSettings: { disableOnContinuousErrors: true },
				});

				// An empty payload passes the contract schema but fails Kodi sink parsing,
				// producing a genuinely failed run on an enabled integration. The runs must be
				// sequential so the recent-status window sees 5 consecutive failures.
				for (let attempt = 0; attempt < 5; attempt++) {
					const { run } = yield* postIntegrationWebhookAndWait(client, id, {});
					expect(run.status).toBe("failed");
				}

				const disabled = yield* pollUntil(
					"integration auto-disable",
					Effect.gen(function* () {
						const integration = yield* getIntegration(client, id);
						return integration.isDisabled ? integration : null;
					}),
				);
				expect(disabled.isDisabled).toBe(true);

				const delivered = yield* pollUntil(
					"integration-disabled notification delivery",
					Effect.sync(() => {
						const match = fakeApprise.requests.find(
							(request) => request.path === "/notify/enabled",
						);
						return match ?? null;
					}),
				);
				expect(delivered.body).toEqual({
					title: "Ryot",
					body: "Integration kodi has been disabled due to too many errors",
				});
				expect(
					fakeApprise.requests.filter((request) => request.path === "/notify/disabled"),
				).toEqual([]);

				// A further webhook fails fast at the disabled-integration guard without
				// running the workflow, so no duplicate notification is produced.
				const { run: afterDisableRun } = yield* postIntegrationWebhookAndWait(client, id, {});
				expect(afterDisableRun.status).toBe("failed");

				yield* Effect.sleep(Duration.millis(3000));
				expect(
					fakeApprise.requests.filter((request) => request.path === "/notify/enabled"),
				).toHaveLength(1);
			}),
	);
});
