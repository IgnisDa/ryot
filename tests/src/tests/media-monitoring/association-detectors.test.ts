import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { EntityId, EntitySchemaId, SandboxScriptId } from "@ryot/contract/schema/brands";

import {
	adminHeaders,
	cleanupBuiltinProviderScript,
	createAuthenticatedClient,
	createNotificationChannel,
	enableMediaMonitoring,
	enqueueEntityImport,
	fakeProviderDetailsResult,
	getBackendClient,
	getBuiltinEntitySchemaId,
	pollEntityImportResult,
	providerSandboxSource,
	replaceSandboxScriptCompiledRepresentation,
	seedBuiltinProviderScript,
	seedMediaEntity,
	startFakeAppriseServer,
	triggerCronAndWaitForEntity,
	type SeededProviderScript,
} from "~/fixtures";
import { pollUntil } from "~/fixtures/polling";
import { assertCompleted, requireObjectRecord } from "~/support/assertions";
import type { FakeHttpServer } from "~/support/fake-http-server";

const movieName = "Association E2E Movie";
const personName = "Association E2E Person";
const movieExternalId = `association-movie-${crypto.randomUUID()}`;
const personExternalId = `association-person-${crypto.randomUUID()}`;

let movieSchemaId: string;
let personEntityId: string;
let fakeApprise: FakeHttpServer;
let movieProvider: SeededProviderScript;
let personProvider: SeededProviderScript;

beforeAll(async () => {
	const { client } = await createAuthenticatedClient();
	const personSchemaId = await getBuiltinEntitySchemaId("person");
	movieSchemaId = await getBuiltinEntitySchemaId("movie");
	personProvider = await seedBuiltinProviderScript({
		client,
		linkToEntitySchemaId: personSchemaId,
		slug: `person.association-e2e-${crypto.randomUUID()}`,
		drivers: { details: fakeProviderDetailsResult({ name: personName }) },
	});
	movieProvider = await seedBuiltinProviderScript({
		client,
		slug: `movie.association-e2e-${crypto.randomUUID()}`,
		drivers: {
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
								scriptSlug: personProvider.slug,
								externalId: personExternalId,
								relationshipProperties: { roles: ["Actor", "Director"] },
							},
						],
					},
				],
			}),
		},
	});
	const person = await seedMediaEntity({
		properties: {},
		name: personName,
		externalId: personExternalId,
		entitySchemaId: personSchemaId,
		sandboxScriptId: personProvider.scriptId,
	});
	personEntityId = person.id;
	fakeApprise = await startFakeAppriseServer();
});

afterAll(async () => {
	fakeApprise.stop();
	await cleanupBuiltinProviderScript(movieProvider);
	await cleanupBuiltinProviderScript(personProvider);
});

it("notifies only a credited person's monitor once per role on first media population", async () => {
	const personMonitor = await createAuthenticatedClient();
	const importer = await createAuthenticatedClient();
	await Promise.all([
		createNotificationChannel(personMonitor.client, {
			channel: "apprise",
			channelSpecifics: { baseUrl: fakeApprise.url, key: "person-monitor", kind: "apprise" },
		}),
		createNotificationChannel(importer.client, {
			channel: "apprise",
			channelSpecifics: { baseUrl: fakeApprise.url, key: "media-importer", kind: "apprise" },
		}),
	]);
	await enableMediaMonitoring(personMonitor.client, personEntityId);

	const { jobId } = await enqueueEntityImport(importer.client, {
		externalId: movieExternalId,
		entitySchemaId: EntitySchemaId.make(movieSchemaId),
		scriptId: SandboxScriptId.make(movieProvider.scriptId),
	});
	const result = await pollEntityImportResult(importer.client, jobId, { timeoutMs: 30_000 });
	assertCompleted(result, "association media import");

	const delivered = await pollUntil("association notification delivery", () => {
		const requests = fakeApprise.requests.filter(({ path }) => path === "/notify/person-monitor");
		return Promise.resolve(requests.length === 2 ? requests : null);
	});
	const bodies = delivered
		.map(({ body }) => requireObjectRecord(body, "Missing association notification body").body)
		.sort((left, right) => String(left).localeCompare(String(right)));
	expect(bodies).toEqual(
		[
			`${personName} has been associated with ${movieName} as Actor`,
			`${personName} has been associated with ${movieName} as Director`,
		].sort((left, right) => left.localeCompare(right)),
	);
	expect(fakeApprise.requests.filter(({ path }) => path === "/notify/media-importer")).toEqual([]);
});

