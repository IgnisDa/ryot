import { UserLifecycleRequestResponse } from "@ryot-app/contract/modules/instance-admin/contract";
import { SignalSchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import { mediaPlugin } from "@ryot-app/media-plugin";
import { instanceAdminUsersRecipe } from "@ryot-app/ryotql-recipes/instance-admin";
import { pluginInstallationsRecipe } from "@ryot-app/ryotql-recipes/plugin-installations";
import { Effect, Schema } from "effect";

import {
	adminAccessTokenHeaders,
	adminHeaders,
	collectRyotQLRecipeItems,
	createApiKey,
	createAuthenticatedClient,
	createEntity,
	createEventFixture,
	createNotificationChannel,
	deleteUserAndWait,
	type DeleteUserOperation,
	enqueueProviderEntityImport,
	executeAdminRyotQLRecipe,
	fakeProviderDetailsResult,
	findBuiltinPluginByPackage,
	getApiClient,
	getAutomationRuleCount,
	getBuiltinEntitySchemaSlug,
	listAutomationRuns,
	listAutomationTriggerRecipients,
	listSignalTriggers,
	makeSession,
	pollProviderEntityImportResult,
	pollSignalTrigger,
	pollSignalTriggerWithRecipientCount,
	pollTerminalAutomationRuns,
	pollUserLifecycleOperation,
	populateRelatedThroughForegroundInterest,
	shippedPluginTestProviders,
	startFakeAppriseServerScoped,
	updatePluginState,
} from "~/fixtures/kernel";
import { findFitnessEntitySchema } from "~/fixtures/plugins/fitness";
import {
	enableMediaMonitoring,
	findMediaEntitySchema,
	seedMediaEntity,
} from "~/fixtures/plugins/media";
import { assertCompleted, assertTaggedError } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";
import { startIsolatedHarness } from "~/support/isolated-harness";
import { webRequest } from "~/support/web-request";

const WRONG_TOKEN = "wrong-token";

const listPluginsWithHeaders = (headers: Record<string, string>) =>
	collectRyotQLRecipeItems(makeSession(target, headers), (after) =>
		pluginInstallationsRecipe({ after, limit: 100 }),
	);

let harness: undefined | Effect.Success<ReturnType<typeof startIsolatedHarness>>;
let target: Effect.Success<ReturnType<typeof startIsolatedHarness>>["target"];
let media: Effect.Success<ReturnType<typeof shippedPluginTestProviders>>;

beforeAll(() =>
	runPromise(
		Effect.gen(function* () {
			harness = yield* startIsolatedHarness("Delete User");
			target = harness.target;
			media = yield* shippedPluginTestProviders(mediaPlugin.metadata.packageId, target);
		}),
	),
);

afterAll(() => runPromise(harness?.stop ?? Effect.void));

describe("Delete user admin token enforcement", () => {
	it.live("rejects deletion without an admin token", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				getApiClient(target).call((c) =>
					c.instanceAdmin.deleteUser({ params: { userId: UserId.make("any-id") } }),
				),
			);
			assertTaggedError(error, "AuthUnauthorized");
		}),
	);

	it.live("rejects deletion with an incorrect admin token", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				getApiClient(target).call(
					(c) => c.instanceAdmin.deleteUser({ params: { userId: UserId.make("any-id") } }),
					adminAccessTokenHeaders(WRONG_TOKEN),
				),
			);
			assertTaggedError(error, "AuthUnauthorized");
		}),
	);
});

