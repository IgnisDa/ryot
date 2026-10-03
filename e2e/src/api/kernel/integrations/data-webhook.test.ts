import type { DataJsonDocument } from "@ryot-app/contract/modules/imports/data-json";
import { IntegrationId } from "@ryot-app/contract/schema/brands";
import { integrationProvidersRecipe } from "@ryot-app/ryotql-recipes/integration-providers";
import { Effect, Option } from "effect";

import {
	collectRyotQLRecipeItems,
	createAuthenticatedClient,
	createDataJsonSchemaGraph,
	createEntityFixture,
	createIntegration,
	deleteIntegration,
	getIntegration,
	listEventsForEntity,
	listImportedEntityNames,
	pollImportRunUntilTerminal,
	sendDataWebhook,
} from "~/fixtures/kernel";
import { assertCompleted, assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("Native data JSON webhooks", () => {
	it.live("lists and creates the native integration without installing a plugin", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const providers = yield* collectRyotQLRecipeItems(client, (after) =>
				integrationProvidersRecipe({ after, limit: 100 }),
			);
			const provider = requirePresent(
				providers.find(({ slug }) => slug === "data-json"),
				"Expected native data JSON integration provider",
			);
			expect(provider.pluginSlug).toBeNull();
			expect(provider.lot).toBe("sink");

			const integration = yield* Effect.acquireRelease(
				createIntegration(client, { provider: "data-json", providerSpecifics: {} }),
				({ id }) => deleteIntegration(client, id).pipe(Effect.asVoid, Effect.orDie),
			);
			const detail = requirePresent(
				Option.getOrUndefined(yield* getIntegration(client, integration.id)),
				"Expected native data JSON integration",
			);
			expect(detail.provider).toBe("data-json");
			expect(detail.webhookToken).not.toBeNull();
		}),
	);

	it.live("deduplicates concurrent webhook submissions with the same key and body", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const graph = yield* createDataJsonSchemaGraph(client);
			const integration = yield* Effect.acquireRelease(
				createIntegration(client, { provider: "data-json", providerSpecifics: {} }),
				({ id }) => deleteIntegration(client, id).pipe(Effect.asVoid, Effect.orDie),
			);
			const name = `Webhook duplicate ${crypto.randomUUID()}`;
			const document: DataJsonDocument = {
				events: [],
				relationships: [],
				entities: [
					{
						name,
						key: "record",
						kind: "custom",
						properties: {},
						entitySchemaSlug: graph.entityA.schemaId,
					},
				],
			};

			const runIds = yield* Effect.forEach(
				[0, 1],
				() => sendDataWebhook(client, integration, document, "concurrent-retry"),
				{ concurrency: 2 },
			);
			expect(runIds[0]).toBe(runIds[1]);
			const run = yield* pollImportRunUntilTerminal(
				client,
				requirePresent(runIds[0], "Expected run ID"),
			);
			assertCompleted(run, "deduplicated data webhook");
			expect(yield* listImportedEntityNames(client, graph.entityA.schemaId)).toEqual([name]);
		}),
	);

	it.live("rejects a different payload with a previously used webhook key", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const graph = yield* createDataJsonSchemaGraph(client);
			const integration = yield* Effect.acquireRelease(
				createIntegration(client, { provider: "data-json", providerSpecifics: {} }),
				({ id }) => deleteIntegration(client, id).pipe(Effect.asVoid, Effect.orDie),
			);
			const document = (name: string): DataJsonDocument => ({
				events: [],
				relationships: [],
				entities: [
					{
						name,
						key: "record",
						kind: "custom",
						properties: {},
						entitySchemaSlug: graph.entityA.schemaId,
					},
				],
			});
			const firstRunId = yield* sendDataWebhook(
				client,
				integration,
				document("Webhook original"),
				"webhook-conflict",
			);
			assertCompleted(
				yield* pollImportRunUntilTerminal(client, firstRunId),
				"first data webhook submission",
			);
			const error = yield* Effect.flip(
				sendDataWebhook(client, integration, document("Webhook changed"), "webhook-conflict"),
			);
			assertTaggedError(error, "ImportConflictError");
			expect(error.reason).toEqual({ runId: firstRunId, code: "submission-key-conflict" });
			expect(yield* listImportedEntityNames(client, graph.entityA.schemaId)).toEqual([
				"Webhook original",
			]);
		}),
	);

	it.live("uses integration identity as part of the webhook submission key", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const graph = yield* createDataJsonSchemaGraph(client);
			const firstIntegration = yield* Effect.acquireRelease(
				createIntegration(client, { provider: "data-json", providerSpecifics: {} }),
				({ id }) => deleteIntegration(client, id).pipe(Effect.asVoid, Effect.orDie),
			);
			const secondIntegration = yield* Effect.acquireRelease(
				createIntegration(client, { provider: "data-json", providerSpecifics: {} }),
				({ id }) => deleteIntegration(client, id).pipe(Effect.asVoid, Effect.orDie),
			);
			const name = `Cross-integration submission ${crypto.randomUUID()}`;
			const document: DataJsonDocument = {
				events: [],
				relationships: [],
				entities: [
					{
						name,
						key: "record",
						kind: "custom",
						properties: {},
						entitySchemaSlug: graph.entityA.schemaId,
					},
				],
			};

			const firstRunId = yield* sendDataWebhook(
				client,
				firstIntegration,
				document,
				"same-integration-key",
			);
			const secondRunId = yield* sendDataWebhook(
				client,
				secondIntegration,
				document,
				"same-integration-key",
			);
			expect(secondRunId).not.toBe(firstRunId);
			assertCompleted(
				yield* pollImportRunUntilTerminal(client, firstRunId),
				"first integration data webhook",
			);
			assertCompleted(
				yield* pollImportRunUntilTerminal(client, secondRunId),
				"second integration data webhook",
			);
			expect(yield* listImportedEntityNames(client, graph.entityA.schemaId)).toEqual([name, name]);
		}),
	);

	it.live("fails a disabled integration webhook without importing records", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const graph = yield* createDataJsonSchemaGraph(client);
			const integration = yield* Effect.acquireRelease(
				createIntegration(client, { provider: "data-json", providerSpecifics: {} }),
				({ id }) => deleteIntegration(client, id).pipe(Effect.asVoid, Effect.orDie),
			);
			yield* client.call((c) =>
				c.integrations.update({
					payload: { isDisabled: true },
					params: { integrationId: IntegrationId.make(integration.id) },
				}),
			);
			const runId = yield* sendDataWebhook(
				client,
				integration,
				{
					events: [],
					relationships: [],
					entities: [
						{
							key: "record",
							kind: "custom",
							properties: {},
							name: "Disabled integration record",
							entitySchemaSlug: graph.entityA.schemaId,
						},
					],
				},
				"disabled-run",
			);
			const run = yield* pollImportRunUntilTerminal(client, runId);
			expect(run).toMatchObject({
				status: "failed",
				failureReason: { code: "integration-disabled" },
			});
			expect(yield* listImportedEntityNames(client, graph.entityA.schemaId)).toEqual([]);
		}),
	);

	it.live("rejects data webhooks without an idempotency header", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const integration = yield* Effect.acquireRelease(
				createIntegration(client, { provider: "data-json", providerSpecifics: {} }),
				({ id }) => deleteIntegration(client, id).pipe(Effect.asVoid, Effect.orDie),
			);
			const detail = requirePresent(
				Option.getOrUndefined(yield* getIntegration(client, integration.id)),
				"Expected data JSON integration detail",
			);
			const webhookToken = requirePresent(detail.webhookToken, "Expected data JSON webhook token");
			const error = yield* Effect.flip(
				client.call((c) =>
					c.integrations.webhook({
						headers: {},
						params: { webhookToken },
						payload: JSON.stringify({ events: [], entities: [], relationships: [] }),
					}),
				),
			);
			assertTaggedError(error, "IntegrationRequestError");
			expect(error.reason).toEqual({ provider: "data-json", code: "invalid-provider-settings" });
		}),
	);

	it.live("appends events with the same document key under separate submissions", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const graph = yield* createDataJsonSchemaGraph(client);
			const entity = yield* createEntityFixture(client, {
				properties: {},
				entitySchemaSlug: graph.entityA.schemaId,
				name: `Webhook event owner ${crypto.randomUUID()}`,
			});
			const integration = yield* Effect.acquireRelease(
				createIntegration(client, { provider: "data-json", providerSpecifics: {} }),
				({ id }) => deleteIntegration(client, id).pipe(Effect.asVoid, Effect.orDie),
			);
			const makeDocument = (occurredAt: string): DataJsonDocument => ({
				relationships: [],
				entities: [
					{
						kind: "existing",
						key: "owner-entity",
						entityId: entity.id,
						entitySchemaSlug: graph.entityA.schemaId,
					},
				],
				events: [
					{
						occurredAt,
						properties: {},
						key: "same-event-key",
						entityKey: "owner-entity",
						eventSchemaSlug: graph.event.id,
					},
				],
			});
			const firstRunId = yield* sendDataWebhook(
				client,
				integration,
				makeDocument("2026-09-10T00:00:00.000Z"),
				"event-submission-one",
			);
			assertCompleted(
				yield* pollImportRunUntilTerminal(client, firstRunId),
				"first data webhook event",
			);
			const secondRunId = yield* sendDataWebhook(
				client,
				integration,
				makeDocument("2026-09-11T00:00:00.000Z"),
				"event-submission-two",
			);
			assertCompleted(
				yield* pollImportRunUntilTerminal(client, secondRunId),
				"second data webhook event",
			);
			const events = yield* listEventsForEntity(client, entity.id, undefined, 100);
			expect(events.map(({ occurredAt }) => occurredAt)).toEqual([
				"2026-09-11T00:00:00.000Z",
				"2026-09-10T00:00:00.000Z",
			]);
		}),
	);
});
