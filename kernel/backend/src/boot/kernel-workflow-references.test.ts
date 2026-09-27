import { BunFileSystem } from "@effect/platform-bun";
import { expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import {
	KERNEL_EVENT_CREATE_WORKFLOW,
	KERNEL_ENTITY_IMPORT_WORKFLOW,
	KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW,
	KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
} from "@ryot-app/contract/modules/plugins/execution";
import {
	EntitySchemaSlug,
	ImportRunId,
	IntegrationId,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import { makeWorkflowEngine } from "#lib/test-utils/effect";
import { mutationAdmissionTestLayer } from "#lib/test-utils/mutation-admission";
import { IngestionCaptures } from "#modules/imports/capture-service";
import { ingestionTestRun } from "#modules/imports/ingestion.test-support";
import { ImportsRepository } from "#modules/imports/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { KernelWorkflowReferences } from "#modules/sandbox/kernel-workflow-references";

import { KernelWorkflowReferencesLive } from "./kernel-workflow-references";

const mockImportsRepository = Layer.mock(ImportsRepository);
const captureDependencies = Layer.mergeAll(
	Layer.mock(IngestionCaptures)({}),
	Layer.mock(SandboxArtifactStore)({}),
	BunFileSystem.layer,
);
const mockIntegrationsRepository = Layer.mock(IntegrationsRepository);
const unownedRepositories = Layer.mergeAll(
	mockImportsRepository({
		getRunById: () => Effect.succeed(null),
		getIngestionRun: () => Effect.succeed(null),
	}),
	mockIntegrationsRepository({ getForUser: () => Effect.succeed(null) }),
);

const referencesLayer = (repositories: Layer.Layer<ImportsRepository | IntegrationsRepository>) =>
	Layer.provide(
		KernelWorkflowReferencesLive,
		Layer.mergeAll(
			mutationAdmissionTestLayer,
			captureDependencies,
			repositories,
			Layer.mock(PluginRuntimeResolver)({}),
		),
	);

const populationReferencesLayer = (
	authorizes: (providerId: SandboxProviderId) => boolean = () => true,
) =>
	Layer.provide(
		KernelWorkflowReferencesLive,
		Layer.mergeAll(
			mutationAdmissionTestLayer,
			captureDependencies,
			unownedRepositories,
			Layer.mock(PluginRuntimeResolver)({
				findAuthorizedSchemaProviderById: ({ providerId }) =>
					Effect.succeed(
						authorizes(providerId)
							? {
									entitySchemaSlug: EntitySchemaSlug.make("record"),
									provider: {
										id: providerId,
										name: "Records",
										slug: "record.catalog",
										createdAt: new Date(0),
										updatedAt: new Date(0),
										pluginId: "provider-owner",
										rootEntitySchemaSlug: "record",
										information: { source: "catalog" },
									},
								}
							: null,
					),
				findActiveScriptById: () =>
					Effect.succeed({
						providerId: null,
						source: "source",
						compiledFormat: 1,
						pluginId: "catalog",
						pluginSlug: "catalog",
						createdAt: new Date(0),
						updatedAt: new Date(0),
						name: "Catalog refresh",
						slug: "catalog.refresh",
						compiledCode: "compiled",
						contentHash: "workflow-hash",
						pluginRevisionId: "catalog-revision",
						id: SandboxScriptId.make("caller-script"),
						metadata: {
							kind: "workflow",
							capabilities: [],
							name: "Catalog refresh",
							slug: "catalog.refresh",
							oauthConnectionFields: [],
							executableDependencies: [],
							requiredPluginConfigKeys: [],
							optionalPluginConfigKeys: [],
						},
					}),
			}),
		),
	);

type ExecuteArgs = Parameters<WorkflowEngine["Service"]["execute"]>;
type ExecuteOptions = ExecuteArgs[1];

class RecordedWorkflowDispatches extends Context.Service<
	RecordedWorkflowDispatches,
	{
		readonly payloads: Effect.Effect<ReadonlyArray<unknown>>;
		readonly executionIds: Effect.Effect<ReadonlyArray<string>>;
	}
>()("test/RecordedWorkflowDispatches") {}

const recordingEngineLayer = (
	respond: (
		workflow: ExecuteArgs[0],
		options: ExecuteOptions,
		dispatchNumber: number,
	) => Effect.Effect<unknown, SandboxRunError>,
) =>
	Layer.effectContext(
		Effect.gen(function* () {
			const dispatches = yield* Ref.make<ReadonlyArray<ExecuteOptions>>([]);
			return Context.make(
				WorkflowEngine,
				makeWorkflowEngine({
					execute: (workflow, options) =>
						Ref.updateAndGet(dispatches, (all) => [...all, options]).pipe(
							Effect.flatMap((all) => respond(workflow, options, all.length)),
						),
				}),
			).pipe(
				Context.add(RecordedWorkflowDispatches, {
					payloads: Effect.map(Ref.get(dispatches), (all) => all.map(({ payload }) => payload)),
					executionIds: Effect.map(Ref.get(dispatches), (all) =>
						all.map(({ executionId }) => executionId),
					),
				}),
			);
		}),
	);

const unusedEngineLayer = Layer.succeed(WorkflowEngine, makeWorkflowEngine());

layer(
	KernelWorkflowReferencesLive.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				mutationAdmissionTestLayer,
				BunFileSystem.layer,
				unusedEngineLayer,
				Layer.mock(PluginRuntimeResolver)({}),
				mockIntegrationsRepository({}),
				mockImportsRepository({ getIngestionRun: () => Effect.succeed(ingestionTestRun()) }),
				Layer.mock(SandboxArtifactStore)({
					resolveOutputs: () => Effect.die("Replay must not resolve a temporary handle"),
				}),
				Layer.mock(IngestionCaptures)({
					resume: (input) =>
						Effect.succeed({
							id: input.id,
							state: input.state,
							phase: input.phase,
							ordinal: input.ordinal,
							checkpoint: input.checkpoint,
							payload: { byteSize: 10, locator: "durable-object", checksum: "persisted-checksum" },
						}),
				}),
			),
		),
	),
)((test) => {
	test.effect("replays capture publication without resolving the collector temporary handle", () =>
		Effect.gen(function* () {
			const references = yield* KernelWorkflowReferences;
			const result = yield* references.execute(
				KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW,
				{
					runId: "run-1",
					operation: {
						ordinal: 0,
						action: "capture",
						phase: "collection",
						captureId: "page-1",
						checkpoint: { page: 1 },
						handle: "deleted-temporary-handle",
					},
				},
				{
					type: "user",
					userId: UserId.make("user-1"),
					accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
				},
				"capture-child",
				"run-1-import",
				SandboxScriptId.make("caller-script"),
			);
			expect(result).toEqual({
				captureId: "page-1",
				handle: "deleted-temporary-handle",
				inputFingerprint: "persisted-checksum",
			});
		}),
	);
});

