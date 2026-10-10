import { integrationWebhookUrl } from "@ryot-app/contract/modules/integrations/schemas";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	ImportRunId,
	IntegrationId,
	IntegrationWebhookToken,
} from "@ryot-app/contract/schema/brands";
import { integrationProvidersRecipe } from "@ryot-app/ryotql-recipes/integration-providers";
import { Effect, Option, Schema } from "effect";

import {
	collectRyotQLRecipeItems,
	createAudiobookshelfIntegration,
	createAuthenticatedClient,
	createIntegration,
	createKodiIntegration,
	deleteIntegration,
	getIntegration,
	getImportRun,
	installTestIntegrationProvider,
	listIntegrationImportRuns,
	listIntegrations,
	listManualImportRuns,
	postIntegrationWebhookAndWait,
	postIntegrationWebhook,
	pollUntil,
	pollImportRunUntilTerminal,
	syncIntegrations,
	updateUserSettingsPreferences,
	uninstallTestPluginStrict,
} from "~/fixtures/kernel";
import {
	assertTaggedError,
	requireObjectRecord,
	requirePresent,
	requireString,
} from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { webRequest } from "~/support/web-request";

const kodiPayload = { lot: "movie", progress: 50, identifier: "tt1234567" };
const testSettingsSchema = {
	unknownKeys: "strict",
	fields: {
		label: { type: "string", label: "Label", description: "Optional test integration label" },
	},
} satisfies PluginManifest["integrationProviders"][number]["settingsSchema"];

