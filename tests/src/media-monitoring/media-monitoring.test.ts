import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { EntityId } from "@ryot/contract/schema/brands";

import {
	cleanupBuiltinProviderScript,
	countMediaMonitoringRelationships,
	createAuthenticatedClient,
	createNotificationChannel,
	createRule,
	createSandboxScript,
	detailsDriverCode,
	disableMediaMonitoring,
	enableMediaMonitoring,
	findBuiltinRelationshipSchemaId,
	getBackendClient,
	getMediaMonitoringStatus,
	getBuiltinEntitySchemaId,
	listSubscriptionRuns,
	queryInLibraryRelationship,
	ruleTarget,
	seedBuiltinProviderScript,
	seedMediaEntity,
	startFakeAppriseServer,
	waitForProviderRefresh,
} from "../fixtures";
import { pollUntil } from "../fixtures/polling";
import { getPgClient } from "../setup";
import { assertTaggedError, requireObjectRecord } from "../test-support/assertions";
import type { FakeHttpServer } from "../test-support/fake-http-server";

const ADMIN_TOKEN = "test-admin-token";
const adminHeaders = { "Admin-Access-Token": ADMIN_TOKEN };
const apiExternalId = `media-monitoring-api-${crypto.randomUUID()}`;
const cronExternalId = `media-monitoring-cron-${crypto.randomUUID()}`;

const SETTLE_WINDOW_MS = 2500;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const benignSubscriptionScript = `driver("subscription", async function () {\n\treturn { ran: true };\n});`;

const makeUserScript = (client: Parameters<typeof createSandboxScript>[0]) =>
	createSandboxScript(client, {
		metadata: {},
		code: benignSubscriptionScript,
		name: `mm-user-script-${crypto.randomUUID()}`,
		slug: `mm-user-script-${crypto.randomUUID()}`,
	});

const listSucceededRuns = (client: Parameters<typeof listSubscriptionRuns>[0], ruleId: string) =>
	listSubscriptionRuns(client, { ruleId, status: "succeeded" });

const detailsCode = (productionStatus: string) =>
	detailsDriverCode({
		name: "Media Monitoring Cron Target",
		properties: { productionStatus, publishYear: 2026 },
	});

