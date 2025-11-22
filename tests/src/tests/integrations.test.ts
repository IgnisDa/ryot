import { describe, expect, it } from "bun:test";

import { ImportRunId, IntegrationId } from "@ryot/app-backend/schema/brands";

import {
	createAudiobookshelfIntegration,
	createAuthenticatedClient,
	createKodiIntegration,
	deleteIntegration,
	getImportRun,
	getIntegration,
	listEventSlugs,
	listIntegrations,
	postIntegrationWebhook,
	postWebhook,
	pollImportRunUntilTerminal,
	seedGlobalShowEpisodeTree,
	updateUserPreferences,
	waitForEventSlugs,
} from "../fixtures";
import { assertTaggedError, requirePresent } from "../test-support/assertions";

const kodiPayload = { identifier: "tt1234567", lot: "movie", progress: 50 };

describe("Integration CRUD", () => {
	it("creates with correct defaults", async () => {
		const { client } = await createAuthenticatedClient();
		const { id } = await createKodiIntegration(client);
		const integration = await getIntegration(client, id);

		expect(integration.isDisabled).toBe(false);
		expect(integration.syncOwnership).toBe(false);
		expect(integration.minimumProgress).toBe(2);
		expect(integration.maximumProgress).toBe(95);
		expect(integration.extraSettings.disableOnContinuousErrors).toBe(false);
	});

	it("rejects minimumProgress > maximumProgress", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
			c.integrations.create({
				payload: {
					provider: "kodi",
					minimumProgress: 80,
					maximumProgress: 20,
					providerSpecifics: { kind: "kodi" },
				},
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("minimumProgress");
	});

	it("rejects provider !== providerSpecifics.kind", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
			c.integrations.create({
				payload: { provider: "emby", providerSpecifics: { kind: "kodi" } },
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("provider");
	});

	it("GET list returns only the authenticated user's integrations", async () => {
		const { client: clientA } = await createAuthenticatedClient();
		const { client: clientB } = await createAuthenticatedClient();

		const { id: idA } = await createKodiIntegration(clientA);
		await createKodiIntegration(clientB);

		const integrationsA = await listIntegrations(clientA);
		const ids = integrationsA.map((i) => i.id);

		expect(ids).toContain(IntegrationId.make(idA));
		expect(ids).toHaveLength(1);
	});

	it("GET list filters by provider", async () => {
		const { client } = await createAuthenticatedClient();

		await createKodiIntegration(client);
		await createAudiobookshelfIntegration(client);

		const filtered = await listIntegrations(client, { provider: "kodi" });
		expect(filtered).toHaveLength(1);
		expect(requirePresent(filtered[0], "Expected filtered integration").provider).toBe("kodi");
	});

	it("GET list filters by isDisabled", async () => {
		const { client } = await createAuthenticatedClient();

		const { id } = await createKodiIntegration(client);
		await client.run((c) =>
			c.integrations.update({
				payload: { isDisabled: true },
				path: { integrationId: IntegrationId.make(id) },
			}),
		);

		await createKodiIntegration(client);

		const enabled = await listIntegrations(client, {
			provider: "kodi",
			isDisabled: false,
		});
		expect(enabled).toHaveLength(1);
		expect(requirePresent(enabled[0], "Expected enabled integration").isDisabled).toBe(false);
	});

	it("GET by id returns full providerSpecifics and webhookUrl for Sink providers", async () => {
		const { client } = await createAuthenticatedClient();

		const { id } = await createKodiIntegration(client);
		const integration = await getIntegration(client, id);

		expect(integration.id).toBe(IntegrationId.make(id));
		expect(integration.providerSpecifics).toMatchObject({ kind: "kodi" });
		expect(integration.webhookUrl).toBeDefined();
		expect(integration.webhookUrl).toContain(`/_i/${id}`);
	});

	it("GET by id returns no webhookUrl for Yank providers", async () => {
		const { client } = await createAuthenticatedClient();

		const { id } = await createAudiobookshelfIntegration(client);
		const integration = await getIntegration(client, id);

		expect(integration.webhookUrl).toBeUndefined();
	});

	it("PATCH updates name and preserves secret fields when omitted", async () => {
		const { client } = await createAuthenticatedClient();

		const { id } = await createAudiobookshelfIntegration(client);

		const data = await client.run((c) =>
			c.integrations.update({
				payload: { name: "My ABS" },
				path: { integrationId: IntegrationId.make(id) },
			}),
		);

		expect(data.name).toBe("My ABS");

		const integration = await getIntegration(client, id);
		const specifics = integration.providerSpecifics;
		expect(specifics.kind).toBe("audiobookshelf");
		if (specifics.kind === "audiobookshelf") {
			expect(specifics.token).toBe("test-token");
			expect(specifics.baseUrl).toBe("https://abs.example.com");
		}
	});

	it("PATCH rejects threshold violations on update", async () => {
		const { client } = await createAuthenticatedClient();

		const { id } = await createKodiIntegration(client);

		const error = await client.runError((c) =>
			c.integrations.update({
				path: { integrationId: IntegrationId.make(id) },
				payload: { minimumProgress: 90, maximumProgress: 10 },
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("minimumProgress");
	});

	it("DELETE removes the integration", async () => {
		const { client } = await createAuthenticatedClient();

		const { id } = await createKodiIntegration(client);
		await deleteIntegration(client, id);

		const error = await client.runError((c) =>
			c.integrations.get({ path: { integrationId: IntegrationId.make(id) } }),
		);

		assertTaggedError(error, "NotFound");
	});
});

describe("Webhook routes", () => {
	it("POST /_i/{unknownId} returns 404", async () => {
		const { response } = await postWebhook("nonexistent-id-abc123");
		expect(response.status).toBe(404);
	});

	it("POST /api/webhooks/integrations/{unknownId} returns 404", async () => {
		const { client } = await createAuthenticatedClient();
		const { response } = await postIntegrationWebhook(client, "nonexistent-id-abc123", {});
		expect(response.status).toBe(404);
	});

	it("POST /_i/{validKodiIntegrationId} returns 202 with runId", async () => {
		const { client } = await createAuthenticatedClient();
		const { id } = await createKodiIntegration(client);

		const { response, data } = await postWebhook(id, kodiPayload);

		expect(response.status).toBe(202);
		expect(data?.runId).toBeDefined();
	});

	it("POST /api/webhooks/integrations/{validKodiIntegrationId} returns 202 with runId", async () => {
		const { client } = await createAuthenticatedClient();
		const { id } = await createKodiIntegration(client);

		const { response, data } = await postIntegrationWebhook(client, id, kodiPayload);

		expect(response.status).toBe(202);
		expect(data?.runId).toBeDefined();
	});

	it("POST /_i/{validKodiIntegrationId} attaches show progress to the resolved episode", async () => {
		const { client } = await createAuthenticatedClient();
		const { id } = await createKodiIntegration(client);

		const { tmdbId, showId, episodeId } = await seedGlobalShowEpisodeTree(client, {
			showName: "Live Sink Test Show",
		});

		const { response, data } = await postWebhook(id, {
			lot: "show",
			progress: 45,
			identifier: tmdbId,
			show_episode_number: 2,
			show_season_number: 1,
		});

		expect(response.status).toBe(202);
		const runId = requirePresent(data?.runId, "Expected runId from webhook");
		const completedRun = await pollImportRunUntilTerminal(client, runId);

		expect(completedRun.status).toBe("completed");
		expect(completedRun.failedItems).toBe(0);

		const episodeEvents = await waitForEventSlugs(client, episodeId, "progress");
		const showEvents = await listEventSlugs(client, showId);
		expect(showEvents).not.toContain("progress");
		expect(episodeEvents).toContain("progress");
	}, 60_000);

	it("POST to a disabled integration returns 202 with a failed run", async () => {
		const { client } = await createAuthenticatedClient();
		const { id } = await createKodiIntegration(client);

		await client.run((c) =>
			c.integrations.update({
				payload: { isDisabled: true },
				path: { integrationId: IntegrationId.make(id) },
			}),
		);

		const { response, data } = await postWebhook(id, kodiPayload);

		expect(response.status).toBe(202);
		const runId = requirePresent(data?.runId, "Expected runId from webhook");

		const run = await getImportRun(client, runId);
		expect(run.status).toBe("failed");
	});

	it("POST when disableIntegrations preference is true returns 202 with failed run", async () => {
		const { client } = await createAuthenticatedClient();
		const { id } = await createKodiIntegration(client);

		await updateUserPreferences(client, { disableIntegrations: true });

		const { response, data } = await postWebhook(id, kodiPayload);

		expect(response.status).toBe(202);
		const runId = requirePresent(data?.runId, "Expected runId from webhook");

		const run = await getImportRun(client, runId);
		expect(run.status).toBe("failed");
	});

	it("POST to a non-Sink integration returns 400", async () => {
		const { client } = await createAuthenticatedClient();
		const { id } = await createAudiobookshelfIntegration(client);

		const { response } = await postWebhook(id, {});

		expect(response.status).toBe(400);
	});
});

describe("Import run visibility", () => {
	it("GET /imports/runs excludes integration runs; GET /imports/runs/:id and GET /integrations/:id/runs expose them", async () => {
		const { client } = await createAuthenticatedClient();
		const { id: integrationId } = await createKodiIntegration(client);

		const { data: webhookData } = await postWebhook(integrationId, kodiPayload);
		const runId = requirePresent(webhookData?.runId, "Expected runId from webhook");

		const allRuns = await client.run((c) => c.imports.listRuns());
		expect(allRuns.find((r) => r.id === runId)).toBeUndefined();

		const run = await getImportRun(client, runId);
		expect(run.id).toBe(ImportRunId.make(runId));

		const integrationRuns = await client.run((c) =>
			c.integrations.getRuns({ path: { integrationId: IntegrationId.make(integrationId) } }),
		);
		expect(integrationRuns.find((r) => r.id === runId)).toBeDefined();
	});
});
