import { expect, it } from "@effect/vitest";
import type { IngestionCapture, IngestionRun } from "@ryot-app/contract/modules/imports/ingestion";
import { IntegrationId, SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { Deferred, Effect, Fiber, Layer } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";
import { mutationAdmissionTestLayer } from "#lib/test-utils/mutation-admission";
import { IngestionCaptures } from "#modules/imports/capture-service";
import { IngestionExecution } from "#modules/imports/execution-service";
import {
	ingestionTestRevision,
	ingestionTestRun,
	ingestionTestScope,
	ingestionTestSource,
} from "#modules/imports/ingestion.test-support";
import { ImportsRepository } from "#modules/imports/repository";
import type { PreparedIngestionRelease } from "#modules/imports/runtime/prepared-release";
import { ImportSourceStateStore } from "#modules/imports/runtime/source-state-store";
import { ImportRunError } from "#modules/imports/runtime/workflow-errors";
import { ImportWorkflowPinning } from "#modules/imports/workflow-pinning";
import { IngestionReadinessService } from "#modules/plugins/ingestion-readiness-service";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { fixtureManifest } from "#modules/plugins/test-support";
import { SandboxPluginScriptResolver } from "#modules/sandbox/plugin-script-resolver";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { IntegrationIngestion } from "./ingestion";
import type { IntegrationWebhookDelivery } from "./jobs";
import { makeIntegration } from "./test-support";

const integration = makeIntegration({
	provider: "fixture",
	userId: ingestionTestScope.userId,
	pluginInstallationId: "installation-1",
	id: IntegrationId.make("integration-1"),
});
const runCase = (
	options: {
		status?: IngestionRun["status"];
		ready?: boolean;
		released?: boolean;
		expired?: boolean;
		interruptPreparation?: boolean;
		workflowId?: string;
		adapter?: string;
		lot?: "sink" | "yank";
		writeEnvelope?: (envelope: IntegrationWebhookDelivery) => Effect.Effect<void>;
	} = {},
) =>
	Effect.gen(function* () {
		let run = ingestionTestRun({
			integrationId: integration.id,
			status: options.status ?? "blocked",
			plan: options.status === "pending" ? ingestionTestRun().plan : null,
			pins: options.status === "pending" ? ingestionTestRun().pins : null,
		});
		let prepared: PreparedIngestionRelease | null = null;
		let interrupted = false;
		let envelopeCapture: IngestionCapture | null = null;
		let envelopeValue: IntegrationWebhookDelivery | null = null;
		const calls: { method: string; input: unknown }[] = [];
		const record = (method: string, input: unknown) =>
			Effect.sync(() => {
				calls.push({ input, method });
			});
		const dependencies = Layer.mergeAll(
			Layer.mock(SandboxExecutionService)({}),
			mutationAdmissionTestLayer,
			Layer.mock(IngestionCaptures)({ recover: () => record("recover", null) }),
			Layer.mock(IngestionExecution)({ cleanup: (scope) => record("cleanup", scope) }),
			Layer.mock(ImportsRepository)({
				getCapture: () => Effect.succeed(null),
				getIngestionRun: () => Effect.sync(() => run),
				getPreparedRelease: () => Effect.sync(() => prepared),
				expireBlocked: (input) => record("expire", input).pipe(Effect.as(options.expired ?? false)),
				createBlockedRun: (input) =>
					record("admit", input).pipe(Effect.as(ingestionTestScope.runId)),
				getIntegrationInput: () =>
					Effect.sync(() => ({ envelope: envelopeCapture, lot: options.lot ?? "yank" })),
				rejectBlocked: (input) =>
					record("reject", input).pipe(
						Effect.andThen(
							Effect.sync(() => {
								run = { ...run, status: "failed" };
								return true;
							}),
						),
					),
				releaseBlocked: (input) =>
					record("release", input).pipe(
						Effect.andThen(
							Effect.sync(() => {
								if (options.released === false) {
									run = { ...run, status: "expired" };
									return false;
								}
								run = { ...run, pins: input.pins, plan: input.plan, status: "pending" };
								return true;
							}),
						),
					),
			}),
			Layer.mock(ImportSourceStateStore)({
				materialize: () => Effect.succeed(ingestionTestSource),
				loadEnvelope: () =>
					Effect.suspend(() =>
						envelopeValue ? Effect.succeed(envelopeValue) : Effect.die("Missing envelope"),
					),
				store: (input) =>
					record("state", input).pipe(
						Effect.andThen(() => {
							if (options.interruptPreparation && !interrupted) {
								interrupted = true;
								return Effect.fail(new ImportRunError({ message: "Publication interrupted" }));
							}
							return Effect.void;
						}),
					),
				storeEnvelope: (scope, envelope) =>
					Effect.gen(function* () {
						yield* record("envelope", { scope, envelope });
						if (options.writeEnvelope) {
							yield* options.writeEnvelope(envelope);
						}
						envelopeValue = envelope;
						envelopeCapture = {
							ordinal: 33,
							state: "sealed",
							checkpoint: null,
							phase: "collection",
							id: "admitted-envelope",
							payload: {
								checksum: "checksum",
								locator: "durable-envelope",
								byteSize: new TextEncoder().encode(envelope.rawBody).length,
							},
						};
						return envelopeCapture;
					}),
			}),
			Layer.mock(PluginInstallationRepository)({
				findUserSettingsForRevision: () =>
					Effect.succeed({
						installationId: "installation-1",
						userSettings: { timezone: "Pacific/Auckland" },
						manifest: {
							...fixtureManifest(),
							userSettingsSchema: {
								unknownKeys: "strict",
								fields: {
									timezone: { type: "string", label: "Timezone", description: "Import timezone" },
								},
							},
						},
					}),
			}),
			Layer.mock(ImportWorkflowPinning)({
				preRegister: (input) =>
					record("pin", input).pipe(
						Effect.tap(() =>
							Effect.sync(() => {
								if (input.preparedRelease) {
									prepared = {
										...input.preparedRelease,
										state: {
											...input.preparedRelease.state,
											pluginRevision: ingestionTestRevision,
										},
									};
									run = { ...run, pins: input.expectedPins };
								}
							}),
						),
						Effect.as({
							pluginRevision: ingestionTestRevision,
							registrationStatus: "registered" as const,
						}),
					),
			}),
			Layer.mock(SandboxPluginScriptResolver)({
				findWorkflowScriptAvailableToUser: (...input) =>
					record("workflow", input).pipe(
						Effect.as({ id: SandboxScriptId.make(options.workflowId ?? "script-1") }),
					),
			}),
			Layer.mock(IngestionReadinessService)({
				evaluateIntegration: (input) =>
					record("evaluate", input).pipe(
						Effect.as({
							pins: {
								pluginRevisionId: "revision-1",
								pluginConfigRevisionId: "config-1",
								scriptId: SandboxScriptId.make("script-1"),
							},
							readiness: {
								ready: options.ready ?? true,
								blockReasons:
									options.ready === false
										? [{ key: "token", code: "configuration-required" as const }]
										: [],
								plan: {
									operation: "workflow.media-integration",
									selection: { "integration-adapter": options.adapter ?? "integration.fixture" },
								},
							},
							script: {
								name: "Fixture",
								providerId: null,
								contentHash: "hash",
								pluginId: "plugin-1",
								pluginRevisionId: "revision-1",
								slug: "workflow.media-integration",
								id: SandboxScriptId.make("script-1"),
								metadata: {
									name: "Fixture",
									capabilities: [],
									runtimeImports: [],
									kind: "workflow" as const,
									slug: "workflow.media-integration",
								},
							},
							provider: {
								slug: "fixture",
								name: "Fixture",
								lot: "sink" as const,
								pluginId: "plugin-1",
								pluginSlug: "fixture",
								description: "Fixture",
								pluginScope: "system" as const,
								settingsSchema: { fields: {} },
								installationId: "installation-1",
								scriptSlug: "workflow.media-integration",
								readinessMetadata: {
									scripts: [],
									workflows: [],
									oauthProviders: [],
									availableConfigKeys: [],
								},
								configContext: {
									ownerUserId: null,
									kind: "revision" as const,
									configSchema: { fields: {} },
									pluginRevisionId: "revision-1",
									pluginConfigRevisionId: "config-1",
								},
							},
						}),
					),
			}),
		);
		const context = yield* Layer.build(
			IntegrationIngestion.layer.pipe(Layer.provideMerge(dependencies)),
		);
		return { calls, context, getRun: () => run };
	});

it.effect.each(["blocked", "pending"] as const)(
	"rejects a %s sink with no durable envelope",
	(status) =>
		Effect.gen(function* () {
			const test = yield* runCase({ status, lot: "sink" });
			const service = yield* Effect.provideContext(IntegrationIngestion, test.context);
			expect(yield* service.inputReady(ingestionTestScope)).toBe(false);
			expect(yield* service.release(ingestionTestScope, integration)).toBe(false);
			assertExitFails(
				yield* Effect.exit(service.recoverInput(ingestionTestScope)),
				new ImportRunError({ message: "Integration admitted envelope is not sealed" }),
			);
			expect(test.calls).toEqual([]);
		}),
);

it.effect.each(["integration-disabled", "integrations-disabled", "pro-key-required"] as const)(
	"terminates %s admission before exposing input to another worker",
	(code) =>
		Effect.gen(function* () {
			const test = yield* runCase({ lot: "sink" });
			const service = yield* Effect.provideContext(IntegrationIngestion, test.context);
			const scope = yield* service.admitWebhook(
				integration,
				{ rawBody: "{}", contentType: "application/json" },
				{ code },
			);
			expect(test.getRun().status).toBe("failed");
			expect(test.calls.find((call) => call.method === "reject")?.input).toMatchObject({
				scope,
				failureReason: { code },
			});
			expect(test.calls.some((call) => call.method === "envelope")).toBe(false);
			expect(yield* service.release(scope, integration)).toBe(false);
		}),
);

it.effect(
	"does not release or recover a sink while its admitted envelope write is deferred, then recovers the exact transport",
	() =>
		Effect.gen(function* () {
			const entered = yield* Deferred.make<void>();
			const durable = yield* Deferred.make<void>();
			const test = yield* runCase({
				lot: "sink",
				writeEnvelope: () =>
					Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(durable))),
			});
			const envelope = {
				rawBody: "--boundary\r\nß unparsed bytes\r\n",
				contentType: "multipart/form-data; boundary=boundary",
			};
			const service = yield* Effect.provideContext(IntegrationIngestion, test.context);
			const admission = yield* service
				.admitWebhook({ ...integration, lot: "sink" }, envelope)
				.pipe(Effect.forkChild);
			yield* Deferred.await(entered);
			expect(yield* service.release(ingestionTestScope, integration)).toBe(false);
			assertExitFails(
				yield* Effect.exit(service.recoverInput(ingestionTestScope)),
				new ImportRunError({ message: "Integration admitted envelope is not sealed" }),
			);
			expect(test.calls.map((call) => call.method)).toEqual(["evaluate", "admit", "envelope"]);
			yield* Deferred.succeed(durable, undefined);
			expect(yield* Fiber.join(admission)).toEqual(ingestionTestScope);
			expect(yield* service.release(ingestionTestScope, integration)).toBe(true);
			const recovered = yield* service.recoverInput(ingestionTestScope);
			expect(recovered.sourcePayload["integrationContext"]).toEqual(envelope);
		}),
);

