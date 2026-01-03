import { afterAll, beforeAll, expect, it } from "bun:test";

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
