import {
	AutomationHookSlug,
	EntityId,
	SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { entitySchemaRecordSchema } from "@ryot-app/plugin-backend-sdk/core";
import { jsonValueSchema } from "@ryot-app/plugin-backend-sdk/wire";
import { entityDefinitionsRecipe } from "@ryot-app/ryotql-recipes/definitions";
import { Deferred, Effect, Schema } from "effect";

import {
	createAuthenticatedClient,
	enqueueSandboxScript,
	executeRyotQLRecipe,
	getApiClient,
	installNamespacePackage,
	installTestSupportSystemPlugin,
	invokeNamespaceOperation,
	listAdminSandboxScripts,
	listAutomationRuns,
	listEventsForEntity,
	namespaceBottlesRecipe,
	namespaceInstallation,
	pluginNamespacePackages,
	pollSandboxResult,
	pollSignalTrigger,
	pollTerminalAutomationRunAttempts,
	pollTerminalAutomationRuns,
	requireCompletedSandboxValue,
	updateNamespacePackage,
	updateTestSupportSystemPlugin,
} from "~/fixtures/kernel";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { startFakeHttpServerScoped } from "~/support/fake-http-server";

describe("plugin revision scopes", () => {
	it.live(
		"retries an eligible failed hook using its retained revision and config after an additive update",
		() =>
			Effect.gen(function* () {
				const { client, userId } = yield* createAuthenticatedClient();
				let ready = false;
				const upstream = yield* startFakeHttpServerScoped(
					() => new Response(ready ? "ok" : "retry", { status: ready ? 200 : 503 }),
				);
				const packages = pluginNamespacePackages();
				const a = yield* installNamespacePackage(client, packages.a, {
					retryGateUrl: `${upstream.url}/before`,
				});
				const bottle = requirePresent(
					(yield* executeRyotQLRecipe(
						client,
						namespaceBottlesRecipe({ reference: { kind: "local", pluginId: a.pluginId } }),
					))[0],
					"A bottle missing",
				);
				yield* invokeNamespaceOperation(client, a.installation.packageId, {
					entityId: bottle.id,
					action: "create-event",
				});
				const event = requirePresent(
					(yield* listEventsForEntity(client, bottle.id, undefined, 100))[0],
					"A event missing",
				);
				const original = requirePresent(
					(yield* pollTerminalAutomationRuns({
						hookSlug: AutomationHookSlug.make("after"),
						sourceRecord: { id: event.id, resource: "event" },
					}))[0],
					"Failed hook missing",
				);
				expect(original).toMatchObject({
					attemptCount: 1,
					status: "failed",
					pluginId: a.pluginId,
					pluginRevisionId: a.installation.activeRevisionId,
				});
				yield* updateNamespacePackage(client, a, packages.a2, {
					retryGateUrl: `${upstream.url}/after`,
				});
				ready = true;
				const retried = yield* client.call((contract) =>
					contract.automationHistory.retryRun({
						params: { runId: original.id },
						payload: { expectedAttemptCount: original.attemptCount },
					}),
				);
				expect(retried).toMatchObject({ attemptNumber: 2, runId: original.id });
				const attempts = yield* pollTerminalAutomationRunAttempts({ runId: original.id }, 2);
				expect(attempts.map(({ status }) => status)).toEqual(["failed", "succeeded"]);
				const retained = requirePresent(
					(yield* listAutomationRuns({
						triggerId: original.triggerId,
						hookSlug: AutomationHookSlug.make("after"),
					}))[0],
					"Retained hook missing",
				);
				expect(retained).toMatchObject({
					attemptCount: 2,
					status: "succeeded",
					sandboxScriptId: original.sandboxScriptId,
					pluginRevisionId: original.pluginRevisionId,
					pluginConfigRevisionId: original.pluginConfigRevisionId,
				});
				const signal = yield* pollSignalTrigger({
					actorUserId: UserId.make(userId),
					subjectEntityId: EntityId.make(bottle.id),
					signalSchema: {
						slug: SignalSchemaSlug.make("tasted"),
						owner: { kind: "plugin", pluginId: a.pluginId },
					},
				});
				expect(signal.payload.properties).toEqual({ label: "A1" });
				expect(upstream.requests.map(({ path }) => path)).toEqual(["/before", "/before"]);
			}),
	);
	it.live(
		"lets an admitted old writer finish after an additive update with its exact script and definitions",
		() =>
			Effect.gen(function* () {
				const { client, userId } = yield* createAuthenticatedClient();
				const packages = pluginNamespacePackages();
				const a = yield* installNamespacePackage(client, packages.a, { writerMarker: "before" });
				const bottle = requirePresent(
					(yield* executeRyotQLRecipe(
						client,
						namespaceBottlesRecipe({ reference: { kind: "local", pluginId: a.pluginId } }),
					))[0],
					"A bottle missing",
				);
				const entered = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				const upstream = yield* startFakeHttpServerScoped(() =>
					Effect.gen(function* () {
						yield* Deferred.succeed(entered, undefined);
						yield* Deferred.await(release);
						return Response.json({ ok: true });
					}),
				);
				yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
				const script = requirePresent(
					(yield* listAdminSandboxScripts(a.installation.activeRevisionId)).find(
						({ slug }) => slug === "retained",
					),
					"Pinned retained writer missing",
				);
				const admitted = yield* enqueueSandboxScript(userId, {
					lane: "interactive",
					scriptId: script.id,
					context: { entityId: bottle.id, gateUrl: upstream.url },
				});
				yield* Deferred.await(entered);
				yield* updateNamespacePackage(client, a, packages.a2, { writerMarker: "after" });
				yield* Deferred.succeed(release, undefined);
				const completed = requireCompletedSandboxValue(
					yield* pollSandboxResult(userId, admitted.jobId),
					"admitted namespace writer",
				);
				expect(completed).toMatchObject({
					label: "A1",
					scriptId: script.id,
					config: { writerMarker: "before" },
					definitions: [expect.objectContaining({ slug: "bottle" })],
				});
				const result = yield* Schema.decodeUnknownEffect(
					Schema.Struct({
						definitions: Schema.Array(entitySchemaRecordSchema),
						config: Schema.Record(Schema.String, jsonValueSchema),
					}),
				)(completed);
				const definition = requirePresent(
					result.definitions.find(({ slug }) => slug === "bottle"),
					"Retained bottle definition missing",
				);
				const properties = yield* Schema.decodeEffect(AppSchema)(definition.propertiesSchema);
				expect(properties.fields.finish).toBeUndefined();
				expect((yield* invokeNamespaceOperation(client, a.installation.packageId)).result).toEqual({
					label: "A2",
				});
			}),
	);
	it.live("updates only the private owner's revision and rejects a new stale UI invocation", () =>
		Effect.gen(function* () {
			const alice = yield* createAuthenticatedClient();
			const bob = yield* createAuthenticatedClient();
			const packages = pluginNamespacePackages();
			const a = yield* installNamespacePackage(alice.client, packages.a);
			const b = yield* installNamespacePackage(bob.client, packages.a);
			expect(a.pluginId).not.toBe(b.pluginId);
			yield* updateNamespacePackage(alice.client, a, packages.a2);
			const updated = yield* namespaceInstallation(alice.client, a.pluginId);
			expect(updated.contentHash).not.toBe(a.installation.contentHash);
			expect((yield* namespaceInstallation(bob.client, b.pluginId)).contentHash).toBe(
				b.installation.contentHash,
			);
			expect(
				(yield* invokeNamespaceOperation(alice.client, a.installation.packageId)).result,
			).toEqual({ label: "A2" });
			expect(
				(yield* invokeNamespaceOperation(bob.client, b.installation.packageId)).result,
			).toEqual({ label: "A1" });
			const stale = yield* Effect.flip(
				invokeNamespaceOperation(
					alice.client,
					a.installation.packageId,
					{},
					a.installation.contentHash,
				),
			);
			assertTaggedError(stale, "PluginConflictError");
			expect(stale.reason).toEqual({ pluginId: a.pluginId, code: "source-revision-stale" });
			const aliceRows = yield* executeRyotQLRecipe(
				alice.client,
				namespaceBottlesRecipe({
					reference: {
						scope: "user",
						kind: "package",
						packageId: packages.a.manifest.metadata.packageId,
					},
				}),
			);
			const bobRows = yield* executeRyotQLRecipe(
				bob.client,
				namespaceBottlesRecipe({
					reference: {
						scope: "user",
						kind: "package",
						packageId: packages.a.manifest.metadata.packageId,
					},
				}),
			);
			expect(aliceRows.map(({ owner }) => owner)).toEqual([a.pluginId]);
			expect(bobRows.map(({ owner }) => owner)).toEqual([b.pluginId]);
			expect(aliceRows[0]?.id).not.toBe(bobRows[0]?.id);
			const aliceDefinitions = yield* executeRyotQLRecipe(
				alice.client,
				entityDefinitionsRecipe({ limit: 100 }),
			);
			const bobDefinitions = yield* executeRyotQLRecipe(
				bob.client,
				entityDefinitionsRecipe({ limit: 100 }),
			);
			const aliceBottle = requirePresent(
				aliceDefinitions.items.find(
					({ slug, pluginId }) => pluginId === a.pluginId && slug === "bottle",
				),
				"Alice bottle definition missing",
			);
			const bobBottle = requirePresent(
				bobDefinitions.items.find(
					({ slug, pluginId }) => pluginId === b.pluginId && slug === "bottle",
				),
				"Bob bottle definition missing",
			);
			expect(aliceBottle.propertiesSchema.fields.finish).toMatchObject({ type: "string" });
			expect(bobBottle.propertiesSchema.fields.finish).toBeUndefined();
		}),
	);

	it.live(
		"uses one system revision for all installations and requires exact update expectations",
		() =>
			Effect.gen(function* () {
				const alice = yield* createAuthenticatedClient();
				const bob = yield* createAuthenticatedClient();
				const packages = pluginNamespacePackages();
				const system = yield* installTestSupportSystemPlugin(packages.a);
				let activationId = system.activationId;
				yield* Effect.addFinalizer(() =>
					getApiClient()
						.adminCall((contract) =>
							contract.testSupport.uninstallSystemPlugin({
								params: { activationId, pluginId: system.pluginId },
							}),
						)
						.pipe(Effect.ignore),
				);
				yield* getApiClient().adminCall((contract) =>
					contract.testSupport.reconcilePluginInstallations(),
				);
				const original = yield* namespaceInstallation(alice.client, system.pluginId);
				const updated = yield* updateTestSupportSystemPlugin({
					...packages.a2,
					pluginId: system.pluginId,
					contentHash: original.contentHash,
				});
				activationId = updated.activationId;
				for (const owner of [alice.client, bob.client]) {
					expect(
						(yield* invokeNamespaceOperation(owner, packages.a.manifest.metadata.packageId)).result,
					).toEqual({ label: "A2" });
				}
				const duplicate = yield* Effect.flip(installTestSupportSystemPlugin(packages.a2));
				assertTaggedError(duplicate, "PluginConflictError");
				expect(duplicate.reason.code).toBe("already-installed");
				const stale = yield* Effect.flip(
					updateTestSupportSystemPlugin({
						...packages.a,
						pluginId: system.pluginId,
						contentHash: original.contentHash,
					}),
				);
				assertTaggedError(stale, "PluginConflictError");
				expect(stale.reason.code).toBe("source-revision-stale");
			}),
	);
});