let apiEntityId: string;
let cronEntityId: string;
let movieSchemaId: string;
let fakeApprise: FakeHttpServer;
const extraEntityIds: string[] = [];
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
			owner.email,
		);
		expect(inLibraryRelationship.rowCount).toBe(1);
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
				kind: "apprise",
				specifics: { baseUrl: fakeApprise.url, key: "first", kind: "apprise" },
			}),
			createNotificationChannel(second.client, {
				kind: "apprise",
				specifics: { baseUrl: fakeApprise.url, key: "second", kind: "apprise" },
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
		await waitForProviderRefresh(`${baseline.executionId}-${cronEntityId}-provider-refresh`);
		expect(fakeApprise.requests).toEqual([]);

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
		await waitForProviderRefresh(`${changed.executionId}-${cronEntityId}-provider-refresh`);
		const automationDelivery = await pollUntil(
			"media monitoring signal subscriptions",
			async () => {
				const result = await getPgClient().query<{
					properties: unknown;
					recipientIds: string[];
					succeededUserIds: string[];
				}>(
					`select s.properties,
				        array(
				          select sr.user_id
				          from signal_recipient sr
				          where sr.signal_id = s.id
				          order by sr.user_id
				        ) as "recipientIds",
				        array(
				          select run.execution_user_id
				          from subscription_run run
				          where run.signal_id = s.id
				            and run.operation = 'signal'
				            and run.status = 'succeeded'
				          order by run.execution_user_id
				        ) as "succeededUserIds"
				 from signal s
				 inner join signal_schema ss on ss.id = s.signal_schema_id
				 where ss.slug = 'media.status.changed'
				   and s.subject_entity_id = $1
				   and s.correlation_id like ('%' || $2 || '%')
				 order by s.created_at desc
				 limit 1`,
					[cronEntityId, changed.executionId],
				);
				const row = result.rows[0];
				const expectedUserIds = [first.userId, second.userId].sort();
				return row?.recipientIds.length === 2 &&
					row.succeededUserIds.length === 2 &&
					row.recipientIds.every((userId, index) => userId === expectedUserIds[index]) &&
					row.succeededUserIds.every((userId, index) => userId === expectedUserIds[index])
					? row
					: null;
			},
		);
		const signalProperties = requireObjectRecord(
			automationDelivery.properties,
			"Missing media status signal properties",
		);
		expect(signalProperties).toEqual({
			newStatus: "Ended",
			oldStatus: "Continuing",
			entityName: "Media Monitoring Cron Target",
		});
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

describe("media monitoring enable/disable automation ownership", () => {
	it("fires a media-monitoring relationship create subscription only on a genuine enable", async () => {
		const user = await createAuthenticatedClient();
		const relationshipSchemaId = await findBuiltinRelationshipSchemaId(
			user.client,
			"media-monitoring",
		);
		const script = await makeUserScript(user.client);
		const rule = await createRule(user.client, {
			sandboxScriptId: script.id,
			name: "On media monitoring enable",
			target: ruleTarget("relationship", relationshipSchemaId),
		});
		expect(rule.operation).toBe("create");
		expect(rule.target).toEqual({ kind: "relationship", id: relationshipSchemaId });

		const entity = await seedMediaEntity({
			properties: {},
			entitySchemaId: movieSchemaId,
			sandboxScriptId: provider.scriptId,
			name: "Media Monitoring Automation Target",
			externalId: `media-monitoring-automation-${crypto.randomUUID()}`,
		});
		await getPgClient().query(`update entity set populated_at = now() where id = $1`, [entity.id]);

		// Enabling creates the monitoring relationship: one api-origin create occurrence, one run.
		await enableMediaMonitoring(user.client, entity.id);
		const enabled = await pollUntil("media monitoring enable subscription run", async () => {
			const page = await listSucceededRuns(user.client, rule.id);
			return page.items.length > 0 ? page.items : null;
		});
		expect(enabled.length).toBe(1);
		expect(enabled[0]?.operation).toBe("create");
		expect(enabled[0]?.originalRuleId).toBe(rule.id);
		await delay(SETTLE_WINDOW_MS);
		const page1 = await listSucceededRuns(user.client, rule.id);
		expect(page1.items.length).toBe(1);

		// Re-enabling preserves the existing relationship (noop): no occurrence, no new run.
		await enableMediaMonitoring(user.client, entity.id);
		await delay(SETTLE_WINDOW_MS);
		const page2 = await listSucceededRuns(user.client, rule.id);
		expect(page2.items.length).toBe(1);

		// Disabling deletes the relationship and is deliberately occurrence-free.
		await disableMediaMonitoring(user.client, entity.id);
		expect(await getMediaMonitoringStatus(user.client, entity.id)).toEqual({
			entityId: EntityId.make(entity.id),
			isMediaMonitored: false,
		});
		await delay(SETTLE_WINDOW_MS);
		const pageAfterDisable = await listSucceededRuns(user.client, rule.id);
		expect(pageAfterDisable.items.length).toBe(1);

		// Re-enabling after a disable inserts a brand-new relationship row: a genuine create.
		await enableMediaMonitoring(user.client, entity.id);
		const reenabled = await pollUntil("media monitoring re-enable subscription run", async () => {
			const page = await listSucceededRuns(user.client, rule.id);
			return page.items.length >= 2 ? page.items : null;
		});
		expect(reenabled.length).toBe(2);
		await delay(SETTLE_WINDOW_MS);

		const page3 = await listSucceededRuns(user.client, rule.id);
		expect(page3.items.length).toBe(2);
	});
});
