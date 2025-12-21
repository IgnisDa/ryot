import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { EntityId } from "@ryot/contract/schema/brands";

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
	type Client,
} from "~/fixtures";
import { pollUntil } from "~/fixtures/polling";
import { getPgClient } from "~/setup";
import { assertTaggedError, requireObjectRecord } from "~/support/assertions";
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

const waitForMediaMonitoringRefresh = (executionId: string) =>
	pollUntil("media monitoring refresh workflow completion", async () => {
		const result = await getPgClient().query<{ complete: boolean }>(
			`select exists (
				select 1
				from cluster_messages m
				inner join cluster_replies r on r.request_id = m.id
				where m.entity_type = 'Workflow/MediaMonitoringRefreshWorkflow'
				  and m.tag = 'run'
				  and m.payload like ('%' || $1 || '%')
				  and r.payload not like '%Suspended%'
			) as complete`,
			[executionId],
		);
		return result.rows[0]?.complete ? true : null;
	});

let apiEntityId: string;
let cronEntityId: string;
let movieSchemaId: string;
let discoveryEntityId: string;
let fakeApprise: FakeHttpServer;
let providerCompilerClient: Client;
const extraEntityIds: string[] = [];
let provider: Awaited<ReturnType<typeof seedBuiltinProviderScript>>;
let discoveryProvider: Awaited<ReturnType<typeof seedBuiltinProviderScript>>;

beforeAll(async () => {
	const { client } = await createAuthenticatedClient();
	providerCompilerClient = client;
	movieSchemaId = await getBuiltinEntitySchemaId("movie");
	provider = await seedBuiltinProviderScript({
		client,
		name: providerName,
		slug: `movie.media-monitoring-e2e-${crypto.randomUUID()}`,
		drivers: { details: providerDetails("Continuing") },
	});
	discoveryProvider = await seedBuiltinProviderScript({
		client,
		name: `${providerName} Discovery`,
		drivers: { details: discoveryProviderDetails(0) },
		slug: `show.media-monitoring-discovery-e2e-${crypto.randomUUID()}`,
	});
	const apiEntity = await seedMediaEntity({
		properties: {},
		externalId: apiExternalId,
		entitySchemaId: movieSchemaId,
		sandboxScriptId: provider.scriptId,
		name: "Media Monitoring API Target",
	});
	const cronEntity = await seedMediaEntity({
		properties: {},
		externalId: cronExternalId,
		entitySchemaId: movieSchemaId,
		sandboxScriptId: provider.scriptId,
		name: "Media Monitoring Cron Target",
	});
	const showSchemaId = await getBuiltinEntitySchemaId("show");
	const discoveryEntity = await seedMediaEntity({
		properties: {},
		entitySchemaId: showSchemaId,
		externalId: discoveryExternalId,
		name: "Media Monitoring Discovery Target",
		sandboxScriptId: discoveryProvider.scriptId,
	});
	apiEntityId = apiEntity.id;
	cronEntityId = cronEntity.id;
	discoveryEntityId = discoveryEntity.id;
	await getBackendClient().run(
		(c) =>
			c.testSupport.setEntityPopulatedAt({
				path: { entityId: EntityId.make(apiEntityId) },
				payload: { populatedAt: new Date().toISOString() },
			}),
		adminHeaders,
	);

	fakeApprise = await startFakeAppriseServer();
});

