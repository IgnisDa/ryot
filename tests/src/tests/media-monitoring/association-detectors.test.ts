import { EntityId, EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	adminHeaders,
	createAuthenticatedClient,
	createNotificationChannel,
	enableMediaMonitoring,
	enqueueEntityImport,
	fakeProviderDetailsResult,
	getBackendClient,
	getBuiltinEntitySchemaSlug,
	pollEntityImportResult,
	providerSandboxSource,
	replaceSandboxScriptCompiledRepresentation,
	installTestProvider,
	seedMediaEntity,
	startFakeAppriseServer,
	triggerCronAndWaitForEntity,
	type InstalledTestProvider,
	pollUntil,
} from "~/fixtures";
import { assertCompleted, requireObjectRecord } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";
import type { FakeHttpServer } from "~/support/fake-http-server";

const movieName = "Association E2E Movie";
const personName = "Association E2E Person";
const movieExternalId = `association-movie-${crypto.randomUUID()}`;
const personExternalId = `association-person-${crypto.randomUUID()}`;

let movieSchemaId: string;
let personEntityId: string;
let fakeApprise: FakeHttpServer;
let movieProvider: InstalledTestProvider;
let personProvider: InstalledTestProvider;

beforeAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const personSchemaId = yield* getBuiltinEntitySchemaSlug("person");
			movieSchemaId = yield* getBuiltinEntitySchemaSlug("movie");
			personProvider = yield* installTestProvider({
				client,
				linkToEntitySchemaSlug: personSchemaId,
				slug: `person.association-e2e-${crypto.randomUUID()}`,
				details: fakeProviderDetailsResult({ name: personName }),
			});
			movieProvider = yield* installTestProvider({
				client,
				slug: `movie.association-e2e-${crypto.randomUUID()}`,
				linkToEntitySchemaSlug: movieSchemaId,
				details: fakeProviderDetailsResult({
					name: movieName,
					relatedEntityGroups: [
						{
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "person-to-movie",
							entities: [
								{
									name: personName,
									providerSlug: personProvider.providerSlug,
									externalId: personExternalId,
									relationshipProperties: { roles: ["Actor", "Director"] },
								},
							],
						},
					],
				}),
			});
			const person = yield* seedMediaEntity({
				properties: {},
				name: personName,
				externalId: personExternalId,
				entitySchemaSlug: personSchemaId,
				providerId: personProvider.providerId,
			});
			personEntityId = person.id;
		}),
	);
	fakeApprise = await startFakeAppriseServer();
});

afterAll(() => {
	fakeApprise.stop();
});

it.live("notifies only a credited person's monitor once per role on first media population", () =>
	Effect.gen(function* () {
		const personMonitor = yield* createAuthenticatedClient();
		const importer = yield* createAuthenticatedClient();
		yield* Effect.all([
			createNotificationChannel(personMonitor.client, {
				channel: "apprise",
				channelSpecifics: { baseUrl: fakeApprise.url, key: "person-monitor", kind: "apprise" },
			}),
			createNotificationChannel(importer.client, {
				channel: "apprise",
				channelSpecifics: { baseUrl: fakeApprise.url, key: "media-importer", kind: "apprise" },
			}),
		]);
		yield* enableMediaMonitoring(personMonitor.client, personEntityId);

		const { jobId } = yield* enqueueEntityImport(importer.client, {
			externalId: movieExternalId,
			entitySchemaSlug: EntitySchemaSlug.make(movieSchemaId),
			providerId: SandboxProviderId.make(movieProvider.providerId),
		});
		const result = yield* pollEntityImportResult(importer.client, jobId);
		assertCompleted(result, "association media import");

		const delivered = yield* pollUntil(
			"association notification delivery",
			Effect.sync(() => {
				const requests = fakeApprise.requests.filter(
					({ path }) => path === "/notify/person-monitor",
				);
				return requests.length === 2 ? requests : null;
			}),
		);
		const bodies = delivered
			.map(({ body }) => requireObjectRecord(body, "Missing association notification body").body)
			.sort((left, right) => String(left).localeCompare(String(right)));
		expect(bodies).toEqual(
			[
				`${personName} has been associated with ${movieName} as Actor`,
				`${personName} has been associated with ${movieName} as Director`,
			].sort((left, right) => left.localeCompare(right)),
		);
		expect(fakeApprise.requests.filter(({ path }) => path === "/notify/media-importer")).toEqual(
			[],
		);
	}),
);

