import { describe, expect, it } from "bun:test";

import {
	createAudiobookshelfIntegration,
	createAuthenticatedClient,
	createKodiIntegration,
	deleteIntegration,
	getImportRun,
	getIntegration,
	listIntegrations,
	postWebhook,
} from "../fixtures";
import { getBackendUrl, getPgClient } from "../setup";
import { requirePresent } from "../test-support/assertions";

const kodiPayload = { identifier: "tt1234567", lot: "movie", progress: 50 };

describe("Integration CRUD", () => {
	it("creates with correct defaults", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { id } = await createKodiIntegration(client, cookies);
		const integration = await getIntegration(client, cookies, id);

		expect(integration.isDisabled).toBe(false);
		expect(integration.syncOwnership).toBe(false);
		expect(integration.minimumProgress).toBe(2);
		expect(integration.maximumProgress).toBe(95);
		expect(integration.extraSettings.disableOnContinuousErrors).toBe(false);
	});

	it("rejects minimumProgress > maximumProgress", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { response, error } = await client.POST("/integrations", {
			headers: { Cookie: cookies },
			body: {
				provider: "kodi",
				minimumProgress: 80,
				maximumProgress: 20,
				providerSpecifics: { kind: "kodi" },
			},
		});

		expect(response.status).toBe(400);
		expect(error?.error.message).toContain("minimumProgress");
	});

	it("rejects provider !== providerSpecifics.kind", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { response, error } = await client.POST("/integrations", {
			headers: { Cookie: cookies },
			body: { provider: "emby", providerSpecifics: { kind: "kodi" } },
		});

		expect(response.status).toBe(400);
		expect(error?.error.message).toContain("provider");
	});

	it("GET list returns only the authenticated user's integrations", async () => {
		const { client: clientA, cookies: cookiesA } = await createAuthenticatedClient();
		const { client: clientB, cookies: cookiesB } = await createAuthenticatedClient();

		const { id: idA } = await createKodiIntegration(clientA, cookiesA);
		await createKodiIntegration(clientB, cookiesB);

		const integrationsA = await listIntegrations(clientA, cookiesA);
		const ids = integrationsA.map((i) => i.id);

		expect(ids).toContain(idA);
		expect(ids).toHaveLength(1);
	});

	it("GET list filters by provider", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		await createKodiIntegration(client, cookies);
		await createAudiobookshelfIntegration(client, cookies);

		const filtered = await listIntegrations(client, cookies, { provider: "kodi" });
		expect(filtered).toHaveLength(1);
		expect(requirePresent(filtered[0], "Expected filtered integration").provider).toBe("kodi");
	});

	it("GET list filters by isDisabled", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { id } = await createKodiIntegration(client, cookies);
		await client.PATCH("/integrations/{integrationId}", {
			body: { isDisabled: true },
			headers: { Cookie: cookies },
			params: { path: { integrationId: id } },
		});

		await createKodiIntegration(client, cookies);

		const enabled = await listIntegrations(client, cookies, {
			provider: "kodi",
			isDisabled: false,
		});
		expect(enabled).toHaveLength(1);
		expect(requirePresent(enabled[0], "Expected enabled integration").isDisabled).toBe(false);
	});

	it("GET by id returns full providerSpecifics and webhookUrl for Sink providers", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { id } = await createKodiIntegration(client, cookies);
		const integration = await getIntegration(client, cookies, id);

		expect(integration.id).toBe(id);
		expect(integration.providerSpecifics).toMatchObject({ kind: "kodi" });
		expect(integration.webhookUrl).toBeDefined();
		expect(integration.webhookUrl).toContain(`/_i/${id}`);
	});

	it("GET by id returns no webhookUrl for Yank providers", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { id } = await createAudiobookshelfIntegration(client, cookies);
		const integration = await getIntegration(client, cookies, id);

		expect(integration.webhookUrl).toBeUndefined();
	});

	it("PATCH updates name and preserves secret fields when omitted", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { id } = await createAudiobookshelfIntegration(client, cookies);

		const { data, response } = await client.PATCH("/integrations/{integrationId}", {
			body: { name: "My ABS" },
			headers: { Cookie: cookies },
			params: { path: { integrationId: id } },
		});

		expect(response.status).toBe(200);
		expect(data?.data.name).toBe("My ABS");

		const integration = await getIntegration(client, cookies, id);
		const specifics = integration.providerSpecifics;
		expect(specifics.kind).toBe("audiobookshelf");
		if (specifics.kind === "audiobookshelf") {
			expect(specifics.token).toBe("test-token");
			expect(specifics.baseUrl).toBe("https://abs.example.com");
		}
	});

	it("PATCH rejects threshold violations on update", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { id } = await createKodiIntegration(client, cookies);

		const { response, error } = await client.PATCH("/integrations/{integrationId}", {
			headers: { Cookie: cookies },
			params: { path: { integrationId: id } },
			body: { minimumProgress: 90, maximumProgress: 10 },
		});

		expect(response.status).toBe(400);
		expect(error?.error.message).toContain("minimumProgress");
	});

	it("DELETE removes the integration", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { id } = await createKodiIntegration(client, cookies);
		await deleteIntegration(client, cookies, id);

		const { response } = await client.GET("/integrations/{integrationId}", {
			headers: { Cookie: cookies },
			params: { path: { integrationId: id } },
		});

		expect(response.status).toBe(404);
	});
});

