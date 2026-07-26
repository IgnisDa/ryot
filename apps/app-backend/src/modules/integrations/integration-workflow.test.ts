import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { SandboxRunError } from "@ryot/contract/errors";
import {
	ImportRunId,
	IntegrationId,
	SandboxScriptId,
	SignalId,
	SignalSchemaSlug,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { RedisService } from "#lib/infrastructure/redis";
import type { MockOverrides, WorkflowEngineOverrides } from "#lib/test-utils/effect";
import {
	dbRunnerLayer,
	makeAppConfigLayer,
	makeRedisService,
	makeWorkflowActivityEngine,
} from "#lib/test-utils/effect";
import { ImportRunFailuresService } from "#modules/imports/failure-service";
import { ImportsRepository } from "#modules/imports/repository";
import { ImportsService } from "#modules/imports/service";
import { IntegrationProviderCatalog } from "#modules/plugins/integration-provider-catalog";
import { SandboxExecutionService } from "#modules/sandbox/service";
import { SignalEmissionService, type EmitSignalInput } from "#modules/signals/service";

import { ProcessIntegrationRunWorkflow } from "./integration-workflow";
import { runIntegrationRunWorkflow } from "./integration-workflow-live";
import {
	IntegrationRunOperations,
	type IntegrationRunOperationsValue,
} from "./operations-workflow";
import { IntegrationsRepository } from "./repository";
import { IntegrationsService } from "./service";
import { makeIntegration, makeRun } from "./test-support";

const now = "2026-06-17T00:00:00.000Z";

const mockImportsService = Layer.mock(ImportsService);
const mockImportsRepository = Layer.mock(ImportsRepository);
const mockIntegrationsService = Layer.mock(IntegrationsService);
const mockSignalEmissionService = Layer.mock(SignalEmissionService);
const mockIntegrationsRepository = Layer.mock(IntegrationsRepository);
const mockImportRunFailuresService = Layer.mock(ImportRunFailuresService);

const movieGroup = () => ({
	itemIndex: 0,
	collectionMemberships: [],
	events: [{ occurredAt: now, eventSchemaSlug: "progress", properties: { progressPercent: 30 } }],
	entityRef: {
		externalId: "603",
		sourceLabel: "603",
		entitySchemaSlug: "movie",
		kind: "resolved" as const,
		providerSlug: "movie.tmdb",
	},
});

const makeImportsRepository = (overrides: MockOverrides<typeof mockImportsRepository> = {}) =>
	mockImportsRepository({
		getRunById: () => Effect.succeed(null),
		listRecentStatusesByIntegrationId: () => Effect.succeed([]),
		...overrides,
	});

const makeImportRunFailuresService = (
	overrides: MockOverrides<typeof mockImportRunFailuresService> = {},
) =>
	mockImportRunFailuresService({
		create: () => Effect.void,
		...overrides,
	});

const makeImportsService = (overrides: MockOverrides<typeof mockImportsService> = {}) =>
	mockImportsService({
		update: () => Effect.void,
		...overrides,
	});

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
		update: () => Effect.succeed(makeIntegration()),
		disableIfEnabled: () => Effect.succeed(false),
		...overrides,
	});

const makeSignalEmissionService = (
	overrides: MockOverrides<typeof mockSignalEmissionService> = {},
) =>
	mockSignalEmissionService({
		emit: () => Effect.die("unexpected signal emission"),
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
	integrationOperations?: Partial<IntegrationRunOperationsValue>;
	importRunFailuresService?: Layer.Layer<ImportRunFailuresService>;
};

const makeIntegrationOperations = (overrides: Partial<IntegrationRunOperationsValue> = {}) =>
	Layer.mock(IntegrationRunOperations, {
		runAdapter: () =>
			Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: { failures: [], entityGroups: [movieGroup()] },
			}),
		...overrides,
	});