function pollAssociationNotification(key: string) {
	return pollUntil(
		`association notification for '${key}'`,
		Effect.sync(() => {
			const requests = fakeApprise.requests.filter(({ path }) => path === `/notify/${key}`);
			return requests.length >= 1 ? requests : null;
		}),
	);
}

describe("dual-writer canonical identity", () => {
	it.live(
		"resolves media-rooted and person-rooted writes to one canonical edge; an identical rewrite is a noop",
		() =>
			Effect.gen(function* () {
				const dwMovieName = "Dual Writer Movie";
				const dwPersonName = "Dual Writer Person";
				const dwMovieSlug = `movie.dual-writer-e2e-${crypto.randomUUID()}`;
				const dwMovieExternalId = `dual-writer-movie-${crypto.randomUUID()}`;
				const dwPersonSlug = `person.dual-writer-e2e-${crypto.randomUUID()}`;
				const personSchemaId = yield* getBuiltinEntitySchemaSlug("person");
				const dwPersonExternalId = `dual-writer-person-${crypto.randomUUID()}`;

				const { client } = yield* createAuthenticatedClient();
				const dwPersonProvider = yield* installTestProvider({
					client,
					slug: dwPersonSlug,
					linkToEntitySchemaSlug: personSchemaId,
					details: fakeProviderDetailsResult({
						name: dwPersonName,
						relatedEntityGroups: [
							{
								direction: "outgoing",
								synchronization: "authoritative",
								relationshipSchemaSlug: "person-to-movie",
								entities: [
									{
										name: dwMovieName,
										providerSlug: dwMovieSlug,
										externalId: dwMovieExternalId,
										relationshipProperties: { roles: ["Actor"] },
									},
								],
							},
						],
					}),
				});
				const dwMovieProvider = yield* installTestProvider({
					client,
					slug: dwMovieSlug,
					linkToEntitySchemaSlug: movieSchemaId,
					details: fakeProviderDetailsResult({
						name: dwMovieName,
						relatedEntityGroups: [
							{
								direction: "incoming",
								synchronization: "additive",
								relationshipSchemaSlug: "person-to-movie",
								entities: [
									{
										name: dwPersonName,
										providerSlug: dwPersonSlug,
										externalId: dwPersonExternalId,
										relationshipProperties: { roles: ["Actor"] },
									},
								],
							},
						],
					}),
				});

				const person = yield* seedMediaEntity({
					properties: {},
					name: dwPersonName,
					externalId: dwPersonExternalId,
					entitySchemaSlug: personSchemaId,
					providerId: dwPersonProvider.providerId,
				});
				// Mark the person already-populated so its own later cron refresh below is a
				// rewrite, not a first population — isolating the noop assertion from the
				// initial-population carve-out (covered separately).
				yield* getBackendClient().call(
					(c) =>
						c.testSupport.setEntityPopulatedAt({
							path: { entityId: EntityId.make(person.id) },
							payload: { populatedAt: new Date().toISOString() },
						}),
					adminHeaders,
				);

				const personMonitor = yield* createAuthenticatedClient();
				const importer = yield* createAuthenticatedClient();
				yield* createNotificationChannel(personMonitor.client, {
					channel: "apprise",
					channelSpecifics: {
						kind: "apprise",
						baseUrl: fakeApprise.url,
						key: "dual-writer-monitor",
					},
				});
				yield* enableMediaMonitoring(personMonitor.client, person.id);

				fakeApprise.requests.length = 0;
				const { jobId } = yield* enqueueEntityImport(importer.client, {
					externalId: dwMovieExternalId,
					entitySchemaSlug: EntitySchemaSlug.make(movieSchemaId),
					providerId: SandboxProviderId.make(dwMovieProvider.providerId),
				});
				const imported = yield* pollEntityImportResult(importer.client, jobId);
				assertCompleted(imported, "dual-writer media-rooted import");
				const created = yield* pollAssociationNotification("dual-writer-monitor");
				expect(created).toHaveLength(1);
				expect(requireObjectRecord(created[0]?.body, "Missing notification body").body).toBe(
					`${dwPersonName} has been associated with ${dwMovieName} as Actor`,
				);

				// The person's own authoritative outgoing sync now rewrites the same edge with
				// the identical role: it must resolve to the existing canonical row (not a
				// duplicate) and dispatch nothing, since the write is a noop.
				fakeApprise.requests.length = 0;
				yield* triggerCronAndWaitForEntity(personMonitor, person.id);
				expect(
					fakeApprise.requests.filter(({ path }) => path === "/notify/dual-writer-monitor"),
				).toEqual([]);
			}),
	);
});

