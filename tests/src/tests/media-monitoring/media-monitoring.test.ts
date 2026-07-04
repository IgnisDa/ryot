import { EntityId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	cleanupBuiltinProviderScript,
	adminHeaders,
	countMediaMonitoringRelationships,
	createAuthenticatedClient,
	createNotificationChannel,
	disableMediaMonitoring,
	enableMediaMonitoring,
	fakeProviderDetailsResult,
	getBackendClient,
	getMediaMonitoringStatus,
	getBuiltinEntitySchemaId,
	providerSandboxSource,
	queryInLibraryRelationship,
	replaceSandboxScriptCompiledRepresentation,
	seedBuiltinProviderScript,
	seedMediaEntity,
	startFakeAppriseServer,
	triggerCronAndWaitForEntity,
	type Client,
	pollUntil,
} from "~/fixtures";
import { assertTaggedError, requireObjectRecord } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";
import type { FakeHttpServer } from "~/support/fake-http-server";

const providerName = "Media Monitoring E2E Provider";
const apiExternalId = `media-monitoring-api-${crypto.randomUUID()}`;
const cronExternalId = `media-monitoring-cron-${crypto.randomUUID()}`;
const discoveryExternalId = `media-monitoring-discovery-${crypto.randomUUID()}`;

const providerDetails = (productionStatus: string) =>
	fakeProviderDetailsResult({
		name: "Media Monitoring Cron Target",
		properties: { productionStatus, publishYear: 2026 },
	});

const discoveryProviderDetails = (episodeCount: number) =>
	fakeProviderDetailsResult({
		name: "Media Monitoring Discovery Target",
		properties: { productionStatus: "Continuing", publishYear: 2026 },
		childEntities:
			episodeCount === 0
				? []
				: [
						{
							name: "Season 1",
							properties: { seasonNumber: 1 },
							entitySchemaSlug: "show-season",
							externalId: "discovery-season-1",
							childEntities: Array.from({ length: episodeCount }, (_, index) => ({
								name: `Episode ${index + 1}`,
								entitySchemaSlug: "show-episode",
								externalId: `discovery-episode-${index + 1}`,
								properties: { seasonNumber: 1, episodeNumber: index + 1 },
							})),
						},
					],
	});

let apiEntityId: string;
let cronEntityId: string;
let movieSchemaId: string;
let discoveryEntityId: string;
let fakeApprise: FakeHttpServer;
let providerCompilerClient: Client;
const extraEntityIds: string[] = [];
let provider: Effect.Effect.Success<ReturnType<typeof seedBuiltinProviderScript>>;
let discoveryProvider: Effect.Effect.Success<ReturnType<typeof seedBuiltinProviderScript>>;

beforeAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			providerCompilerClient = client;
			movieSchemaId = yield* getBuiltinEntitySchemaId("movie");
			provider = yield* seedBuiltinProviderScript({
				client,
				name: providerName,
				slug: `movie.media-monitoring-e2e-${crypto.randomUUID()}`,
				drivers: { details: providerDetails("Continuing") },
			});
			discoveryProvider = yield* seedBuiltinProviderScript({
				client,
				name: `${providerName} Discovery`,
				drivers: { details: discoveryProviderDetails(0) },
				slug: `show.media-monitoring-discovery-e2e-${crypto.randomUUID()}`,
			});
			const apiEntity = yield* seedMediaEntity({
				properties: {},
				externalId: apiExternalId,
				entitySchemaId: movieSchemaId,
				sandboxScriptId: provider.scriptId,
				name: "Media Monitoring API Target",
			});
			const cronEntity = yield* seedMediaEntity({
				properties: {},
				externalId: cronExternalId,
				entitySchemaId: movieSchemaId,
				sandboxScriptId: provider.scriptId,
				name: "Media Monitoring Cron Target",
			});
			const showSchemaId = yield* getBuiltinEntitySchemaId("show");
			const discoveryEntity = yield* seedMediaEntity({
				properties: {},
				entitySchemaId: showSchemaId,
				externalId: discoveryExternalId,
				name: "Media Monitoring Discovery Target",
				sandboxScriptId: discoveryProvider.scriptId,
			});
			apiEntityId = apiEntity.id;
			cronEntityId = cronEntity.id;
			discoveryEntityId = discoveryEntity.id;
			yield* getBackendClient().call(
				(c) =>
					c.testSupport.setEntityPopulatedAt({
						path: { entityId: EntityId.make(apiEntityId) },
						payload: { populatedAt: new Date().toISOString() },
					}),
				adminHeaders,
			);
		}),
	);

	fakeApprise = await startFakeAppriseServer();
});