it.effect(
	"durably stores the unchanged transport with its account generation while setup is blocked",
	() =>
		Effect.gen(function* () {
			const test = yield* runCase({ ready: false });
			const envelope = {
				rawBody: "--boundary\r\nraw transport",
				contentType: "multipart/form-data; boundary=boundary",
			};
			yield* Effect.flatMap(IntegrationIngestion, (service) =>
				service.admitWebhook(integration, envelope),
			).pipe(Effect.provideContext(test.context));
			expect(test.calls.map((call) => call.method)).toEqual(["evaluate", "admit", "envelope"]);
			expect(test.calls[1]?.input).toMatchObject({
				acceptedAt: expect.any(Date),
				accountGeneration: ingestionTestScope.accountGeneration,
				blockReasons: [{ key: "token", code: "configuration-required" }],
			});
			expect(test.calls[2]?.input).toEqual({ envelope, scope: ingestionTestScope });
		}),
);

it.effect(
	"resumes interrupted preparation from the retained plan without evaluating current configuration",
	() =>
		Effect.gen(function* () {
			const test = yield* runCase({ interruptPreparation: true });
			const release = Effect.flatMap(IntegrationIngestion, (service) =>
				service.release(ingestionTestScope, integration),
			).pipe(Effect.provideContext(test.context));
			expect((yield* Effect.exit(release))._tag).toBe("Failure");
			expect(yield* release).toBe(true);
			expect(test.calls.map((call) => call.method)).toEqual([
				"evaluate",
				"workflow",
				"pin",
				"state",
				"state",
				"release",
			]);
			expect(test.getRun().plan).toEqual({
				operation: "workflow.media-integration",
				selection: { "integration-adapter": "integration.fixture" },
			});
		}),
);