describe("association lifecycle via cron refresh", () => {
	it.live("notifies only the newly added role on an update, not the already-known one", () =>
		Effect.gen(function* () {
			const ruMovieName = "Role Update Movie";
			const ruPersonName = "Role Update Person";
			const ruMovieSlug = `movie.role-update-e2e-${crypto.randomUUID()}`;
			const ruMovieExternalId = `role-update-movie-${crypto.randomUUID()}`;
			const ruPersonSlug = `person.role-update-e2e-${crypto.randomUUID()}`;
			const personSchemaId = yield* getBuiltinEntitySchemaSlug("person");
			const ruPersonExternalId = `role-update-person-${crypto.randomUUID()}`;

			const buildPersonSource = (roles: string[]) =>
				providerSandboxSource({
					name: ruPersonName,
					slug: `${ruPersonSlug}.details`,
					operation: "details",
					result: fakeProviderDetailsResult({
						name: ruPersonName,
						relatedEntityGroups: [
							{
								direction: "outgoing",
								synchronization: "authoritative",
								relationshipSchemaSlug: "person-to-movie",
								entities: [
									{
										name: ruMovieName,
										providerSlug: ruMovieSlug,
										externalId: ruMovieExternalId,
										relationshipProperties: { roles },
									},
								],
							},
						],
					}),
				});

			const { client } = yield* createAuthenticatedClient();
			const ruPersonProvider = yield* installTestProvider({
				client,
				slug: ruPersonSlug,
				linkToEntitySchemaSlug: personSchemaId,
				details: fakeProviderDetailsResult({ name: ruPersonName }),
			});
			const ruMovieProvider = yield* installTestProvider({
				client,
				slug: ruMovieSlug,
				linkToEntitySchemaSlug: movieSchemaId,
				details: fakeProviderDetailsResult({
					name: ruMovieName,
					relatedEntityGroups: [
						{
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "person-to-movie",
							entities: [
								{
									name: ruPersonName,
									providerSlug: ruPersonSlug,
									externalId: ruPersonExternalId,
									relationshipProperties: { roles: ["Actor"] },
								},
							],
						},
					],
				}),
			});

			const person = yield* seedMediaEntity({
				properties: {},
				name: ruPersonName,
				externalId: ruPersonExternalId,
				entitySchemaSlug: personSchemaId,
				providerId: ruPersonProvider.providerId,
			});
			const movie = yield* seedMediaEntity({
				properties: {},
				name: ruMovieName,
				externalId: ruMovieExternalId,
				entitySchemaSlug: movieSchemaId,
				providerId: ruMovieProvider.providerId,
			});
			// Mark the person already-populated so its later cron-driven authoritative sync
			// below is a role update, not a first population — the carve-out would otherwise
			// silence it since the person is both the refresh root and the credited subject.
			yield* getBackendClient().call(
				(c) =>
					c.testSupport.setEntityPopulatedAt({
						path: { entityId: EntityId.make(person.id) },
						payload: { populatedAt: new Date().toISOString() },
					}),
				adminHeaders,
			);

			const personMonitor = yield* createAuthenticatedClient();
			yield* createNotificationChannel(personMonitor.client, {
				channel: "apprise",
				channelSpecifics: {
					baseUrl: fakeApprise.url,
					key: "role-update-monitor",
					kind: "apprise",
				},
			});
			yield* enableMediaMonitoring(personMonitor.client, person.id);
			yield* enableMediaMonitoring(personMonitor.client, movie.id);

			fakeApprise.requests.length = 0;
			yield* triggerCronAndWaitForEntity(personMonitor, movie.id);
			const baseline = yield* pollAssociationNotification("role-update-monitor");
			expect(baseline).toHaveLength(1);
			expect(requireObjectRecord(baseline[0]?.body, "Missing notification body").body).toBe(
				`${ruPersonName} has been associated with ${ruMovieName} as Actor`,
			);

			// The movie's additive incoming sync never touches an existing edge's properties
			// (it always preserves them), so the role addition must come from the person's own
			// authoritative outgoing sync instead of re-driving the movie's cron.
			fakeApprise.requests.length = 0;
			yield* replaceSandboxScriptCompiledRepresentation(
				client,
				ruPersonProvider.detailsScriptId,
				buildPersonSource(["Actor", "Director"]),
			);
			yield* triggerCronAndWaitForEntity(personMonitor, person.id);
			const updated = yield* pollAssociationNotification("role-update-monitor");
			expect(updated).toHaveLength(1);
			expect(requireObjectRecord(updated[0]?.body, "Missing notification body").body).toBe(
				`${ruPersonName} has been associated with ${ruMovieName} as Director`,
			);
		}),
	);

	it.live(
		"silences a monitored person's own first population and a later delete, but permits a fresh notification after re-create",
		() =>
			Effect.gen(function* () {
				const drMovieName = "Delete Recreate Movie";
				const drPersonName = "Delete Recreate Person";
				const personSchemaId = yield* getBuiltinEntitySchemaSlug("person");
				const drMovieSlug = `movie.delete-recreate-e2e-${crypto.randomUUID()}`;
				const drMovieExternalId = `delete-recreate-movie-${crypto.randomUUID()}`;
				const drPersonSlug = `person.delete-recreate-e2e-${crypto.randomUUID()}`;
				const drPersonExternalId = `delete-recreate-person-${crypto.randomUUID()}`;

				const movieRelatedEntity = {
					name: drMovieName,
					providerSlug: drMovieSlug,
					externalId: drMovieExternalId,
					relationshipProperties: { roles: ["Actor"] },
				};
				const buildPersonSource = (entities: ReadonlyArray<typeof movieRelatedEntity>) =>
					providerSandboxSource({
						name: drPersonName,
						slug: `${drPersonSlug}.details`,
						operation: "details",
						result: fakeProviderDetailsResult({
							name: drPersonName,
							relatedEntityGroups: [
								{
									entities,
									direction: "outgoing",
									synchronization: "authoritative",
									relationshipSchemaSlug: "person-to-movie",
								},
							],
						}),
					});

				const { client } = yield* createAuthenticatedClient();
				yield* installTestProvider({
					client,
					slug: drMovieSlug,
					linkToEntitySchemaSlug: movieSchemaId,
					details: fakeProviderDetailsResult({ name: drMovieName }),
				});
				const drPersonProvider = yield* installTestProvider({
					client,
					slug: drPersonSlug,
					linkToEntitySchemaSlug: personSchemaId,
					details: fakeProviderDetailsResult({
						name: drPersonName,
						relatedEntityGroups: [
							{
								direction: "outgoing",
								entities: [movieRelatedEntity],
								synchronization: "authoritative",
								relationshipSchemaSlug: "person-to-movie",
							},
						],
					}),
				});

				const person = yield* seedMediaEntity({
					properties: {},
					name: drPersonName,
					externalId: drPersonExternalId,
					entitySchemaSlug: personSchemaId,
					providerId: drPersonProvider.providerId,
				});

				const personMonitor = yield* createAuthenticatedClient();
				yield* createNotificationChannel(personMonitor.client, {
					channel: "apprise",
					channelSpecifics: {
						kind: "apprise",
						baseUrl: fakeApprise.url,
						key: "delete-recreate-monitor",
					},
				});
				yield* enableMediaMonitoring(personMonitor.client, person.id);

				// First population of the monitored person is the credited subject's own root:
				// the carve-out silences it even though the edge is genuinely created.
				fakeApprise.requests.length = 0;
				yield* triggerCronAndWaitForEntity(personMonitor, person.id);
				expect(
					fakeApprise.requests.filter(({ path }) => path === "/notify/delete-recreate-monitor"),
				).toEqual([]);

				// An authoritative sync dropping the movie deletes the edge; deletes never notify.
				fakeApprise.requests.length = 0;
				yield* replaceSandboxScriptCompiledRepresentation(
					client,
					drPersonProvider.detailsScriptId,
					buildPersonSource([]),
				);
				yield* triggerCronAndWaitForEntity(personMonitor, person.id);
				expect(
					fakeApprise.requests.filter(({ path }) => path === "/notify/delete-recreate-monitor"),
				).toEqual([]);

				// Re-adding the movie re-creates the edge. The root is no longer on its first
				// population, so the carve-out no longer applies and the fresh create notifies.
				fakeApprise.requests.length = 0;
				yield* replaceSandboxScriptCompiledRepresentation(
					client,
					drPersonProvider.detailsScriptId,
					buildPersonSource([movieRelatedEntity]),
				);
				yield* triggerCronAndWaitForEntity(personMonitor, person.id);
				const recreated = yield* pollAssociationNotification("delete-recreate-monitor");
				expect(recreated).toHaveLength(1);
				expect(requireObjectRecord(recreated[0]?.body, "Missing notification body").body).toBe(
					`${drPersonName} has been associated with ${drMovieName} as Actor`,
				);
			}),
	);
});
