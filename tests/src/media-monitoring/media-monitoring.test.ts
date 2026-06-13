import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { EntityId } from "@ryot/contract/schema/brands";
import getPort from "get-port";

import {
	cleanupBuiltinProviderScript,
	countMediaMonitoringRelationships,
	createAuthenticatedClient,
	createNotificationPlatform,
	detailsDriverCode,
	disableMediaMonitoring,
	enableMediaMonitoring,
	getBackendClient,
	getMediaMonitoringStatus,
	getBuiltinEntitySchemaId,
	queryInLibraryRelationship,
	seedBuiltinProviderScript,
	seedMediaEntity,
} from "../fixtures";
import { pollUntil } from "../fixtures/polling";
import { getPgClient } from "../setup";
import { assertTaggedError, requirePresent } from "../test-support/assertions";

const ADMIN_TOKEN = "test-admin-token";
const adminHeaders = { "Admin-Access-Token": ADMIN_TOKEN };
const apiExternalId = `media-monitoring-api-${crypto.randomUUID()}`;
const cronExternalId = `media-monitoring-cron-${crypto.randomUUID()}`;

const detailsCode = (productionStatus: string) =>
	detailsDriverCode({
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
			) as complete`,
			[executionId],
		);
		return result.rows[0]?.complete ? true : null;
	});

let apiEntityId: string;
let cronEntityId: string;
let movieSchemaId: string;
let fakeAppriseUrl: string;
const extraEntityIds: string[] = [];
let fakeAppriseServer: ReturnType<typeof Bun.serve>;
const requests: Array<{ body: unknown; path: string }> = [];
let provider: Awaited<ReturnType<typeof seedBuiltinProviderScript>>;

beforeAll(async () => {
	movieSchemaId = await getBuiltinEntitySchemaId("movie");
	provider = await seedBuiltinProviderScript({
		name: "Media Monitoring E2E Provider",
		code: detailsCode("Continuing"),
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

	const port = await getPort();
	fakeAppriseServer = Bun.serve({
		port,
		hostname: "127.0.0.1",
		fetch: async (request) => {
			requests.push({ body: await request.json(), path: new URL(request.url).pathname });
			return Response.json({ ok: true });
		},
	});
	fakeAppriseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
	await fakeAppriseServer.stop(true);
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
		expect(
			(await queryInLibraryRelationship(owner.client, apiEntityId, owner.email)).rowCount,
		).toBe(1);
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

		for (const entity of unsupported) {
			const error = await owner.client.runError((contract) =>
				contract.mediaMonitoring.enable({ path: { entityId: entity.id } }),
			);
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
		requests.length = 0;
		const first = await createAuthenticatedClient();
		const second = await createAuthenticatedClient();
		await Promise.all([
			createNotificationPlatform(first.client, {
				platform: "apprise",
				configuredEvents: ["metadata_status_changed"],
				platformSpecifics: { baseUrl: fakeAppriseUrl, key: "first", kind: "apprise" },
			}),
			createNotificationPlatform(second.client, {
				platform: "apprise",
				configuredEvents: ["metadata_status_changed"],
				platformSpecifics: { baseUrl: fakeAppriseUrl, key: "second", kind: "apprise" },
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
			const result = await getPgClient().query<{
				populatedAt: string | null;
				productionStatus: string | null;
			}>(
				`select populated_at::text as "populatedAt",
				        properties->>'productionStatus' as "productionStatus"
				 from entity where id = $1`,
				[cronEntityId],
			);
			const row = result.rows[0];
			return row?.populatedAt && row.productionStatus === "Continuing" ? row : null;
		});
		await waitForMediaMonitoringRefresh(`${baseline.executionId}-${cronEntityId}`);
		expect(requests).toEqual([]);

		await getPgClient().query(`update sandbox_script set code = $1 where id = $2`, [
			detailsCode("Ended"),
			provider.scriptId,
		]);
		const changed = await getBackendClient().run(
			(contract) => contract.godMode.triggerInfrequentCron(),
			adminHeaders,
		);
		await pollUntil("media monitoring changed provider refresh", async () => {
			const result = await getPgClient().query<{ productionStatus: string | null }>(
				`select properties->>'productionStatus' as "productionStatus" from entity where id = $1`,
				[cronEntityId],
			);
			return result.rows[0]?.productionStatus === "Ended" ? true : null;
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
		const delivered = await pollUntil("media monitoring status notification delivery", async () => {
			const paths = new Set(requests.map((request) => request.path));
			return paths.has("/notify/first") && paths.has("/notify/second") ? requests : null;
		});
		expect(delivered).toHaveLength(2);
		for (const request of delivered) {
			const body = requirePresent(request.body as { body?: unknown }, "Missing notification body");
			expect(body.body).toBe(
				"Status of Media Monitoring Cron Target changed from Continuing to Ended",
			);
		}
	});
});
