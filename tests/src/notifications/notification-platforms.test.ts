import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { notificationEventTypes } from "@ryot/contract/modules/notifications/types";
import { NotificationPlatformId } from "@ryot/contract/schema/brands";
import getPort from "get-port";

import {
	createAuthenticatedClient,
	createNotificationPlatform,
	deleteNotificationPlatform,
	getBackendClient,
	listNotificationPlatforms,
	testNotificationPlatforms,
	updateNotificationPlatform,
} from "../fixtures";
import { pollUntil } from "../fixtures/polling";
import { assertTaggedError, requirePresent } from "../test-support/assertions";

let fakeAppriseServer: ReturnType<typeof Bun.serve>;
let fakeAppriseUrl: string;
const requests: Array<{ body: unknown; path: string }> = [];

beforeAll(async () => {
	const port = await getPort();
	fakeAppriseServer = Bun.serve({
		port,
		hostname: "127.0.0.1",
		fetch: async (request) => {
			const url = new URL(request.url);
			const body = await request.json();
			requests.push({ body, path: url.pathname });
			return url.pathname.endsWith("/fail")
				? new Response("failed", { status: 500 })
				: Response.json({ ok: true });
		},
	});
	fakeAppriseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
	void fakeAppriseServer.stop(true);
});

describe("notification platform CRUD", () => {
	it("creates with all event defaults and returns a safe description", async () => {
		const { client } = await createAuthenticatedClient();
		await createNotificationPlatform(client, {
			platform: "apprise",
			platformSpecifics: { baseUrl: fakeAppriseUrl, key: "secret-key", kind: "apprise" },
		});

		const platforms = await listNotificationPlatforms(client);
		const platform = requirePresent(platforms[0], "Expected created notification platform");
		expect(platform.configuredEvents).toEqual(notificationEventTypes);
		expect(platform.isDisabled).toBe(false);
		expect(platform.description).toBe(`Apprise at ${fakeAppriseUrl}`);
		expect(platform.description).not.toContain("secret-key");
	});

	it("updates event subscriptions and disabled state", async () => {
		const { client } = await createAuthenticatedClient();
		const { id } = await createNotificationPlatform(client, {
			platform: "telegram",
			platformSpecifics: { botToken: "bot-secret", chatId: "1234", kind: "telegram" },
		});

		const updated = await updateNotificationPlatform(client, id, {
			isDisabled: true,
			configuredEvents: [],
		});
		expect(updated.configuredEvents).toEqual([]);
		expect(updated.isDisabled).toBe(true);
	});

	it("lists only the authenticated user's platforms and protects mutations", async () => {
		const owner = await createAuthenticatedClient();
		const other = await createAuthenticatedClient();
		const { id } = await createNotificationPlatform(owner.client, {
			platform: "push_safer",
			platformSpecifics: { key: "secret-key", kind: "push_safer" },
		});

		expect(await listNotificationPlatforms(owner.client)).toHaveLength(1);
		expect(await listNotificationPlatforms(other.client)).toHaveLength(0);

		const updateError = await other.client.runError((c) =>
			c.notifications.updatePlatform({
				payload: { isDisabled: true },
				path: { platformId: NotificationPlatformId.make(id) },
			}),
		);
		assertTaggedError(updateError, "NotFound");

		const deleteError = await other.client.runError((c) =>
			c.notifications.deletePlatform({ path: { platformId: NotificationPlatformId.make(id) } }),
		);
		assertTaggedError(deleteError, "NotFound");

		await deleteNotificationPlatform(owner.client, id);
		expect(await listNotificationPlatforms(owner.client)).toEqual([]);
	});

	it("rejects platform and specifics mismatches", async () => {
		const { client } = await createAuthenticatedClient();
		const mismatch = await client.runError((c) =>
			c.notifications.createPlatform({
				payload: {
					platform: "email",
					platformSpecifics: { baseUrl: fakeAppriseUrl, key: "key", kind: "apprise" },
				},
			}),
		);
		assertTaggedError(mismatch, "BadRequest");
	});
});

describe("notification delivery", () => {
	it("delivers to enabled platforms in the background and skips disabled ones", async () => {
		requests.length = 0;
		const { client } = await createAuthenticatedClient();
		await createNotificationPlatform(client, {
			platform: "apprise",
			platformSpecifics: { baseUrl: fakeAppriseUrl, key: "success", kind: "apprise" },
		});
		await createNotificationPlatform(client, {
			platform: "apprise",
			platformSpecifics: { baseUrl: fakeAppriseUrl, key: "fail", kind: "apprise" },
		});
		await createNotificationPlatform(client, {
			isDisabled: true,
			platform: "apprise",
			platformSpecifics: { baseUrl: fakeAppriseUrl, key: "disabled", kind: "apprise" },
		});

		await testNotificationPlatforms(client);

		const delivered = await pollUntil("background notification deliveries", () => {
			const paths = requests.map((request) => request.path).sort();
			const complete = paths.includes("/notify/fail") && paths.includes("/notify/success");
			return Promise.resolve(complete ? paths : null);
		});

		expect(delivered).toEqual(["/notify/fail", "/notify/success"]);
		expect(requests.map((request) => request.body)).toEqual([
			{ body: "This is a test notification for platform: apprise", title: "Ryot" },
			{ body: "This is a test notification for platform: apprise", title: "Ryot" },
		]);
		expect(requests.some((request) => request.path === "/notify/disabled")).toBe(false);
	});

	it("exposes SMTP capability and requires authentication", async () => {
		const config = await getBackendClient().run((c) => c.system.config());
		expect(config.notifications.smtpEnabled).toBe(false);

		const error = await getBackendClient().runError((c) => c.notifications.listPlatforms());
		assertTaggedError(error, "Unauthorized");
	});
});
