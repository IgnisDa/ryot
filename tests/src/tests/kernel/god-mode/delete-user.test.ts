import { UserLifecycleOperation as UserLifecycleOperationSchema } from "@ryot/contract/modules/god-mode/user-lifecycle";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect, Schema } from "effect";

import {
	ADMIN_TOKEN,
	type DeleteUserOperation,
	adminAccessTokenHeaders,
	uninstallTestProvider,
	createAuthenticatedClient,
	createApiKey,
	createEntity,
	createNotificationChannel,
	deleteUserAndWait,
	enableMediaMonitoring,
	enqueueProviderEntityImport,
	fakeProviderDetailsResult,
	findBuiltinSchemaBySlug,
	findBuiltinPluginBySlug,
	getAutomationRuleCount,
	getBackendClient,
	getBuiltinEntitySchemaSlug,
	listSignals,
	listSubscriptionRuns,
	pollProviderEntityImportResult,
	pollSignal,
	pollSignalWithRecipientCount,
	pollUserLifecycleOperation,
	pollTerminalSubscriptionRuns,
	installTestProvider,
	seedMediaEntity,
	startFakeAppriseServerScoped,
	updatePluginState,
} from "~/fixtures";
import { assertCompleted, assertTaggedError } from "~/support/assertions";
import { getBackendUrl } from "~/support/backend";
import { describe, expect, it } from "~/support/effect-test";

const WRONG_TOKEN = "wrong-token";
const pluginListQuery = { includeDisabled: false };