describe("Webhook routes", () => {
	it("POST /_i/{unknownId} returns 404", async () => {
		const { response } = await postWebhook("nonexistent-id-abc123");
		expect(response.status).toBe(404);
	});

	it("POST /api/webhooks/integrations/{unknownId} returns 404", async () => {
		const backendUrl = getBackendUrl();
		const response = await fetch(`${backendUrl}/webhooks/integrations/nonexistent-id-abc123`, {
			method: "POST",
			body: JSON.stringify({}),
			headers: { "Content-Type": "application/json" },
		});
		expect(response.status).toBe(404);
	});

	it("POST /_i/{validKodiIntegrationId} returns 202 with runId", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { id } = await createKodiIntegration(client, cookies);

		const { response, data } = await postWebhook(id, kodiPayload);

		expect(response.status).toBe(202);
		expect(data.data?.runId).toBeDefined();
	});

	it("POST /api/webhooks/integrations/{validKodiIntegrationId} returns 202 with runId", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { id } = await createKodiIntegration(client, cookies);

		const backendUrl = getBackendUrl();
		const response = await fetch(`${backendUrl}/webhooks/integrations/${id}`, {
			method: "POST",
			body: JSON.stringify(kodiPayload),
			headers: { "Content-Type": "application/json" },
		});
		const responseData: { data?: { runId: string } } = await response.json();

		expect(response.status).toBe(202);
		expect(responseData.data?.runId).toBeDefined();
	});

	it("POST to a disabled integration returns 202 with a failed run", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { id } = await createKodiIntegration(client, cookies);

		await client.PATCH("/integrations/{integrationId}", {
			body: { isDisabled: true },
			headers: { Cookie: cookies },
			params: { path: { integrationId: id } },
		});

		const { response, data } = await postWebhook(id, kodiPayload);

		expect(response.status).toBe(202);
		const runId = requirePresent(data.data?.runId, "Expected runId from webhook");

		const run = await getImportRun(client, cookies, runId);
		expect(run.status).toBe("failed");
	});

	it("POST when disableIntegrations preference is true returns 202 with failed run", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();
		const { id } = await createKodiIntegration(client, cookies);

		const pg = getPgClient();
		await pg.query(`UPDATE "user" SET preferences = preferences || $1::jsonb WHERE id = $2`, [
			JSON.stringify({ disableIntegrations: true }),
			userId,
		]);

		const { response, data } = await postWebhook(id, kodiPayload);

		expect(response.status).toBe(202);
		const runId = requirePresent(data.data?.runId, "Expected runId from webhook");

		const run = await getImportRun(client, cookies, runId);
		expect(run.status).toBe("failed");
	});

	it("POST to a non-Sink integration returns 400", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { id } = await createAudiobookshelfIntegration(client, cookies);

		const { response } = await postWebhook(id, {});

		expect(response.status).toBe(400);
	});
});

describe("Import run visibility", () => {
	it("GET /imports/runs excludes integration runs; GET /imports/runs/:id and GET /integrations/:id/runs expose them", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { id: integrationId } = await createKodiIntegration(client, cookies);

		const { data: webhookData } = await postWebhook(integrationId, kodiPayload);
		const runId = requirePresent(webhookData.data?.runId, "Expected runId from webhook");

		const { data: listData } = await client.GET("/imports/runs", {
			headers: { Cookie: cookies },
		});
		const allRuns = listData?.data ?? [];
		expect(allRuns.find((r: { id: string }) => r.id === runId)).toBeUndefined();

		const run = await getImportRun(client, cookies, runId);
		expect(run.id).toBe(runId);

		const { data: integrationRunsData } = await client.GET("/integrations/{integrationId}/runs", {
			headers: { Cookie: cookies },
			params: { path: { integrationId } },
		});
		const integrationRuns = integrationRunsData?.data ?? [];
		expect(integrationRuns.find((r: { id: string }) => r.id === runId)).toBeDefined();
	});
});
