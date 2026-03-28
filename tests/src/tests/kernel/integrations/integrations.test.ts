import { ImportRunId, IntegrationId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	createAudiobookshelfIntegration,
	createAuthenticatedClient,
	createKodiIntegration,
	deleteIntegration,
	getIntegration,
	listIntegrationImportRuns,
	listIntegrations,
	listManualImportRuns,
	postIntegrationWebhookAndWait,
	pollImportRunUntilTerminal,
	updateUserPreferences,
} from "~/fixtures";
import {
	assertTaggedError,
	requireObjectRecord,
	requirePresent,
	requireString,
} from "~/support/assertions";
import { getBackendUrl } from "~/support/backend";
import { describe, expect, it } from "~/support/effect-test";

const kodiPayload = { identifier: "tt1234567", lot: "movie", progress: 50 };

describe("Integration CRUD", () => {
	it.live("creates with correct defaults", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { id } = yield* createKodiIntegration(client);
			const integration = requirePresent(
				yield* getIntegration(client, id),
				"Expected created integration",
			);

			expect(integration.isDisabled).toBe(false);
			expect(integration.syncOwnership).toBe(false);
			expect(integration.minimumProgress).toBe(2);
			expect(integration.maximumProgress).toBe(95);
			expect(integration.extraSettings.disableOnContinuousErrors).toBe(false);
		}),
	);

	it.live("rejects minimumProgress > maximumProgress", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const error = yield* Effect.flip(
				client.call((c) =>
					c.integrations.create({
						payload: {
							provider: "kodi",
							minimumProgress: 80,
							maximumProgress: 20,
							providerSpecifics: { kind: "kodi" },
						},
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toContain("minimumProgress");
		}),
	);

	it.live("rejects provider !== providerSpecifics.kind", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const error = yield* Effect.flip(
				client.call((c) =>
					c.integrations.create({
						payload: { provider: "emby", providerSpecifics: { kind: "kodi" } },
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toContain("provider");
		}),
	);

	it.live("RyotQL list returns only the authenticated user's integrations", () =>
		Effect.gen(function* () {
			const { client: clientA } = yield* createAuthenticatedClient();
			const { client: clientB } = yield* createAuthenticatedClient();

			const { id: idA } = yield* createKodiIntegration(clientA);
			yield* createKodiIntegration(clientB);

			const integrationsA = yield* listIntegrations(clientA);
			const ids = integrationsA.map((i) => i.id);

			expect(ids).toContain(IntegrationId.make(idA));
			expect(ids).toHaveLength(1);
		}),
	);

	it.live("RyotQL list filters by provider", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			yield* createKodiIntegration(client);
			yield* createAudiobookshelfIntegration(client);

			const filtered = yield* listIntegrations(client, { provider: "kodi" });
			expect(filtered).toHaveLength(1);
			expect(requirePresent(filtered[0], "Expected filtered integration").provider).toBe("kodi");
		}),
	);

	it.live("RyotQL list filters by isDisabled", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { id } = yield* createKodiIntegration(client);
			yield* client.call((c) =>
				c.integrations.update({
					payload: { isDisabled: true },
					params: { integrationId: IntegrationId.make(id) },
				}),
			);

			yield* createKodiIntegration(client);

			const enabled = yield* listIntegrations(client, {
				provider: "kodi",
				isDisabled: false,
			});
			expect(enabled).toHaveLength(1);
			expect(requirePresent(enabled[0], "Expected enabled integration").isDisabled).toBe(false);
		}),
	);

	it.live("PATCH updates name and redacts secret fields", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const created = yield* createAudiobookshelfIntegration(client);
			expect(created.name).toBe("ABS");

			const data = yield* client.call((c) =>
				c.integrations.update({
					payload: { name: "My ABS" },
					params: { integrationId: IntegrationId.make(created.id) },
				}),
			);

			expect(data.name).toBe("My ABS");
			expect(data.providerSpecifics).not.toHaveProperty("token");
			expect(data.providerSpecifics.baseUrl).toBe("https://abs.example.com");

			const integration = requirePresent(
				yield* getIntegration(client, created.id),
				"Expected updated integration",
			);
			expect(integration.name).toBe("My ABS");
		}),
	);

	it.live("PATCH rejects threshold violations on update", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { id } = yield* createKodiIntegration(client);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.integrations.update({
						params: { integrationId: IntegrationId.make(id) },
						payload: { minimumProgress: 90, maximumProgress: 10 },
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toContain("minimumProgress");
		}),
	);

	it.live("DELETE removes the integration", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { id } = yield* createKodiIntegration(client);
			yield* deleteIntegration(client, id);

			expect(yield* getIntegration(client, id)).toBeNull();
		}),
	);
});