afterAll(async () => {
	fakeApprise.stop();
	await Effect.runPromise(
		Effect.gen(function* () {
			const [firstExtraEntityId, ...remainingExtraEntityIds] = extraEntityIds;
			if (firstExtraEntityId) {
				yield* getBackendClient().call(
					(c) =>
						c.testSupport.deleteGlobalEntities({
							payload: {
								ids: [
									EntityId.make(firstExtraEntityId),
									...remainingExtraEntityIds.map((id) => EntityId.make(id)),
								],
							},
						}),
					adminHeaders,
				);
			}
			yield* cleanupBuiltinProviderScript(discoveryProvider);
			yield* cleanupBuiltinProviderScript(provider);
		}),
	);
});

describe("media monitoring endpoints", () => {
	it.live("requires authentication", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				getBackendClient().call((contract) =>
					contract.mediaMonitoring.status({ path: { entityId: EntityId.make(apiEntityId) } }),
				),
			);
			assertTaggedError(error, "Unauthorized");
		}),
	);

	it.live("keeps media monitoring status and relationships scoped to each user", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const other = yield* createAuthenticatedClient();

			expect(yield* getMediaMonitoringStatus(owner.client, apiEntityId)).toEqual({
				isMediaMonitored: false,
				entityId: EntityId.make(apiEntityId),
			});
			yield* enableMediaMonitoring(owner.client, apiEntityId);
			yield* enableMediaMonitoring(owner.client, apiEntityId);
			expect(
				yield* countMediaMonitoringRelationships({
					client: owner.client,
					entityId: apiEntityId,
					entitySchemaSlug: "movie",
				}),
			).toBe(1);
			expect(yield* getMediaMonitoringStatus(owner.client, apiEntityId)).toEqual({
				isMediaMonitored: true,
				entityId: EntityId.make(apiEntityId),
			});
			expect(yield* getMediaMonitoringStatus(other.client, apiEntityId)).toEqual({
				isMediaMonitored: false,
				entityId: EntityId.make(apiEntityId),
			});

			yield* disableMediaMonitoring(owner.client, apiEntityId);
			yield* disableMediaMonitoring(owner.client, apiEntityId);
			expect(
				yield* countMediaMonitoringRelationships({
					client: owner.client,
					entityId: apiEntityId,
					entitySchemaSlug: "movie",
				}),
			).toBe(0);
			const inLibraryRelationship = yield* queryInLibraryRelationship(
				owner.client,
				apiEntityId,
				"movie",
			);
			expect(inLibraryRelationship.data.items).toHaveLength(1);
		}),
	);

	it.live("rejects invisible and unsupported media monitoring targets", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const other = yield* createAuthenticatedClient();
			const [seasonSchemaId, episodeSchemaId, groupSchemaId] = yield* Effect.all([
				getBuiltinEntitySchemaId("show-season"),
				getBuiltinEntitySchemaId("show-episode"),
				getBuiltinEntitySchemaId("movie-group"),
			]);
			const unsupported = yield* Effect.all([
				seedMediaEntity({
					name: "Season",
					entitySchemaId: seasonSchemaId,
					properties: { seasonNumber: 1 },
					sandboxScriptId: provider.scriptId,
					externalId: `media-monitoring-season-${crypto.randomUUID()}`,
				}),
				seedMediaEntity({
					name: "Episode",
					entitySchemaId: episodeSchemaId,
					sandboxScriptId: provider.scriptId,
					properties: { seasonNumber: 1, episodeNumber: 1 },
					externalId: `media-monitoring-episode-${crypto.randomUUID()}`,
				}),
				seedMediaEntity({
					name: "Group",
					properties: {},
					entitySchemaId: groupSchemaId,
					sandboxScriptId: provider.scriptId,
					externalId: `media-monitoring-group-${crypto.randomUUID()}`,
				}),
				seedMediaEntity({
					properties: {},
					name: "Custom Movie",
					userId: owner.userId,
					client: owner.client,
					entitySchemaId: movieSchemaId,
					sandboxScriptId: provider.scriptId,
					externalId: `media-monitoring-custom-${crypto.randomUUID()}`,
				}),
				seedMediaEntity({
					properties: {},
					userId: other.userId,
					client: other.client,
					name: "Other User Movie",
					entitySchemaId: movieSchemaId,
					sandboxScriptId: provider.scriptId,
					externalId: `media-monitoring-invisible-${crypto.randomUUID()}`,
				}),
				seedMediaEntity({
					properties: {},
					sandboxScriptId: null,
					name: "Incomplete Movie",
					entitySchemaId: movieSchemaId,
					externalId: `media-monitoring-incomplete-${crypto.randomUUID()}`,
				}),
			]);
			extraEntityIds.push(...unsupported.map((entity) => entity.id));

			const errors = yield* Effect.all(
				unsupported.map((entity) =>
					Effect.flip(
						owner.client.call((contract) =>
							contract.mediaMonitoring.enable({ path: { entityId: entity.id } }),
						),
					),
				),
			);
			for (const error of errors) {
				assertTaggedError(error, "NotFound");
			}
			const invisible = yield* Effect.flip(
				owner.client.call((contract) =>
					contract.mediaMonitoring.status({ path: { entityId: unsupported[4].id } }),
				),
			);
			assertTaggedError(invisible, "NotFound");
		}),
	);
});

