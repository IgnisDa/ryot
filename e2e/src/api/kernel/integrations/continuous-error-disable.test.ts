import { Duration, Effect, Option } from "effect";

import {
	createAuthenticatedClient,
	createIntegration,
	createNotificationChannel,
	getIntegration,
	pollUntil,
	postIntegrationWebhookAndWait,
	startFakeAppriseServer,
} from "~/fixtures/kernel";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";
import type { FakeHttpServer } from "~/support/fake-http-server";

let fakeApprise: FakeHttpServer;

beforeAll(() =>
	runPromise(
		Effect.gen(function* () {
			fakeApprise = yield* startFakeAppriseServer;
		}),
	),
);

afterAll(() => fakeApprise.stop());

describe("integration auto-disable on continuous errors", () => {
	it.live(
		"disables after 5 consecutive failed runs and notifies through its subscription once",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();

				yield* createNotificationChannel(client, {
					channel: "apprise",
					channelSpecifics: { key: "enabled", kind: "apprise", baseUrl: fakeApprise.url },
				});
				yield* createNotificationChannel(client, {
					isDisabled: true,
					channel: "apprise",
					channelSpecifics: { key: "disabled", kind: "apprise", baseUrl: fakeApprise.url },
				});

				const integration = yield* createIntegration(client, {
					provider: "kodi",
					providerSpecifics: { kind: "kodi" },
					extraSettings: { disableOnContinuousErrors: true },
				});

				for (let attempt = 0; attempt < 5; attempt++) {
					const { run } = yield* postIntegrationWebhookAndWait(client, integration, {});
					expect(run).toMatchObject({
						status: "failed",
						failureReason: { code: "input-transformation-failed" },
					});
				}

				const disabled = yield* pollUntil(
					"integration auto-disable",
					Effect.gen(function* () {
						const current = Option.getOrUndefined(yield* getIntegration(client, integration.id));
						if (!current?.isDisabled) {
							return null;
						}
						return current;
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

				const { run: afterDisableRun } = yield* postIntegrationWebhookAndWait(
					client,
					integration,
					{},
				);
				expect(afterDisableRun).toMatchObject({
					status: "failed",
					failureReason: { code: "integration-disabled" },
				});

				yield* Effect.sleep(Duration.millis(3000));
				expect(
					fakeApprise.requests.filter((request) => request.path === "/notify/enabled"),
				).toHaveLength(1);
			}),
	);
});
