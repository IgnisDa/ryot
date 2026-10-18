import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { Deferred, Effect } from "effect";

import {
	createAuthenticatedClient,
	createCollection,
	fakeProviderDetailsResult,
	fakeProviderTranslations,
	findRelationshipBySchema,
	getApiClient,
	getEntity,
	installTestProvider,
	namespaceInstallation,
	openInterestWebSocketScoped,
	pollUntil,
	seedEntity,
	seedEntityTranslation,
	setEntityPopulatedAt,
	setUserLanguage,
	testProviderEntitySchema,
	uninstallTestProvider,
} from "~/fixtures/kernel";
import { expect, it } from "~/support/effect-test";
import { startFakeHttpServerScoped } from "~/support/fake-http-server";

it.live(
	"refreshes successful shared data once, keeps user links, and replays after completion",
	() =>
		Effect.gen(function* () {
			const release = yield* Deferred.make<void>();
			yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
			const upstream = yield* startFakeHttpServerScoped(() =>
				Deferred.await(release).pipe(Effect.as(Response.json({ ok: true }))),
			);
			const first = yield* createAuthenticatedClient();
			const second = yield* createAuthenticatedClient();
			const provider = yield* Effect.acquireRelease(
				installTestProvider({
					scope: "system",
					client: first.client,
					rootEntitySchemaSlug: "record",
					detailsHttpCalls: { count: 1, url: `${upstream.url}/details` },
					details: fakeProviderDetailsResult({ name: "Refreshed record" }),
				}),
				uninstallTestProvider,
			);
			yield* getApiClient().adminCall((contract) =>
				contract.testSupport.reconcilePluginInstallations(),
			);
			yield* namespaceInstallation(first.client, provider.pluginId);
			yield* namespaceInstallation(second.client, provider.pluginId);
			const seeded = yield* seedEntity({
				userId: null,
				properties: {},
				name: "Saved record",
				providerId: provider.providerId,
				externalId: crypto.randomUUID(),
				entitySchema: testProviderEntitySchema(provider),
			});
			yield* setEntityPopulatedAt(seeded.id, "2026-01-01T00:00:00.000Z");
			const collection = yield* createCollection(first.client);
			yield* first.client.call((contract) =>
				contract.collections.createMembership({
					payload: { collectionId: collection.id, entityId: EntityId.make(seeded.id) },
				}),
			);
			const membership = () =>
				findRelationshipBySchema(first.client, {
					sourceEntityId: seeded.id,
					owner: definitionOwner(null),
					targetEntityId: collection.id,
					relationshipSchemaSlug: "member-of",
				});
			const before = yield* membership();
			const socket = yield* openInterestWebSocketScoped(first);
			yield* socket.replaceInterest([seeded.id]);
			expect((yield* getEntity(first.client, seeded.id)).name).toBe("Saved record");
			const key = crypto.randomUUID();
			const submit = (client: typeof first.client, idempotencyKey: string) =>
				client.call((contract) =>
					contract.entities.requestEnrichment({
						params: { entityId: EntityId.make(seeded.id) },
						payload: {
							idempotencyKey,
							action: "refresh",
							operation: "population",
							pluginId: provider.pluginId,
						},
					}),
				);
			const accepted = yield* submit(first.client, key);
			expect(accepted.enrichmentRequestId).not.toBeNull();
			yield* pollUntil(
				"refresh reached provider",
				Effect.sync(() => (upstream.requests.length === 1 ? true : null)),
			);
			const joined = yield* submit(second.client, crypto.randomUUID());
			expect(joined.enrichmentRequestId).not.toBeNull();
			expect((yield* getEntity(first.client, seeded.id)).populationStatus).toEqual({
				state: "running",
				availability: "complete",
			});
			expect((yield* getEntity(second.client, seeded.id)).populationStatus.state).toBe("running");
			expect(upstream.requests).toHaveLength(1);
			yield* Deferred.succeed(release, undefined);
			for (const client of [first.client, second.client]) {
				const refreshed = yield* pollUntil(
					"full refresh completed",
					getEntity(client, seeded.id).pipe(
						Effect.map((entity) =>
							entity.relatedPopulationStatus.state === "succeeded" ? entity : null,
						),
					),
				);
				expect(refreshed.name).toBe("Refreshed record");
				expect(refreshed.providerCheckedAt).not.toBeNull();
			}
			expect(yield* membership()).toEqual(before);
			expect(yield* submit(first.client, key)).toEqual(accepted);
			yield* submit(first.client, crypto.randomUUID());
			yield* pollUntil(
				"cooldown request completed",
				getEntity(first.client, seeded.id).pipe(
					Effect.map((entity) =>
						entity.relatedPopulationStatus.state === "succeeded" ? entity : null,
					),
				),
			);
			expect(upstream.requests).toHaveLength(1);
		}),
);

