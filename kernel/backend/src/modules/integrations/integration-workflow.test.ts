import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import {
	AutomationTriggerId,
	ImportRunId,
	IntegrationId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { RedisService } from "#lib/infrastructure/redis";
import type { MockOverrides, WorkflowEngineOverrides } from "#lib/test-utils/effect";
import {
	databaseLayer,
	makeAppConfigLayer,
	makeRedisService,
	makeWorkflowActivityEngine,
} from "#lib/test-utils/effect";
import { SignalEmissionService, type EmitSignalInput } from "#modules/automations/signal-service";
import { ImportRunFailuresService } from "#modules/imports/failure-service";
import { ImportsRepository } from "#modules/imports/repository";
import { ImportsService } from "#modules/imports/service";
import { IntegrationProviderCatalog } from "#modules/plugins/integration-provider-catalog";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { ProcessIntegrationRunWorkflow } from "./integration-workflow";
import { runIntegrationRunWorkflow } from "./integration-workflow-live";
import { IntegrationsRepository } from "./repository";
import { IntegrationsService } from "./service";
import { makeIntegration, makeRun } from "./test-support";

const mockImportsService = Layer.mock(ImportsService);
const mockImportsRepository = Layer.mock(ImportsRepository);
const mockIntegrationsService = Layer.mock(IntegrationsService);
const mockSignalEmissionService = Layer.mock(SignalEmissionService);
const mockIntegrationsRepository = Layer.mock(IntegrationsRepository);
const mockImportRunFailuresService = Layer.mock(ImportRunFailuresService);

const makeImportsRepository = (overrides: MockOverrides<typeof mockImportsRepository> = {}) =>
	mockImportsRepository({
		getRunById: () => Effect.succeed(null),
		listRecentStatusesByIntegrationId: () => Effect.succeed([]),
		...overrides,
	});

const makeImportRunFailuresService = (
	overrides: MockOverrides<typeof mockImportRunFailuresService> = {},
) => mockImportRunFailuresService({ create: () => Effect.void, ...overrides });

const makeImportsService = (overrides: MockOverrides<typeof mockImportsService> = {}) =>
	mockImportsService({ update: () => Effect.void, ...overrides });

const makeIntegrationsRepository = (
	overrides: MockOverrides<typeof mockIntegrationsRepository> = {},
) =>
	mockIntegrationsRepository({
		getByIdAnyUser: () => Effect.succeed(makeIntegration()),
		getUserDisableIntegrations: () => Effect.succeed(false),
		...overrides,
	});

const makeIntegrationsService = (overrides: MockOverrides<typeof mockIntegrationsService> = {}) =>
	mockIntegrationsService({
		disableIfEnabled: () => Effect.succeed(false),
		update: () => Effect.succeed(makeIntegration()),
		...overrides,
	});

const makeSignalEmissionService = (
	overrides: MockOverrides<typeof mockSignalEmissionService> = {},
) =>
	mockSignalEmissionService({
		emitSignal: () => Effect.die("unexpected signal emission"),
		...overrides,
	});

const makeRedisLayer = () => {
	const store = new Map<string, string>();
	return Layer.succeed(
		RedisService,
		makeRedisService({
			get: (key) => Effect.succeed(store.get(key) ?? null),
			set: (key, value) =>
				Effect.sync(() => {
					store.set(key, value);
				}),
			del: (...keys) =>
				Effect.sync(() => {
					let removed = 0;
					for (const key of keys) {
						if (store.delete(key)) {
							removed += 1;
						}
					}
					return removed;
				}),
		}),
	);
};

type TestLayerOptions = {
	sandboxFailure?: string;
	sandboxInterrupt?: boolean;
	importsService?: Layer.Layer<ImportsService>;
	sandboxCalls?: Array<Record<string, unknown>>;
	providerLookups?: Array<Record<string, string>>;
	importsRepository?: Layer.Layer<ImportsRepository>;
	workflowResolutions?: Array<Record<string, string>>;
	integrationsService?: Layer.Layer<IntegrationsService>;
	signalEmissionService?: Layer.Layer<SignalEmissionService>;
	integrationsRepository?: Layer.Layer<IntegrationsRepository>;
	importRunFailuresService?: Layer.Layer<ImportRunFailuresService>;
};

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

const makeTestLayer = (options: TestLayerOptions) =>
	Layer.mergeAll(
		databaseLayer,
		makeAppConfigLayer(),
		BunFileSystem.layer,
		makeRedisLayer(),
		Layer.mock(IntegrationProviderCatalog)({
			listForUser: () => Effect.succeed([]),
			resolveOwnedForUser: () => Effect.succeed(null),
			findForUser: () => Effect.succeed(registeredProvider),
			findOwnedForUser: (_userId, providerSlug, installationId) => {
				options.providerLookups?.push({ providerSlug, installationId });
				return Effect.succeed(installationId === "inst_1" ? registeredProvider : null);
			},
		}),
		Layer.mock(SandboxExecutionService)({
			resolveWorkflowScript: (input) => {
				options.workflowResolutions?.push(input);
				return Effect.succeed(SandboxScriptId.make("workflow.example-import"));
			},
			executeWorkflow: (input) => {
				options.sandboxCalls?.push({ payload: input.input, executionId: input.executionId });
				if (options.sandboxInterrupt) {
					return Effect.interrupt;
				}
				return options.sandboxFailure
					? Effect.fail(
							new SandboxRunError({ kind: "script-failure", message: options.sandboxFailure }),
						)
					: Effect.succeed(null);
			},
		}),
		options.importsRepository ?? makeImportsRepository(),
		options.importsService ?? makeImportsService(),
		options.importRunFailuresService ?? makeImportRunFailuresService(),
		options.integrationsRepository ?? makeIntegrationsRepository(),
		options.integrationsService ?? makeIntegrationsService(),
		options.signalEmissionService ?? makeSignalEmissionService(),
	);

const withTestLayer = <A, E, R>(
	options: TestLayerOptions,
	executionId: string,
	effect: Effect.Effect<A, E, R>,
	engineOverrides: WorkflowEngineOverrides = {},
) => {
	const instance = WorkflowInstance.initial(ProcessIntegrationRunWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(instance, engineOverrides);

	return effect.pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(makeTestLayer(options)),
	);
};

const captureChildExecute = (
	childDispatches: Array<Record<string, unknown>>,
): WorkflowEngineOverrides => ({
	execute: (_workflow, dispatch) =>
		Effect.sync(() => {
			childDispatches.push({ payload: dispatch.payload, executionId: dispatch.executionId });
			return undefined;
		}),
});

const sinkPayload = {
	userId: UserId.make("user_1"),
	runId: ImportRunId.make("run_1"),
	integrationId: IntegrationId.make("int_1"),
	webhook: {
		contentType: "application/json",
		rawBody: JSON.stringify({ lot: "item", progress: 30, identifier: "603" }),
	},
};

const yankPayload = {
	userId: UserId.make("user_1"),
	runId: ImportRunId.make("run_1"),
	integrationId: IntegrationId.make("int_1"),
};

it.effect("persists the sink adapter result and dispatches the normalized child", () => {
	const providerLookups: Array<Record<string, string>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];
	const childDispatches: Array<Record<string, unknown>> = [];
	const integrationUpdates: Array<Record<string, unknown>> = [];
	const workflowResolutions: Array<Record<string, string>> = [];

	const options = {
		providerLookups,
		workflowResolutions,
		sandboxCalls: childDispatches,
		importsRepository: makeImportsRepository({
			getRunById: () => Effect.succeed(makeRun("completed")),
		}),
		importsService: makeImportsService({
			update: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		integrationsService: makeIntegrationsService({
			update: (userId, integrationId, body) => {
				integrationUpdates.push({ userId, integrationId, ...body });
				return Effect.succeed(makeIntegration());
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"run_1",
		Effect.gen(function* () {
			yield* runIntegrationRunWorkflow(sinkPayload, "run_1");

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
			expect(providerLookups).toEqual([
				{ installationId: "inst_1", providerSlug: "test-provider" },
			]);
			expect(workflowResolutions).toEqual([
				{
					userId: "user_1",
					executionId: "run_1",
					workflowSlug: "import",
					pluginId: "fixture-plugin-id",
					pluginInstallationId: "inst_1",
				},
			]);

			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({ runId: "run_1", status: "running" }),
			);
			expect(integrationUpdates).toHaveLength(1);
			expect(integrationUpdates[0]).toMatchObject({
				userId: "user_1",
				integrationId: "int_1",
				lastFinishedAt: expect.any(Date),
			});
		}),
		captureChildExecute(childDispatches),
	);
});

it.effect("fails the run when the integration is not found", () => {
	const childDispatches: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];

	const options = {
		sandboxCalls: childDispatches,
		integrationsRepository: makeIntegrationsRepository({
			getByIdAnyUser: () => Effect.succeed(null),
		}),
		importsService: makeImportsService({
			update: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"run_1",
		Effect.gen(function* () {
			yield* runIntegrationRunWorkflow(sinkPayload, "run_1");

			expect(childDispatches).toHaveLength(0);
			expect(recordedUpdates).toEqual([
				expect.objectContaining({
					runId: "run_1",
					status: "failed",
					failureReason: { code: "integration-not-found" },
				}),
			]);
		}),
		captureChildExecute(childDispatches),
	);
});

it.effect("fails the whole run on catastrophic yank provider failure", () => {
	const childDispatches: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];

	const options = {
		sandboxFailure: "Failed to run integration",
		importsRepository: makeImportsRepository({
			getRunById: () => Effect.succeed(makeRun("failed")),
		}),
		importsService: makeImportsService({
			update: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		integrationsRepository: makeIntegrationsRepository({
			getByIdAnyUser: () => Effect.succeed(makeIntegration({ lot: "yank" })),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"run_1",
		Effect.gen(function* () {
			yield* runIntegrationRunWorkflow(yankPayload, "run_1");

			expect(childDispatches).toHaveLength(0);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({
					runId: "run_1",
					status: "failed",
					failureReason: { code: "unexpected-failure", operation: "integration-import" },
				}),
			);
		}),
		captureChildExecute(childDispatches),
	);
});

it.effect("preserves workflow suspension while awaiting the plugin import child", () => {
	const recordedUpdates: Array<Record<string, unknown>> = [];
	const options = {
		sandboxInterrupt: true,
		importsService: makeImportsService({
			update: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"run_1",
		Effect.gen(function* () {
			const exit = yield* Effect.exit(runIntegrationRunWorkflow(sinkPayload, "run_1"));

			expect(exit._tag).toBe("Failure");
			expect(recordedUpdates).not.toContainEqual(expect.objectContaining({ status: "failed" }));
		}),
	);
});

it.effect("disables a yank integration after continuous failures during finalization", () => {
	let emitted: EmitSignalInput | undefined;
	const integrationUpdates: Array<Record<string, unknown>> = [];

	const options = {
		integrationsRepository: makeIntegrationsRepository({
			getByIdAnyUser: () =>
				Effect.succeed(
					makeIntegration({ lot: "yank", extraSettings: { disableOnContinuousErrors: true } }),
				),
		}),
		integrationsService: makeIntegrationsService({
			disableIfEnabled: (userId, integrationId, runId) => {
				integrationUpdates.push({ runId, userId, integrationId, isDisabled: true });
				return Effect.succeed(true);
			},
		}),
		signalEmissionService: makeSignalEmissionService({
			emitSignal: (input) => {
				emitted = input;
				return Effect.succeed({
					warnings: [],
					wasCreated: true,
					triggerId: AutomationTriggerId.make("trigger-1"),
				});
			},
		}),
		importsRepository: makeImportsRepository({
			getRunById: () => Effect.succeed(makeRun("failed")),
			listRecentStatusesByIntegrationId: () =>
				Effect.succeed([
					{ status: "failed" as const },
					{ status: "failed" as const },
					{ status: "failed" as const },
					{ status: "failed" as const },
					{ status: "failed" as const },
				]),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"run_1",
		Effect.gen(function* () {
			yield* runIntegrationRunWorkflow(yankPayload, "run_1");

			expect(integrationUpdates).toEqual([
				{ runId: "run_1", userId: "user_1", isDisabled: true, integrationId: "int_1" },
			]);
			expect(emitted).toMatchObject({
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
