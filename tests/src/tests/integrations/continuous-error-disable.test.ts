import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createIntegration,
	createNotificationChannel,
	getImportRun,
	getIntegration,
	pollImportRunUntilTerminal,
	postIntegrationWebhook,
	startFakeAppriseServer,
} from "~/fixtures";
import { pollUntil } from "~/fixtures/polling";
import { requirePresent } from "~/support/assertions";
import type { FakeHttpServer } from "~/support/fake-http-server";

let fakeApprise: FakeHttpServer;

beforeAll(async () => {
	fakeApprise = await startFakeAppriseServer();
});

afterAll(() => {
	fakeApprise.stop();
});

describe("integration auto-disable on continuous errors", () => {
	it("disables after 5 consecutive failed runs and notifies through its subscription once", async () => {
		const { client } = await createAuthenticatedClient();

		await createNotificationChannel(client, {
			channel: "apprise",
			channelSpecifics: { baseUrl: fakeApprise.url, key: "enabled", kind: "apprise" },
		});
		await createNotificationChannel(client, {
			isDisabled: true,
			channel: "apprise",
			channelSpecifics: { baseUrl: fakeApprise.url, key: "disabled", kind: "apprise" },
		});

		const { id } = await createIntegration(client, {
			provider: "kodi",
			providerSpecifics: { kind: "kodi" },
			extraSettings: { disableOnContinuousErrors: true },
		});

		// An empty payload passes the contract schema but fails Kodi sink parsing,
		// producing a genuinely failed run on an enabled integration. The runs must be
		// sequential so the recent-status window sees 5 consecutive failures.
		for (let attempt = 0; attempt < 5; attempt++) {
			// oxlint-disable-next-line no-await-in-loop
			const data = await postIntegrationWebhook(client, id, {});
			const runId = requirePresent(data.runId, "Expected runId from webhook");
			// oxlint-disable-next-line no-await-in-loop
			const run = await pollImportRunUntilTerminal(client, runId);
			expect(run.status).toBe("failed");
		}

		const disabled = await pollUntil("integration auto-disable", async () => {
			const integration = await getIntegration(client, id);
			return integration.isDisabled ? integration : null;
		});
		expect(disabled.isDisabled).toBe(true);

		const delivered = await pollUntil("integration-disabled notification delivery", () => {
			const match = fakeApprise.requests.find((request) => request.path === "/notify/enabled");
			return Promise.resolve(match ?? null);
		});
		expect(delivered.body).toEqual({
			title: "Ryot",
			body: "Integration kodi has been disabled due to too many errors",
		});
		expect(fakeApprise.requests.filter((request) => request.path === "/notify/disabled")).toEqual(
			[],
		);

		// A further webhook fails fast at the disabled-integration guard without
		// running the workflow, so no duplicate notification is produced.
		const afterDisable = await postIntegrationWebhook(client, id, {});
		const afterDisableRunId = requirePresent(afterDisable.runId, "Expected runId from webhook");
		const afterDisableRun = await getImportRun(client, afterDisableRunId);
		expect(afterDisableRun.status).toBe("failed");

		await Bun.sleep(3000);
		expect(
			fakeApprise.requests.filter((request) => request.path === "/notify/enabled"),
		).toHaveLength(1);
	});
});