it.live("keeps successful saved data when an explicit refresh fails", () =>
	Effect.gen(function* () {
		const auth = yield* createAuthenticatedClient();
		const provider = yield* Effect.acquireRelease(
			installTestProvider({
				scope: "system",
				client: auth.client,
				rootEntitySchemaSlug: "record",
				detailsFailure: "Provider is unavailable",
				details: fakeProviderDetailsResult({ name: "Unavailable new record" }),
			}),
			uninstallTestProvider,
		);
		yield* getApiClient().adminCall((contract) =>
			contract.testSupport.reconcilePluginInstallations(),
		);
		yield* namespaceInstallation(auth.client, provider.pluginId);
		const seeded = yield* seedEntity({
			userId: null,
			properties: {},
			name: "Saved record",
			providerId: provider.providerId,
			externalId: crypto.randomUUID(),
			entitySchema: testProviderEntitySchema(provider),
		});
		yield* setEntityPopulatedAt(seeded.id, "2026-01-01T00:00:00.000Z");
		const request = {
			params: { entityId: EntityId.make(seeded.id) },
			payload: {
				action: "refresh" as const,
				pluginId: provider.pluginId,
				operation: "population" as const,
				idempotencyKey: crypto.randomUUID(),
			},
		};
		const accepted = yield* auth.client.call((contract) =>
			contract.entities.requestEnrichment(request),
		);
		const failed = yield* pollUntil(
			"explicit refresh failed",
			getEntity(auth.client, seeded.id).pipe(
				Effect.map((entity) => (entity.populationStatus.state === "failed" ? entity : null)),
			),
		);
		expect(failed.name).toBe("Saved record");
		expect(failed.populationStatus.availability).toBe("complete");
		expect(failed.providerCheckedAt).toBeNull();
		expect(
			yield* auth.client.call((contract) => contract.entities.requestEnrichment(request)),
		).toEqual(accepted);
	}),
);

it.live("refreshes the current-language overlay even when canonical content is unchanged", () =>
	Effect.gen(function* () {
		const auth = yield* createAuthenticatedClient();
		const properties = { description: "Canonical description" };
		const provider = yield* Effect.acquireRelease(
			installTestProvider({
				scope: "system",
				client: auth.client,
				rootEntitySchemaSlug: "record",
				information: { source: "test", canonicalLanguage: "en" },
				details: fakeProviderDetailsResult({ properties, name: "Canonical record" }),
				translations: fakeProviderTranslations({ es: { name: "New translated name" } }),
			}),
			uninstallTestProvider,
		);
		yield* getApiClient().adminCall((contract) =>
			contract.testSupport.reconcilePluginInstallations(),
		);
		yield* namespaceInstallation(auth.client, provider.pluginId);
		const seeded = yield* seedEntity({
			properties,
			userId: null,
			name: "Canonical record",
			providerId: provider.providerId,
			externalId: crypto.randomUUID(),
			entitySchema: testProviderEntitySchema(provider),
		});
		yield* setEntityPopulatedAt(seeded.id, "2026-01-01T00:00:00.000Z");
		yield* seedEntityTranslation({
			language: "es",
			entityId: seeded.id,
			name: "Old translated name",
		});
		yield* setUserLanguage(auth.client, "es");
		expect((yield* getEntity(auth.client, seeded.id)).name).toBe("Old translated name");
		yield* auth.client.call((contract) =>
			contract.entities.requestEnrichment({
				params: { entityId: EntityId.make(seeded.id) },
				payload: {
					action: "refresh",
					operation: "population",
					pluginId: provider.pluginId,
					idempotencyKey: crypto.randomUUID(),
				},
			}),
		);
		const refreshed = yield* pollUntil(
			"current-language refresh completed",
			getEntity(auth.client, seeded.id).pipe(
				Effect.map((entity) => (entity.name === "New translated name" ? entity : null)),
			),
		);
		expect(refreshed.translationStatus).toEqual({ state: "succeeded", availability: "complete" });
		expect(refreshed.properties).toEqual(properties);
	}),
);