layer(
	referencesLayer(unownedRepositories).pipe(
		Layer.provideMerge(
			recordingEngineLayer((workflow) =>
				Effect.succeed(workflow._tag === "EventCreateWorkflow" ? [] : { id: "entity-1" }),
			),
		),
	),
)((test) => {
	test.effect("binds kernel workflow user ids to the trusted execution subject", () =>
		Effect.gen(function* () {
			const references = yield* KernelWorkflowReferences;
			const subject = {
				type: "user" as const,
				userId: UserId.make("trusted-user"),
				accountGeneration: {
					token: "test-account-generation",
					userId: UserId.make("trusted-user"),
				},
			};
			yield* references.execute(
				KERNEL_ENTITY_IMPORT_WORKFLOW,
				{
					providerId: "zeta",
					externalId: "record-1",
					entitySchemaSlug: "record",
					origin: { kind: "import" },
					userId: "attacker-selected-user",
				},
				subject,
				"entity-import-execution",
				"parent-execution",
				SandboxScriptId.make("caller-script"),
			);
			yield* references.execute(
				KERNEL_EVENT_CREATE_WORKFLOW,
				{ payload: [], origin: "import", userId: "attacker-selected-user" },
				subject,
				"event-create-execution",
				"parent-execution",
				SandboxScriptId.make("caller-script"),
			);

			expect(yield* (yield* RecordedWorkflowDispatches).payloads).toMatchObject([
				{
					executionId: "entity-import-execution",
					entityScope: { type: "global", userId: "trusted-user" },
				},
				{
					userId: "trusted-user",
					command: { causation: { executionId: "event-create-execution" } },
				},
			]);
		}),
	);
});

const slugResolvingReferencesLayer = Layer.provide(
	KernelWorkflowReferencesLive,
	Layer.mergeAll(
		mutationAdmissionTestLayer,
		captureDependencies,
		unownedRepositories,
		Layer.mock(PluginRuntimeResolver)({
			findSchemaProviderBySlug: () =>
				Effect.succeed({
					entitySchemaSlug: EntitySchemaSlug.make("group"),
					provider: {
						name: "Alpha",
						slug: "group.alpha",
						pluginId: "example",
						createdAt: new Date(0),
						updatedAt: new Date(0),
						rootEntitySchemaSlug: "group",
						information: { source: "alpha" },
						id: SandboxProviderId.make("provider-group-alpha"),
					},
				}),
		}),
	),
);

