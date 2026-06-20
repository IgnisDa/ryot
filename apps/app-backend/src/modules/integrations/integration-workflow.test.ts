import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import {
	EntitySchemaId,
	ImportRunId,
	IntegrationId,
	SandboxScriptId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { RedisService } from "#lib/infrastructure/redis";
import type { MockOverrides, WorkflowEngineOverrides } from "#lib/test-support/effect";
import {
	dbRunnerLayer,
	makeAppConfigLayer,
	makeRedisService,
	makeWorkflowActivityEngine,
} from "#lib/test-support/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { ImportRunFailuresService } from "#modules/imports/failure-service";
import { ImportsRepository } from "#modules/imports/repository";
import { loadImportAdapterResult } from "#modules/imports/runtime/source-payload-store";
import { ImportsService } from "#modules/imports/service";

import { ProcessIntegrationRunWorkflow } from "./integration-workflow";
import { runIntegrationRunWorkflow } from "./integration-workflow-live";
import {
	IntegrationRunOperations,
	type IntegrationRunOperationsValue,
} from "./operations-workflow";
import { IntegrationsRepository } from "./repository";
import { IntegrationsService } from "./service";
import {
	makeIntegration,
	makeKomgaIntegration,
	makeRun,
	makeYoutubeMusicIntegration,
} from "./test-support";

const now = "2026-06-17T00:00:00.000Z";

const mockImportsRepository = Layer.mock(ImportsRepository);
const mockImportRunFailuresService = Layer.mock(ImportRunFailuresService);
const mockImportsService = Layer.mock(ImportsService);
const mockIntegrationsRepository = Layer.mock(IntegrationsRepository);
const mockIntegrationsService = Layer.mock(IntegrationsService);
const mockEntitiesRepository = Layer.mock(EntitiesRepository);

const mangaGroup = (overrides: Record<string, unknown> = {}) => ({
	itemIndex: 0,
	collectionMemberships: [],
	events: [{ occurredAt: now, eventSchemaSlug: "progress", properties: { progressPercent: 50 } }],
	entityRef: {
		externalId: "30002",
		sourceLabel: "Berserk",
		entitySchemaSlug: "manga",
		kind: "resolved" as const,
		scriptSlug: "manga.anilist",
	},
	...overrides,
});

const makeImportsRepository = (overrides: MockOverrides<typeof mockImportsRepository> = {}) =>
	mockImportsRepository({
		getRunById: () => Effect.succeed(null),
		listRecentStatusesByIntegrationId: () => Effect.succeed([]),
		...overrides,
		_tag: "ImportsRepository",
	});

const makeImportRunFailuresService = (
	overrides: MockOverrides<typeof mockImportRunFailuresService> = {},
) =>
	mockImportRunFailuresService({
		create: () => Effect.void,
		...overrides,
		_tag: "ImportRunFailuresService",
	});

const makeImportsService = (overrides: MockOverrides<typeof mockImportsService> = {}) =>
	mockImportsService({
		update: () => Effect.void,
		...overrides,
		_tag: "ImportsService",
	});

const makeIntegrationsRepository = (
	overrides: MockOverrides<typeof mockIntegrationsRepository> = {},
) =>
	mockIntegrationsRepository({
		getByIdAnyUser: () => Effect.succeed(makeIntegration()),
		getUserDisableIntegrations: () => Effect.succeed(false),
		...overrides,
		_tag: "IntegrationsRepository",
	});

const makeIntegrationsService = (overrides: MockOverrides<typeof mockIntegrationsService> = {}) =>
	mockIntegrationsService({
		update: () => Effect.succeed(makeIntegration()),
		...overrides,
		_tag: "IntegrationsService",
	});

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({
		findEntitySchemaSandboxScriptBySlug: (slug) => {
			let result: { entitySchemaId: EntitySchemaId; sandboxScriptId: SandboxScriptId } | null =
				null;
			switch (slug) {
				case "movie.tmdb": {
					result = {
						entitySchemaId: EntitySchemaId.make("schema-movie"),
						sandboxScriptId: SandboxScriptId.make("script-movie-tmdb"),
					};
					break;
				}
				case "manga.anilist": {
					result = {
						entitySchemaId: EntitySchemaId.make("schema-manga"),
						sandboxScriptId: SandboxScriptId.make("script-manga-anilist"),
					};
					break;
				}
				case "music.youtube-music": {
					result = {
						entitySchemaId: EntitySchemaId.make("schema-music"),
						sandboxScriptId: SandboxScriptId.make("script-youtube-music"),
					};
					break;
				}
			}
			return Effect.succeed(result);
		},
		...overrides,
		_tag: "EntitiesRepository",
	});

const makeRedisLayer = () => {
	const store = new Map<string, string>();
	return Layer.succeed(
		RedisService,
		makeRedisService({
			claim: () => Effect.succeed(true),
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
	importsRepository?: Layer.Layer<ImportsRepository>;
	importsService?: Layer.Layer<ImportsService>;
	importRunFailuresService?: Layer.Layer<ImportRunFailuresService>;
	integrationsRepository?: Layer.Layer<IntegrationsRepository>;
	integrationsService?: Layer.Layer<IntegrationsService>;
	integrationOperations?: Partial<IntegrationRunOperationsValue>;
};

const makeIntegrationOperations = (overrides: Partial<IntegrationRunOperationsValue> = {}) =>
	Layer.mock(IntegrationRunOperations, {
		loadYankAdapterResult: () =>
			Effect.succeed({ cleanupPaths: [], adapterResult: { failures: [], entityGroups: [] } }),
		runSandboxHistory: () =>
			Effect.succeed({ status: "completed" as const, value: { songs: [] }, logs: [], error: null }),
		...overrides,
	});

const makeTestLayer = (options: TestLayerOptions) =>
	Layer.mergeAll(
		dbRunnerLayer,
		makeAppConfigLayer(),
		BunFileSystem.layer,
		makeRedisLayer(),
		makeIntegrationOperations(options.integrationOperations),
		options.importsRepository ?? makeImportsRepository(),
		options.importsService ?? makeImportsService(),
		options.importRunFailuresService ?? makeImportRunFailuresService(),
		options.integrationsRepository ?? makeIntegrationsRepository(),
		options.integrationsService ?? makeIntegrationsService(),
		makeEntitiesRepository(),
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
	const childDispatches: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];
	const integrationUpdates: Array<Record<string, unknown>> = [];

	const options = {
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

			const stored = yield* loadImportAdapterResult("run_1");
			expect(stored?.entityGroups).toHaveLength(1);
			expect(stored?.entityGroups[0]?.entityRef).toMatchObject({ externalId: "603" });

			expect(childDispatches).toHaveLength(1);
			expect(childDispatches[0]).toMatchObject({
				executionId: "run_1-normalized",
				payload: {
					runId: "run_1",
					userId: "user_1",
					integrationId: "int_1",
					executionId: "run_1-normalized",
				},
			});

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

it.effect(
	"records adapter-only sink failures and fails the run without dispatching a child",
	() => {
		const childDispatches: Array<Record<string, unknown>> = [];
		const recordedFailures: Array<Record<string, unknown>> = [];
		const recordedUpdates: Array<Record<string, unknown>> = [];

		const options = {
			importsRepository: makeImportsRepository({
				getRunById: () => Effect.succeed(makeRun("failed")),
			}),
			importRunFailuresService: makeImportRunFailuresService({
				create: (input) => {
					recordedFailures.push(input);
					return Effect.void;
				},
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
				yield* runIntegrationRunWorkflow(
					{
						rawBody: "{}",
						userId: UserId.make("user_1"),
						runId: ImportRunId.make("run_1"),
						contentType: "application/json",
						integrationId: IntegrationId.make("int_1"),
					},
					"run_1",
				);

				expect(childDispatches).toHaveLength(0);
				expect(recordedFailures).toEqual([
					{
						itemIndex: 0,
						context: null,
						runId: "run_1",
						sourceLabel: undefined,
						sourceIdentifier: undefined,
						stage: "input_transformation",
						message: "Could not parse Kodi webhook payload",
					},
				]);
				expect(recordedUpdates).toContainEqual(
					expect.objectContaining({
						runId: "run_1",
						progress: 100,
						totalItems: 1,
						failedItems: 1,
						processedItems: 1,
					}),
				);
				expect(recordedUpdates).toContainEqual(
					expect.objectContaining({
						runId: "run_1",
						status: "failed",
						errorSummary: "Could not parse Kodi webhook payload",
					}),
				);
			}),
			captureChildExecute(childDispatches),
		);
	},
);

it.effect("fails the run when the integration is not found", () => {
	const childDispatches: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];

	const options = {
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

it.effect("persists the komga yank adapter result and dispatches the normalized child", () => {
	const childDispatches: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];
	const integrationUpdates: Array<Record<string, unknown>> = [];

	const options = {
		integrationOperations: {
			loadYankAdapterResult: () =>
				Effect.succeed({
					cleanupPaths: [],
					adapterResult: { failures: [], entityGroups: [mangaGroup()] },
				}),
		},
		importsRepository: makeImportsRepository({
			getRunById: () => Effect.succeed(makeRun("completed")),
		}),
		importsService: makeImportsService({
			update: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		integrationsRepository: makeIntegrationsRepository({
			getByIdAnyUser: () => Effect.succeed(makeKomgaIntegration()),
		}),
		integrationsService: makeIntegrationsService({
			update: (userId, integrationId, body) => {
				integrationUpdates.push({ userId, integrationId, ...body });
				return Effect.succeed(makeKomgaIntegration());
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"run_1",
		Effect.gen(function* () {
			yield* runIntegrationRunWorkflow(yankPayload, "run_1");

			const stored = yield* loadImportAdapterResult("run_1");
			expect(stored?.entityGroups).toHaveLength(1);
			expect(stored?.entityGroups[0]?.entityRef).toMatchObject({ externalId: "30002" });

			expect(childDispatches).toHaveLength(1);
			expect(childDispatches[0]).toMatchObject({
				executionId: "run_1-normalized",
				payload: { runId: "run_1", integrationId: "int_1", executionId: "run_1-normalized" },
			});

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

it.effect("fails the whole run on catastrophic yank provider failure", () => {
	const childDispatches: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];

	const options = {
		integrationOperations: {
			loadYankAdapterResult: () =>
				Effect.fail({ cleanupPaths: [], message: "Failed to fetch data from Komga" }),
		},
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
			getByIdAnyUser: () => Effect.succeed(makeKomgaIntegration()),
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
					errorSummary: "Failed to fetch data from Komga",
				}),
			);
		}),
		captureChildExecute(childDispatches),
	);
});

it.effect("persists synced yank ownership items into the adapter artifact", () => {
	const childDispatches: Array<Record<string, unknown>> = [];

	const options = {
		integrationOperations: {
			loadYankAdapterResult: () =>
				Effect.succeed({
					cleanupPaths: [],
					adapterResult: {
						failures: [],
						entityGroups: [mangaGroup({ events: [], ownershipProvider: "komga" })],
					},
				}),
		},
		importsRepository: makeImportsRepository({
			getRunById: () => Effect.succeed(makeRun("completed")),
		}),
		integrationsRepository: makeIntegrationsRepository({
			getByIdAnyUser: () => Effect.succeed(makeKomgaIntegration({ syncOwnership: true })),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"run_1",
		Effect.gen(function* () {
			yield* runIntegrationRunWorkflow(yankPayload, "run_1");

			const stored = yield* loadImportAdapterResult("run_1");
			expect(stored?.entityGroups[0]).toMatchObject({ ownershipProvider: "komga" });
			expect(childDispatches).toHaveLength(1);
		}),
		captureChildExecute(childDispatches),
	);
});

it.effect("runs a YouTube Music yank through workflow-owned sandbox execution", () => {
	const childDispatches: Array<Record<string, unknown>> = [];
	const sandboxCalls: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];

	const options = {
		integrationOperations: {
			runSandboxHistory: (input) =>
				Effect.sync(() => {
					sandboxCalls.push(input);
					return {
						logs: [],
						error: null,
						status: "completed" as const,
						value: { songs: [{ title: "Song A", videoId: "vid1" }] },
					};
				}),
		},
		integrationsRepository: makeIntegrationsRepository({
			getByIdAnyUser: () => Effect.succeed(makeYoutubeMusicIntegration()),
		}),
		importsRepository: makeImportsRepository({
			getRunById: () => Effect.succeed(makeRun("completed")),
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
			yield* runIntegrationRunWorkflow(yankPayload, "run_1");

			expect(sandboxCalls).toEqual([
				{
					userId: "user_1",
					scriptId: "script-youtube-music",
					executionId: "run_1-youtube-music-history",
					context: { authCookie: "cookie", timezone: "America/New_York" },
				},
			]);

			const stored = yield* loadImportAdapterResult("run_1");
			expect(stored?.entityGroups).toHaveLength(1);
			expect(stored?.entityGroups[0]?.entityRef).toMatchObject({ externalId: "vid1" });

			expect(childDispatches).toHaveLength(1);
			expect(childDispatches[0]).toMatchObject({ executionId: "run_1-normalized" });
		}),
		captureChildExecute(childDispatches),
	);
});

it.effect("records a YouTube Music sandbox failure as a source-fetch failure", () => {
	const childDispatches: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];
	const recordedFailures: Array<Record<string, unknown>> = [];
	const integrationUpdates: Array<Record<string, unknown>> = [];

	const options = {
		integrationOperations: {
			runSandboxHistory: () =>
				Effect.succeed({
					logs: [],
					value: null,
					status: "completed" as const,
					error: "history fetch failed",
				}),
		},
		integrationsRepository: makeIntegrationsRepository({
			getByIdAnyUser: () => Effect.succeed(makeYoutubeMusicIntegration()),
		}),
		integrationsService: makeIntegrationsService({
			update: (userId, integrationId, body) => {
				integrationUpdates.push({ userId, integrationId, ...body });
				return Effect.succeed(makeYoutubeMusicIntegration());
			},
		}),
		importsRepository: makeImportsRepository({
			getRunById: () => Effect.succeed(makeRun("failed")),
		}),
		importRunFailuresService: makeImportRunFailuresService({
			create: (input) => {
				recordedFailures.push(input);
				return Effect.void;
			},
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
			yield* runIntegrationRunWorkflow(yankPayload, "run_1");

			expect(childDispatches).toHaveLength(0);
			expect(recordedFailures).toContainEqual(
				expect.objectContaining({
					itemIndex: 0,
					runId: "run_1",
					stage: "source_fetch",
					message: "history fetch failed",
				}),
			);
			expect(integrationUpdates).toEqual([]);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({ runId: "run_1", failedItems: 1, processedItems: 1 }),
			);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({ runId: "run_1", status: "failed" }),
			);
		}),
		captureChildExecute(childDispatches),
	);
});

it.effect("disables a yank integration after continuous failures during finalization", () => {
	const integrationUpdates: Array<Record<string, unknown>> = [];
	const notificationDispatches: Array<Record<string, unknown>> = [];

	const options = {
		integrationOperations: {
			loadYankAdapterResult: () =>
				Effect.fail({ cleanupPaths: [], message: "Failed to fetch data from Komga" }),
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
					makeKomgaIntegration({ extraSettings: { disableOnContinuousErrors: true } }),
				),
		}),
		integrationsService: makeIntegrationsService({
			update: (userId, integrationId, body) => {
				integrationUpdates.push({ userId, integrationId, ...body });
				return Effect.succeed(makeKomgaIntegration({ isDisabled: true }));
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"run_1",
		Effect.gen(function* () {
			yield* runIntegrationRunWorkflow(yankPayload, "run_1");

			expect(integrationUpdates).toEqual([
				{ userId: "user_1", isDisabled: true, integrationId: "int_1" },
			]);
			expect(notificationDispatches).toEqual([
				{
					workflowName: "NotificationDeliveryWorkflow",
					// The engine-level id is a hash of the workflow idempotency key
					// (payload.executionId), so only the payload carries the raw value.
					executionId: expect.any(String),
					payload: {
						userId: "user_1",
						executionId: "run_1-integration-disabled",
						request: {
							kind: "event",
							eventType: "integration_disabled_due_to_too_many_errors",
							message: "Integration komga has been disabled due to too many errors",
						},
					},
				},
			]);
		}),
		{
			execute: (workflow, dispatch) =>
				Effect.sync(() => {
					notificationDispatches.push({
						payload: dispatch.payload,
						workflowName: workflow.name,
						executionId: dispatch.executionId,
					});
					return undefined;
				}),
		},
	);
});
