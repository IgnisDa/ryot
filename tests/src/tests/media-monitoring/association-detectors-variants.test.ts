import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { EntitySchemaId, SandboxScriptId } from "@ryot/contract/schema/brands";

import {
	cleanupBuiltinProviderScript,
	createAuthenticatedClient,
	createNotificationChannel,
	enableMediaMonitoring,
	enqueueEntityImport,
	fakeProviderDetailsResult,
	getBuiltinEntitySchemaId,
	pollEntityImportResult,
	seedBuiltinProviderScript,
	seedMediaEntity,
	startFakeAppriseServer,
} from "~/fixtures";
import { pollUntil } from "~/fixtures/polling";
import { assertCompleted, requireObjectRecord } from "~/support/assertions";
import type { FakeHttpServer } from "~/support/fake-http-server";

let fakeApprise: FakeHttpServer;

beforeAll(async () => {
	fakeApprise = await startFakeAppriseServer();
});

afterAll(() => {
	fakeApprise.stop();
});

function pollNotificationBody(key: string) {
	return pollUntil(`notification delivery for '${key}'`, () => {
		const requests = fakeApprise.requests.filter(({ path }) => path === `/notify/${key}`);
		return Promise.resolve(requests.length === 1 ? requests : null);
	});
}

describe("company and media-group association variants", () => {
	it("notifies a company's monitor when newly credited on media", async () => {
		const movieName = "Association Variant Movie";
		const companyName = "Association Variant Company";
		const companyExternalId = `association-company-${crypto.randomUUID()}`;
		const movieExternalId = `association-variant-movie-${crypto.randomUUID()}`;

		const { client } = await createAuthenticatedClient();
		const [companySchemaId, movieSchemaId] = await Promise.all([
			getBuiltinEntitySchemaId("movie"),
			getBuiltinEntitySchemaId("company"),
		]);
		const companyProvider = await seedBuiltinProviderScript({
			client,
			linkToEntitySchemaId: companySchemaId,
			slug: `company.association-variant-e2e-${crypto.randomUUID()}`,
			drivers: { details: fakeProviderDetailsResult({ name: companyName }) },
		});
		const movieProvider = await seedBuiltinProviderScript({
			client,
			slug: `movie.association-variant-e2e-${crypto.randomUUID()}`,
			drivers: {
				details: fakeProviderDetailsResult({
					name: movieName,
					relatedEntityGroups: [
						{
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "company-to-movie",
							entities: [
								{
									name: companyName,
									externalId: companyExternalId,
									scriptSlug: companyProvider.slug,
									relationshipProperties: { roles: ["Production Company"] },
								},
							],
						},
					],
				}),
			},
		});

		try {
			const company = await seedMediaEntity({
				properties: {},
				name: companyName,
				externalId: companyExternalId,
				entitySchemaId: companySchemaId,
				sandboxScriptId: companyProvider.scriptId,
			});

			const companyMonitor = await createAuthenticatedClient();
			const importer = await createAuthenticatedClient();
			await createNotificationChannel(companyMonitor.client, {
				channel: "apprise",
				channelSpecifics: { baseUrl: fakeApprise.url, key: "company-monitor", kind: "apprise" },
			});
			await enableMediaMonitoring(companyMonitor.client, company.id);

			const { jobId } = await enqueueEntityImport(importer.client, {
				externalId: movieExternalId,
				entitySchemaId: EntitySchemaId.make(movieSchemaId),
				scriptId: SandboxScriptId.make(movieProvider.scriptId),
			});
			const result = await pollEntityImportResult(importer.client, jobId, { timeoutMs: 30_000 });
			assertCompleted(result, "company association media import");

			const delivered = await pollNotificationBody("company-monitor");
			expect(requireObjectRecord(delivered[0]?.body, "Missing notification body").body).toBe(
				`${companyName} has been associated with ${movieName} as Production Company`,
			);
		} finally {
			await cleanupBuiltinProviderScript(movieProvider);
			await cleanupBuiltinProviderScript(companyProvider);
		}
	});

	it("notifies both a person's and a company's monitor for media-group associations", async () => {
		const personName = "Media Group Person";
		const companyName = "Media Group Company";
		const musicGroupName = "Association Variant Album";
		const personExternalId = `media-group-person-${crypto.randomUUID()}`;
		const companyExternalId = `media-group-company-${crypto.randomUUID()}`;
		const musicGroupExternalId = `media-group-album-${crypto.randomUUID()}`;

		const { client } = await createAuthenticatedClient();
		const [personSchemaId, companySchemaId, musicGroupSchemaId] = await Promise.all([
			getBuiltinEntitySchemaId("person"),
			getBuiltinEntitySchemaId("company"),
			getBuiltinEntitySchemaId("music-group"),
		]);
		const personProvider = await seedBuiltinProviderScript({
			client,
			linkToEntitySchemaId: personSchemaId,
			slug: `person.media-group-e2e-${crypto.randomUUID()}`,
			drivers: { details: fakeProviderDetailsResult({ name: personName }) },
		});
		const companyProvider = await seedBuiltinProviderScript({
			client,
			linkToEntitySchemaId: companySchemaId,
			slug: `company.media-group-e2e-${crypto.randomUUID()}`,
			drivers: { details: fakeProviderDetailsResult({ name: companyName }) },
		});
		const musicGroupProvider = await seedBuiltinProviderScript({
			client,
			slug: `music-group.media-group-e2e-${crypto.randomUUID()}`,
			drivers: {
				details: fakeProviderDetailsResult({
					name: musicGroupName,
					relatedEntityGroups: [
						{
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "person-to-music-group",
							entities: [
								{
									name: personName,
									scriptSlug: personProvider.slug,
									externalId: personExternalId,
									relationshipProperties: { roles: ["Artist"] },
								},
							],
						},
						{
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "company-to-music-group",
							entities: [
								{
									name: companyName,
									scriptSlug: companyProvider.slug,
									externalId: companyExternalId,
									relationshipProperties: { roles: ["Label"] },
								},
							],
						},
					],
				}),
			},
		});

		try {
			const [person, company] = await Promise.all([
				seedMediaEntity({
					properties: {},
					name: personName,
					externalId: personExternalId,
					entitySchemaId: personSchemaId,
					sandboxScriptId: personProvider.scriptId,
				}),
				seedMediaEntity({
					properties: {},
					name: companyName,
					externalId: companyExternalId,
					entitySchemaId: companySchemaId,
					sandboxScriptId: companyProvider.scriptId,
				}),
			]);

			const personMonitor = await createAuthenticatedClient();
			const companyMonitor = await createAuthenticatedClient();
			const importer = await createAuthenticatedClient();
			await Promise.all([
				createNotificationChannel(personMonitor.client, {
					channel: "apprise",
					channelSpecifics: {
						kind: "apprise",
						baseUrl: fakeApprise.url,
						key: "media-group-person-monitor",
					},
				}),
				createNotificationChannel(companyMonitor.client, {
					channel: "apprise",
					channelSpecifics: {
						kind: "apprise",
						baseUrl: fakeApprise.url,
						key: "media-group-company-monitor",
					},
				}),
			]);
			await Promise.all([
				enableMediaMonitoring(personMonitor.client, person.id),
				enableMediaMonitoring(companyMonitor.client, company.id),
			]);

			const { jobId } = await enqueueEntityImport(importer.client, {
				externalId: musicGroupExternalId,
				entitySchemaId: EntitySchemaId.make(musicGroupSchemaId),
				scriptId: SandboxScriptId.make(musicGroupProvider.scriptId),
			});
			const result = await pollEntityImportResult(importer.client, jobId, { timeoutMs: 30_000 });
			assertCompleted(result, "media-group association import");

			const [personDelivered, companyDelivered] = await Promise.all([
				pollNotificationBody("media-group-person-monitor"),
				pollNotificationBody("media-group-company-monitor"),
			]);
			expect(requireObjectRecord(personDelivered[0]?.body, "Missing notification body").body).toBe(
				`${personName} has been associated with ${musicGroupName} as Artist`,
			);
			expect(requireObjectRecord(companyDelivered[0]?.body, "Missing notification body").body).toBe(
				`${companyName} has been associated with ${musicGroupName} as Label`,
			);
		} finally {
			await cleanupBuiltinProviderScript(musicGroupProvider);
			await cleanupBuiltinProviderScript(companyProvider);
			await cleanupBuiltinProviderScript(personProvider);
		}
	});
});