layer(
	slugResolvingReferencesLayer.pipe(
		Layer.provideMerge(recordingEngineLayer(() => Effect.succeed({ id: "entity-1" }))),
	),
)((test) => {
	test.effect("resolves plugin provider slugs before dispatching entity imports", () =>
		Effect.gen(function* () {
			const references = yield* KernelWorkflowReferences;
			yield* references.execute(
				KERNEL_ENTITY_IMPORT_WORKFLOW,
				{
					externalId: "group-1",
					origin: { kind: "import" },
					providerSlug: "group.alpha",
					entitySchemaSlug: "attacker-selected-schema",
				},
				{
					type: "user",
					userId: UserId.make("trusted-user"),
					accountGeneration: {
						token: "test-account-generation",
						userId: UserId.make("trusted-user"),
					},
				},
				"entity-import-execution",
				"parent-execution",
				SandboxScriptId.make("caller-script"),
			);

			expect(yield* (yield* RecordedWorkflowDispatches).payloads).toEqual([
				expect.objectContaining({
					entitySchemaSlug: "group",
					providerId: "provider-group-alpha",
					entityScope: { type: "global", userId: "trusted-user" },
				}),
			]);
		}),
	);
});

const ownedRepositories = Layer.mergeAll(
	mockImportsRepository({
		getIngestionRun: (scope) =>
			Effect.succeed({
				...ingestionTestRun(),
				id: scope.runId,
				userId: scope.userId,
				accountGeneration: scope.accountGeneration,
				pins: {
					scriptId: "script",
					pluginRevisionId: null,
					pluginConfigRevisionId: null,
					executionId: "parent/execution",
				},
			}),
		getRunById: () =>
			Effect.succeed({
				progress: 0,
				failedItems: 0,
				startedAt: null,
				finishedAt: null,
				inputSummary: {},
				importedItems: 0,
				totalItems: null,
				processedItems: 0,
				failureReason: null,
				status: "pending" as const,
				source: "open_scale" as const,
				id: ImportRunId.make("run-1"),
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			}),
	}),
	mockIntegrationsRepository({}),
);

layer(
	referencesLayer(ownedRepositories).pipe(
		Layer.provideMerge(
			recordingEngineLayer(() => Effect.succeed({ issues: [], summary: [], confirmed: [] })),
		),
	),
)((test) => {
	test.effect("keeps import handles opaque across the kernel child boundary", () =>
		Effect.gen(function* () {
			const references = yield* KernelWorkflowReferences;
			yield* references.execute(
				KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW,
				{
					runId: "run-1",
					operation: {
						ordinal: 0,
						action: "apply",
						batchId: "batch",
						captureId: "capture",
						inputFingerprint: "fingerprint",
					},
				},
				{
					type: "user",
					userId: UserId.make("trusted-user"),
					accountGeneration: {
						token: "test-account-generation",
						userId: UserId.make("trusted-user"),
					},
				},
				"child-execution",
				"parent/execution",
				SandboxScriptId.make("caller-script"),
			);

			expect(yield* (yield* RecordedWorkflowDispatches).payloads).toEqual([
				expect.objectContaining({
					ordinal: 0,
					batchId: "batch",
					captureId: "capture",
					userId: "trusted-user",
					executionId: "child-execution",
					inputFingerprint: "fingerprint",
					artifactOwnerExecutionId: "parent/execution",
					artifactReferenceExecutionId: "child-execution",
				}),
			]);
		}),
	);
});

layer(referencesLayer(unownedRepositories).pipe(Layer.provideMerge(unusedEngineLayer)))((test) => {
	test.effect("rejects user-scoped kernel workflows for system executions", () =>
		Effect.gen(function* () {
			const references = yield* KernelWorkflowReferences;
			const exit = yield* Effect.exit(
				references.execute(
					KERNEL_ENTITY_IMPORT_WORKFLOW,
					{
						providerId: "zeta",
						externalId: "record-1",
						entitySchemaSlug: "record",
						origin: { kind: "import" },
						userId: "attacker-selected-user",
					},
					{ type: "system" },
					"entity-import-execution",
					"parent-execution",
					SandboxScriptId.make("caller-script"),
				),
			);

			expect(exit.toString()).toContain("is not available for system executions");
		}),
	);
});

