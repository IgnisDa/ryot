import { EntityId, RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import { Deferred, Effect, Exit } from "effect";

import {
	createAuthenticatedClient,
	fakeProviderDetailsResult,
	findRelationshipBySchema,
	getApiClient,
	getEntity,
	getVisibleEntityByProvenance,
	insertGlobalRelationship,
	installTestProviders,
	markEntityPopulated,
	namespaceInstallation,
	openInterestWebSocketScoped,
	pollUntil,
	providerSandboxSource,
	relatedPageKey,
	replaceSandboxScriptCompiledRepresentation,
	seedEntity,
	testProviderEntitySchema,
	uninstallTestProvider,
} from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { startFakeHttpServerScoped } from "~/support/fake-http-server";

describe("related population progress", () => {
	it.live("exposes partial pages, retains data on failure, and admits one new manual retry", () =>
		Effect.gen(function* () {
			const auth = yield* createAuthenticatedClient();
			const failedPage = yield* Deferred.make<void>();
			const retryPage = yield* Deferred.make<void>();
			let retrying = false;
			const upstream = yield* startFakeHttpServerScoped((url) =>
				url.pathname === "/page-3"
					? Deferred.await(retrying ? retryPage : failedPage).pipe(
							Effect.as(Response.json({ ok: true })),
						)
					: Response.json({ ok: true }),
			);
			yield* Effect.addFinalizer(() =>
				Effect.all(
					[Deferred.succeed(failedPage, undefined), Deferred.succeed(retryPage, undefined)],
					{ discard: true },
				),
			);
			const relatedProviderSlug = `related-${crypto.randomUUID()}`;
			const prefix = crypto.randomUUID();
			const related = (index: number) => ({
				name: `Related record ${index}`,
				externalId: `${prefix}-${index}`,
				providerSlug: relatedProviderSlug,
			});
			const pageCalls = {
				[relatedPageKey({ page: 2 })]: { count: 1, url: `${upstream.url}/page-2` },
				[relatedPageKey({ page: 3 })]: { count: 1, url: `${upstream.url}/page-3` },
			};
			const firstPages = {
				[relatedPageKey({ page: 2 })]: { entities: [related(2)], continuation: { page: 3 } },
			};
			const providers = yield* Effect.acquireRelease(
				installTestProviders({
					scope: "system",
					client: auth.client,
					relationshipSchemas: [
						{
							slug: "record-to-related",
							name: "Record to related record",
							sourceEntitySchemaSlug: "record",
							propertiesSchema: { fields: {} },
							targetEntitySchemaSlug: "related-record",
						},
					],
					providers: {
						related: {
							slug: relatedProviderSlug,
							rootEntitySchemaSlug: "related-record",
							details: fakeProviderDetailsResult({ name: "Related record" }),
						},
						root: {
							relatedPages: firstPages,
							rootEntitySchemaSlug: "record",
							relatedPageHttpCalls: pageCalls,
							detailsHttpCalls: { count: 1, url: `${upstream.url}/details` },
							details: fakeProviderDetailsResult({
								name: "Populated root record",
								properties: { description: "Retained root content" },
								relatedEntityGroups: [
									{
										direction: "outgoing",
										entities: [related(1)],
										continuation: { page: 2 },
										synchronization: "authoritative",
										relationshipSchemaSlug: "record-to-related",
									},
								],
							}),
						},
					},
				}),
				({ root }) => uninstallTestProvider(root),
			);
			yield* getApiClient().adminCall((contract) =>
				contract.testSupport.reconcilePluginInstallations(),
			);
			yield* namespaceInstallation(auth.client, providers.root.pluginId);
			const root = yield* seedEntity({
				name: "Existing root record",
				externalId: `${prefix}-root`,
				providerId: providers.root.providerId,
				properties: { description: "Retained root content" },
				entitySchema: testProviderEntitySchema(providers.root),
			});
			yield* markEntityPopulated(root.id, "base");
			const stale = yield* seedEntity({
				properties: {},
				externalId: `${prefix}-stale`,
				name: "Previously related record",
				providerId: providers.related.providerId,
				entitySchema: testProviderEntitySchema(providers.related),
			});
			const owner = testProviderEntitySchema(providers.root).owner;
			yield* insertGlobalRelationship({
				sourceEntityId: root.id,
				targetEntityId: stale.id,
				relationshipSchema: { owner, slug: RelationshipSchemaSlug.make("record-to-related") },
			});
			const relationship = (targetEntityId: string) =>
				findRelationshipBySchema(auth.client, {
					owner,
					targetEntityId,
					sourceEntityId: root.id,
					relationshipSchemaSlug: "record-to-related",
				});
			const socket = yield* openInterestWebSocketScoped(auth);
			yield* socket.replaceInterest([root.id], [root.id]);
			yield* pollUntil(
				"last related page held upstream",
				Effect.sync(() => (upstream.requests.some(({ path }) => path === "/page-3") ? true : null)),
			);
			const partial = yield* getEntity(auth.client, root.id);
			expect(partial.populationStatus).toEqual({ state: "running", availability: "complete" });
			expect(partial.relatedPopulationStatus).toEqual({
				state: "running",
				availability: "partial",
			});
			expect(partial.properties).toEqual({ description: "Retained root content" });
			const readableIds: string[] = [];
			for (const index of [1, 2]) {
				const record = yield* getVisibleEntityByProvenance(auth.client, {
					entitySchemaSlug: "related-record",
					externalId: related(index).externalId,
					providerId: providers.related.providerId,
				});
				expect((yield* getEntity(auth.client, record.id)).name).toBe(related(index).name);
				expect((yield* relationship(record.id)).sourceEntityId).toBe(root.id);
				readableIds.push(record.id);
			}
			yield* relationship(stale.id);
			yield* socket.waitForEntityUpdated(root.id, "populated");
			yield* socket.waitForEntityUpdated(root.id, "enrichment-updated");

			yield* Deferred.succeed(failedPage, undefined);
			const failed = yield* pollUntil(
				"related page failure projected",
				getEntity(auth.client, root.id).pipe(
					Effect.map((entity) =>
						entity.relatedPopulationStatus.state === "failed" ? entity : null,
					),
				),
			);
			expect(failed.relatedPopulationStatus).toEqual({ state: "failed", availability: "partial" });
			expect(failed.populationStatus).toEqual({ state: "failed", availability: "complete" });
			expect(failed.properties).toEqual(partial.properties);
			for (const id of readableIds) {
				yield* getEntity(auth.client, id);
				yield* relationship(id);
			}
			yield* relationship(stale.id);
			const observer = yield* createAuthenticatedClient();
			expect((yield* getEntity(observer.client, root.id)).relatedPopulationStatus).toEqual({
				state: "idle",
				availability: "partial",
			});
			expect(upstream.requests.filter(({ path }) => path === "/page-3")).toHaveLength(1);

			yield* replaceSandboxScriptCompiledRepresentation(
				auth.client,
				requirePresent(providers.root.relatedScriptId, "Related script is installed"),
				providerSandboxSource({
					operation: "related",
					name: "Recovered related pages",
					relatedPageHttpCalls: pageCalls,
					slug: `${providers.root.providerSlug}.related`,
					result: {
						...firstPages,
						[relatedPageKey({ page: 3 })]: { continuation: null, entities: [related(3)] },
					},
				}),
			);
			retrying = true;
			const idempotencyKey = crypto.randomUUID();
			const retries = yield* Effect.forEach(
				[0, 1],
				() =>
					auth.client.call((contract) =>
						contract.entities.requestEnrichment({
							params: { entityId: EntityId.make(root.id) },
							payload: {
								idempotencyKey,
								action: "retry",
								operation: "population",
								pluginId: providers.root.pluginId,
							},
						}),
					),
				{ concurrency: "unbounded" },
			);
			expect(retries[0]?.enrichmentRequestId).not.toBeNull();
			expect(retries[1]).toEqual(retries[0]);
			yield* pollUntil(
				"new attempt reached final page",
				Effect.gen(function* () {
					const current = yield* getEntity(auth.client, root.id);
					expect(current.relatedPopulationStatus.state).not.toBe("failed");
					return upstream.requests.filter(({ path }) => path === "/page-3").length === 2
						? true
						: null;
				}),
			);
			expect((yield* getEntity(auth.client, root.id)).properties).toEqual(partial.properties);
			yield* relationship(stale.id);
			yield* Deferred.succeed(retryPage, undefined);
			const complete = yield* pollUntil(
				"manual retry completed",
				getEntity(auth.client, root.id).pipe(
					Effect.map((entity) =>
						entity.relatedPopulationStatus.state === "succeeded" ? entity : null,
					),
				),
			);
			expect(complete.relatedPopulationStatus).toEqual({
				state: "succeeded",
				availability: "complete",
			});
			expect(complete.populationStatus).toEqual({ state: "succeeded", availability: "complete" });
			expect(complete.properties).toEqual(partial.properties);
			for (const id of readableIds) {
				yield* getEntity(auth.client, id);
				yield* relationship(id);
			}
			expect(Exit.isFailure(yield* Effect.exit(relationship(stale.id)))).toBe(true);
			const last = yield* getVisibleEntityByProvenance(auth.client, {
				externalId: related(3).externalId,
				entitySchemaSlug: "related-record",
				providerId: providers.related.providerId,
			});
			yield* relationship(last.id);
			for (const path of ["/details", "/page-2", "/page-3"]) {
				expect(upstream.requests.filter((request) => request.path === path)).toHaveLength(2);
			}
		}),
	);
});