function pollAssociationNotification(key: string) {
	return pollUntil(`association notification for '${key}'`, () => {
		const requests = fakeApprise.requests.filter(({ path }) => path === `/notify/${key}`);
		return Promise.resolve(requests.length >= 1 ? requests : null);
	});
}

describe("dual-writer canonical identity", () => {
	it("resolves media-rooted and person-rooted writes to one canonical edge; an identical rewrite is a noop", async () => {
		const dwMovieName = "Dual Writer Movie";
		const dwPersonName = "Dual Writer Person";
		const dwMovieSlug = `movie.dual-writer-e2e-${crypto.randomUUID()}`;
		const dwMovieExternalId = `dual-writer-movie-${crypto.randomUUID()}`;
		const dwPersonSlug = `person.dual-writer-e2e-${crypto.randomUUID()}`;
		const personSchemaId = await getBuiltinEntitySchemaId("person");
		const dwPersonExternalId = `dual-writer-person-${crypto.randomUUID()}`;

		const { client } = await createAuthenticatedClient();
		const dwPersonProvider = await seedBuiltinProviderScript({
			client,
			slug: dwPersonSlug,
			linkToEntitySchemaId: personSchemaId,
			drivers: {
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
									scriptSlug: dwMovieSlug,
									externalId: dwMovieExternalId,
									relationshipProperties: { roles: ["Actor"] },
								},
							],
						},
					],
				}),
			},
		});
		const dwMovieProvider = await seedBuiltinProviderScript({
			client,
			slug: dwMovieSlug,
			linkToEntitySchemaId: movieSchemaId,
			drivers: {
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
									scriptSlug: dwPersonSlug,
									externalId: dwPersonExternalId,
									relationshipProperties: { roles: ["Actor"] },
								},
							],
						},
					],
				}),
			},
		});

		try {
			const person = await seedMediaEntity({
				properties: {},
				name: dwPersonName,
				externalId: dwPersonExternalId,
				entitySchemaId: personSchemaId,
				sandboxScriptId: dwPersonProvider.scriptId,
			});
			// Mark the person already-populated so its own later cron refresh below is a
			// rewrite, not a first population — isolating the noop assertion from the
			// initial-population carve-out (covered separately).
			await getBackendClient().run(
				(c) =>
					c.testSupport.setEntityPopulatedAt({
						path: { entityId: EntityId.make(person.id) },
						payload: { populatedAt: new Date().toISOString() },
					}),
				adminHeaders,
			);

			const personMonitor = await createAuthenticatedClient();
			const importer = await createAuthenticatedClient();
			await createNotificationChannel(personMonitor.client, {
				channel: "apprise",
				channelSpecifics: { kind: "apprise", baseUrl: fakeApprise.url, key: "dual-writer-monitor" },
			});
			await enableMediaMonitoring(personMonitor.client, person.id);

			fakeApprise.requests.length = 0;
			const { jobId } = await enqueueEntityImport(importer.client, {
				externalId: dwMovieExternalId,
				entitySchemaId: EntitySchemaId.make(movieSchemaId),
				scriptId: SandboxScriptId.make(dwMovieProvider.scriptId),
			});
			const imported = await pollEntityImportResult(importer.client, jobId, {
				timeoutMs: 30_000,
			});
			assertCompleted(imported, "dual-writer media-rooted import");
			const created = await pollAssociationNotification("dual-writer-monitor");
			expect(created).toHaveLength(1);
			expect(requireObjectRecord(created[0]?.body, "Missing notification body").body).toBe(
				`${dwPersonName} has been associated with ${dwMovieName} as Actor`,
			);

			// The person's own authoritative outgoing sync now rewrites the same edge with
			// the identical role: it must resolve to the existing canonical row (not a
			// duplicate) and dispatch nothing, since the write is a noop.
			fakeApprise.requests.length = 0;
			await triggerCronAndWaitForEntity(person.id);
			expect(
				fakeApprise.requests.filter(({ path }) => path === "/notify/dual-writer-monitor"),
			).toEqual([]);
		} finally {
			await cleanupBuiltinProviderScript(dwMovieProvider);
			await cleanupBuiltinProviderScript(dwPersonProvider);
		}
	});
});