layer(referencesLayer(unownedRepositories).pipe(Layer.provideMerge(unusedEngineLayer)))((test) => {
	test.effect("rejects an import run owned by another user", () =>
		Effect.gen(function* () {
			const references = yield* KernelWorkflowReferences;
			const exit = yield* Effect.exit(
				references.execute(
					KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW,
					{
						totalItems: 0,
						failureCount: 0,
						writeItemCount: 0,
						runId: "victim-run",
						chunkHandles: ["harvest-handle-0"],
					},
					{
						type: "user",
						userId: UserId.make("trusted-user"),
						accountGeneration: {
							token: "test-account-generation",
							userId: UserId.make("trusted-user"),
						},
					},
					"entity-import-execution",
					"parent-execution",
					SandboxScriptId.make("caller-script"),
				),
			);

			expect(exit.toString()).toContain(
				"import run 'victim-run' does not belong to the executing user",
			);
		}),
	);
});

layer(referencesLayer(unownedRepositories).pipe(Layer.provideMerge(unusedEngineLayer)))((test) => {
	test.effect("rejects a trusted integration subject owned by another user", () =>
		Effect.gen(function* () {
			const references = yield* KernelWorkflowReferences;
			const exit = yield* Effect.exit(
				references.execute(
					KERNEL_EVENT_CREATE_WORKFLOW,
					{ payload: [] },
					{
						type: "user",
						userId: UserId.make("trusted-user"),
						integrationId: IntegrationId.make("victim-integration"),
						accountGeneration: {
							token: "test-account-generation",
							userId: UserId.make("trusted-user"),
						},
					},
					"event-create-execution",
					"parent-execution",
					SandboxScriptId.make("caller-script"),
				),
			);

			expect(exit.toString()).toContain(
				"integration 'victim-integration' does not belong to the executing user",
			);
		}),
	);
});

layer(
	populationReferencesLayer().pipe(
		Layer.provideMerge(
			recordingEngineLayer((_workflow, _options, dispatchNumber) =>
				Effect.succeed({ id: `entity-${dispatchNumber}` }),
			),
		),
	),
)((test) => {
	test.effect(
		"dispatches bounded provider population items with deterministic child ids using a cross-plugin provider",
		() =>
			Effect.gen(function* () {
				const references = yield* KernelWorkflowReferences;
				const result = yield* references.execute(
					KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
					{
						mode: "refresh",
						items: [
							{
								externalId: "record-1",
								entitySchemaSlug: "record",
								providerId: "provider-record-catalog",
							},
							{
								externalId: "record-2",
								entitySchemaSlug: "record",
								providerId: "provider-record-catalog",
							},
						],
					},
					{ type: "system" },
					"population-reference",
					"parent-execution",
					SandboxScriptId.make("caller-script"),
				);

				const dispatches = yield* RecordedWorkflowDispatches;
				expect(result).toEqual([{ id: "entity-1" }, { id: "entity-2" }]);
				expect(yield* dispatches.executionIds).toEqual([
					"population-reference-item-0",
					"population-reference-item-1",
				]);
				expect(yield* dispatches.payloads).toEqual([
					expect.objectContaining({
						mode: "refresh",
						externalId: "record-1",
						entitySchemaSlug: "record",
						providerId: "provider-record-catalog",
						executionId: "population-reference-item-0",
						entityScope: { userId: null, type: "global" },
						command: expect.objectContaining({
							itemIdentity: "kernel:provider-entity-population:0",
							causation: expect.objectContaining({
								source: "provider-refresh",
								executionId: "population-reference-item-0",
								providerExecutionId: "population-reference-item-0",
							}),
						}),
					}),
					expect.objectContaining({
						externalId: "record-2",
						executionId: "population-reference-item-1",
					}),
				]);
			}),
	);
});