describe("Webhook routes", () => {
	it.live("POST /api/webhooks/integrations/{unknownId} returns NotFound", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const error = yield* Effect.flip(
				client.call((c) =>
					c.integrations.webhook({
						payload: {},
						params: { integrationId: IntegrationId.make("nonexistent-id-abc123") },
					}),
				),
			);

			assertTaggedError(error, "NotFound");
		}),
	);

	it.live("POST /api/webhooks/integrations/{validKodiIntegrationId} creates a run", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { id } = yield* createKodiIntegration(client);

			const { data } = yield* postIntegrationWebhookAndWait(client, id, kodiPayload);

			expect(data.runId).toBeDefined();
		}),
	);

	it.live("POST /_i/{validKodiIntegrationId} creates a run from a JSON payload", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { id } = yield* createKodiIntegration(client);
			const backendRootUrl = getBackendUrl().replace(/\/api$/, "");

			const response = yield* Effect.promise(() =>
				fetch(`${backendRootUrl}/_i/${id}`, {
					method: "POST",
					body: JSON.stringify(kodiPayload),
					headers: { "Content-Type": "application/json" },
				}),
			);
			const data = requireObjectRecord(
				yield* Effect.promise(() => response.json()),
				"Expected webhook response",
			);

			expect(response.status).toBe(202);
			expect(data.runId).toBeDefined();
			const runId = requireString(data.runId, "Expected runId from webhook");
			yield* pollImportRunUntilTerminal(client, runId);
		}),
	);

	it.live("POST to a disabled integration returns 202 with a failed run", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { id } = yield* createKodiIntegration(client);

			yield* client.call((c) =>
				c.integrations.update({
					payload: { isDisabled: true },
					params: { integrationId: IntegrationId.make(id) },
				}),
			);

			const { run } = yield* postIntegrationWebhookAndWait(client, id, kodiPayload);
			expect(run.status).toBe("failed");
		}),
	);

	it.live("POST when disableIntegrations preference is true returns 202 with failed run", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { id } = yield* createKodiIntegration(client);

			yield* updateUserPreferences(client, { disableIntegrations: true });

			const { run } = yield* postIntegrationWebhookAndWait(client, id, kodiPayload);
			expect(run.status).toBe("failed");
		}),
	);

	it.live("POST to a non-Sink integration returns BadRequest", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { id } = yield* createAudiobookshelfIntegration(client);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.integrations.webhook({
						payload: {},
						params: { integrationId: IntegrationId.make(id) },
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
		}),
	);
});

describe("Import run visibility", () => {
	it.live(
		"RyotQL manual runs exclude integration runs while detail and integration lists expose them",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { id: integrationId } = yield* createKodiIntegration(client);

				const { run, runId } = yield* postIntegrationWebhookAndWait(
					client,
					integrationId,
					kodiPayload,
				);

				const allRuns = yield* listManualImportRuns(client, 1, 20);
				expect(allRuns.items.find((r) => r.id === runId)).toBeUndefined();

				expect(run.id).toBe(ImportRunId.make(runId));

				const integrationRuns = yield* listIntegrationImportRuns(client, integrationId, 1, 20);
				expect(integrationRuns.items.find((r) => r.id === runId)).toBeDefined();
			}),
	);
});
