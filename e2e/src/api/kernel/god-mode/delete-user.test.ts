import { UserLifecycleRequestResponse } from "@ryot-app/contract/modules/god-mode/contract";
import { SignalSchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import { godModeUsersRecipe } from "@ryot-app/ryotql-recipes/god-mode";
import { pluginInstallationsRecipe } from "@ryot-app/ryotql-recipes/plugin-installations";
import { Effect, Schema } from "effect";

import {
	type DeleteUserOperation,
	adminAccessTokenHeaders,
	adminHeaders,
	collectRyotQLRecipeItems,
	uninstallTestProvider,
	createAuthenticatedClient,
	createApiKey,
	createEntity,
	createNotificationChannel,
	deleteUserAndWait,
	enqueueProviderEntityImport,
	executeAdminRyotQLRecipe,
	fakeProviderDetailsResult,
	findBuiltinSchemaBySlug,
	findBuiltinPluginBySlug,
	getAutomationRuleCount,
	getApiClient,
	getBuiltinEntitySchemaSlug,
	listSignalTriggers,
	listAutomationRuns,
	listAutomationTriggerRecipients,
	makeSession,
	pollProviderEntityImportResult,
	pollSignalTrigger,
	pollSignalTriggerWithRecipientCount,
	pollUserLifecycleOperation,
	pollTerminalAutomationRuns,
	installTestProvider,
	startFakeAppriseServerScoped,
	updatePluginState,
} from "~/fixtures/kernel";
import { enableMediaMonitoring, seedMediaEntity } from "~/fixtures/plugins/media";
import { assertCompleted, assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { getApiUrl } from "~/support/harness-target";

const WRONG_TOKEN = "wrong-token";

const listPluginsWithHeaders = (headers: Record<string, string>) =>
	collectRyotQLRecipeItems(makeSession(undefined, headers), (after) =>
		pluginInstallationsRecipe({ after, limit: 100 }),
	);

describe("Delete user admin token enforcement", () => {
	it.live("rejects deletion without an admin token", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				getApiClient().call((c) =>
					c.godMode.deleteUser({ params: { userId: UserId.make("any-id") } }),
				),
			);
			assertTaggedError(error, "AuthUnauthorized");
		}),
	);

	it.live("rejects deletion with an incorrect admin token", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				getApiClient().call(
					(c) => c.godMode.deleteUser({ params: { userId: UserId.make("any-id") } }),
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
				getApiClient().call(
					(c) =>
						c.godMode.deleteUser({
							params: { userId: UserId.make(`missing-${crypto.randomUUID()}`) },
						}),
					adminHeaders(),
				),
			);
			assertTaggedError(error, "GodModeNotFound");
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
			} = yield* createAuthenticatedClient();
			const userId = UserId.make(rawUserId);
			const { client: observerClient } = yield* createAuthenticatedClient();
			const plugin = yield* findBuiltinPluginBySlug(userClient, "media");
			yield* updatePluginState(userClient, plugin.slug, { sortOrder: 41, isDisabled: true });
			const configuredPlugin = yield* findBuiltinPluginBySlug(userClient, "media");
			expect(configuredPlugin).toMatchObject({ sortOrder: 41, isDisabled: true });
			const apiKey = yield* createApiKey(sessionCookie);

			yield* listPluginsWithHeaders({ Authorization: `Bearer ${token}` });
			yield* listPluginsWithHeaders({ "X-Api-Key": apiKey });

			const acceptedResponse = yield* Effect.promise(() =>
				fetch(`${getApiUrl()}/god-mode/users/${userId}`, {
					method: "DELETE",
					headers: adminHeaders(),
				}),
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

			const deleted = yield* pollUserLifecycleOperation(accepted.operationId);
			expect(deleted).toMatchObject({ userId, failure: null, kind: "delete", status: "completed" });

			const listed = yield* executeAdminRyotQLRecipe(
				godModeUsersRecipe({ limit: 50, search: email }),
			);
			expect(listed.items).toHaveLength(0);

			const plugins = yield* collectRyotQLRecipeItems(observerClient, (after) =>
				pluginInstallationsRecipe({ after, limit: 100 }),
			);
			expect(plugins.some((candidate) => candidate.slug === plugin.slug)).toBe(true);
		}),
	);
});

