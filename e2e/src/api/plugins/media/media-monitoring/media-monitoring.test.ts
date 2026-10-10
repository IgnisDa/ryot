import { EntityId } from "@ryot-app/contract/schema/brands";
import { mediaPlugin } from "@ryot-app/media-plugin";
import { Effect } from "effect";

import {
	adminHeaders,
	createAuthenticatedClient,
	createNotificationChannel,
	fakeProviderDetailsResult,
	getApiClient,
	getEntity,
	shippedPluginTestProviders,
	startFakeAppriseServer,
	pollUntil,
} from "~/fixtures/kernel";
import type { AttachedTestProvider } from "~/fixtures/kernel/sandbox-provider";
import {
	countMediaMonitoringRelationships,
	disableMediaMonitoring,
	enableMediaMonitoring,
	findMediaEntitySchema,
	getMediaMonitoringStatus,
	queryInMediaLibraryRelationship,
	seedMediaEntity,
	triggerCronAndWaitForEntity,
} from "~/fixtures/plugins/media";
import { assertTaggedError, requireObjectRecord } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";
import type { FakeHttpServer } from "~/support/fake-http-server";
import { startIsolatedHarness } from "~/support/isolated-harness";

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
		properties: { publishYear: 2026, productionStatus: "Continuing" },
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
const extraGlobalEntityIds: string[] = [];
let harness: Effect.Success<ReturnType<typeof startIsolatedHarness>> | undefined;
let media: Effect.Success<ReturnType<typeof shippedPluginTestProviders>>;
let provider: AttachedTestProvider;
let discoveryProvider: AttachedTestProvider;

beforeAll(
	() =>
		runPromise(
			Effect.gen(function* () {
				fakeApprise = yield* startFakeAppriseServer;
				harness = yield* startIsolatedHarness("Media Monitoring");
				media = yield* shippedPluginTestProviders(mediaPlugin.metadata.packageId);
				({ movie: provider, show: discoveryProvider } = yield* media.attach({
					movie: {
						name: providerName,
						rootEntitySchemaSlug: "movie",
						details: providerDetails("Continuing"),
					},
					show: {
						rootEntitySchemaSlug: "show",
						name: `${providerName} Discovery`,
						details: discoveryProviderDetails(0),
					},
				}));
				const { client } = yield* createAuthenticatedClient();
				const { schema: movieSchema } = yield* findMediaEntitySchema(client, "movie");
				movieSchemaId = movieSchema.id;
				const { schema: showSchema } = yield* findMediaEntitySchema(client, "show");
				const showSchemaId = showSchema.id;
				const apiEntity = yield* seedMediaEntity({
					properties: {},
					externalId: apiExternalId,
					entitySchemaSlug: movieSchemaId,
					providerId: provider.providerId,
					name: "Media Monitoring API Target",
				});
				const cronEntity = yield* seedMediaEntity({
					properties: {},
					externalId: cronExternalId,
					entitySchemaSlug: movieSchemaId,
					providerId: provider.providerId,
					name: "Media Monitoring Cron Target",
				});
				const discoveryEntity = yield* seedMediaEntity({
					properties: {},
					entitySchemaSlug: showSchemaId,
					externalId: discoveryExternalId,
					providerId: discoveryProvider.providerId,
					name: "Media Monitoring Discovery Target",
				});
				apiEntityId = apiEntity.id;
				cronEntityId = cronEntity.id;
				discoveryEntityId = discoveryEntity.id;
				yield* getApiClient().call(
					(c) =>
						c.testSupport.setEntityPopulatedAt({
							params: { entityId: EntityId.make(apiEntityId) },
							payload: { populatedAt: new Date().toISOString() },
						}),
					adminHeaders(),
				);
			}),
		),
);

afterAll(() =>
	runPromise(
		Effect.gen(function* () {
			yield* Effect.promise(() => fakeApprise.stop());
			const [firstExtraEntityId, ...remainingExtraEntityIds] = extraGlobalEntityIds;
			if (firstExtraEntityId) {
				yield* getApiClient().call(
					(c) =>
						c.testSupport.deleteGlobalEntities({
							payload: {
								ids: [
									EntityId.make(firstExtraEntityId),
									...remainingExtraEntityIds.map((id) => EntityId.make(id)),
								],
							},
						}),
					adminHeaders(),
				);
			}
			yield* harness?.stop ?? Effect.void;
		}),
	),
);