afterAll(async () => {
	fakeApprise.stop();
	const [firstExtraEntityId, ...remainingExtraEntityIds] = extraEntityIds;
	if (firstExtraEntityId) {
		await getBackendClient().run(
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
	await cleanupBuiltinProviderScript(discoveryProvider);
	await cleanupBuiltinProviderScript(provider);
});

describe("media monitoring endpoints", () => {
	it("requires authentication", async () => {
		const error = await getBackendClient().runError((contract) =>
			contract.mediaMonitoring.status({ path: { entityId: EntityId.make(apiEntityId) } }),
		);
		assertTaggedError(error, "Unauthorized");
	});

	it("keeps media monitoring status and relationships scoped to each user", async () => {
		const owner = await createAuthenticatedClient();
		const other = await createAuthenticatedClient();

		expect(await getMediaMonitoringStatus(owner.client, apiEntityId)).toEqual({
			isMediaMonitored: false,
			entityId: EntityId.make(apiEntityId),
		});
		await enableMediaMonitoring(owner.client, apiEntityId);
		await enableMediaMonitoring(owner.client, apiEntityId);
		expect(
			await countMediaMonitoringRelationships({ entityId: apiEntityId, userId: owner.userId }),
		).toBe(1);
		expect(await getMediaMonitoringStatus(owner.client, apiEntityId)).toEqual({
			isMediaMonitored: true,
			entityId: EntityId.make(apiEntityId),
		});
		expect(await getMediaMonitoringStatus(other.client, apiEntityId)).toEqual({
			isMediaMonitored: false,
			entityId: EntityId.make(apiEntityId),
		});

		await disableMediaMonitoring(owner.client, apiEntityId);
		await disableMediaMonitoring(owner.client, apiEntityId);
		expect(
			await countMediaMonitoringRelationships({ entityId: apiEntityId, userId: owner.userId }),
		).toBe(0);
		const inLibraryRelationship = await queryInLibraryRelationship(
			owner.client,
			apiEntityId,
			"movie",
		);
		expect(inLibraryRelationship.data.items).toHaveLength(1);
	});

	it("rejects invisible and unsupported media monitoring targets", async () => {
		const owner = await createAuthenticatedClient();
		const other = await createAuthenticatedClient();
		const [seasonSchemaId, episodeSchemaId, groupSchemaId] = await Promise.all([
			getBuiltinEntitySchemaId("show-season"),
			getBuiltinEntitySchemaId("show-episode"),
			getBuiltinEntitySchemaId("movie-group"),
		]);
		const unsupported = await Promise.all([
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

		const errors = await Promise.all(
			unsupported.map((entity) =>
				owner.client.runError((contract) =>
					contract.mediaMonitoring.enable({ path: { entityId: entity.id } }),
				),
			),
		);
		for (const error of errors) {
			assertTaggedError(error, "NotFound");
		}
		const invisible = await owner.client.runError((contract) =>
			contract.mediaMonitoring.status({ path: { entityId: unsupported[4].id } }),
		);
		assertTaggedError(invisible, "NotFound");
	});
});

describe("media monitoring infrequent refresh", () => {
	it("refreshes each target once and delivers changed metadata through signal subscriptions", async () => {
		fakeApprise.requests.length = 0;
		const first = await createAuthenticatedClient();
		const second = await createAuthenticatedClient();
		await Promise.all([
			createNotificationChannel(first.client, {
				channel: "apprise",
				channelSpecifics: { baseUrl: fakeApprise.url, key: "first", kind: "apprise" },
			}),
			createNotificationChannel(second.client, {
				channel: "apprise",
				channelSpecifics: { baseUrl: fakeApprise.url, key: "second", kind: "apprise" },
			}),
		]);
		await Promise.all([
			enableMediaMonitoring(first.client, cronEntityId),
			enableMediaMonitoring(second.client, cronEntityId),
		]);

		const baseline = await getBackendClient().run(
			(contract) => contract.testSupport.triggerInfrequentCron(),
			adminHeaders,
		);
		await pollUntil("media monitoring baseline population", async () => {
			const entity = await first.client.run((contract) =>
				contract.entities.get({ path: { entityId: EntityId.make(cronEntityId) } }),
			);
			const properties = requireObjectRecord(entity.properties, "Missing entity properties");
			return entity.populatedAt && properties.productionStatus === "Continuing" ? entity : null;
		});
		await waitForMediaMonitoringRefresh(`${baseline.executionId}-${cronEntityId}`);
		expect(fakeApprise.requests).toEqual([]);

		await replaceSandboxScriptCompiledRepresentation(
			providerCompilerClient,
			provider.scriptId,
			providerSandboxSource({
				name: providerName,
				slug: provider.slug,
				providerInformation: { source: "e2e" },
				drivers: { details: providerDetails("Ended") },
			}),
		);
		const changed = await getBackendClient().run(
			(contract) => contract.testSupport.triggerInfrequentCron(),
			adminHeaders,
		);
		await pollUntil("media monitoring changed provider refresh", async () => {
			const entity = await first.client.run((contract) =>
				contract.entities.get({ path: { entityId: EntityId.make(cronEntityId) } }),
			);
			const properties = requireObjectRecord(entity.properties, "Missing entity properties");
			return properties.productionStatus === "Ended" ? true : null;
		});
		await waitForMediaMonitoringRefresh(`${changed.executionId}-${cronEntityId}`);
		const delivered = await pollUntil("media monitoring status notification delivery", () => {
			const paths = new Set(fakeApprise.requests.map((request) => request.path));
			return Promise.resolve(
				paths.has("/notify/first") && paths.has("/notify/second") ? fakeApprise.requests : null,
			);
		});
		expect(delivered).toHaveLength(2);
		for (const request of delivered) {
			const body = requireObjectRecord(request.body, "Missing notification body");
			expect(body.body).toBe(
				"Status of Media Monitoring Cron Target changed from Continuing to Ended",
			);
		}
	});

	it("keeps the baseline silent and independently notifies for a new season and its episode", async () => {
		fakeApprise.requests.length = 0;
		const owner = await createAuthenticatedClient();
		await createNotificationChannel(owner.client, {
			channel: "apprise",
			channelSpecifics: { baseUrl: fakeApprise.url, key: "discovery", kind: "apprise" },
		});
		await enableMediaMonitoring(owner.client, discoveryEntityId);

		const baseline = await getBackendClient().run(
			(contract) => contract.testSupport.triggerInfrequentCron(),
			adminHeaders,
		);
		await waitForMediaMonitoringRefresh(`${baseline.executionId}-${discoveryEntityId}`);
		expect(fakeApprise.requests.filter(({ path }) => path === "/notify/discovery")).toEqual([]);

		await replaceSandboxScriptCompiledRepresentation(
			providerCompilerClient,
			discoveryProvider.scriptId,
			providerSandboxSource({
				slug: discoveryProvider.slug,
				name: `${providerName} Discovery`,
				providerInformation: { source: "e2e" },
				drivers: { details: discoveryProviderDetails(1) },
			}),
		);
		const changed = await getBackendClient().run(
			(contract) => contract.testSupport.triggerInfrequentCron(),
			adminHeaders,
		);
		await waitForMediaMonitoringRefresh(`${changed.executionId}-${discoveryEntityId}`);
		const expectedEpisodeBody =
			"1 new episode discovered in season 1 for Media Monitoring Discovery Target";
		const expectedSeasonBody =
			"Number of seasons changed from 0 to 1 for Media Monitoring Discovery Target";
		const delivered = await pollUntil("season and episode notification delivery", () => {
			const requests = fakeApprise.requests.filter(({ path }) => path === "/notify/discovery");
			const bodies = requests.map(({ body }) =>
				requireObjectRecord(body, "Missing notification body"),
			);
			return Promise.resolve(
				bodies.some(({ body }) => body === expectedEpisodeBody) &&
					bodies.some(({ body }) => body === expectedSeasonBody)
					? bodies
					: null,
			);
		});
		expect(delivered.some(({ body }) => body === expectedEpisodeBody)).toBe(true);
		expect(delivered.some(({ body }) => body === expectedSeasonBody)).toBe(true);
	});
});