const makeTestLayer = (options: TestLayerOptions) =>
	Layer.mergeAll(
		dbRunnerLayer,
		makeAppConfigLayer(),
		BunFileSystem.layer,
		makeRedisLayer(),
		makeIntegrationOperations(options.integrationOperations),
		Layer.mock(IntegrationProviderCatalog)({
			list: () => [],
			resolveOwned: () => null,
			find: () => ({
				lot: "sink",
				pluginSlug: "media",
				name: "Test provider",
				slug: "test-provider",
				description: "Test provider",
				settingsSchema: { fields: {} },
				scriptSlug: "integration.test-provider",
			}),
			findOwned: (providerSlug, pluginSlug) => {
				options.providerLookups?.push({ providerSlug, pluginSlug });
				return pluginSlug === "fixture"
					? {
							lot: "sink",
							name: "Test provider",
							slug: "test-provider",
							pluginSlug: "fixture",
							description: "Test provider",
							settingsSchema: { fields: {} },
							scriptSlug: "integration.test-provider",
						}
					: null;
			},
		}),
		Layer.mock(SandboxExecutionService)({
			resolveWorkflowScript: (input) => {
				options.workflowResolutions?.push(input);
				return Effect.succeed(SandboxScriptId.make("workflow.media-import"));
			},
			executeWorkflow: (input) => {
				options.sandboxCalls?.push({ executionId: input.executionId, payload: input.input });
				if (options.sandboxInterrupt) {
					return Effect.interrupt;
				}
				return options.sandboxFailure
					? Effect.fail(new SandboxRunError({ message: options.sandboxFailure }))
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
			childDispatches.push({ executionId: dispatch.executionId, payload: dispatch.payload });
			return undefined;
		}),
});

const sinkPayload = {
	userId: UserId.make("user_1"),
	runId: ImportRunId.make("run_1"),
	contentType: "application/json",
	integrationId: IntegrationId.make("int_1"),
	rawBody: JSON.stringify({ lot: "movie", progress: 30, identifier: "603" }),
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
						integrationScriptSlug: "integration.test-provider",
					},
				},
			});
			expect(providerLookups).toEqual([{ providerSlug: "test-provider", pluginSlug: "fixture" }]);
			expect(workflowResolutions).toEqual([
				{ executionId: "run_1", workflowSlug: "import", pluginSlug: "fixture" },
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
		importsService: makeImportsService({
			update: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		integrationsRepository: makeIntegrationsRepository({
			getByIdAnyUser: () => Effect.succeed(null),
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
					errorSummary: "Integration not found",
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
		integrationOperations: {
			runAdapter: () => Effect.fail(new SandboxRunError({ message: "Failed to run integration" })),
		},
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
					errorSummary: "Failed to run integration",
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
		integrationOperations: {
			runAdapter: () => Effect.fail(new SandboxRunError({ message: "Failed to run integration" })),
		},
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
		integrationsRepository: makeIntegrationsRepository({
			getByIdAnyUser: () =>
				Effect.succeed(
					makeIntegration({
						lot: "yank",
						extraSettings: { disableOnContinuousErrors: true },
					}),
				),
		}),
		integrationsService: makeIntegrationsService({
			disableIfEnabled: (userId, integrationId, runId) => {
				integrationUpdates.push({ userId, integrationId, runId, isDisabled: true });
				return Effect.succeed(true);
			},
		}),
		signalEmissionService: makeSignalEmissionService({
			emit: (input) => {
				emitted = input;
				return Effect.succeed({
					wasCreated: true,
					recipientUserIds: input.principal.kind === "user" ? [input.principal.userId] : [],
					signal: {
						origin: input.origin,
						subjectEntityId: null,
						schemaSlug: input.schemaSlug,
						id: SignalId.make("signal-1"),
						createdAt: "2026-06-17T00:00:00.000Z",
						occurredAt: input.occurredAt.toISOString(),
						signalSchemaSlug: SignalSchemaSlug.make("signal-schema-1"),
						properties: { integrationId: "int_1", providerName: "test-provider" },
						actorUserId: input.principal.kind === "user" ? input.principal.userId : null,
					},
				});
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"run_1",
		Effect.gen(function* () {
			yield* runIntegrationRunWorkflow(yankPayload, "run_1");

			expect(integrationUpdates).toEqual([
				{ userId: "user_1", runId: "run_1", isDisabled: true, integrationId: "int_1" },
			]);
			expect(emitted).toMatchObject({
				executionId: "run_1",
				discriminator: "int_1",
				schemaSlug: "integration.disabled",
				principal: { kind: "user", userId: "user_1" },
				properties: { integrationId: "int_1", providerName: "test-provider" },
				origin: { kind: "integration", importRunId: "run_1", integrationId: "int_1" },
			});
			expect(emitted?.occurredAt).toBeInstanceOf(Date);
		}),
	);
});