describe("Delete user", () => {
	it.live("returns not found for an unknown user", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				getApiClient(target).adminCall((c) =>
					c.instanceAdmin.deleteUser({
						params: { userId: UserId.make(`missing-${crypto.randomUUID()}`) },
					}),
				),
			);
			assertTaggedError(error, "InstanceAdminNotFound");
			expect(error.reason.code).toBe("user-not-found");
		}),
	);

	it.live("deletes user data and invalidates existing credentials", () =>
		Effect.gen(function* () {
			const {
				email,
				token,
				sessionCookie,
				userId: rawUserId,
				client: userClient,
			} = yield* createAuthenticatedClient(target);
			const userId = UserId.make(rawUserId);
			const { client: observerClient } = yield* createAuthenticatedClient(target);
			const plugin = yield* findBuiltinPluginByPackage(userClient, {
				scope: "system",
				packageId: mediaPlugin.metadata.packageId,
			});
			yield* updatePluginState(userClient, plugin.installationId, {
				sortOrder: 41,
				isHidden: true,
			});
			const configuredPlugin = yield* findBuiltinPluginByPackage(userClient, {
				scope: "system",
				packageId: mediaPlugin.metadata.packageId,
			});
			expect(configuredPlugin).toMatchObject({ sortOrder: 41, isHidden: true });
			const apiKey = yield* createApiKey(sessionCookie, "E2E key", target.apiUrl);

			yield* listPluginsWithHeaders({ Authorization: `Bearer ${token}` });
			yield* listPluginsWithHeaders({ "X-Api-Key": apiKey });

			const acceptedResponse = yield* webRequest(
				`${target.apiUrl}/instance-admin/users/${userId}`,
				{ method: "DELETE", headers: adminHeaders(userClient) },
			);
			expect(acceptedResponse.status).toBe(202);
			const body = yield* Effect.promise(() => acceptedResponse.json());
			expect(body).toEqual({ operationId: expect.any(String) });
			const accepted: DeleteUserOperation = yield* Schema.decodeUnknownEffect(
				UserLifecycleRequestResponse,
			)(body);

			const revokedSession = yield* Effect.flip(
				listPluginsWithHeaders({ Authorization: `Bearer ${token}` }),
			);
			assertTaggedError(revokedSession, "AuthUnauthorized");

			const revokedApiKey = yield* Effect.flip(listPluginsWithHeaders({ "X-Api-Key": apiKey }));
			assertTaggedError(revokedApiKey, "AuthUnauthorized");

			const deleted = yield* pollUserLifecycleOperation(accepted.operationId, target);
			expect(deleted).toMatchObject({ userId, failure: null, kind: "delete", status: "completed" });

			const listed = yield* executeAdminRyotQLRecipe(
				instanceAdminUsersRecipe({ limit: 50, search: email }),
				target,
			);
			expect(listed.items).toHaveLength(0);

			const plugins = yield* collectRyotQLRecipeItems(observerClient, (after) =>
				pluginInstallationsRecipe({ after, limit: 100 }),
			);
			expect(plugins.some((candidate) => candidate.packageId === plugin.packageId)).toBe(true);
		}),
	);
});

