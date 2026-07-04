import { NotificationChannelId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	createNotificationChannel,
	deleteNotificationChannel,
	findBuiltinSchemaBySlug,
	getBackendClient,
	listNotificationChannels,
	pollSignal,
	pollTerminalSubscriptionRuns,
	pollUntil,
	startFakeAppriseServer,
	testNotificationChannels,
	updateNotificationChannel,
} from "~/fixtures";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";
import type { FakeHttpServer } from "~/support/fake-http-server";

let fakeApprise: FakeHttpServer;

beforeAll(async () => {
	fakeApprise = await startFakeAppriseServer();
});

afterAll(() => {
	fakeApprise.stop();
});

describe("notification channel CRUD", () => {
	it.live("creates an enabled channel and returns a safe description", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			yield* createNotificationChannel(client, {
				channel: "apprise",
				channelSpecifics: { baseUrl: fakeApprise.url, key: "secret-key", kind: "apprise" },
			});

			const channels = yield* listNotificationChannels(client);
			const channel = requirePresent(channels[0], "Expected created notification channel");
			expect(channel.isDisabled).toBe(false);
			expect(channel.description).toBe(`Apprise at ${fakeApprise.url}`);
			expect(channel.description).not.toContain("secret-key");
		}),
	);

	it.live("updates the disabled state", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { id } = yield* createNotificationChannel(client, {
				channel: "telegram",
				channelSpecifics: { botToken: "bot-secret", chatId: "1234", kind: "telegram" },
			});

			const updated = yield* updateNotificationChannel(client, id, { isDisabled: true });
			expect(updated.isDisabled).toBe(true);
		}),
	);

	it.live("lists only the authenticated user's channels and protects mutations", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const other = yield* createAuthenticatedClient();
			const { id } = yield* createNotificationChannel(owner.client, {
				channel: "push_safer",
				channelSpecifics: { key: "secret-key", kind: "push_safer" },
			});

			expect(yield* listNotificationChannels(owner.client)).toHaveLength(1);
			expect(yield* listNotificationChannels(other.client)).toHaveLength(0);

			const updateError = yield* Effect.flip(
				other.client.call((c) =>
					c.notifications.updateChannel({
						payload: { isDisabled: true },
						path: { channelId: NotificationChannelId.make(id) },
					}),
				),
			);
			assertTaggedError(updateError, "NotFound");

			const deleteError = yield* Effect.flip(
				other.client.call((c) =>
					c.notifications.deleteChannel({ path: { channelId: NotificationChannelId.make(id) } }),
				),
			);
			assertTaggedError(deleteError, "NotFound");

			yield* deleteNotificationChannel(owner.client, id);
			expect(yield* listNotificationChannels(owner.client)).toEqual([]);
		}),
	);

	it.live("rejects channel and specifics mismatches", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const mismatch = yield* Effect.flip(
				client.call((c) =>
					c.notifications.createChannel({
						payload: {
							channel: "email",
							channelSpecifics: { baseUrl: fakeApprise.url, key: "key", kind: "apprise" },
						},
					}),
				),
			);
			assertTaggedError(mismatch, "BadRequest");
		}),
	);
});

describe("notification delivery", () => {
	it.live("delivers to enabled channels in the background and skips disabled ones", () =>
		Effect.gen(function* () {
			fakeApprise.requests.length = 0;
			const { client } = yield* createAuthenticatedClient();
			yield* createNotificationChannel(client, {
				channel: "apprise",
				channelSpecifics: { baseUrl: fakeApprise.url, key: "success", kind: "apprise" },
			});
			yield* createNotificationChannel(client, {
				channel: "apprise",
				channelSpecifics: { baseUrl: fakeApprise.url, key: "fail", kind: "apprise" },
			});
			yield* createNotificationChannel(client, {
				isDisabled: true,
				channel: "apprise",
				channelSpecifics: { baseUrl: fakeApprise.url, key: "disabled", kind: "apprise" },
			});

			yield* testNotificationChannels(client);

			const delivered = yield* pollUntil(
				"background notification deliveries",
				Effect.sync(() => {
					const paths = fakeApprise.requests.map((request) => request.path).sort();
					const complete = paths.includes("/notify/fail") && paths.includes("/notify/success");
					return complete ? paths : null;
				}),
			);

			expect(delivered).toEqual(["/notify/fail", "/notify/success"]);
			expect(fakeApprise.requests.map((request) => request.body)).toEqual([
				{ body: "This is a test notification for channel: apprise", title: "Ryot" },
				{ body: "This is a test notification for channel: apprise", title: "Ryot" },
			]);
			expect(fakeApprise.requests.some((request) => request.path === "/notify/disabled")).toBe(
				false,
			);
		}),
	);

	it.live("completes a subscription run successfully with zero enabled channels", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			expect(yield* listNotificationChannels(client)).toEqual([]);

			const { schema } = yield* findBuiltinSchemaBySlug(client, "workout");
			yield* createEntity(client, {
				entitySchemaId: schema.id,
				name: `Zero Channel Workout ${crypto.randomUUID()}`,
				properties: { endedAt: "2026-07-21T11:00:00Z", startedAt: "2026-07-21T10:00:00Z" },
			});

			const { id: signalId } = yield* pollSignal({
				schemaSlug: "workout.created",
				actorUserId: userId,
			});
			const runs = yield* pollTerminalSubscriptionRuns({
				signalId,
				executionUserId: userId,
			});
			expect(runs.map((run) => run.status)).toEqual(["succeeded"]);
		}),
	);

	it.live("exposes SMTP capability and requires authentication", () =>
		Effect.gen(function* () {
			const config = yield* getBackendClient().call((c) => c.system.config());
			expect(config.notifications.smtpEnabled).toBe(false);

			const error = yield* Effect.flip(
				getBackendClient().call((c) => c.notifications.listChannels()),
			);
			assertTaggedError(error, "Unauthorized");
		}),
	);
});
