import { EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createNotificationChannel,
	enableMediaMonitoring,
	enqueueEntityImport,
	fakeProviderDetailsResult,
	getBuiltinEntitySchemaSlug,
	pollEntityImportResult,
	installTestProvider,
	seedMediaEntity,
	startFakeAppriseServer,
	pollUntil,
} from "~/fixtures";
import { assertCompleted, requireObjectRecord } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";
import type { FakeHttpServer } from "~/support/fake-http-server";

let fakeApprise: FakeHttpServer;

beforeAll(async () => {
	fakeApprise = await startFakeAppriseServer();
});

afterAll(() => {
	fakeApprise.stop();
});

function pollNotificationBody(key: string) {
	return pollUntil(
		`notification delivery for '${key}'`,
		Effect.sync(() => {
			const requests = fakeApprise.requests.filter(({ path }) => path === `/notify/${key}`);
			return requests.length === 1 ? requests : null;
		}),
	);
}

describe("company and media-group association variants", () => {
	it.live("notifies a company's monitor when newly credited on media", () =>
		Effect.gen(function* () {
			const movieName = "Association Variant Movie";
			const companyName = "Association Variant Company";
			const companyExternalId = `association-company-${crypto.randomUUID()}`;
			const movieExternalId = `association-variant-movie-${crypto.randomUUID()}`;

			const { client } = yield* createAuthenticatedClient();
			const [companySchemaId, movieSchemaId] = yield* Effect.all([
				getBuiltinEntitySchemaSlug("company"),
				getBuiltinEntitySchemaSlug("movie"),
			]);
			const companyProvider = yield* installTestProvider({
				client,
				linkToEntitySchemaSlug: companySchemaId,
				slug: `company.association-variant-e2e-${crypto.randomUUID()}`,
				details: fakeProviderDetailsResult({ name: companyName }),
			});
			const movieProvider = yield* installTestProvider({
				client,
				slug: `movie.association-variant-e2e-${crypto.randomUUID()}`,
				linkToEntitySchemaSlug: movieSchemaId,
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
									providerSlug: companyProvider.providerSlug,
									relationshipProperties: { roles: ["Production Company"] },
								},
							],
						},
					],
				}),
			});

			const company = yield* seedMediaEntity({
				properties: {},
				name: companyName,
				externalId: companyExternalId,
				entitySchemaSlug: companySchemaId,
				providerId: companyProvider.providerId,
			});

			const companyMonitor = yield* createAuthenticatedClient();
			const importer = yield* createAuthenticatedClient();
			yield* createNotificationChannel(companyMonitor.client, {
				channel: "apprise",
				channelSpecifics: { baseUrl: fakeApprise.url, key: "company-monitor", kind: "apprise" },
			});
			yield* enableMediaMonitoring(companyMonitor.client, company.id);

			const { jobId } = yield* enqueueEntityImport(importer.client, {
				externalId: movieExternalId,
				entitySchemaSlug: EntitySchemaSlug.make(movieSchemaId),
				providerId: SandboxProviderId.make(movieProvider.providerId),
			});
			const result = yield* pollEntityImportResult(importer.client, jobId, { timeoutMs: 30_000 });
			assertCompleted(result, "company association media import");

			const delivered = yield* pollNotificationBody("company-monitor");
			expect(requireObjectRecord(delivered[0]?.body, "Missing notification body").body).toBe(
				`${companyName} has been associated with ${movieName} as Production Company`,
			);
		}),
	);

	it.live("notifies both a person's and a company's monitor for media-group associations", () =>
		Effect.gen(function* () {
			const personName = "Media Group Person";
			const companyName = "Media Group Company";
			const musicGroupName = "Association Variant Album";
			const personExternalId = `media-group-person-${crypto.randomUUID()}`;
			const companyExternalId = `media-group-company-${crypto.randomUUID()}`;
			const musicGroupExternalId = `media-group-album-${crypto.randomUUID()}`;

			const { client } = yield* createAuthenticatedClient();
			const [personSchemaId, companySchemaId, musicGroupSchemaId] = yield* Effect.all([
				getBuiltinEntitySchemaSlug("person"),
				getBuiltinEntitySchemaSlug("company"),
				getBuiltinEntitySchemaSlug("music-group"),
			]);
			const personProvider = yield* installTestProvider({
				client,
				linkToEntitySchemaSlug: personSchemaId,
				slug: `person.media-group-e2e-${crypto.randomUUID()}`,
				details: fakeProviderDetailsResult({ name: personName }),
			});
			const companyProvider = yield* installTestProvider({
				client,
				linkToEntitySchemaSlug: companySchemaId,
				slug: `company.media-group-e2e-${crypto.randomUUID()}`,
				details: fakeProviderDetailsResult({ name: companyName }),
			});
			const musicGroupProvider = yield* installTestProvider({
				client,
				linkToEntitySchemaSlug: musicGroupSchemaId,
				slug: `music-group.media-group-e2e-${crypto.randomUUID()}`,
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
									providerSlug: personProvider.providerSlug,
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
									providerSlug: companyProvider.providerSlug,
									externalId: companyExternalId,
									relationshipProperties: { roles: ["Label"] },
								},
							],
						},
					],
				}),
			});

			const [person, company] = yield* Effect.all([
				seedMediaEntity({
					properties: {},
					name: personName,
					externalId: personExternalId,
					entitySchemaSlug: personSchemaId,
					providerId: personProvider.providerId,
				}),
				seedMediaEntity({
					properties: {},
					name: companyName,
					externalId: companyExternalId,
					entitySchemaSlug: companySchemaId,
					providerId: companyProvider.providerId,
				}),
			]);

			const personMonitor = yield* createAuthenticatedClient();
			const companyMonitor = yield* createAuthenticatedClient();
			const importer = yield* createAuthenticatedClient();
			yield* Effect.all([
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
			yield* Effect.all([
				enableMediaMonitoring(personMonitor.client, person.id),
				enableMediaMonitoring(companyMonitor.client, company.id),
			]);

			const { jobId } = yield* enqueueEntityImport(importer.client, {
				externalId: musicGroupExternalId,
				entitySchemaSlug: EntitySchemaSlug.make(musicGroupSchemaId),
				providerId: SandboxProviderId.make(musicGroupProvider.providerId),
			});
			const result = yield* pollEntityImportResult(importer.client, jobId, { timeoutMs: 30_000 });
			assertCompleted(result, "media-group association import");

			const [personDelivered, companyDelivered] = yield* Effect.all([
				pollNotificationBody("media-group-person-monitor"),
				pollNotificationBody("media-group-company-monitor"),
			]);
			expect(requireObjectRecord(personDelivered[0]?.body, "Missing notification body").body).toBe(
				`${personName} has been associated with ${musicGroupName} as Artist`,
			);
			expect(requireObjectRecord(companyDelivered[0]?.body, "Missing notification body").body).toBe(
				`${companyName} has been associated with ${musicGroupName} as Label`,
			);
		}),
	);
});