it.effect("does not retain executable authority before prerequisites are ready", () =>
	Effect.gen(function* () {
		const test = yield* runCase({ ready: false });
		expect(
			yield* Effect.flatMap(IntegrationIngestion, (service) =>
				service.release(ingestionTestScope, integration),
			).pipe(Effect.provideContext(test.context)),
		).toBe(false);
		expect(test.calls.map((call) => call.method)).toEqual(["evaluate"]);
	}),
);

it.effect("does not pin a different integration root than the evaluated provider", () =>
	Effect.gen(function* () {
		const test = yield* runCase({ workflowId: "different-root" });
		expect(
			yield* Effect.flatMap(IntegrationIngestion, (service) =>
				service.release(ingestionTestScope, integration),
			).pipe(Effect.provideContext(test.context)),
		).toBe(false);
		expect(test.calls.map((call) => call.method)).toEqual(["evaluate", "workflow"]);
	}),
);

it.effect("rejects an integration plan without an adapter before pinning", () =>
	Effect.gen(function* () {
		const test = yield* runCase({ adapter: "" });
		const result = yield* Effect.flatMap(IntegrationIngestion, (service) =>
			service.release(ingestionTestScope, integration),
		).pipe(Effect.provideContext(test.context), Effect.exit);
		assertExitFails(
			result,
			new ImportRunError({ message: "Integration execution plan does not select its adapter" }),
		);
		expect(test.calls.map((call) => call.method)).toEqual(["evaluate"]);
	}),
);

