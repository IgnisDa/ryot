import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createIntegration,
	createNotificationChannel,
	getImportRun,
	getIntegration,
	pollImportRunUntilTerminal,
	postIntegrationWebhook,
	queryRecipientUserIds,
	querySignalBySlug,
	querySubscriptionRuns,
	startFakeAppriseServer,
} from "../fixtures";
import { pollUntil } from "../fixtures/polling";
import { requirePresent } from "../test-support/assertions";
import type { FakeHttpServer } from "../test-support/fake-http-server";

let fakeApprise: FakeHttpServer;

beforeAll(async () => {
	fakeApprise = await startFakeAppriseServer();
});

afterAll(() => {
	fakeApprise.stop();
});

describe("integration auto-disable on continuous errors", () => {
	it("disables after 5 consecutive failed runs and notifies enabled channels once", async () => {
		const { client, userId } = await createAuthenticatedClient();

		await createNotificationChannel(client, {
			kind: "apprise",
			specifics: { baseUrl: fakeApprise.url, key: "subscribed", kind: "apprise" },
		});
		await createNotificationChannel(client, {
			isDisabled: true,
			kind: "apprise",
			specifics: { baseUrl: fakeApprise.url, key: "disabled", kind: "apprise" },
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
			const match = fakeApprise.requests.find((request) => request.path === "/notify/subscribed");
			return Promise.resolve(match ?? null);
		});
		expect(delivered.body).toEqual({
			title: "Ryot",
			body: "Integration kodi has been disabled due to too many errors",
		});
		expect(fakeApprise.requests.filter((request) => request.path === "/notify/disabled")).toEqual(
			[],
		);

		const afterDisable = await postIntegrationWebhook(client, id, {});
		const afterDisableRunId = requirePresent(afterDisable.runId, "Expected runId from webhook");
		const afterDisableRun = await getImportRun(client, afterDisableRunId);
		expect(afterDisableRun.status).toBe("failed");

		await Bun.sleep(3000);
		expect(
			fakeApprise.requests.filter((request) => request.path === "/notify/subscribed"),
		).toHaveLength(1);

		const signal = await querySignalBySlug({ slug: "integration.disabled", actorUserId: userId });
		expect(signal).not.toBeNull();
		if (!signal) {
			throw new Error("Expected integration.disabled signal");
		}
		expect(signal.actorUserId).toBe(userId);
		expect(signal.properties.providerName).toBe("kodi");
		expect(signal.properties.integrationId).toBe(id);
		expect(await queryRecipientUserIds(signal.id)).toEqual([userId]);

		const signalRuns = await querySubscriptionRuns({ signalId: signal.id, status: "succeeded" });
		expect(signalRuns).toHaveLength(1);
		expect(signalRuns[0]?.operation).toBe("signal");
		expect(signalRuns[0]?.executionUserId).toBe(userId);
	});
});