describe("Integration CRUD", () => {
	it.live("cancels an integration-owned import without recording integration completion", () =>
		Effect.gen(function* () {
			const { providerSlug } = yield* Effect.acquireRelease(
				installTestIntegrationProvider(testSettingsSchema, { delayMs: 30_000 }),
				({ plugin: installed }) => uninstallTestPluginStrict(installed).pipe(Effect.orDie),
			);
			const { client } = yield* createAuthenticatedClient();
			const integration = yield* Effect.acquireRelease(
				createIntegration(client, {
					providerSpecifics: {},
					provider: providerSlug,
					extraSettings: { disableOnContinuousErrors: true },
				}),
				({ id }) => deleteIntegration(client, id).pipe(Effect.asVoid, Effect.orDie),
			);
			const delivery = yield* postIntegrationWebhook(client, integration, { fixture: true });
			const runId = requirePresent(delivery.runId, "Expected integration import run");
			yield* pollUntil(
				`Integration import '${runId}' to start`,
				Effect.gen(function* () {
					const run = (yield* getImportRun(client, runId, undefined, 10)).run;
					return run?.status === "running" ? true : null;
				}),
			);

			yield* client.call((c) => c.imports.cancelRun({ params: { runId } }));
			const cancelled = yield* pollImportRunUntilTerminal(client, runId);
			expect(cancelled.status).toBe("cancelled");
			expect(cancelled.failureReason).toBeNull();

			const current = requirePresent(
				Option.getOrUndefined(yield* getIntegration(client, integration.id)),
				"Expected integration after cancellation",
			);
			expect(current.lastFinishedAt).toBeNull();
			expect(current.isDisabled).toBe(false);
		}),
	);

	it.live("lists integration providers with server-owned form schemas", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const providers = yield* collectRyotQLRecipeItems(client, (after) =>
				integrationProvidersRecipe({ after, limit: 100 }),
			);
			const radarr = requirePresent(
				providers.find(({ slug }) => slug === "radarr"),
				"Expected Radarr provider",
			);
			const kodi = requirePresent(
				providers.find(({ slug }) => slug === "kodi"),
				"Expected Kodi provider",
			);
			const komga = requirePresent(
				providers.find(({ slug }) => slug === "komga"),
				"Expected Komga provider",
			);
			const spotify = requirePresent(
				providers.find(({ slug }) => slug === "spotify"),
				"Expected Spotify provider",
			);
			const anilist = requirePresent(
				providers.find(({ slug }) => slug === "anilist"),
				"Expected AniList provider",
			);

			expect(radarr.lot).toBe("push");
			expect(radarr.hasScript).toBe(true);
			expect(radarr.requiresProKey).toBe(false);
			expect(radarr.commonSchema.fields).not.toHaveProperty("minimumProgress");
			expect(radarr.commonSchema.fields).not.toHaveProperty("syncOwnership");
			expect(kodi.lot).toBe("sink");
			expect(kodi.hasScript).toBe(true);
			expect(kodi.requiresProKey).toBe(false);
			expect(kodi.commonSchema.fields.minimumProgress).toMatchObject({
				type: "number",
				defaultValue: 2,
			});
			expect(kodi.commonSchema.fields).not.toHaveProperty("syncOwnership");
			expect(komga.supportsOwnershipSync).toBe(true);
			expect(komga.commonSchema.fields).toHaveProperty("syncOwnership");
			expect(spotify.supportsOwnershipSync).toBe(false);
			expect(spotify.commonSchema.fields).not.toHaveProperty("syncOwnership");
			expect(anilist.lot).toBe("yank");
			expect(anilist.hasScript).toBe(true);
			expect(anilist.requiresProKey).toBe(true);
			expect(anilist.supportsOwnershipSync).toBe(false);
		}),
	);

	it.live("creates with correct defaults", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { id } = yield* createKodiIntegration(client);
			const integration = requirePresent(
				Option.getOrUndefined(yield* getIntegration(client, id)),
				"Expected created Kodi integration",
			);
			const { frontendOrigin } = yield* client.call((c) => c.system.config());

			expect(integration.isDisabled).toBe(false);
			expect(integration.syncOwnership).toBe(false);
			expect(integration.minimumProgress).toBe(2);
			expect(integration.maximumProgress).toBe(95);
			expect(integration.extraSettings.disableOnContinuousErrors).toBe(false);
			const token = requirePresent(integration.webhookToken, "Expected sink webhook token");
			const webhookUrl = new URL(integrationWebhookUrl(frontendOrigin, token));
			expect(webhookUrl.origin).toBe(new URL(frontendOrigin).origin);
			expect(webhookUrl.pathname).toBe(`/_i/${token}`);
		}),
	);

	it.live("creates a push integration without an integration script", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { id } = yield* createIntegration(client, {
				provider: "radarr",
				providerSpecifics: {
					kind: "radarr",
					profileId: "1",
					tagIds: [3, 7],
					apiKey: "radarr-secret",
					rootFolderPath: "/movies",
					baseUrl: "https://radarr.test",
					syncCollectionIds: ["collection-1"],
				},
			});
			const integration = requirePresent(
				Option.getOrUndefined(yield* getIntegration(client, id)),
				"Expected created Radarr integration",
			);

			expect(integration.lot).toBe("push");
			expect(integration.provider).toBe("radarr");
			expect(integration.webhookToken).toBeNull();
			expect(integration.providerSpecifics).not.toHaveProperty("apiKey");
			expect(integration.providerSpecifics.tagIds).toEqual([3, 7]);
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

			assertTaggedError(error, "IntegrationRequestError");
			expect(error.reason).toEqual({
				minimumProgress: 80,
				maximumProgress: 20,
				code: "invalid-progress-range",
			});
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

			assertTaggedError(error, "IntegrationRequestError");
			expect(error.reason).toEqual({ provider: "emby", code: "invalid-provider-settings" });
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

			const enabled = yield* listIntegrations(client, { provider: "kodi", isDisabled: false });
			expect(enabled).toHaveLength(1);
			expect(requirePresent(enabled[0], "Expected enabled integration").isDisabled).toBe(false);
		}),
	);

	it.live("PATCH updates name and redacts secret fields", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const created = yield* createAudiobookshelfIntegration(client);
			const before = requirePresent(
				Option.getOrUndefined(yield* getIntegration(client, created.id)),
				"Expected created integration",
			);
			expect(before.name).toBe("ABS");

			const data = yield* client.call((c) =>
				c.integrations.update({
					payload: { name: "My ABS" },
					params: { integrationId: IntegrationId.make(created.id) },
				}),
			);
			expect(data).toEqual({ id: created.id });

			const integration = requirePresent(
				Option.getOrUndefined(yield* getIntegration(client, created.id)),
				"Expected updated integration",
			);
			expect(integration.name).toBe("My ABS");
			expect(integration.providerSpecifics).not.toHaveProperty("token");
			expect(integration.providerSpecifics.baseUrl).toBe("https://abs.example.com");
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

			assertTaggedError(error, "IntegrationRequestError");
			expect(error.reason).toEqual({
				minimumProgress: 90,
				maximumProgress: 10,
				code: "invalid-progress-range",
			});
		}),
	);

	it.live("DELETE removes the integration", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const { id } = yield* createKodiIntegration(client);
			yield* deleteIntegration(client, id);

			expect(Option.isNone(yield* getIntegration(client, id))).toBe(true);
		}),
	);
});