layer(
	populationReferencesLayer().pipe(
		Layer.provideMerge(
			recordingEngineLayer((_workflow, options) => {
				if (options.executionId.endsWith("item-0")) {
					return new SandboxRunError({ kind: "script-failure", message: "first item failed" });
				}
				if (options.executionId.endsWith("item-2")) {
					return new SandboxRunError({ kind: "script-failure", message: "third item failed" });
				}
				return Effect.succeed({ id: options.executionId });
			}),
		),
	),
)((test) => {
	test.effect("awaits every provider population exit and reports failures in input order", () =>
		Effect.gen(function* () {
			const references = yield* KernelWorkflowReferences;
			const exit = yield* Effect.exit(
				references.execute(
					KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
					{
						mode: "refresh",
						items: Array.from({ length: 5 }, (_, index) => ({
							entitySchemaSlug: "record",
							externalId: `record-${index}`,
							providerId: "provider-record-catalog",
						})),
					},
					{ type: "system" },
					"population-reference",
					"parent-execution",
					SandboxScriptId.make("caller-script"),
				),
			);

			expect(yield* (yield* RecordedWorkflowDispatches).executionIds).toHaveLength(5);
			expect(exit.toString()).toContain("first item failed");
			expect(exit.toString()).not.toContain("third item failed");
		}),
	);
});

const populationInput = {
	mode: "refresh" as const,
	items: [{ providerId: "foreign", externalId: "record-1", entitySchemaSlug: "record" }],
};

layer(
	populationReferencesLayer(() => false).pipe(
		Layer.provideMerge(recordingEngineLayer(() => Effect.succeed({ id: "entity-1" }))),
	),
)((test) => {
	test.effect("rejects non-system and unauthorized provider population calls", () =>
		Effect.gen(function* () {
			const references = yield* KernelWorkflowReferences;
			const userExit = yield* Effect.exit(
				references.execute(
					KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
					populationInput,
					{
						type: "user",
						userId: UserId.make("user-1"),
						accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
					},
					"user-call",
					"parent-execution",
					SandboxScriptId.make("caller-script"),
				),
			);
			expect(userExit.toString()).toContain("available only for system executions");

			const ownershipExit = yield* Effect.exit(
				references.execute(
					KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
					populationInput,
					{ type: "system" },
					"foreign-call",
					"parent-execution",
					SandboxScriptId.make("caller-script"),
				),
			);
			expect(ownershipExit.toString()).toContain(
				"is not active or has no exact binding to entity schema 'record' owned by plugin 'catalog'",
			);
			expect(yield* (yield* RecordedWorkflowDispatches).executionIds).toHaveLength(0);
		}),
	);
});

layer(
	populationReferencesLayer((providerId) => providerId === "owned").pipe(
		Layer.provideMerge(recordingEngineLayer(() => Effect.succeed({ id: "entity-1" }))),
	),
)((test) => {
	test.effect("authorizes every provider population item before dispatching any child", () =>
		Effect.gen(function* () {
			const references = yield* KernelWorkflowReferences;
			const exit = yield* Effect.exit(
				references.execute(
					KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
					{
						mode: "ensure",
						items: [
							{ providerId: "owned", externalId: "record-1", entitySchemaSlug: "record" },
							{ providerId: "foreign", externalId: "record-2", entitySchemaSlug: "record" },
						],
					},
					{ type: "system" },
					"population-reference",
					"parent-execution",
					SandboxScriptId.make("caller-script"),
				),
			);

			expect(exit.toString()).toContain(
				"is not active or has no exact binding to entity schema 'record' owned by plugin 'catalog'",
			);
			expect(yield* (yield* RecordedWorkflowDispatches).executionIds).toHaveLength(0);
		}),
	);
});

layer(
	populationReferencesLayer().pipe(
		Layer.provideMerge(
			recordingEngineLayer((_workflow, _options, dispatchNumber) =>
				Effect.succeed({ id: `entity-${dispatchNumber}` }),
			),
		),
	),
)((test) => {
	test.effect(
		"accepts 1-100 provider population items and rejects batches outside those bounds",
		() => {
			const item = {
				externalId: "record-1",
				entitySchemaSlug: "record",
				providerId: "provider-record-catalog",
			};
			return Effect.gen(function* () {
				const references = yield* KernelWorkflowReferences;
				for (const items of [[item], Array.from({ length: 100 }, () => item)]) {
					yield* references.execute(
						KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
						{ items, mode: "ensure" },
						{ type: "system" },
						`valid-batch-${items.length}`,
						"parent-execution",
						SandboxScriptId.make("caller-script"),
					);
				}
				expect(yield* (yield* RecordedWorkflowDispatches).executionIds).toHaveLength(101);

				for (const items of [[], Array.from({ length: 101 }, () => item)]) {
					const exit = yield* Effect.exit(
						references.execute(
							KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
							{ items, mode: "ensure" },
							{ type: "system" },
							"invalid-batch",
							"parent-execution",
							SandboxScriptId.make("caller-script"),
						),
					);
					expect(exit.toString()).toContain("Invalid kernel workflow input");
				}
			});
		},
	);
});