describe("media monitoring infrequent refresh", () => {
	it.live(
		"refreshes each target once and delivers changed metadata through signal subscriptions",
		() =>
			Effect.gen(function* () {
				fakeApprise.requests.length = 0;
				const first = yield* createAuthenticatedClient();
				const second = yield* createAuthenticatedClient();
				yield* Effect.all([
					createNotificationChannel(first.client, {
						channel: "apprise",
						channelSpecifics: { baseUrl: fakeApprise.url, key: "first", kind: "apprise" },
					}),
					createNotificationChannel(second.client, {
						channel: "apprise",
						channelSpecifics: { baseUrl: fakeApprise.url, key: "second", kind: "apprise" },
					}),
				]);
				yield* Effect.all([
					enableMediaMonitoring(first.client, cronEntityId),
					enableMediaMonitoring(second.client, cronEntityId),
				]);

				yield* triggerCronAndWaitForEntity(first, cronEntityId);
				yield* pollUntil(
					"media monitoring baseline population",
					Effect.gen(function* () {
						const entity = yield* first.client.call((contract) =>
							contract.entities.get({ path: { entityId: EntityId.make(cronEntityId) } }),
						);
						const properties = requireObjectRecord(entity.properties, "Missing entity properties");
						return entity.populatedAt && properties.productionStatus === "Continuing"
							? entity
							: null;
					}),
				);
				expect(fakeApprise.requests).toEqual([]);

				yield* replaceSandboxScriptCompiledRepresentation(
					providerCompilerClient,
					provider.scriptId,
					providerSandboxSource({
						name: providerName,
						slug: provider.slug,
						providerInformation: { source: "e2e" },
						drivers: { details: providerDetails("Ended") },
					}),
				);
				yield* triggerCronAndWaitForEntity(first, cronEntityId);
				yield* pollUntil(
					"media monitoring changed provider refresh",
					Effect.gen(function* () {
						const entity = yield* first.client.call((contract) =>
							contract.entities.get({ path: { entityId: EntityId.make(cronEntityId) } }),
						);
						const properties = requireObjectRecord(entity.properties, "Missing entity properties");
						return properties.productionStatus === "Ended" ? true : null;
					}),
				);
				const delivered = yield* pollUntil(
					"media monitoring status notification delivery",
					Effect.sync(() => {
						const paths = new Set(fakeApprise.requests.map((request) => request.path));
						return paths.has("/notify/first") && paths.has("/notify/second")
							? fakeApprise.requests
							: null;
					}),
				);
				expect(delivered).toHaveLength(2);
				for (const request of delivered) {
					const body = requireObjectRecord(request.body, "Missing notification body");
					expect(body.body).toBe(
						"Status of Media Monitoring Cron Target changed from Continuing to Ended",
					);
				}
			}),
	);

	it.live(
		"keeps the baseline silent and independently notifies for a new season and its episode",
		() =>
			Effect.gen(function* () {
				fakeApprise.requests.length = 0;
				const owner = yield* createAuthenticatedClient();
				yield* createNotificationChannel(owner.client, {
					channel: "apprise",
					channelSpecifics: { baseUrl: fakeApprise.url, key: "discovery", kind: "apprise" },
				});
				yield* enableMediaMonitoring(owner.client, discoveryEntityId);

				yield* triggerCronAndWaitForEntity(owner, discoveryEntityId);
				expect(fakeApprise.requests.filter(({ path }) => path === "/notify/discovery")).toEqual([]);

				yield* replaceSandboxScriptCompiledRepresentation(
					providerCompilerClient,
					discoveryProvider.scriptId,
					providerSandboxSource({
						slug: discoveryProvider.slug,
						name: `${providerName} Discovery`,
						providerInformation: { source: "e2e" },
						drivers: { details: discoveryProviderDetails(1) },
					}),
				);
				yield* triggerCronAndWaitForEntity(owner, discoveryEntityId);
				const expectedEpisodeBody =
					"1 new episode discovered in season 1 for Media Monitoring Discovery Target";
				const expectedSeasonBody =
					"Number of seasons changed from 0 to 1 for Media Monitoring Discovery Target";
				yield* pollUntil(
					"season and episode notification delivery",
					Effect.sync(() => {
						const requests = fakeApprise.requests.filter(
							({ path }) => path === "/notify/discovery",
						);
						const bodies = requests.map(({ body }) =>
							requireObjectRecord(body, "Missing notification body"),
						);
						return bodies.some(({ body }) => body === expectedEpisodeBody) &&
							bodies.some(({ body }) => body === expectedSeasonBody)
							? bodies
							: null;
					}),
				);
			}),
	);
});
