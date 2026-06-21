import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { notificationEventTypes } from "@ryot/contract/modules/notifications/types";
import { NotificationChannelId } from "@ryot/contract/schema/brands";

import {
	createAuthenticatedClient,
	createNotificationChannel,
	deleteNotificationChannel,
	getBackendClient,
	listNotificationChannels,
	startFakeAppriseServer,
	testNotificationChannels,
	updateNotificationChannel,
} from "~/fixtures";
import { pollUntil } from "~/fixtures/polling";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import type { FakeHttpServer } from "~/support/fake-http-server";

let fakeApprise: FakeHttpServer;

beforeAll(async () => {
	fakeApprise = await startFakeAppriseServer();
});

afterAll(() => {
	fakeApprise.stop();
});

describe("notification channel CRUD", () => {
	it("creates with all event defaults and returns a safe description", async () => {
		const { client } = await createAuthenticatedClient();
		await createNotificationChannel(client, {
			channel: "apprise",
			channelSpecifics: { baseUrl: fakeApprise.url, key: "secret-key", kind: "apprise" },
		});

		const channels = await listNotificationChannels(client);
		const channel = requirePresent(channels[0], "Expected created notification channel");
		expect(channel.configuredEvents).toEqual(notificationEventTypes);
		expect(channel.isDisabled).toBe(false);
		expect(channel.description).toBe(`Apprise at ${fakeApprise.url}`);
		expect(channel.description).not.toContain("secret-key");
	});

	it("updates event subscriptions and disabled state", async () => {
		const { client } = await createAuthenticatedClient();
		const { id } = await createNotificationChannel(client, {
			channel: "telegram",
			channelSpecifics: { botToken: "bot-secret", chatId: "1234", kind: "telegram" },
		});

		const updated = await updateNotificationChannel(client, id, {
			isDisabled: true,
			configuredEvents: [],
		});
		expect(updated.configuredEvents).toEqual([]);
		expect(updated.isDisabled).toBe(true);
	});

	it("lists only the authenticated user's channels and protects mutations", async () => {
		const owner = await createAuthenticatedClient();
		const other = await createAuthenticatedClient();
		const { id } = await createNotificationChannel(owner.client, {
			channel: "push_safer",
			channelSpecifics: { key: "secret-key", kind: "push_safer" },
		});

		expect(await listNotificationChannels(owner.client)).toHaveLength(1);
		expect(await listNotificationChannels(other.client)).toHaveLength(0);

		const updateError = await other.client.runError((c) =>
			c.notifications.updateChannel({
				payload: { isDisabled: true },
				path: { channelId: NotificationChannelId.make(id) },
			}),
		);
		assertTaggedError(updateError, "NotFound");

		const deleteError = await other.client.runError((c) =>
			c.notifications.deleteChannel({ path: { channelId: NotificationChannelId.make(id) } }),
		);
		assertTaggedError(deleteError, "NotFound");

		await deleteNotificationChannel(owner.client, id);
		expect(await listNotificationChannels(owner.client)).toEqual([]);
	});

	it("rejects channel and specifics mismatches", async () => {
		const { client } = await createAuthenticatedClient();
		const mismatch = await client.runError((c) =>
			c.notifications.createChannel({
				payload: {
					channel: "email",
					channelSpecifics: { baseUrl: fakeApprise.url, key: "key", kind: "apprise" },
				},
			}),
		);
		assertTaggedError(mismatch, "BadRequest");
	});
});

describe("notification delivery", () => {
	it("delivers to enabled channels in the background and skips disabled ones", async () => {
		fakeApprise.requests.length = 0;
		const { client } = await createAuthenticatedClient();
		await createNotificationChannel(client, {
			channel: "apprise",
			channelSpecifics: { baseUrl: fakeApprise.url, key: "success", kind: "apprise" },
		});
		await createNotificationChannel(client, {
			channel: "apprise",
			channelSpecifics: { baseUrl: fakeApprise.url, key: "fail", kind: "apprise" },
		});
		await createNotificationChannel(client, {
			isDisabled: true,
			channel: "apprise",
			channelSpecifics: { baseUrl: fakeApprise.url, key: "disabled", kind: "apprise" },
		});

		await testNotificationChannels(client);

		const delivered = await pollUntil("background notification deliveries", () => {
			const paths = fakeApprise.requests.map((request) => request.path).sort();
			const complete = paths.includes("/notify/fail") && paths.includes("/notify/success");
			return Promise.resolve(complete ? paths : null);
		});

		expect(delivered).toEqual(["/notify/fail", "/notify/success"]);
		expect(fakeApprise.requests.map((request) => request.body)).toEqual([
			{ body: "This is a test notification for channel: apprise", title: "Ryot" },
			{ body: "This is a test notification for channel: apprise", title: "Ryot" },
		]);
		expect(fakeApprise.requests.some((request) => request.path === "/notify/disabled")).toBe(false);
	});

	it("exposes SMTP capability and requires authentication", async () => {
		const config = await getBackendClient().run((c) => c.system.config());
		expect(config.notifications.smtpEnabled).toBe(false);

		const error = await getBackendClient().runError((c) => c.notifications.listChannels());
		assertTaggedError(error, "Unauthorized");
	});
});