describe("media monitoring endpoints", () => {
	it.live("requires authentication", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(getMediaMonitoringStatus(getApiClient(), apiEntityId));
			assertTaggedError(error, "AuthUnauthorized");
		}),
	);

	it.live("keeps media monitoring status and relationships scoped to each user", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const other = yield* createAuthenticatedClient();

			expect(yield* getMediaMonitoringStatus(owner.client, apiEntityId)).toEqual({
				status: "found",
				entityId: apiEntityId,
				isMediaMonitored: false,
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
				status: "found",
				entityId: apiEntityId,
				isMediaMonitored: true,
			});
			expect(yield* getMediaMonitoringStatus(other.client, apiEntityId)).toEqual({
				status: "found",
				entityId: apiEntityId,
				isMediaMonitored: false,
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
			const inMediaLibraryRelationship = yield* queryInMediaLibraryRelationship(
				owner.client,
				apiEntityId,
				"movie",
			);
			expect(
				inMediaLibraryRelationship.data.entity?.type === "rows"
					? inMediaLibraryRelationship.data.entity.items
					: [],
			).toHaveLength(1);
		}),
	);

	it.live("rejects invisible and unsupported media monitoring targets", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const other = yield* createAuthenticatedClient();
			const [{ schema: seasonSchema }, { schema: episodeSchema }, { schema: groupSchema }] =
				yield* Effect.all([
					findMediaEntitySchema(owner.client, "show-season"),
					findMediaEntitySchema(owner.client, "show-episode"),
					findMediaEntitySchema(owner.client, "movie-group"),
				]);
			const seasonSchemaId = seasonSchema.id;
			const episodeSchemaId = episodeSchema.id;
			const groupSchemaId = groupSchema.id;
			const unsupported = yield* Effect.all([
				seedMediaEntity({
					name: "Season",
					properties: { seasonNumber: 1 },
					providerId: provider.providerId,
					entitySchemaSlug: seasonSchemaId,
					externalId: `media-monitoring-season-${crypto.randomUUID()}`,
				}),
				seedMediaEntity({
					name: "Episode",
					providerId: provider.providerId,
					entitySchemaSlug: episodeSchemaId,
					properties: { seasonNumber: 1, episodeNumber: 1 },
					externalId: `media-monitoring-episode-${crypto.randomUUID()}`,
				}),
				seedMediaEntity({
					name: "Group",
					properties: {},
					entitySchemaSlug: groupSchemaId,
					providerId: provider.providerId,
					externalId: `media-monitoring-group-${crypto.randomUUID()}`,
				}),
				seedMediaEntity({
					properties: {},
					name: "Custom Movie",
					userId: owner.userId,
					client: owner.client,
					entitySchemaSlug: movieSchemaId,
					providerId: provider.providerId,
					externalId: `media-monitoring-custom-${crypto.randomUUID()}`,
				}),
				seedMediaEntity({
					properties: {},
					userId: other.userId,
					client: other.client,
					name: "Other User Movie",
					entitySchemaSlug: movieSchemaId,
					providerId: provider.providerId,
					externalId: `media-monitoring-invisible-${crypto.randomUUID()}`,
				}),
				seedMediaEntity({
					properties: {},
					providerId: null,
					name: "Incomplete Movie",
					entitySchemaSlug: movieSchemaId,
					externalId: `media-monitoring-incomplete-${crypto.randomUUID()}`,
				}),
			]);
			extraGlobalEntityIds.push(
				...unsupported.filter((entity) => entity.userId === null).map((entity) => entity.id),
			);

			const unsupportedResults = yield* Effect.all(
				unsupported.map((entity) => enableMediaMonitoring(owner.client, entity.id)),
			);
			for (const [index, result] of unsupportedResults.entries()) {
				expect(result).toEqual({ status: "notFound", entityId: unsupported[index]?.id });
			}
			expect(yield* getMediaMonitoringStatus(owner.client, unsupported[4].id)).toEqual({
				status: "notFound",
				entityId: unsupported[4].id,
			});
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
						channelSpecifics: { key: "first", kind: "apprise", baseUrl: fakeApprise.url },
					}),
					createNotificationChannel(second.client, {
						channel: "apprise",
						channelSpecifics: { key: "second", kind: "apprise", baseUrl: fakeApprise.url },
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
						const entity = yield* getEntity(first.client, cronEntityId);
						const properties = requireObjectRecord(entity.properties, "Missing entity properties");
						return entity.populatedAt && properties.productionStatus === "Continuing"
							? entity
							: null;
					}),
				);
				expect(fakeApprise.requests).toEqual([]);

				yield* media.update(provider.providerSlug, { details: providerDetails("Ended") });
				yield* triggerCronAndWaitForEntity(first, cronEntityId);
				yield* pollUntil(
					"media monitoring changed provider refresh",
					Effect.gen(function* () {
						const entity = yield* getEntity(first.client, cronEntityId);
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
					channelSpecifics: { kind: "apprise", key: "discovery", baseUrl: fakeApprise.url },
				});
				yield* enableMediaMonitoring(owner.client, discoveryEntityId);

				yield* triggerCronAndWaitForEntity(owner, discoveryEntityId);
				expect(fakeApprise.requests.filter(({ path }) => path === "/notify/discovery")).toEqual([]);

				yield* media.update(discoveryProvider.providerSlug, {
					details: discoveryProviderDetails(1),
				});
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