describe("association lifecycle via cron refresh", () => {
	it("notifies only the newly added role on an update, not the already-known one", async () => {
		const ruMovieName = "Role Update Movie";
		const ruPersonName = "Role Update Person";
		const ruMovieSlug = `movie.role-update-e2e-${crypto.randomUUID()}`;
		const ruMovieExternalId = `role-update-movie-${crypto.randomUUID()}`;
		const ruPersonSlug = `person.role-update-e2e-${crypto.randomUUID()}`;
		const personSchemaId = await getBuiltinEntitySchemaId("person");
		const ruPersonExternalId = `role-update-person-${crypto.randomUUID()}`;

		const buildPersonSource = (roles: string[]) =>
			providerSandboxSource({
				slug: ruPersonSlug,
				name: ruPersonName,
				providerInformation: { source: "e2e" },
				drivers: {
					details: fakeProviderDetailsResult({
						name: ruPersonName,
						relatedEntityGroups: [
							{
								direction: "outgoing",
								synchronization: "authoritative",
								relationshipSchemaSlug: "person-to-movie",
								entities: [
									{
										name: ruMovieName,
										scriptSlug: ruMovieSlug,
										externalId: ruMovieExternalId,
										relationshipProperties: { roles },
									},
								],
							},
						],
					}),
				},
			});

		const { client } = await createAuthenticatedClient();
		const ruPersonProvider = await seedBuiltinProviderScript({
			client,
			slug: ruPersonSlug,
			linkToEntitySchemaId: personSchemaId,
			drivers: { details: fakeProviderDetailsResult({ name: ruPersonName }) },
		});
		const ruMovieProvider = await seedBuiltinProviderScript({
			client,
			slug: ruMovieSlug,
			linkToEntitySchemaId: movieSchemaId,
			drivers: {
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
									scriptSlug: ruPersonSlug,
									externalId: ruPersonExternalId,
									relationshipProperties: { roles: ["Actor"] },
								},
							],
						},
					],
				}),
			},
		});

		try {
			const person = await seedMediaEntity({
				properties: {},
				name: ruPersonName,
				externalId: ruPersonExternalId,
				entitySchemaId: personSchemaId,
				sandboxScriptId: ruPersonProvider.scriptId,
			});
			const movie = await seedMediaEntity({
				properties: {},
				name: ruMovieName,
				externalId: ruMovieExternalId,
				entitySchemaId: movieSchemaId,
				sandboxScriptId: ruMovieProvider.scriptId,
			});
			// Mark the person already-populated so its later cron-driven authoritative sync
			// below is a role update, not a first population — the carve-out would otherwise
			// silence it since the person is both the refresh root and the credited subject.
			await getBackendClient().run(
				(c) =>
					c.testSupport.setEntityPopulatedAt({
						path: { entityId: EntityId.make(person.id) },
						payload: { populatedAt: new Date().toISOString() },
					}),
				adminHeaders,
			);

			const personMonitor = await createAuthenticatedClient();
			await createNotificationChannel(personMonitor.client, {
				channel: "apprise",
				channelSpecifics: { baseUrl: fakeApprise.url, key: "role-update-monitor", kind: "apprise" },
			});
			await enableMediaMonitoring(personMonitor.client, person.id);
			await enableMediaMonitoring(personMonitor.client, movie.id);

			fakeApprise.requests.length = 0;
			await triggerCronAndWaitForEntity(movie.id);
			const baseline = await pollAssociationNotification("role-update-monitor");
			expect(baseline).toHaveLength(1);
			expect(requireObjectRecord(baseline[0]?.body, "Missing notification body").body).toBe(
				`${ruPersonName} has been associated with ${ruMovieName} as Actor`,
			);

			// The movie's additive incoming sync never touches an existing edge's properties
			// (it always preserves them), so the role addition must come from the person's own
			// authoritative outgoing sync instead of re-driving the movie's cron.
			fakeApprise.requests.length = 0;
			await replaceSandboxScriptCompiledRepresentation(
				client,
				ruPersonProvider.scriptId,
				buildPersonSource(["Actor", "Director"]),
			);
			await triggerCronAndWaitForEntity(person.id);
			const updated = await pollAssociationNotification("role-update-monitor");
			expect(updated).toHaveLength(1);
			expect(requireObjectRecord(updated[0]?.body, "Missing notification body").body).toBe(
				`${ruPersonName} has been associated with ${ruMovieName} as Director`,
			);
		} finally {
			await cleanupBuiltinProviderScript(ruMovieProvider);
			await cleanupBuiltinProviderScript(ruPersonProvider);
		}
	});

	it("silences a monitored person's own first population and a later delete, but permits a fresh notification after re-create", async () => {
		const drMovieName = "Delete Recreate Movie";
		const drPersonName = "Delete Recreate Person";
		const personSchemaId = await getBuiltinEntitySchemaId("person");
		const drMovieSlug = `movie.delete-recreate-e2e-${crypto.randomUUID()}`;
		const drMovieExternalId = `delete-recreate-movie-${crypto.randomUUID()}`;
		const drPersonSlug = `person.delete-recreate-e2e-${crypto.randomUUID()}`;
		const drPersonExternalId = `delete-recreate-person-${crypto.randomUUID()}`;

		const movieRelatedEntity = {
			name: drMovieName,
			scriptSlug: drMovieSlug,
			externalId: drMovieExternalId,
			relationshipProperties: { roles: ["Actor"] },
		};
		const buildPersonSource = (entities: ReadonlyArray<typeof movieRelatedEntity>) =>
			providerSandboxSource({
				slug: drPersonSlug,
				name: drPersonName,
				providerInformation: { source: "e2e" },
				drivers: {
					details: fakeProviderDetailsResult({
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
				},
			});

		const { client } = await createAuthenticatedClient();
		const drMovieProvider = await seedBuiltinProviderScript({
			client,
			slug: drMovieSlug,
			linkToEntitySchemaId: movieSchemaId,
			drivers: { details: fakeProviderDetailsResult({ name: drMovieName }) },
		});
		const drPersonProvider = await seedBuiltinProviderScript({
			client,
			slug: drPersonSlug,
			drivers: {
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
			},
		});

		try {
			const person = await seedMediaEntity({
				properties: {},
				name: drPersonName,
				externalId: drPersonExternalId,
				entitySchemaId: personSchemaId,
				sandboxScriptId: drPersonProvider.scriptId,
			});

			const personMonitor = await createAuthenticatedClient();
			await createNotificationChannel(personMonitor.client, {
				channel: "apprise",
				channelSpecifics: {
					kind: "apprise",
					baseUrl: fakeApprise.url,
					key: "delete-recreate-monitor",
				},
			});
			await enableMediaMonitoring(personMonitor.client, person.id);

			// First population of the monitored person is the credited subject's own root:
			// the carve-out silences it even though the edge is genuinely created.
			fakeApprise.requests.length = 0;
			await triggerCronAndWaitForEntity(person.id);
			expect(
				fakeApprise.requests.filter(({ path }) => path === "/notify/delete-recreate-monitor"),
			).toEqual([]);

			// An authoritative sync dropping the movie deletes the edge; deletes never notify.
			fakeApprise.requests.length = 0;
			await replaceSandboxScriptCompiledRepresentation(
				client,
				drPersonProvider.scriptId,
				buildPersonSource([]),
			);
			await triggerCronAndWaitForEntity(person.id);
			expect(
				fakeApprise.requests.filter(({ path }) => path === "/notify/delete-recreate-monitor"),
			).toEqual([]);

			// Re-adding the movie re-creates the edge. The root is no longer on its first
			// population, so the carve-out no longer applies and the fresh create notifies.
			fakeApprise.requests.length = 0;
			await replaceSandboxScriptCompiledRepresentation(
				client,
				drPersonProvider.scriptId,
				buildPersonSource([movieRelatedEntity]),
			);
			await triggerCronAndWaitForEntity(person.id);
			const recreated = await pollAssociationNotification("delete-recreate-monitor");
			expect(recreated).toHaveLength(1);
			expect(requireObjectRecord(recreated[0]?.body, "Missing notification body").body).toBe(
				`${drPersonName} has been associated with ${drMovieName} as Actor`,
			);
		} finally {
			await cleanupBuiltinProviderScript(drPersonProvider);
			await cleanupBuiltinProviderScript(drMovieProvider);
		}
	});
});