describe("Integration sync", () => {
	it.live("starts eligible yank integrations only for the authenticated user", () =>
		Effect.gen(function* () {
			const { client: clientA } = yield* createAuthenticatedClient();
			const { client: clientB } = yield* createAuthenticatedClient();
			const enabled = yield* createIntegration(clientA, {
				provider: "audiobookshelf",
				providerSpecifics: {
					token: "test-token",
					kind: "audiobookshelf",
					baseUrl: "https://abs.example.com",
				},
			});
			const disabled = yield* createAudiobookshelfIntegration(clientA);
			const otherUser = yield* createIntegration(clientB, {
				provider: "audiobookshelf",
				providerSpecifics: {
					token: "test-token",
					kind: "audiobookshelf",
					baseUrl: "https://abs.example.com",
				},
			});

			const accepted = yield* syncIntegrations(clientA);
			expect(accepted.executionId).toMatch(/^integration-sync-/);

			yield* pollUntil(
				"manual integration sync run",
				listIntegrationImportRuns(clientA, enabled.id, undefined, 20).pipe(
					Effect.map(({ items }) => items[0] ?? null),
				),
			);

			const disabledRuns = yield* listIntegrationImportRuns(clientA, disabled.id, undefined, 20);
			const otherUserRuns = yield* listIntegrationImportRuns(clientB, otherUser.id, undefined, 20);
			expect(disabledRuns.items).toHaveLength(0);
			expect(otherUserRuns.items).toHaveLength(0);
		}),
	);
});

describe("Webhook routes", () => {
	it.live("POST /api/webhooks/integrations/{unknownWebhookToken} returns NotFound", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const error = yield* Effect.flip(
				client.call((c) =>
					c.integrations.webhook({
						headers: {},
						payload: "{}",
						params: {
							webhookToken: IntegrationWebhookToken.make("nonexistent-webhook-token-abc123"),
						},
					}),
				),
			);

			assertTaggedError(error, "IntegrationNotFoundError");
			expect(error.reason).toEqual({ code: "integration-webhook-not-found" });
		}),
	);

	it.live("POST /api/webhooks/integrations/{validKodiWebhookToken} creates a run", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const integration = yield* createKodiIntegration(client);

			const { data } = yield* postIntegrationWebhookAndWait(client, integration, kodiPayload);

			expect(data.runId).toBeDefined();
		}),
	);

	it.live("POST /_i/{validKodiWebhookToken} creates a run from a JSON payload", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const integration = yield* createKodiIntegration(client);
			const detail = requirePresent(
				Option.getOrUndefined(yield* getIntegration(client, integration.id)),
				"Expected Kodi integration detail",
			);
			const { frontendOrigin } = yield* client.call((c) => c.system.config());
			const webhookUrl = integrationWebhookUrl(
				frontendOrigin,
				requirePresent(detail.webhookToken, "Expected sink webhook token"),
			);

			const response = yield* webRequest(webhookUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(kodiPayload),
			});
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
			const integration = yield* createKodiIntegration(client);

			yield* client.call((c) =>
				c.integrations.update({
					payload: { isDisabled: true },
					params: { integrationId: IntegrationId.make(integration.id) },
				}),
			);

			const { run } = yield* postIntegrationWebhookAndWait(client, integration, kodiPayload);
			expect(run.status).toBe("failed");
		}),
	);

	it.live("POST when disableIntegrations preference is true returns 202 with failed run", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const integration = yield* createKodiIntegration(client);

			yield* updateUserSettingsPreferences(client, { disableIntegrations: true });

			const { run } = yield* postIntegrationWebhookAndWait(client, integration, kodiPayload);
			expect(run.status).toBe("failed");
		}),
	);

	it.live("POST with a non-Sink webhook token returns NotFound", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const integration = yield* createAudiobookshelfIntegration(client);

			const error = yield* Effect.flip(
				client.call((c) =>
					c.integrations.webhook({
						headers: {},
						payload: "{}",
						params: { webhookToken: IntegrationWebhookToken.make(integration.id) },
					}),
				),
			);

			assertTaggedError(error, "IntegrationNotFoundError");
			expect(error.reason).toEqual({ code: "integration-webhook-not-found" });
		}),
	);
});

describe("Import run visibility", () => {
	it.live(
		"RyotQL manual runs exclude integration runs while detail and integration lists expose them",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const integration = yield* createKodiIntegration(client);

				const { run, runId } = yield* postIntegrationWebhookAndWait(
					client,
					integration,
					kodiPayload,
				);

				const allRuns = yield* listManualImportRuns(client, undefined, 20);
				expect(allRuns.items.find((r) => r.id === runId)).toBeUndefined();

				expect(run.id).toBe(ImportRunId.make(runId));

				const integrationRuns = yield* listIntegrationImportRuns(
					client,
					integration.id,
					undefined,
					20,
				);
				expect(integrationRuns.items.find((r) => r.id === runId)).toBeDefined();
			}),
	);
});