describe("Delete user automation data cleanup", () => {
	it.live("removes a deleted user's private actor-audience signal and subscription run", () =>
		Effect.gen(function* () {
			const { userId: rawUserId, client: userClient } = yield* createAuthenticatedClient();
			const userId = UserId.make(rawUserId);
			const { schema } = yield* findBuiltinSchemaBySlug(userClient, "workout");
			const workoutName = `Delete User E2E Workout ${crypto.randomUUID()}`;
			yield* createEntity(userClient, {
				name: workoutName,
				entitySchemaSlug: schema.id,
				properties: { endedAt: "2026-07-21T11:00:00Z", startedAt: "2026-07-21T10:00:00Z" },
			});

			const { id: triggerId } = yield* pollSignalTrigger({
				actorUserId: userId,
				signalSchemaSlug: SignalSchemaSlug.make("workout.created"),
			});
			yield* pollTerminalAutomationRuns({ triggerId, executionUserId: userId });

			yield* deleteUserAndWait(userId);

			expect(
				yield* listSignalTriggers({
					actorUserId: userId,
					signalSchemaSlug: SignalSchemaSlug.make("workout.created"),
				}),
			).toEqual([]);
			expect(yield* listAutomationRuns({ triggerId, executionUserId: userId })).toEqual([]);
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

				const { client: compilerClient } = yield* createAuthenticatedClient();
				const personSchemaId = yield* getBuiltinEntitySchemaSlug(compilerClient, "person");
				const movieSchemaId = yield* getBuiltinEntitySchemaSlug(compilerClient, "movie");
				const personProvider = yield* Effect.acquireRelease(
					installTestProvider({
						scope: "system",
						client: compilerClient,
						rootEntitySchemaSlug: personSchemaId,
						slug: `person.delete-user-e2e-${crypto.randomUUID()}`,
						details: fakeProviderDetailsResult({ name: personName }),
					}),
					(provider) => uninstallTestProvider(provider),
				);
				const movieProvider = yield* Effect.acquireRelease(
					installTestProvider({
						scope: "system",
						client: compilerClient,
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
					}),
					(provider) => uninstallTestProvider(provider),
				);

				const person = yield* seedMediaEntity({
					properties: {},
					name: personName,
					externalId: personExternalId,
					entitySchemaSlug: personSchemaId,
					providerId: personProvider.providerId,
				});

				const fakeApprise = yield* startFakeAppriseServerScoped;
				const firstMonitor = yield* createAuthenticatedClient();
				const secondMonitor = yield* createAuthenticatedClient();
				const importer = yield* createAuthenticatedClient();
				yield* Effect.all([
					createNotificationChannel(firstMonitor.client, {
						channel: "apprise",
						channelSpecifics: { key: "first", kind: "apprise", baseUrl: fakeApprise.url },
					}),
					createNotificationChannel(secondMonitor.client, {
						channel: "apprise",
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

				const { id: triggerId } = yield* pollSignalTriggerWithRecipientCount(
					{
						subjectEntityId: person.id,
						signalSchemaSlug: SignalSchemaSlug.make("person.media.associated"),
					},
					2,
				);
				yield* Effect.all([
					pollTerminalAutomationRuns({
						triggerId,
						executionUserId: UserId.make(firstMonitor.userId),
					}),
					pollTerminalAutomationRuns({
						triggerId,
						executionUserId: UserId.make(secondMonitor.userId),
					}),
				]);
				const rulesBeforeDeletion = yield* getAutomationRuleCount(secondMonitor.userId);
				expect(rulesBeforeDeletion).toBeGreaterThan(0);

				yield* deleteUserAndWait(UserId.make(firstMonitor.userId));

				const [remainingTrigger] = yield* listSignalTriggers({
					subjectEntityId: person.id,
					signalSchemaSlug: SignalSchemaSlug.make("person.media.associated"),
				});
				expect(remainingTrigger?.id).toBe(triggerId);
				expect(yield* listAutomationTriggerRecipients({ triggerId })).toEqual([
					{ triggerId, userId: UserId.make(secondMonitor.userId) },
				]);
				expect(
					yield* listAutomationRuns({
						triggerId,
						executionUserId: UserId.make(firstMonitor.userId),
					}),
				).toEqual([]);
				expect(
					yield* listAutomationRuns({
						triggerId,
						executionUserId: UserId.make(secondMonitor.userId),
					}),
				).not.toEqual([]);
				expect(yield* getAutomationRuleCount(firstMonitor.userId)).toBe(0);
				expect(yield* getAutomationRuleCount(secondMonitor.userId)).toBe(rulesBeforeDeletion);
			}),
	);
});
