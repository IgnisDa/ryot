import { describe, expect, it } from "bun:test";

import { EntitySchemaId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";

import {
	ADMIN_TOKEN,
	adminAccessTokenHeaders,
	cleanupBuiltinProviderScript,
	createEntity,
	createNotificationChannel,
	enableMediaMonitoring,
	enqueueEntityImport,
	fakeProviderDetailsResult,
	findBuiltinSchemaBySlug,
	getBackendClient,
	getBuiltinEntitySchemaId,
	listSubscriptionRuns,
	listSignals,
	pollEntityImportResult,
	pollSignal,
	pollSignalWithRecipientCount,
	pollTerminalSubscriptionRuns,
	getAutomationRuleCount,
	seedBuiltinProviderScript,
	seedMediaEntity,
	startFakeAppriseServer,
} from "~/fixtures";
import { createAuthenticatedClient } from "~/fixtures/auth";
import { createTracker } from "~/fixtures/trackers";
import { getBackendUrl, getPgClient } from "~/setup";
import { assertCompleted, assertTaggedError } from "~/support/assertions";

const WRONG_TOKEN = "wrong-token";
const trackersListQuery = { includeDisabled: false };

async function createApiKey(cookies: string) {
	const response = await fetch(`${getBackendUrl()}/auth/api-key/create`, {
		method: "POST",
		body: JSON.stringify({ name: "Delete user e2e key" }),
		headers: { Cookie: cookies, "Content-Type": "application/json" },
	});
	if (!response.ok) {
		throw new Error(`API key creation failed: ${await response.text()}`);
	}
	const data: { key: string } = await response.json();
	return data.key;
}

describe("Delete user admin token enforcement", () => {
	it("rejects deletion without an admin token", async () => {
		const error = await getBackendClient().runError((c) =>
			c.godMode.deleteUser({ path: { userId: UserId.make("any-id") } }),
		);
		assertTaggedError(error, "Unauthorized");
	});

	it("rejects deletion with an incorrect admin token", async () => {
		const error = await getBackendClient().runError(
			(c) => c.godMode.deleteUser({ path: { userId: UserId.make("any-id") } }),
			adminAccessTokenHeaders(WRONG_TOKEN),
		);
		assertTaggedError(error, "Unauthorized");
	});
});

describe("Delete user", () => {
	it("returns not found for an unknown user", async () => {
		const error = await getBackendClient().runError(
			(c) =>
				c.godMode.deleteUser({ path: { userId: UserId.make(`missing-${crypto.randomUUID()}`) } }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		assertTaggedError(error, "NotFound");
	});

	it("deletes user data and invalidates existing credentials", async () => {
		const client = getBackendClient();
		const {
			email,
			cookies,
			userId: rawUserId,
			client: userClient,
		} = await createAuthenticatedClient();
		const userId = UserId.make(rawUserId);
		const { tracker } = await createTracker(userClient, { name: "Delete user tracker" });
		const apiKey = await createApiKey(cookies);

		await client.run((c) => c.trackers.list({ urlParams: trackersListQuery }), {
			Cookie: cookies,
		});
		await client.run((c) => c.trackers.list({ urlParams: trackersListQuery }), {
			"X-Api-Key": apiKey,
		});

		const deleted = await client.run(
			(c) => c.godMode.deleteUser({ path: { userId } }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		expect(deleted.id).toBe(userId);

		const listed = await client.run(
			(c) =>
				c.godMode.listUsers({
					urlParams: { limit: 50, offset: 0, search: email },
				}),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		expect(listed.users).toHaveLength(0);

		const trackerRows = await getPgClient().query<{ id: string }>(
			`SELECT id FROM "tracker" WHERE id = $1`,
			[tracker.id],
		);
		expect(trackerRows.rowCount).toBe(0);

		const revokedSession = await client.runError(
			(c) => c.trackers.list({ urlParams: trackersListQuery }),
			{ Cookie: cookies },
		);
		assertTaggedError(revokedSession, "Unauthorized");

		const revokedApiKey = await client.runError(
			(c) => c.trackers.list({ urlParams: trackersListQuery }),
			{ "X-Api-Key": apiKey },
		);
		assertTaggedError(revokedApiKey, "Unauthorized");
	});
});

describe("Delete user automation data cleanup", () => {
	it("removes a deleted user's private actor-audience signal and subscription run", async () => {
		const client = getBackendClient();
		const { userId: rawUserId, client: userClient } = await createAuthenticatedClient();
		const userId = UserId.make(rawUserId);
		const { schema } = await findBuiltinSchemaBySlug(userClient, "workout");
		const workoutName = `Delete User E2E Workout ${crypto.randomUUID()}`;
		await createEntity(userClient, {
			name: workoutName,
			entitySchemaId: schema.id,
			properties: { endedAt: "2026-07-21T11:00:00Z", startedAt: "2026-07-21T10:00:00Z" },
		});

		const { id: signalId } = await pollSignal({
			actorUserId: rawUserId,
			schemaSlug: "workout.created",
		});
		await pollTerminalSubscriptionRuns({ executionUserId: rawUserId, signalId });

		await client.run(
			(c) => c.godMode.deleteUser({ path: { userId } }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);

		expect(await listSignals({ schemaSlug: "workout.created", actorUserId: rawUserId })).toEqual(
			[],
		);
		expect(await listSubscriptionRuns({ executionUserId: rawUserId, signalId })).toEqual([]);
	});

	it("removes only the deleted recipient's row from a shared signal, preserving it for other recipients", async () => {
		const movieName = "Delete User E2E Movie";
		const personName = "Delete User E2E Person";
		const movieExternalId = `delete-user-movie-${crypto.randomUUID()}`;
		const personExternalId = `delete-user-person-${crypto.randomUUID()}`;

		const { client: compilerClient } = await createAuthenticatedClient();
		const personSchemaId = await getBuiltinEntitySchemaId("person");
		const movieSchemaId = await getBuiltinEntitySchemaId("movie");
		const personProvider = await seedBuiltinProviderScript({
			client: compilerClient,
			linkToEntitySchemaId: personSchemaId,
			slug: `person.delete-user-e2e-${crypto.randomUUID()}`,
			drivers: { details: fakeProviderDetailsResult({ name: personName }) },
		});
		const movieProvider = await seedBuiltinProviderScript({
			client: compilerClient,
			slug: `movie.delete-user-e2e-${crypto.randomUUID()}`,
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
									externalId: personExternalId,
									scriptSlug: personProvider.slug,
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
				name: personName,
				externalId: personExternalId,
				entitySchemaId: personSchemaId,
				sandboxScriptId: personProvider.scriptId,
			});

			const fakeApprise = await startFakeAppriseServer();
			try {
				const firstMonitor = await createAuthenticatedClient();
				const secondMonitor = await createAuthenticatedClient();
				const importer = await createAuthenticatedClient();
				await Promise.all([
					createNotificationChannel(firstMonitor.client, {
						channel: "apprise",
						channelSpecifics: { baseUrl: fakeApprise.url, key: "first", kind: "apprise" },
					}),
					createNotificationChannel(secondMonitor.client, {
						channel: "apprise",
						channelSpecifics: { baseUrl: fakeApprise.url, key: "second", kind: "apprise" },
					}),
				]);
				await Promise.all([
					enableMediaMonitoring(firstMonitor.client, person.id),
					enableMediaMonitoring(secondMonitor.client, person.id),
				]);

				const { jobId } = await enqueueEntityImport(importer.client, {
					externalId: movieExternalId,
					entitySchemaId: EntitySchemaId.make(movieSchemaId),
					scriptId: SandboxScriptId.make(movieProvider.scriptId),
				});
				const imported = await pollEntityImportResult(importer.client, jobId, {
					timeoutMs: 30_000,
				});
				assertCompleted(imported, "delete-user shared association import");

				const { id: signalId } = await pollSignalWithRecipientCount(
					{ schemaSlug: "person.media.associated", subjectEntityId: person.id },
					2,
				);
				await Promise.all([
					pollTerminalSubscriptionRuns({
						signalId,
						executionUserId: firstMonitor.userId,
					}),
					pollTerminalSubscriptionRuns({
						signalId,
						executionUserId: secondMonitor.userId,
					}),
				]);
				const rulesBeforeDeletion = await getAutomationRuleCount(secondMonitor.userId);
				expect(rulesBeforeDeletion).toBeGreaterThan(0);

				await getBackendClient().run(
					(c) => c.godMode.deleteUser({ path: { userId: UserId.make(firstMonitor.userId) } }),
					adminAccessTokenHeaders(ADMIN_TOKEN),
				);

				const [remainingSignal] = await listSignals({
					subjectEntityId: person.id,
					schemaSlug: "person.media.associated",
				});
				expect(remainingSignal?.id).toBe(signalId);
				expect(remainingSignal?.recipientUserIds).toEqual([UserId.make(secondMonitor.userId)]);
				expect(
					await listSubscriptionRuns({ signalId, executionUserId: firstMonitor.userId }),
				).toEqual([]);
				expect(
					await listSubscriptionRuns({ signalId, executionUserId: secondMonitor.userId }),
				).not.toEqual([]);
				expect(await getAutomationRuleCount(firstMonitor.userId)).toBe(0);
				expect(await getAutomationRuleCount(secondMonitor.userId)).toBe(rulesBeforeDeletion);
			} finally {
				fakeApprise.stop();
			}
		} finally {
			await cleanupBuiltinProviderScript(movieProvider);
			await cleanupBuiltinProviderScript(personProvider);
		}
	});
});