describe("Delete user admin token enforcement", () => {
	it.live("rejects deletion without an admin token", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				getBackendClient().call((c) =>
					c.godMode.deleteUser({ params: { userId: UserId.make("any-id") } }),
				),
			);
			assertTaggedError(error, "AuthUnauthorized");
		}),
	);

	it.live("rejects deletion with an incorrect admin token", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				getBackendClient().call(
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
				getBackendClient().call(
					(c) =>
						c.godMode.deleteUser({
							params: { userId: UserId.make(`missing-${crypto.randomUUID()}`) },
						}),
					adminAccessTokenHeaders(ADMIN_TOKEN),
				),
			);
			assertTaggedError(error, "GodModeNotFound");
			expect(error.reason.code).toBe("user-not-found");
		}),
	);

	it.live("deletes user data and invalidates existing credentials", () =>
		Effect.gen(function* () {
			const client = getBackendClient();
			const {
				email,
				cookies,
				userId: rawUserId,
				client: userClient,
			} = yield* createAuthenticatedClient();
			const userId = UserId.make(rawUserId);
			const { client: observerClient } = yield* createAuthenticatedClient();
			const plugin = yield* findBuiltinPluginBySlug(userClient, "media");
			const configuredPlugin = yield* updatePluginState(userClient, plugin.slug, {
				sortOrder: 41,
				isDisabled: true,
			});
			expect(configuredPlugin).toMatchObject({ isDisabled: true, sortOrder: 41 });
			const apiKey = yield* createApiKey(cookies);

			yield* client.call((c) => c.definitions.listPlugins({ query: pluginListQuery }), {
				Cookie: cookies,
			});
			yield* client.call((c) => c.definitions.listPlugins({ query: pluginListQuery }), {
				"X-Api-Key": apiKey,
			});

			const acceptedResponse = yield* Effect.promise(() =>
				fetch(`${getBackendUrl()}/god-mode/users/${userId}`, {
					method: "DELETE",
					headers: adminAccessTokenHeaders(ADMIN_TOKEN),
				}),
			);
			expect(acceptedResponse.status).toBe(202);
			const accepted: DeleteUserOperation = yield* Schema.decodeUnknownEffect(
				UserLifecycleOperationSchema,
			)(yield* Effect.promise(() => acceptedResponse.json()));
			expect(accepted).toMatchObject({ kind: "delete", userId });

			const revokedSession = yield* Effect.flip(
				client.call((c) => c.definitions.listPlugins({ query: pluginListQuery }), {
					Cookie: cookies,
				}),
			);
			assertTaggedError(revokedSession, "AuthUnauthorized");

			const revokedApiKey = yield* Effect.flip(
				client.call((c) => c.definitions.listPlugins({ query: pluginListQuery }), {
					"X-Api-Key": apiKey,
				}),
			);
			assertTaggedError(revokedApiKey, "AuthUnauthorized");

			const deleted = yield* pollUserLifecycleOperation(accepted.id);
			expect(deleted).toMatchObject({ userId, failure: null, kind: "delete", status: "completed" });

			const listed = yield* client.call(
				(c) => c.godMode.listUsers({ query: { limit: 50, offset: 0, search: email } }),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);
			expect(listed.users).toHaveLength(0);

			const plugins = yield* observerClient.call((c) =>
				c.definitions.listPlugins({ query: { includeDisabled: true } }),
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

			const { id: signalId } = yield* pollSignal({
				actorUserId: rawUserId,
				schemaSlug: "workout.created",
			});
			yield* pollTerminalSubscriptionRuns({ executionUserId: rawUserId, signalId });

			yield* deleteUserAndWait(userId);

			expect(yield* listSignals({ schemaSlug: "workout.created", actorUserId: rawUserId })).toEqual(
				[],
			);
			expect(yield* listSubscriptionRuns({ executionUserId: rawUserId, signalId })).toEqual([]);
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
				const personSchemaId = yield* getBuiltinEntitySchemaSlug("person");
				const movieSchemaId = yield* getBuiltinEntitySchemaSlug("movie");
				const personProvider = yield* Effect.acquireRelease(
					installTestProvider({
						client: compilerClient,
						scope: "system",
						rootEntitySchemaSlug: personSchemaId,
						slug: `person.delete-user-e2e-${crypto.randomUUID()}`,
						details: fakeProviderDetailsResult({ name: personName }),
					}),
					(provider) => uninstallTestProvider(provider),
				);
				const movieProvider = yield* Effect.acquireRelease(
					installTestProvider({
						client: compilerClient,
						scope: "system",
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
						channelSpecifics: { baseUrl: fakeApprise.url, key: "first", kind: "apprise" },
					}),
					createNotificationChannel(secondMonitor.client, {
						channel: "apprise",
						channelSpecifics: { baseUrl: fakeApprise.url, key: "second", kind: "apprise" },
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

				const { id: signalId } = yield* pollSignalWithRecipientCount(
					{ schemaSlug: "person.media.associated", subjectEntityId: person.id },
					2,
				);
				yield* Effect.all([
					pollTerminalSubscriptionRuns({ signalId, executionUserId: firstMonitor.userId }),
					pollTerminalSubscriptionRuns({ signalId, executionUserId: secondMonitor.userId }),
				]);
				const rulesBeforeDeletion = yield* getAutomationRuleCount(secondMonitor.userId);
				expect(rulesBeforeDeletion).toBeGreaterThan(0);

				yield* deleteUserAndWait(UserId.make(firstMonitor.userId));

				const [remainingSignal] = yield* listSignals({
					subjectEntityId: person.id,
					schemaSlug: "person.media.associated",
				});
				expect(remainingSignal?.id).toBe(signalId);
				expect(remainingSignal?.recipientUserIds).toEqual([UserId.make(secondMonitor.userId)]);
				expect(
					yield* listSubscriptionRuns({ signalId, executionUserId: firstMonitor.userId }),
				).toEqual([]);
				expect(
					yield* listSubscriptionRuns({ signalId, executionUserId: secondMonitor.userId }),
				).not.toEqual([]);
				expect(yield* getAutomationRuleCount(firstMonitor.userId)).toBe(0);
				expect(yield* getAutomationRuleCount(secondMonitor.userId)).toBe(rulesBeforeDeletion);
			}),
	);
});