describe("Delete user automation data cleanup", () => {
	it.live("removes a deleted user's private actor-audience signal and subscription run", () =>
		Effect.gen(function* () {
			const { userId: rawUserId, client: userClient } = yield* createAuthenticatedClient(target);
			const userId = UserId.make(rawUserId);
			const { schema } = yield* findFitnessEntitySchema(userClient, "workout");
			const workoutSignalSchema = {
				owner: schema.reference.owner,
				slug: SignalSchemaSlug.make("workout.created"),
			};
			const workoutName = `Delete User E2E Workout ${crypto.randomUUID()}`;
			const workout = yield* createEntity(userClient, {
				name: workoutName,
				entitySchema: schema.reference,
				properties: { endedAt: "2026-07-21T11:00:00Z", startedAt: "2026-07-21T10:00:00Z" },
			});
			yield* createEventFixture(userClient, {
				entityId: workout.id,
				properties: { workoutName },
				eventSchemaSlug: "workout-completed",
			});

			const { id: triggerId } = yield* pollSignalTrigger(
				{ actorUserId: userId, signalSchema: workoutSignalSchema },
				target,
			);
			yield* pollTerminalAutomationRuns({ triggerId, executionUserId: userId }, target);

			yield* deleteUserAndWait(userId, target);

			expect(
				yield* listSignalTriggers(
					{ actorUserId: userId, signalSchema: workoutSignalSchema },
					target,
				),
			).toEqual([]);
			expect(yield* listAutomationRuns({ triggerId, executionUserId: userId }, target)).toEqual([]);
		}),
	);

	it.live(
		"removes only the deleted recipient's row from a shared signal, preserving it for other recipients",
		() =>
			Effect.gen(function* () {
				const movieName = "Delete User E2E Movie";
				const personName = "Delete User E2E Person";
				const movieExternalId = `delete-user-movie-${crypto.randomUUID()}`;
				const personExternalId = `delete-user-person-${crypto.randomUUID()}`;

				const { client: compilerClient } = yield* createAuthenticatedClient(target);
				const { schema: personSchema } = yield* findMediaEntitySchema(compilerClient, "person");
				const { schema: movieSchema } = yield* findMediaEntitySchema(compilerClient, "movie");
				const personSchemaId = yield* getBuiltinEntitySchemaSlug(
					compilerClient,
					"person",
					personSchema.reference.owner,
				);
				const movieSchemaId = yield* getBuiltinEntitySchemaSlug(
					compilerClient,
					"movie",
					movieSchema.reference.owner,
				);
				const personProvider = yield* media.attachProvider({
					rootEntitySchemaSlug: personSchemaId,
					slug: `person.delete-user-e2e-${crypto.randomUUID()}`,
					details: fakeProviderDetailsResult({ name: personName }),
				});
				const movieProvider = yield* media.attachProvider({
					rootEntitySchemaSlug: movieSchemaId,
					slug: `movie.delete-user-e2e-${crypto.randomUUID()}`,
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
										providerSlug: personProvider.providerSlug,
										relationshipProperties: { roles: ["Actor"] },
									},
								],
							},
						],
					}),
				});

				const person = yield* seedMediaEntity({
					target,
					properties: {},
					name: personName,
					externalId: personExternalId,
					entitySchemaSlug: personSchemaId,
					providerId: personProvider.providerId,
				});

				const fakeApprise = yield* startFakeAppriseServerScoped;
				const firstMonitor = yield* createAuthenticatedClient(target);
				const secondMonitor = yield* createAuthenticatedClient(target);
				const importer = yield* createAuthenticatedClient(target);
				yield* Effect.all([
					createNotificationChannel(firstMonitor.client, {
						channelSpecifics: { key: "first", kind: "apprise", baseUrl: fakeApprise.url },
					}),
					createNotificationChannel(secondMonitor.client, {
						channelSpecifics: { key: "second", kind: "apprise", baseUrl: fakeApprise.url },
					}),
				]);
				yield* Effect.all([
					enableMediaMonitoring(firstMonitor.client, person.id),
					enableMediaMonitoring(secondMonitor.client, person.id),
				]);

				const { jobId } = yield* enqueueProviderEntityImport(importer.client, {
					externalId: movieExternalId,
					providerId: movieProvider.providerId,
				});
				const imported = yield* pollProviderEntityImportResult(importer.client, jobId);
				assertCompleted(imported, "delete-user shared association import");
				yield* populateRelatedThroughForegroundInterest(importer, imported.data.id);

				const { id: triggerId } = yield* pollSignalTriggerWithRecipientCount(
					{
						actorUserId: null,
						subjectEntityId: person.id,
						signalSchema: {
							owner: personSchema.reference.owner,
							slug: SignalSchemaSlug.make("person.media.associated"),
						},
					},
					2,
					target,
				);
				yield* Effect.all([
					pollTerminalAutomationRuns(
						{ triggerId, executionUserId: UserId.make(firstMonitor.userId) },
						target,
					),
					pollTerminalAutomationRuns(
						{ triggerId, executionUserId: UserId.make(secondMonitor.userId) },
						target,
					),
				]);
				const rulesBeforeDeletion = yield* getAutomationRuleCount(secondMonitor.userId, target);
				expect(rulesBeforeDeletion).toBeGreaterThan(0);

				yield* deleteUserAndWait(UserId.make(firstMonitor.userId), target);

				const [remainingTrigger] = yield* listSignalTriggers(
					{
						actorUserId: null,
						subjectEntityId: person.id,
						signalSchema: {
							owner: personSchema.reference.owner,
							slug: SignalSchemaSlug.make("person.media.associated"),
						},
					},
					target,
				);
				expect(remainingTrigger?.id).toBe(triggerId);
				expect(yield* listAutomationTriggerRecipients({ triggerId }, target)).toEqual([
					{ triggerId, userId: UserId.make(secondMonitor.userId) },
				]);
				expect(
					yield* listAutomationRuns(
						{ triggerId, executionUserId: UserId.make(firstMonitor.userId) },
						target,
					),
				).toEqual([]);
				expect(
					yield* listAutomationRuns(
						{ triggerId, executionUserId: UserId.make(secondMonitor.userId) },
						target,
					),
				).not.toEqual([]);
				expect(yield* getAutomationRuleCount(firstMonitor.userId, target)).toBe(0);
				expect(yield* getAutomationRuleCount(secondMonitor.userId, target)).toBe(
					rulesBeforeDeletion,
				);
			}),
	);
});