it.effect(
	"retains exact configuration and durable executable input before guarded release and reuses released pins",
	() =>
		Effect.gen(function* () {
			const test = yield* runCase();
			const release = Effect.flatMap(IntegrationIngestion, (service) =>
				service.release(ingestionTestScope, integration),
			).pipe(Effect.provideContext(test.context));
			expect(yield* release).toBe(true);
			expect(yield* release).toBe(true);
			expect(test.calls.map((call) => call.method)).toEqual([
				"evaluate",
				"workflow",
				"pin",
				"state",
				"release",
			]);
			expect(test.calls[1]?.input).toEqual([
				ingestionTestScope.userId,
				"plugin-1",
				"integration",
				"installation-1",
			]);
			expect(test.calls[2]?.input).toMatchObject({
				expectedPins: {
					scriptId: "script-1",
					executionId: "run-1-import",
					pluginRevisionId: "revision-1",
					pluginConfigRevisionId: "config-1",
				},
				preparedRelease: {
					state: {
						workflowScriptId: "script-1",
						sourcePayload: {
							integrationId: integration.id,
							integrationScriptSlug: "integration.fixture",
						},
					},
				},
			});
			expect(test.getRun().plan).toEqual({
				operation: "workflow.media-integration",
				selection: { "integration-adapter": "integration.fixture" },
			});
		}),
);

it.effect("captures integration settings selected when a blocked run is released", () =>
	Effect.gen(function* () {
		const selected = {
			...integration,
			minimumProgress: 15,
			maximumProgress: 85,
			syncOwnership: true,
			providerSpecifics: { provider: "tmdb", filters: ["movie"] },
		};
		const test = yield* runCase();
		const service = yield* Effect.provideContext(IntegrationIngestion, test.context);

		expect(yield* service.release(ingestionTestScope, selected)).toBe(true);
		expect(test.calls.find((call) => call.method === "evaluate")?.input).toMatchObject({
			settings: selected.providerSpecifics,
		});
		expect(test.calls.find((call) => call.method === "pin")?.input).toMatchObject({
			preparedRelease: {
				state: {
					executionSettings: {
						userSettings: { timezone: "Pacific/Auckland" },
						integration: {
							syncOwnership: true,
							minimumProgress: 15,
							maximumProgress: 85,
							providerSpecifics: selected.providerSpecifics,
						},
					},
				},
			},
		});
	}),
);

it.effect(
	"cleans retained authority when expiry wins release and cleans only a winning expiry",
	() =>
		Effect.gen(function* () {
			const losing = yield* runCase({ released: false });
			expect(
				yield* Effect.flatMap(IntegrationIngestion, (service) =>
					service.release(ingestionTestScope, integration),
				).pipe(Effect.provideContext(losing.context)),
			).toBe(false);
			expect(losing.calls.map((call) => call.method)).toEqual([
				"evaluate",
				"workflow",
				"pin",
				"state",
				"release",
				"cleanup",
			]);
			for (const expired of [false, true]) {
				const test = yield* runCase({ expired });
				yield* Effect.flatMap(IntegrationIngestion, (service) =>
					service.expire(ingestionTestScope),
				).pipe(Effect.provideContext(test.context));
				expect(test.calls.map((call) => call.method)).toEqual(
					expired ? ["expire", "cleanup"] : ["expire"],
				);
			}
		}),
);
