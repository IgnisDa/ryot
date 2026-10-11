import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { genericImportSealInputSchema } from "@ryot-app/sandbox-sdk/imports";
import { Deferred, Effect, Schema } from "effect";

import {
	adminHeaders,
	checkClientPageFreshness,
	createAuthenticatedClient,
	exportAndDownloadBackup,
	executeRyotQLRecipe,
	enqueueSandboxScript,
	listAdminSandboxScripts,
	namespaceBottlesRecipe,
	pollSandboxResult,
	getApiClient,
	installNamespacePackage,
	installPrivatePluginPackage,
	installTestSupportSystemPlugin,
	invokeNamespaceOperation,
	namespaceInstallation,
	pluginNamespacePackages,
	pollUntil,
	pollImportRunUntilTerminal,
	getImportRun,
} from "~/fixtures/kernel";
import { assertCompleted, assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { startFakeHttpServerScoped } from "~/support/fake-http-server";

describe("plugin package conflicts", () => {
	it.live(
		"settles a hung private source with the exact identity-conflict outcome and retained pins",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const packages = pluginNamespacePackages();
				const release = yield* Deferred.make<void>();
				const upstream = yield* startFakeHttpServerScoped(() =>
					Deferred.await(release).pipe(Effect.as(Response.json({ ok: true }))),
				);
				yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
				const a = yield* installNamespacePackage(client, packages.a, {
					writerMarker: "admitted",
					checkpointUrl: upstream.url,
				});
				const b = yield* installNamespacePackage(client, packages.b);
				const completed = yield* client.call((contract) =>
					contract.imports.createRun({
						payload: {
							source: { slug: "import", owner: { kind: "plugin", pluginId: b.pluginId } },
						},
					}),
				);
				const completedBefore = yield* pollImportRunUntilTerminal(client, completed.id);
				expect(completedBefore).toMatchObject({ status: "completed", failureReason: null });
				const hung = yield* client.call((contract) =>
					contract.imports.createRun({
						payload: {
							source: { slug: "import", owner: { kind: "plugin", pluginId: a.pluginId } },
						},
					}),
				);
				yield* pollUntil(
					"admitted private source checkpoint",
					Effect.sync(() => (upstream.requests.length > 0 ? true : null)),
				);
				const admitted = requirePresent(
					(yield* getImportRun(client, hung.id, undefined, 100)).run,
					"Hung source admission missing",
				);
				const evidence = yield* Schema.decodeUnknownEffect(
					Schema.Struct({
						scriptId: SandboxScriptId,
						request: genericImportSealInputSchema,
						config: Schema.Record(Schema.String, JsonValue),
					}),
				)(upstream.requests[0]?.body);
				const checkpoint = requirePresent(
					(yield* listAdminSandboxScripts(a.installation.activeRevisionId)).find(
						({ slug }) => slug === "checkpoint",
					),
					"Pinned source checkpoint missing",
				);
				expect(evidence.scriptId).toBe(checkpoint.id);
				expect(evidence.request.runId).toBe(hung.id);
				expect(evidence.request.command.causation.importRunId).toBe(hung.id);
				expect(evidence.config.writerMarker).toBe("admitted");
				const system = yield* installTestSupportSystemPlugin(packages.claim);
				yield* Effect.addFinalizer(() =>
					getApiClient()
						.call(
							(contract) =>
								contract.testSupport.uninstallSystemPlugin({
									params: { pluginId: system.pluginId, activationId: system.activationId },
								}),
							adminHeaders(),
						)
						.pipe(Effect.ignore),
				);
				const retired = yield* pollImportRunUntilTerminal(client, hung.id);
				expect(retired).toMatchObject({
					status: "cancelled",
					failureReason: {
						pluginId: a.pluginId,
						installationId: a.id,
						code: "package-identity-conflict",
					},
				});
				expect((yield* namespaceInstallation(client, a.pluginId)).activeRevisionId).toBe(
					a.installation.activeRevisionId,
				);
				expect(
					(yield* listAdminSandboxScripts(a.installation.activeRevisionId)).map(({ id }) => id),
				).toContain(evidence.scriptId);
				expect(retired.summary).toEqual(admitted.summary);
				yield* Deferred.succeed(release, undefined);
				const denied = yield* Effect.flip(
					client.call((contract) =>
						contract.imports.createRun({
							payload: {
								source: { slug: "import", owner: { kind: "plugin", pluginId: a.pluginId } },
							},
						}),
					),
				);
				assertTaggedError(denied, "ImportRequestError");
				expect(denied.reason).toMatchObject({ source: "import", code: "source-not-found" });
				const unaffected = yield* pollImportRunUntilTerminal(client, completed.id);
				expect(unaffected).toEqual(completedBefore);
			}),
	);
	it.live(
		"re-admits an incomplete private bootstrap after explicit recovery without losing hidden intent",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const packages = pluginNamespacePackages();
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
				const installed = yield* installPrivatePluginPackage({
					client,
					pluginPackage: packages.a,
					config: { bootstrapGateUrl: upstream.url },
				});
				yield* Deferred.await(entered);
				const system = yield* installTestSupportSystemPlugin(packages.claim);
				let removed = false;
				yield* Effect.addFinalizer(() =>
					removed
						? Effect.void
						: getApiClient()
								.call(
									(contract) =>
										contract.testSupport.uninstallSystemPlugin({
											params: { pluginId: system.pluginId, activationId: system.activationId },
										}),
									adminHeaders(),
								)
								.pipe(Effect.ignore),
				);
				const quarantined = yield* namespaceInstallation(client, installed.pluginId);
				expect(quarantined).toMatchObject({
					isInitialized: false,
					health: "incompatible",
					incompatibilityReason: "package-identity-conflict",
				});
				yield* Deferred.succeed(release, undefined);
				yield* getApiClient().call(
					(contract) =>
						contract.testSupport.uninstallSystemPlugin({
							params: { pluginId: system.pluginId, activationId: system.activationId },
						}),
					adminHeaders(),
				);
				removed = true;
				expect((yield* namespaceInstallation(client, installed.pluginId)).health).toBe(
					"incompatible",
				);
				yield* client.call((contract) =>
					contract.plugins.updatePluginState({
						params: { installationId: installed.id },
						payload: { isHidden: true, unsetConfigKeys: ["bootstrapGateUrl"] },
					}),
				);
				const hidden = yield* namespaceInstallation(client, installed.pluginId);
				expect(hidden).toMatchObject({
					isHidden: true,
					isInitialized: false,
					health: "incompatible",
				});
				yield* client.call((contract) =>
					contract.plugins.updatePluginState({
						payload: { isHidden: false },
						params: { installationId: installed.id },
					}),
				);
				const recovered = yield* namespaceInstallation(client, installed.pluginId);
				expect(recovered).toMatchObject({
					health: "ready",
					isHidden: false,
					id: installed.id,
					isInitialized: true,
					incompatibilityReason: null,
					pluginId: installed.pluginId,
				});
				expect(recovered.activationId).not.toBe(installed.activationId);
				expect(
					(yield* executeRyotQLRecipe(
						client,
						namespaceBottlesRecipe({ reference: { kind: "local", pluginId: installed.pluginId } }),
					)).map(({ name }) => name),
				).toEqual(["A1 bottle"]);
			}),
	);
	it.live(
		"revokes fresh host effects from an admitted historical private writer after quarantine",
		() =>
			Effect.gen(function* () {
				const { client, userId } = yield* createAuthenticatedClient();
				const packages = pluginNamespacePackages();
				const a = yield* installNamespacePackage(client, packages.a);
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
					"Historical writer missing",
				);
				const admitted = yield* enqueueSandboxScript(userId, {
					lane: "interactive",
					scriptId: script.id,
					context: { entityId: bottle.id, gateUrl: upstream.url },
				});
				yield* Deferred.await(entered);
				const system = yield* installTestSupportSystemPlugin(packages.claim);
				yield* Effect.addFinalizer(() =>
					getApiClient()
						.call(
							(contract) =>
								contract.testSupport.uninstallSystemPlugin({
									params: { pluginId: system.pluginId, activationId: system.activationId },
								}),
							adminHeaders(),
						)
						.pipe(Effect.ignore),
				);
				yield* Deferred.succeed(release, undefined);
				const result = yield* pollSandboxResult(userId, admitted.jobId);
				assertCompleted(result, "quarantined historical writer");
				expect(result.error).toMatchObject({
					kind: "resource-unavailable",
					data: { pluginId: a.pluginId, installationId: a.id, code: "package-identity-conflict" },
				});
				expect((yield* namespaceInstallation(client, a.pluginId)).sourceHash).toBe(
					a.installation.sourceHash,
				);
			}),
	);
	it.live(
		"quarantines only the exact package claim, denies retained UI pins, and recovers explicitly",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const packages = pluginNamespacePackages();
				const a = yield* installNamespacePackage(client, packages.a);
				const b = yield* installNamespacePackage(client, packages.b);
				const prepared = yield* client.call((contract) =>
					contract.clientPages.prepare({
						payload: {
							target: {
								path: "/",
								search: "",
								kind: "plugin-route",
								packageId: a.installation.packageId,
							},
						},
					}),
				);
				yield* client.call((contract) =>
					contract.plugins.updatePluginState({
						payload: { isHidden: true },
						params: { installationId: a.id },
					}),
				);
				const system = yield* installTestSupportSystemPlugin(packages.claim);
				let removed = false;
				yield* Effect.addFinalizer(() =>
					removed
						? Effect.void
						: getApiClient()
								.call(
									(contract) =>
										contract.testSupport.uninstallSystemPlugin({
											params: { pluginId: system.pluginId, activationId: system.activationId },
										}),
									adminHeaders(),
								)
								.pipe(Effect.ignore),
				);
				expect(system.pluginId).not.toBe(a.pluginId);
				const quarantined = yield* pollUntil(
					"exact private claim quarantine",
					namespaceInstallation(client, a.pluginId).pipe(
						Effect.map((installation) =>
							installation.health === "incompatible" ? installation : null,
						),
					),
				);
				expect(quarantined).toMatchObject({
					id: a.id,
					isHidden: true,
					isInitialized: true,
					pluginId: a.pluginId,
					sourceHash: a.installation.sourceHash,
					packageId: packages.a.manifest.metadata.packageId,
					incompatibilityReason: "package-identity-conflict",
				});
				expect((yield* namespaceInstallation(client, b.pluginId)).health).toBe("ready");
				expect((yield* invokeNamespaceOperation(client, b.installation.packageId)).result).toEqual({
					label: "B1",
				});
				const denied = yield* Effect.flip(
					invokeNamespaceOperation(client, a.installation.packageId, {}, a.installation.sourceHash),
				);
				assertTaggedError(denied, "PluginConflictError");
				expect(denied.reason).toMatchObject({
					pluginId: a.pluginId,
					code: "package-identity-conflict",
				});
				expect((yield* checkClientPageFreshness(client, prepared.identity)).current).toBe(false);
				const unavailable = yield* Effect.flip(
					client.call((contract) =>
						contract.clientPages.prepare({
							payload: {
								target: {
									path: "/",
									search: "",
									kind: "plugin-route",
									packageId: a.installation.packageId,
								},
							},
						}),
					),
				);
				assertTaggedError(unavailable, "ClientPagePreparationError");
				expect(unavailable.reason).toEqual({
					code: "plugin-package-unavailable",
					packageId: a.installation.packageId,
				});
				const uninstall = yield* Effect.flip(
					client.call((contract) =>
						contract.plugins.uninstall({
							params: { installationId: a.id, activationId: a.activationId },
						}),
					),
				);
				assertTaggedError(uninstall, "PluginConflictError");
				expect(uninstall.reason.code).toBe("entity-referenced");
				expect((yield* exportAndDownloadBackup(client)).run.status).toBe("completed");
				yield* getApiClient().call(
					(contract) =>
						contract.testSupport.uninstallSystemPlugin({
							params: { pluginId: system.pluginId, activationId: system.activationId },
						}),
					adminHeaders(),
				);
				removed = true;
				expect(yield* namespaceInstallation(client, a.pluginId)).toMatchObject({
					isHidden: true,
					isInitialized: true,
					health: "incompatible",
				});
				yield* client.call((contract) =>
					contract.plugins.updatePluginState({
						payload: { isHidden: false },
						params: { installationId: a.id },
					}),
				);
				const recovered = yield* namespaceInstallation(client, a.pluginId);
				expect(recovered).toMatchObject({
					id: a.id,
					health: "ready",
					isInitialized: true,
					pluginId: a.pluginId,
					incompatibilityReason: null,
				});
				expect((yield* invokeNamespaceOperation(client, a.installation.packageId)).result).toEqual({
					label: "A1",
				});
				expect(
					(yield* executeRyotQLRecipe(
						client,
						namespaceBottlesRecipe({ reference: { kind: "local", pluginId: a.pluginId } }),
					)).map(({ name }) => name),
				).toEqual(["A1 bottle"]);
			}),
	);

	it.live("rejects a new private claim against an active system package even when hidden", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const packages = pluginNamespacePackages();
			const system = yield* installTestSupportSystemPlugin(packages.claim);
			yield* Effect.addFinalizer(() =>
				getApiClient()
					.call(
						(contract) =>
							contract.testSupport.uninstallSystemPlugin({
								params: { pluginId: system.pluginId, activationId: system.activationId },
							}),
						adminHeaders(),
					)
					.pipe(Effect.ignore),
			);
			yield* getApiClient().call(
				(contract) => contract.testSupport.reconcilePluginInstallations(),
				adminHeaders(),
			);
			const installation = yield* namespaceInstallation(client, system.pluginId);
			yield* client.call((contract) =>
				contract.plugins.updatePluginState({
					payload: { isHidden: true },
					params: { installationId: installation.id },
				}),
			);
			const denied = yield* Effect.flip(
				installPrivatePluginPackage({ client, config: {}, pluginPackage: packages.a }),
			);
			assertTaggedError(denied, "PluginRequestError");
			expect(denied.reason).toEqual({
				code: "reserved-system-identity",
				packageId: packages.a.manifest.metadata.packageId,
			});
			expect((yield* installNamespacePackage(client, packages.b)).installation.health).toBe(
				"ready",
			);
		}),
	);
});
