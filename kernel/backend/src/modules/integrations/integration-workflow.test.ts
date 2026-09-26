import { BunFileSystem } from "@effect/platform-bun";
import { expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import {
	AutomationTriggerId,
	ImportRunId,
	IntegrationId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { RedisService } from "#lib/infrastructure/redis";
import {
	makeAppConfigLayer,
	makeRedisService,
	makeWorkflowActivityEngine,
} from "#lib/test-utils/effect";
import { mutationAdmissionTestLayer } from "#lib/test-utils/mutation-admission";
import { SignalEmissionService, type EmitSignalInput } from "#modules/automations/signal-service";
import { ImportRunFailuresService } from "#modules/imports/failure-service";
import { ImportsRepository } from "#modules/imports/repository";
import { ImportsService } from "#modules/imports/service";
import { IntegrationProviderCatalog } from "#modules/plugins/integration-provider-catalog";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { ProcessIntegrationRunWorkflow } from "./integration-workflow";
import { runIntegrationRunWorkflow } from "./integration-workflow-live";
import { IntegrationsRepository, type IntegrationRecord } from "./repository";
import { IntegrationsService } from "./service";
import { makeIntegration, makeRun } from "./test-support";

const mockImportsService = Layer.mock(ImportsService);
const mockImportsRepository = Layer.mock(ImportsRepository);
const mockIntegrationsService = Layer.mock(IntegrationsService);
const mockSignalEmissionService = Layer.mock(SignalEmissionService);
const mockIntegrationsRepository = Layer.mock(IntegrationsRepository);
const mockImportRunFailuresService = Layer.mock(ImportRunFailuresService);

const registeredProvider = {
	lot: "sink" as const,
	name: "Test provider",
	slug: "test-provider",
	pluginSlug: "fixture",
	installationId: "inst_1",
	description: "Test provider",
	pluginId: "fixture-plugin-id",
	settingsSchema: { fields: {} },
	pluginScope: "system" as const,
	scriptSlug: "integration.test-provider",
	configContext: {
		ownerUserId: null,
		kind: "revision" as const,
		configSchema: { fields: {} },
		pluginConfigRevisionId: null,
		pluginRevisionId: "fixture-revision-id",
	},
};

type Recorded = Record<string, unknown>;

class FakeIntegrationRun extends Context.Service<
	FakeIntegrationRun,
	{
		readonly runUpdates: Effect.Effect<ReadonlyArray<Recorded>>;
		readonly sandboxCalls: Effect.Effect<ReadonlyArray<Recorded>>;
		readonly childDispatches: Effect.Effect<ReadonlyArray<Recorded>>;
		readonly integrationUpdates: Effect.Effect<ReadonlyArray<Recorded>>;
		readonly emittedSignals: Effect.Effect<ReadonlyArray<EmitSignalInput>>;
		readonly providerLookups: Effect.Effect<ReadonlyArray<Record<string, string>>>;
		readonly workflowResolutions: Effect.Effect<ReadonlyArray<Record<string, string>>>;
	}
>()("test/FakeIntegrationRun") {}

const append = <A>(ref: Ref.Ref<ReadonlyArray<A>>, value: A) =>
	Ref.update(ref, (all) => [...all, value]);

const makeTestLayer = (
	options: {
		disableWins?: boolean;
		emitsSignals?: boolean;
		sandboxFailure?: string;
		sandboxInterrupt?: boolean;
		capturesChildren?: boolean;
		integration?: IntegrationRecord | null;
		runStatus?: "completed" | "failed";
		recentStatuses?: ReadonlyArray<{ status: "completed" | "failed" }>;
	} = {},
) =>
	Layer.mergeAll(
		mutationAdmissionTestLayer,
		makeAppConfigLayer(),
		BunFileSystem.layer,
		mockImportRunFailuresService({ create: () => Effect.void }),
		mockImportsRepository({
			listRecentStatusesByIntegrationId: () => Effect.succeed([...(options.recentStatuses ?? [])]),
			getRunById: () =>
				Effect.succeed(options.runStatus === undefined ? null : makeRun(options.runStatus)),
		}),
		mockIntegrationsRepository({
			getUserDisableIntegrations: () => Effect.succeed(false),
			getByIdAnyUser: () =>
				Effect.succeed(options.integration === undefined ? makeIntegration() : options.integration),
		}),
		Layer.unwrap(
			Effect.gen(function* () {
				const runUpdates = yield* Ref.make<ReadonlyArray<Recorded>>([]);
				const sandboxCalls = yield* Ref.make<ReadonlyArray<Recorded>>([]);
				const childDispatches = yield* Ref.make<ReadonlyArray<Recorded>>([]);
				const integrationUpdates = yield* Ref.make<ReadonlyArray<Recorded>>([]);
				const emittedSignals = yield* Ref.make<ReadonlyArray<EmitSignalInput>>([]);
				const providerLookups = yield* Ref.make<ReadonlyArray<Record<string, string>>>([]);
				const workflowResolutions = yield* Ref.make<ReadonlyArray<Record<string, string>>>([]);
				const store = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
				const instance = WorkflowInstance.initial(ProcessIntegrationRunWorkflow, "run_1");
				instance.suspended = options.sandboxInterrupt ?? false;
				return Layer.mergeAll(
					Layer.succeed(FakeIntegrationRun, {
						runUpdates: Ref.get(runUpdates),
						sandboxCalls: Ref.get(sandboxCalls),
						emittedSignals: Ref.get(emittedSignals),
						childDispatches: Ref.get(childDispatches),
						providerLookups: Ref.get(providerLookups),
						integrationUpdates: Ref.get(integrationUpdates),
						workflowResolutions: Ref.get(workflowResolutions),
					}),
					Layer.succeed(WorkflowInstance, instance),
					Layer.succeed(
						WorkflowEngine,
						makeWorkflowActivityEngine(
							instance,
							options.capturesChildren
								? {
										execute: (_workflow, dispatch) =>
											append(childDispatches, {
												payload: dispatch.payload,
												executionId: dispatch.executionId,
											}),
									}
								: {},
						),
					),
					Layer.succeed(
						RedisService,
						makeRedisService({
							get: (key) => Ref.get(store).pipe(Effect.map((all) => all.get(key) ?? null)),
							set: (key, value) => Ref.update(store, (all) => new Map(all).set(key, value)),
							del: (...keys) =>
								Ref.modify(store, (all) => {
									const next = new Map(all);
									const removed = keys.filter((key) => next.delete(key)).length;
									return [removed, next];
								}),
						}),
					),
					Layer.mock(IntegrationProviderCatalog)({
						resolveOwnedForUser: () => Effect.succeed(null),
						findForUser: () => Effect.succeed(registeredProvider),
						findOwnedForUser: (_userId, providerSlug, installationId) =>
							append(providerLookups, { providerSlug, installationId }).pipe(
								Effect.as(installationId === "inst_1" ? registeredProvider : null),
							),
					}),
					Layer.mock(SandboxExecutionService)({
						resolveWorkflowScript: (input) =>
							append(workflowResolutions, input).pipe(
								Effect.as(SandboxScriptId.make("workflow.example-import")),
							),
						executeWorkflow: (input) =>
							append(sandboxCalls, { payload: input.input, executionId: input.executionId }).pipe(
								Effect.andThen(() => {
									if (options.sandboxInterrupt) {
										return Effect.interrupt;
									}
									return options.sandboxFailure
										? Effect.fail(
												new SandboxRunError({
													kind: "script-failure",
													message: options.sandboxFailure,
												}),
											)
										: Effect.succeed(null);
								}),
							),
					}),
					mockImportsService({
						markStarted: (input) =>
							append(runUpdates, { ...input, status: "running" }).pipe(
								Effect.as("started" as const),
							),
						finishFailed: (input) =>
							append(runUpdates, { ...input, status: "failed" }).pipe(
								Effect.as("settled" as const),
							),
						finishCancelled: (input) =>
							append(runUpdates, { ...input, status: "cancelled" }).pipe(
								Effect.as("settled" as const),
							),
						getRunControlForUser: () =>
							Effect.succeed(
								options.runStatus === undefined
									? null
									: {
											status: options.runStatus,
											id: ImportRunId.make("run_1"),
											executionKind: "integration" as const,
										},
							),
					}),
					mockIntegrationsService({
						update: (userId, integrationId, body) =>
							append(integrationUpdates, { userId, integrationId, ...body }).pipe(
								Effect.as(makeIntegration()),
							),
						disableIfEnabled: (userId, integrationId, runId) =>
							options.disableWins
								? append(integrationUpdates, {
										runId,
										userId,
										integrationId,
										isDisabled: true,
									}).pipe(Effect.as(true))
								: Effect.succeed(false),
					}),
					mockSignalEmissionService({
						emitSignal: (input) =>
							options.emitsSignals
								? append(emittedSignals, input).pipe(
										Effect.as({
											warnings: [],
											wasCreated: true,
											triggerId: AutomationTriggerId.make("trigger-1"),
										}),
									)
								: Effect.die("unexpected signal emission"),
					}),
				);
			}),
		),
	);

const sinkPayload = {
	userId: UserId.make("user_1"),
	runId: ImportRunId.make("run_1"),
	integrationId: IntegrationId.make("int_1"),
	accountGeneration: { userId: UserId.make("user_1"), token: "test-account-generation" },
	webhook: {
		contentType: "application/json",
		rawBody: JSON.stringify({ lot: "item", progress: 30, identifier: "603" }),
	},
};

const yankPayload = {
	userId: UserId.make("user_1"),
	runId: ImportRunId.make("run_1"),
	integrationId: IntegrationId.make("int_1"),
	accountGeneration: { userId: UserId.make("user_1"), token: "test-account-generation" },
};

layer(makeTestLayer({ capturesChildren: true, runStatus: "completed" }))((test) => {
	test.effect("persists the sink adapter result and dispatches the normalized child", () =>
		Effect.gen(function* () {
			const fake = yield* FakeIntegrationRun;
			yield* runIntegrationRunWorkflow(sinkPayload, "run_1");

			const childDispatches = [...(yield* fake.sandboxCalls), ...(yield* fake.childDispatches)];
			const integrationUpdates = yield* fake.integrationUpdates;
			expect(childDispatches).toHaveLength(1);
			expect(childDispatches[0]).toMatchObject({
				executionId: "run_1-import",
				payload: {
					runId: "run_1",
					source: "test-provider",
					sourcePayload: {
						integrationId: "int_1",
						integrationContext: sinkPayload.webhook,
						integrationScriptSlug: "integration.test-provider",
					},
					command: {
						occurredAt: expect.any(String),
						itemIdentity: '["integration-run","run_1"]',
						causation: {
							depth: 0,
							parentRunId: null,
							executionId: "run_1",
							importRunId: "run_1",
							source: "integration",
							parentTriggerId: null,
							integrationId: "int_1",
							rootExecutionId: "run_1",
							initiator: { id: "int_1", kind: "integration" },
						},
					},
				},
			});
			expect(yield* fake.providerLookups).toEqual([
				{ installationId: "inst_1", providerSlug: "test-provider" },
			]);
			expect(yield* fake.workflowResolutions).toEqual([
				{
					userId: "user_1",
					executionId: "run_1",
					workflowSlug: "import",
					pluginId: "fixture-plugin-id",
					pluginInstallationId: "inst_1",
				},
			]);

			expect(yield* fake.runUpdates).toContainEqual(
				expect.objectContaining({ runId: "run_1", status: "running" }),
			);
			expect(integrationUpdates).toHaveLength(1);
			expect(integrationUpdates[0]).toMatchObject({
				userId: "user_1",
				integrationId: "int_1",
				lastFinishedAt: expect.any(Date),
			});
		}),
	);
});

layer(makeTestLayer({ integration: null, capturesChildren: true }))((test) => {
	test.effect("fails the run when the integration is not found", () =>
		Effect.gen(function* () {
			const fake = yield* FakeIntegrationRun;
			yield* runIntegrationRunWorkflow(sinkPayload, "run_1");

			expect([...(yield* fake.sandboxCalls), ...(yield* fake.childDispatches)]).toHaveLength(0);
			expect(yield* fake.runUpdates).toEqual([
				expect.objectContaining({
					runId: "run_1",
					status: "failed",
					failureReason: { code: "integration-not-found" },
				}),
			]);
		}),
	);
});

layer(
	makeTestLayer({
		runStatus: "failed",
		capturesChildren: true,
		sandboxFailure: "Failed to run integration",
		integration: makeIntegration({ lot: "yank" }),
	}),
)((test) => {
	test.effect("fails the whole run on catastrophic yank provider failure", () =>
		Effect.gen(function* () {
			const fake = yield* FakeIntegrationRun;
			yield* runIntegrationRunWorkflow(yankPayload, "run_1");

			expect(yield* fake.childDispatches).toHaveLength(0);
			expect(yield* fake.runUpdates).toContainEqual(
				expect.objectContaining({
					runId: "run_1",
					status: "failed",
					failureReason: { code: "unexpected-failure", operation: "integration-import" },
				}),
			);
		}),
	);
});

layer(makeTestLayer({ sandboxInterrupt: true }))((test) => {
	test.effect("preserves workflow suspension while awaiting the plugin import child", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(runIntegrationRunWorkflow(sinkPayload, "run_1"));

			expect(exit._tag).toBe("Failure");
			expect(yield* (yield* FakeIntegrationRun).runUpdates).not.toContainEqual(
				expect.objectContaining({ status: "failed" }),
			);
		}),
	);
});

