import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { EntityId } from "@ryot/contract/schema/brands";

import {
	cleanupBuiltinProviderScript,
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

const ADMIN_TOKEN = "test-admin-token";
const providerName = "Media Monitoring E2E Provider";
const adminHeaders = { "Admin-Access-Token": ADMIN_TOKEN };
const apiExternalId = `media-monitoring-api-${crypto.randomUUID()}`;
const cronExternalId = `media-monitoring-cron-${crypto.randomUUID()}`;

const providerDetails = (productionStatus: string) =>
	fakeProviderDetailsResult({
		name: "Media Monitoring Cron Target",
		properties: { productionStatus, publishYear: 2026 },
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
let fakeApprise: FakeHttpServer;
let providerCompilerClient: Client;
const extraEntityIds: string[] = [];
let provider: Awaited<ReturnType<typeof seedBuiltinProviderScript>>;

beforeAll(async () => {
	const { client } = await createAuthenticatedClient();
	providerCompilerClient = client;
	movieSchemaId = await getBuiltinEntitySchemaId("movie");
	provider = await seedBuiltinProviderScript({
		client,
		name: providerName,
		drivers: { details: providerDetails("Continuing") },
		slug: `movie.media-monitoring-e2e-${crypto.randomUUID()}`,
	});
	const apiEntity = await seedMediaEntity({
		properties: {},
		externalId: apiExternalId,
		name: "Media Monitoring API Target",
		entitySchemaId: movieSchemaId,
		sandboxScriptId: provider.scriptId,
	});
	const cronEntity = await seedMediaEntity({
		properties: {},
		externalId: cronExternalId,
		entitySchemaId: movieSchemaId,
		name: "Media Monitoring Cron Target",
		sandboxScriptId: provider.scriptId,
	});
	apiEntityId = apiEntity.id;
	cronEntityId = cronEntity.id;
	await getPgClient().query(`update entity set populated_at = now() where id = $1`, [apiEntityId]);

	fakeApprise = await startFakeAppriseServer();
});

afterAll(async () => {
	fakeApprise.stop();
	const pg = getPgClient();
	await pg.query(`delete from entity where id = any($1::text[])`, [extraEntityIds]);
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
			entityId: EntityId.make(apiEntityId),
			isMediaMonitored: false,
		});
		await enableMediaMonitoring(owner.client, apiEntityId);
		await enableMediaMonitoring(owner.client, apiEntityId);
		expect(
			await countMediaMonitoringRelationships({ entityId: apiEntityId, userId: owner.userId }),
		).toBe(1);
		expect(await getMediaMonitoringStatus(owner.client, apiEntityId)).toEqual({
			entityId: EntityId.make(apiEntityId),
			isMediaMonitored: true,
		});
		expect(await getMediaMonitoringStatus(other.client, apiEntityId)).toEqual({
			entityId: EntityId.make(apiEntityId),
			isMediaMonitored: false,
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
				properties: {},
				entitySchemaId: seasonSchemaId,
				sandboxScriptId: provider.scriptId,
				externalId: `media-monitoring-season-${crypto.randomUUID()}`,
			}),
			seedMediaEntity({
				properties: {},
				name: "Episode",
				entitySchemaId: episodeSchemaId,
				sandboxScriptId: provider.scriptId,
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
				entitySchemaId: movieSchemaId,
				sandboxScriptId: provider.scriptId,
				externalId: `media-monitoring-custom-${crypto.randomUUID()}`,
			}),
			seedMediaEntity({
				properties: {},
				userId: other.userId,
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
	it("refreshes each target once, establishes a silent baseline, and delivers changed metadata", async () => {
		fakeApprise.requests.length = 0;
		const first = await createAuthenticatedClient();
		const second = await createAuthenticatedClient();
		await Promise.all([
			createNotificationChannel(first.client, {
				channel: "apprise",
				configuredEvents: ["metadata_status_changed"],
				channelSpecifics: { baseUrl: fakeApprise.url, key: "first", kind: "apprise" },
			}),
			createNotificationChannel(second.client, {
				channel: "apprise",
				configuredEvents: ["metadata_status_changed"],
				channelSpecifics: { baseUrl: fakeApprise.url, key: "second", kind: "apprise" },
			}),
		]);
		await Promise.all([
			enableMediaMonitoring(first.client, cronEntityId),
			enableMediaMonitoring(second.client, cronEntityId),
		]);

		const baseline = await getBackendClient().run(
			(contract) => contract.godMode.triggerInfrequentCron(),
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
			(contract) => contract.godMode.triggerInfrequentCron(),
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
		const queuedDeliveries = await getPgClient().query<{ payload: string }>(
			`select payload from cluster_messages
			 where entity_type = 'Workflow/NotificationDeliveryWorkflow'
			   and tag = 'run'
			   and payload like ('%' || $1 || '%')`,
			[changed.executionId],
		);
		if (queuedDeliveries.rows.length !== 2) {
			const mediaMonitoringReplies = await getPgClient().query<{ payload: string }>(
				`select r.payload
				 from cluster_messages m
				 inner join cluster_replies r on r.request_id = m.id
				 where m.entity_type = 'Workflow/MediaMonitoringRefreshWorkflow'
				   and m.tag = 'run'
				   and m.payload like ('%' || $1 || '%')`,
				[`${changed.executionId}-${cronEntityId}`],
			);
			throw new Error(
				`Expected two notification workflows, got ${queuedDeliveries.rows.length}: ${JSON.stringify(mediaMonitoringReplies.rows)}`,
			);
		}
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
});
