import { EntityId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	fakeProviderDetailsResult,
	getEntity,
	GRACE_WINDOW_MS,
	installTestProvider,
	openInterestWebSocketScoped,
	pollUntil,
	providerSandboxSource,
	replaceSandboxScriptCompiledRepresentation,
	seedEntity,
	testProviderEntitySchema,
	uninstallTestProvider,
} from "~/fixtures/kernel";
import type { InstalledTestProvider } from "~/fixtures/kernel/sandbox-provider";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";
import { startFakeHttpServerScoped } from "~/support/fake-http-server";

const ENTITY_SCHEMA_SLUG = "studio";
const POPULATED_NAME = "E2E Recovered Studio";
const HTTP_CALL_LIMIT = 50;

let provider: InstalledTestProvider;

describe("failed entity population", () => {
	beforeAll(() =>
		runPromise(
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				provider = yield* installTestProvider({
					client,
					scope: "system",
					rootEntitySchemaSlug: ENTITY_SCHEMA_SLUG,
					detailsFailure: "E2E provider details failure",
					details: fakeProviderDetailsResult({ name: POPULATED_NAME }),
				});
			}),
		),
	);

	afterAll(() => runPromise(uninstallTestProvider(provider)));

	it.live(
		"marks a failed population, stops retrying it, and repopulates on an explicit retry",
		() =>
			Effect.gen(function* () {
				const auth = yield* createAuthenticatedClient();
				const { client } = auth;
				const seeded = yield* seedEntity({
					userId: null,
					properties: {},
					name: "Failing Studio",
					providerId: provider.providerId,
					entitySchema: testProviderEntitySchema(provider),
					externalId: `e2e-population-failure-${crypto.randomUUID()}`,
				});

				const socket = yield* openInterestWebSocketScoped(auth);
				yield* socket.replaceInterest([seeded.id]);
				expect(
					yield* socket.waitForEntityUpdated(seeded.id, "population-failed", { timeoutMs: 30_000 }),
				).toEqual({ entityId: seeded.id, type: "entity-updated", reason: "population-failed" });
				expect((yield* getEntity(client, seeded.id)).populationStatus).toBe("failed");

				const reconnected = yield* openInterestWebSocketScoped(auth);
				yield* reconnected.replaceInterest([seeded.id]);
				expect(yield* reconnected.waitForEntityUpdated(seeded.id, "population-failed")).toEqual({
					entityId: seeded.id,
					type: "entity-updated",
					reason: "population-failed",
				});
				yield* reconnected.expectNoEntityUpdated(seeded.id, {
					reason: "populated",
					windowMs: GRACE_WINDOW_MS,
				});
				expect((yield* getEntity(client, seeded.id)).populationStatus).toBe("failed");

				yield* replaceSandboxScriptCompiledRepresentation(
					client,
					provider.detailsScriptId,
					providerSandboxSource({
						operation: "details",
						name: "E2E Provider Script details",
						slug: `${provider.providerSlug}.details`,
						result: fakeProviderDetailsResult({ name: POPULATED_NAME }),
					}),
				);
				const retry = () =>
					client.call((contract) =>
						contract.entities.retryPopulation({
							payload: { pluginId: provider.pluginId },
							params: { entityId: EntityId.make(seeded.id) },
						}),
					);
				expect(yield* retry()).toEqual({ retried: true });
				expect(yield* retry()).toEqual({ retried: false });

				yield* reconnected.waitForEntityUpdated(seeded.id, "populated", { timeoutMs: 30_000 });
				const populated = yield* pollUntil(
					`entity '${seeded.id}' populated after retry`,
					getEntity(client, seeded.id).pipe(
						Effect.map((entity) => (entity.populationStatus === "ready" ? entity : null)),
					),
				);
				expect(populated.name).toBe(POPULATED_NAME);
			}),
	);
	it.live("marks a population whose details script exceeds the httpCall budget as failed", () =>
		Effect.gen(function* () {
			const upstream = yield* startFakeHttpServerScoped();
			const { client: installer } = yield* createAuthenticatedClient();
			const overBudget = yield* Effect.acquireRelease(
				installTestProvider({
					scope: "system",
					client: installer,
					rootEntitySchemaSlug: ENTITY_SCHEMA_SLUG,
					details: fakeProviderDetailsResult({ name: POPULATED_NAME }),
					detailsHttpCalls: { count: HTTP_CALL_LIMIT + 1, url: `${upstream.url}/details` },
				}),
				uninstallTestProvider,
			);
			const auth = yield* createAuthenticatedClient();
			const seeded = yield* seedEntity({
				userId: null,
				properties: {},
				name: "Over Budget Studio",
				providerId: overBudget.providerId,
				entitySchema: testProviderEntitySchema(overBudget),
				externalId: `e2e-population-over-budget-${crypto.randomUUID()}`,
			});

			const socket = yield* openInterestWebSocketScoped(auth);
			yield* socket.replaceInterest([seeded.id]);
			expect(
				yield* socket.waitForEntityUpdated(seeded.id, "population-failed", { timeoutMs: 30_000 }),
			).toEqual({ entityId: seeded.id, type: "entity-updated", reason: "population-failed" });
			expect((yield* getEntity(auth.client, seeded.id)).populationStatus).toBe("failed");
			expect(upstream.requests).toHaveLength(HTTP_CALL_LIMIT);
		}),
	);
});
