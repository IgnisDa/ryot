import { ImportRunId, IntegrationId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	createAudiobookshelfIntegration,
	createAuthenticatedClient,
	createIntegration,
	createKodiIntegration,
	deleteIntegration,
	getIntegration,
	listIntegrations,
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
			const integration = yield* getIntegration(client, id);

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

	it.live("GET list returns only the authenticated user's integrations", () =>
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

	it.live("GET list filters by provider", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			yield* createKodiIntegration(client);
			yield* createAudiobookshelfIntegration(client);

			const filtered = yield* listIntegrations(client, { provider: "kodi" });
			expect(filtered).toHaveLength(1);
			expect(requirePresent(filtered[0], "Expected filtered integration").provider).toBe("kodi");
		}),
	);

	it.live("GET list filters by isDisabled", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { id } = yield* createKodiIntegration(client);
			yield* client.call((c) =>
				c.integrations.update({
					payload: { isDisabled: true },
					path: { integrationId: IntegrationId.make(id) },
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

	it.live("GET by id returns /_i webhookUrl for all Sink providers", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const integrations = [
				yield* createKodiIntegration(client),
				yield* createIntegration(client, {
					provider: "emby",
					providerSpecifics: { kind: "emby" },
				}),
				yield* createIntegration(client, {
					provider: "plex_sink",
					providerSpecifics: { kind: "plex_sink" },
				}),
				yield* createIntegration(client, {
					provider: "generic_json",
					providerSpecifics: { kind: "generic_json" },
				}),
				yield* createIntegration(client, {
					provider: "jellyfin_sink",
					providerSpecifics: { kind: "jellyfin_sink" },
				}),
				yield* createIntegration(client, {
					provider: "ryot_browser_extension",
					providerSpecifics: { kind: "ryot_browser_extension" },
				}),
			];

			const createdIntegrations = yield* Effect.all(
				integrations.map((created) =>
					Effect.gen(function* () {
						return {
							created,
							integration: yield* getIntegration(client, created.id),
						};
					}),
				),
			);

			for (const { created, integration } of createdIntegrations) {
				expect(integration.id).toBe(IntegrationId.make(created.id));
				expect(integration.webhookUrl).toBeDefined();
				expect(integration.webhookUrl).toContain(`/_i/${created.id}`);
				expect(integration.webhookUrl).not.toContain("/api/webhooks/integrations/");
			}
		}),
	);

	it.live("GET by id returns no webhookUrl for Yank providers", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { id } = yield* createAudiobookshelfIntegration(client);
			const integration = yield* getIntegration(client, id);

			expect(integration.webhookUrl).toBeUndefined();
		}),
	);

	it.live("PATCH updates name while client responses redact secret fields", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const created = yield* createAudiobookshelfIntegration(client);
			const createdSpecifics = created.providerSpecifics;
			expect(created.name).toBe("ABS");
			expect(createdSpecifics.kind).toBe("audiobookshelf");
			expect(createdSpecifics).not.toHaveProperty("token");
			expect(createdSpecifics.baseUrl).toBe("https://abs.example.com");

			const data = yield* client.call((c) =>
				c.integrations.update({
					payload: { name: "My ABS" },
					path: { integrationId: IntegrationId.make(created.id) },
				}),
			);

			expect(data.name).toBe("My ABS");
			expect(data.providerSpecifics).not.toHaveProperty("token");
			expect(data.providerSpecifics.baseUrl).toBe("https://abs.example.com");

			const integration = yield* getIntegration(client, created.id);
			const specifics = integration.providerSpecifics;
			expect(integration.name).toBe("My ABS");
			expect(specifics.kind).toBe("audiobookshelf");
			expect(specifics).not.toHaveProperty("token");
			expect(specifics.baseUrl).toBe("https://abs.example.com");
		}),
	);

	it.live("PATCH rejects threshold violations on update", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { id } = yield* createKodiIntegration(client);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.integrations.update({
						path: { integrationId: IntegrationId.make(id) },
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

			const error = yield* Effect.flip(
				client.call((c) => c.integrations.get({ path: { integrationId: IntegrationId.make(id) } })),
			);

			assertTaggedError(error, "NotFound");
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
						path: { integrationId: IntegrationId.make("nonexistent-id-abc123") },
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
					path: { integrationId: IntegrationId.make(id) },
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
						path: { integrationId: IntegrationId.make(id) },
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
		}),
	);
});

describe("Import run visibility", () => {
	it.live(
		"GET /imports/runs excludes integration runs; GET /imports/runs/:id and GET /integrations/:id/runs expose them",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { id: integrationId } = yield* createKodiIntegration(client);

				const { run, runId } = yield* postIntegrationWebhookAndWait(
					client,
					integrationId,
					kodiPayload,
				);

				const allRuns = yield* client.call((c) => c.imports.listRuns());
				expect(allRuns.find((r) => r.id === runId)).toBeUndefined();

				expect(run.id).toBe(ImportRunId.make(runId));

				const integrationRuns = yield* client.call((c) =>
					c.integrations.getRuns({ path: { integrationId: IntegrationId.make(integrationId) } }),
				);
				expect(integrationRuns.find((r) => r.id === runId)).toBeDefined();
			}),
	);
});