layer(
	makeTestLayer({
		disableWins: true,
		emitsSignals: true,
		runStatus: "failed",
		integration: makeIntegration({
			lot: "yank",
			extraSettings: { disableOnContinuousErrors: true },
		}),
		recentStatuses: [
			{ status: "failed" },
			{ status: "failed" },
			{ status: "failed" },
			{ status: "failed" },
			{ status: "failed" },
		],
	}),
)((test) => {
	test.effect("disables a yank integration after continuous failures during finalization", () =>
		Effect.gen(function* () {
			const fake = yield* FakeIntegrationRun;
			yield* runIntegrationRunWorkflow(yankPayload, "run_1");

			expect(yield* fake.integrationUpdates).toEqual([
				{ runId: "run_1", userId: "user_1", isDisabled: true, integrationId: "int_1" },
			]);
			expect((yield* fake.emittedSignals).at(-1)).toMatchObject({
				schemaSlug: "integration.disabled",
				principal: { kind: "user", userId: "user_1" },
				properties: { integrationId: "int_1", providerName: "test-provider" },
				command: {
					occurredAt: expect.any(String),
					itemIdentity: '["[\\"integration-run\\",\\"run_1\\"]","signal","integration.disabled"]',
					causation: {
						executionId: "run_1",
						importRunId: "run_1",
						source: "integration",
						integrationId: "int_1",
						rootExecutionId: "run_1",
						initiator: { id: "int_1", kind: "integration" },
					},
				},
			});
		}),
	);
});
