import { SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { mediaPlugin } from "@ryot-app/media-plugin";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createNotificationChannel,
	enqueueProviderEntityImport,
	fakeProviderDetailsResult,
	pollProviderEntityImportResult,
	pollUntil,
	populateRelatedThroughForegroundInterest,
	shippedPluginTestProviders,
	startFakeAppriseServer,
} from "~/fixtures/kernel";
import {
	enableMediaMonitoring,
	findMediaEntitySchema,
	seedMediaEntity,
} from "~/fixtures/plugins/media";
import { assertCompleted, requireObjectRecord } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";
import type { FakeHttpServer } from "~/support/fake-http-server";
import { startIsolatedHarness } from "~/support/isolated-harness";

let fakeApprise: FakeHttpServer;
let harness: Effect.Success<ReturnType<typeof startIsolatedHarness>> | undefined;
let media: Effect.Success<ReturnType<typeof shippedPluginTestProviders>>;

beforeAll(() =>
	runPromise(
		Effect.gen(function* () {
			fakeApprise = yield* startFakeAppriseServer;
			harness = yield* startIsolatedHarness("Association Detector Variants");
			media = yield* shippedPluginTestProviders(mediaPlugin.metadata.packageId);
		}),
	),
);

afterAll(() =>
	runPromise(
		Effect.gen(function* () {
			yield* Effect.promise(() => fakeApprise.stop());
			yield* harness?.stop ?? Effect.void;
		}),
	),
);

function pollNotificationBody(key: string) {
	return pollUntil(
		`notification delivery for '${key}'`,
		Effect.sync(() => {
			const requests = fakeApprise.requests.filter(({ path }) => path === `/notify/${key}`);
			return requests.length >= 1 ? requests : null;
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
			const [{ schema: companySchema }, { schema: movieSchema }] = yield* Effect.all([
				findMediaEntitySchema(client, "company"),
				findMediaEntitySchema(client, "movie"),
			]);
			const companySchemaId = companySchema.id;
			const movieSchemaId = movieSchema.id;
			const companyProvider = yield* media.attachProvider({
				rootEntitySchemaSlug: companySchemaId,
				details: fakeProviderDetailsResult({ name: companyName }),
				slug: `company.association-variant-e2e-${crypto.randomUUID()}`,
			});
			const movieProvider = yield* media.attachProvider({
				rootEntitySchemaSlug: movieSchemaId,
				slug: `movie.association-variant-e2e-${crypto.randomUUID()}`,
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
				channelSpecifics: { kind: "apprise", key: "company-monitor", baseUrl: fakeApprise.url },
			});
			yield* enableMediaMonitoring(companyMonitor.client, company.id);

			const { jobId } = yield* enqueueProviderEntityImport(importer.client, {
				externalId: movieExternalId,
				providerId: SandboxProviderId.make(movieProvider.providerId),
			});
			const result = yield* pollProviderEntityImportResult(importer.client, jobId);
			assertCompleted(result, "company association media import");
			yield* populateRelatedThroughForegroundInterest(importer, result.data.id);

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
			const [{ schema: personSchema }, { schema: companySchema }, { schema: musicGroupSchema }] =
				yield* Effect.all([
					findMediaEntitySchema(client, "person"),
					findMediaEntitySchema(client, "company"),
					findMediaEntitySchema(client, "music-group"),
				]);
			const personSchemaId = personSchema.id;
			const companySchemaId = companySchema.id;
			const musicGroupSchemaId = musicGroupSchema.id;
			const personProvider = yield* media.attachProvider({
				rootEntitySchemaSlug: personSchemaId,
				slug: `person.media-group-e2e-${crypto.randomUUID()}`,
				details: fakeProviderDetailsResult({ name: personName }),
			});
			const companyProvider = yield* media.attachProvider({
				rootEntitySchemaSlug: companySchemaId,
				slug: `company.media-group-e2e-${crypto.randomUUID()}`,
				details: fakeProviderDetailsResult({ name: companyName }),
			});
			const musicGroupProvider = yield* media.attachProvider({
				rootEntitySchemaSlug: musicGroupSchemaId,
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
									externalId: personExternalId,
									providerSlug: personProvider.providerSlug,
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
									externalId: companyExternalId,
									providerSlug: companyProvider.providerSlug,
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
					channelSpecifics: {
						kind: "apprise",
						baseUrl: fakeApprise.url,
						key: "media-group-person-monitor",
					},
				}),
				createNotificationChannel(companyMonitor.client, {
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

			const { jobId } = yield* enqueueProviderEntityImport(importer.client, {
				externalId: musicGroupExternalId,
				providerId: SandboxProviderId.make(musicGroupProvider.providerId),
			});
			const result = yield* pollProviderEntityImportResult(importer.client, jobId);
			assertCompleted(result, "media-group association import");
			yield* populateRelatedThroughForegroundInterest(importer, result.data.id);

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
