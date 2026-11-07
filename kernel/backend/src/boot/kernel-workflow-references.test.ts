import { expect } from "bun:test";

import { BunFileSystem } from "@effect/platform-bun";
import { SandboxRunError } from "@ryot-app/contract/errors";
import {
	KERNEL_ENTITY_IMPORT_WORKFLOW,
	KERNEL_EVENT_CREATE_WORKFLOW,
	KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW,
	KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
} from "@ryot-app/contract/modules/plugins/execution";
import type { SandboxExecutionSubject } from "@ryot-app/contract/modules/scripts/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	ImportRunId,
	IntegrationId,
	PluginPackageId,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { SandboxExecutionAuthority } from "@ryot-app/sandbox/host/authority";
import { ExecutionFileStore } from "@ryot-app/sandbox/host/execution-files";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { objectContaining } from "@ryot-app/testing/matchers";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer, Ref, Schema } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { enrichmentRequestRow } from "#modules/entities/enrichment/requests.test-support";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsService } from "#modules/events/service";
import { IngestionCaptures } from "#modules/imports/capture-service";
import { ingestionTestRevision, ingestionTestRun } from "#modules/imports/ingestion.test-support";
import { ImportsRepository } from "#modules/imports/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { mutationAdmissionTestLayer } from "#modules/mutations/admission.test-support";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { emptySchemaScope } from "#modules/scripts/authorization/principal.test-support";
import { ScriptExecutionWorkflow } from "#modules/scripts/executions/workflow";
import { KernelWorkflowReferences } from "#modules/scripts/registry/kernel-workflow-references";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { JobQueue } from "#platform/jobs/queue";
import { TransientValues } from "#platform/transient-values";
import { makeWorkflowActivityEngine } from "#testing/effect";

import { KernelWorkflowReferencesLive } from "./kernel-workflow-references";

const callerAuthority = (subject: SandboxExecutionSubject) =>
	Schema.decodeEffect(ScriptExecutionPrincipal)({
		subject,
		providerId: null,
		scriptId: "caller-script",
		contentHash: "caller-hash",
		scriptSlug: "caller-script",
		pluginRevision: ingestionTestRevision,
		metadata: { kind: "workflow", capabilities: [], runtimeImports: [] },
	}).pipe(Effect.orDie);
const populationAuthority = (subject: SandboxExecutionSubject) =>
	Effect.flatMap(callerAuthority(subject), (caller) =>
		Schema.decodeEffect(ScriptExecutionPrincipal)({
			...caller,
			pluginRevision: {
				...ingestionTestRevision,
				id: "provider-owner",
				revisionId: "provider-owner-revision",
			},
		}),
	).pipe(Effect.orDie);
const entitySchemaSlugsByRevision: Record<string, ReadonlyArray<string>> = {
	"provider-owner-revision": ["record"],
	[ingestionTestRevision.revisionId]: ["record", "group"],
};
const sandboxRepositoryLayer = Layer.mock(SandboxRepository)({
	getSchemaScope: (revisionId) =>
		Effect.succeed({
			...emptySchemaScope,
			entitySchemaSlugs: entitySchemaSlugsByRevision[revisionId] ?? [],
		}),
});
const executionAuthorityLayer = Layer.succeed(SandboxExecutionAuthority, {
	resolve: (principal) =>
		Schema.decodeUnknownEffect(ScriptExecutionPrincipal)(principal).pipe(
			Effect.mapBoth({
				onSuccess: (verified) => verified.pluginRevision?.scope ?? "system",
				onFailure: () =>
					new SandboxRunError({ kind: "missing-artifact", message: "Invalid caller pin" }),
			}),
		),
});

const mockImportsRepository = Layer.mock(ImportsRepository);
const captureDependencies = Layer.mergeAll(
	executionAuthorityLayer,
	sandboxRepositoryLayer,
	Layer.mock(IngestionCaptures)({}),
	Layer.mock(ExecutionFileStore)({}),
	BunFileSystem.layer,
);
const mockIntegrationsRepository = Layer.mock(IntegrationsRepository);
const unownedRepositories = Layer.mergeAll(
	mockImportsRepository({
		getRunById: () => Effect.succeed(null),
		getIngestionRunControl: () => Effect.succeed(null),
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
	scope: "user" | "system" = "system",
) =>
	Layer.provide(
		KernelWorkflowReferencesLive,
		Layer.mergeAll(
			mutationAdmissionTestLayer,
			captureDependencies,
			unownedRepositories,
			Layer.mock(PluginRuntimeResolver)({
				findProviderAvailableToUser: (_userId, providerId) =>
					Effect.succeed(
						authorizes(providerId)
							? {
									id: providerId,
									name: "Records",
									pluginScope: scope,
									slug: "record.catalog",
									createdAt: new Date(0),
									updatedAt: new Date(0),
									pluginId: "provider-owner",
									rootEntitySchemaSlug: "record",
									information: { source: "catalog" },
								}
							: null,
					),
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
						createdAt: new Date(0),
						updatedAt: new Date(0),
						name: "Catalog refresh",
						slug: "catalog.refresh",
						compiledCode: "compiled",
						contentHash: "workflow-hash",
						pluginRevisionId: "catalog-revision",
						id: SandboxScriptId.make("caller-script"),
						packageId: PluginPackageId.make("test/catalog"),
						metadata: {
							kind: "workflow",
							capabilities: [],
							runtimeImports: [],
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

type ExecuteOptions = ExecuteArgs[1];

const parentInstance = WorkflowInstance.initial(ScriptExecutionWorkflow, "parent-execution");
type ExecuteArgs = Parameters<WorkflowEngine["Service"]["execute"]>;

class RecordedWorkflowDispatches extends Context.Service<
	RecordedWorkflowDispatches,
	{
		readonly payloads: Effect.Effect<ReadonlyArray<unknown>>;
		readonly executionIds: Effect.Effect<ReadonlyArray<string>>;
	}
>()("@ryot-app/kernel-backend/boot/kernel-workflow-references.test/RecordedWorkflowDispatches") {}

const completedEntityImport = JSON.stringify({
	_tag: "completed",
	entity: {
		properties: {},
		id: "entity-1",
		name: "Record",
		providerId: null,
		externalId: null,
		populatedAt: null,
		entitySchemaPluginId: null,
		entitySchemaSlug: "record",
		createdAt: "1970-01-01T00:00:00.000Z",
		updatedAt: "1970-01-01T00:00:00.000Z",
	},
});

const recordingEngineLayer = (
	respond: (
		workflow: ExecuteArgs[0],
		options: ExecuteOptions,
		dispatchNumber: number,
	) => Effect.Effect<unknown, SandboxRunError>,
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const dispatches = yield* Ref.make<
				ReadonlyArray<Pick<ExecuteOptions, "payload" | "executionId">>
			>([]);
			return Layer.mergeAll(
				Layer.mock(EnrichmentRequests)({}),
				Layer.mock(EntitiesRepository)({}),
				Layer.mock(JobQueue)({
					enqueue: (_kind, payload, options) =>
						Ref.update(dispatches, (all) => [
							...all,
							{ payload, executionId: options?.id ?? "" },
						]).pipe(Effect.as(true)),
				}),
				Layer.mock(TransientValues)({
					get: () => Effect.succeed(completedEntityImport),
				}),
				Layer.succeed(
					WorkflowEngine,
					makeWorkflowActivityEngine(parentInstance, {
						execute: (workflow, options) =>
							Ref.updateAndGet(dispatches, (all) => [...all, options]).pipe(
								Effect.flatMap((all) => respond(workflow, options, all.length)),
							),
					}),
				),
				Layer.succeed(WorkflowInstance, parentInstance),
				Layer.mock(EventsService)({
					create: (input) =>
						Ref.update(dispatches, (all) => [
							...all,
							{ payload: input, executionId: input.command.causation.executionId },
						]).pipe(Effect.as({ count: 0, outcomes: [], warnings: [], failure: null })),
				}),
				Layer.succeed(RecordedWorkflowDispatches, {
					payloads: Effect.map(Ref.get(dispatches), (all) => all.map(({ payload }) => payload)),
					executionIds: Effect.map(Ref.get(dispatches), (all) =>
						all.map(({ executionId }) => executionId),
					),
				}),
			);
		}),
	);

const transientValuesLayer = Layer.mock(TransientValues)({});

const unusedPopulationLayer = Layer.mergeAll(
	Layer.mock(JobQueue)({}),
	Layer.mock(EnrichmentRequests)({}),
	Layer.mock(EntitiesRepository)({}),
);

const unusedEngineLayer = Layer.mergeAll(
	unusedPopulationLayer,
	transientValuesLayer,
	Layer.succeed(WorkflowEngine, makeWorkflowActivityEngine(parentInstance)),
	Layer.succeed(WorkflowInstance, parentInstance),
	Layer.mock(EventsService)({}),
);

type PopulationRequest = Parameters<EnrichmentRequests["Service"]["ensure"]>[0];
type PopulationOutcome =
	| { readonly state: "succeeded" }
	| { readonly state: "failed"; readonly failureKind: "timeout" | "script-failure" };

const populatedEntityId = (executionId: string) => EntityId.make(`entity-${executionId}`);

const recordingPopulationLayer = (
	respond: (executionId: string) => PopulationOutcome = () => ({ state: "succeeded" }),
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const requests = yield* Ref.make<ReadonlyArray<PopulationRequest>>([]);
			return Layer.mergeAll(
				transientValuesLayer,
				Layer.succeed(WorkflowEngine, makeWorkflowActivityEngine(parentInstance)),
				Layer.succeed(WorkflowInstance, parentInstance),
				Layer.mock(EventsService)({}),
				Layer.mock(JobQueue)({ enqueue: () => Effect.succeed(true) }),
				Layer.mock(EnrichmentRequests)({
					ensure: (input) =>
						Ref.update(requests, (all) => [...all, input]).pipe(
							Effect.as(enrichmentRequestRow(input)),
						),
					get: (id) =>
						Effect.map(Ref.get(requests), (all) => {
							const input = all.find((request) => request.id === id);
							if (!input) {
								return null;
							}
							const outcome = respond(id);
							return {
								...enrichmentRequestRow(input),
								state: outcome.state,
								failureKind: outcome.state === "failed" ? outcome.failureKind : null,
								entityId: outcome.state === "succeeded" ? populatedEntityId(id) : null,
							};
						}),
				}),
				Layer.mock(EntitiesRepository)({
					getById: (entityId) =>
						Effect.succeed({
							id: entityId,
							properties: {},
							name: "Record",
							providerId: null,
							externalId: null,
							populatedAt: null,
							entitySchemaPluginId: null,
							createdAt: "1970-01-01T00:00:00.000Z",
							updatedAt: "1970-01-01T00:00:00.000Z",
							entitySchemaSlug: EntitySchemaSlug.make("record"),
						}),
				}),
				Layer.succeed(RecordedWorkflowDispatches, {
					executionIds: Effect.map(Ref.get(requests), (all) => all.map(({ id }) => id)),
					payloads: Effect.map(Ref.get(requests), (all) => all.map(({ payload }) => payload)),
				}),
			);
		}),
	);

layer(
	KernelWorkflowReferencesLive.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				mutationAdmissionTestLayer,
				BunFileSystem.layer,
				executionAuthorityLayer,
				sandboxRepositoryLayer,
				unusedEngineLayer,
				Layer.mock(PluginRuntimeResolver)({}),
				mockIntegrationsRepository({}),
				mockImportsRepository({ getIngestionRunControl: () => Effect.succeed(ingestionTestRun()) }),
				Layer.mock(ExecutionFileStore)({
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
	test.effect(
		"replays capture publication without resolving the collector temporary handle",
		() =>
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
					"background",
					"capture-child",
					"run-1-import",
					yield* callerAuthority({ type: "user", userId: UserId.make("user-1") }),
				);
				expect(result).toEqual({
					captureId: "page-1",
					handle: "deleted-temporary-handle",
					inputFingerprint: "persisted-checksum",
				});
			}),
		testTimeout,
	);
});

layer(
	referencesLayer(unownedRepositories).pipe(
		Layer.provideMerge(recordingEngineLayer(() => Effect.succeed({ id: "entity-1" }))),
	),
)((test) => {
	test.effect(
		"binds kernel workflow user ids to the trusted execution subject",
		() =>
			Effect.gen(function* () {
				const references = yield* KernelWorkflowReferences;
				const subject = { type: "user" as const, userId: UserId.make("trusted-user") };
				yield* references.execute(
					KERNEL_ENTITY_IMPORT_WORKFLOW,
					{
						providerId: "zeta",
						externalId: "record-1",
						entitySchemaSlug: "record",
						origin: { kind: "import" },
						userId: "attacker-selected-user",
					},
					"interactive",
					"entity-import-execution",
					"parent-execution",
					yield* callerAuthority(subject),
				);
				yield* references.execute(
					KERNEL_EVENT_CREATE_WORKFLOW,
					{ payload: [], origin: "import", userId: "attacker-selected-user" },
					"interactive",
					"event-create-execution",
					"parent-execution",
					yield* callerAuthority(subject),
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
		testTimeout,
	);
});

const slugResolvingReferencesLayer = Layer.provide(
	KernelWorkflowReferencesLive,
	Layer.mergeAll(
		mutationAdmissionTestLayer,
		captureDependencies,
		unownedRepositories,
		Layer.mock(PluginRuntimeResolver)({
			findProviderAvailableToUserByReference: () =>
				Effect.succeed({
					name: "Alpha",
					slug: "group.alpha",
					pluginScope: "system",
					createdAt: new Date(0),
					updatedAt: new Date(0),
					rootEntitySchemaSlug: "group",
					information: { source: "alpha" },
					pluginId: ingestionTestRevision.id,
					id: SandboxProviderId.make("provider-group-alpha"),
				}),
		}),
	),
);

layer(
	slugResolvingReferencesLayer.pipe(
		Layer.provideMerge(recordingEngineLayer(() => Effect.succeed({ id: "entity-1" }))),
	),
)((test) => {
	test.effect(
		"resolves plugin provider slugs before queueing entity imports",
		() =>
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
					"interactive",
					"entity-import-execution",
					"parent-execution",
					yield* callerAuthority({ type: "user", userId: UserId.make("trusted-user") }),
				);

				expect(yield* (yield* RecordedWorkflowDispatches).payloads).toEqual([
					objectContaining({
						entitySchemaSlug: "group",
						providerId: "provider-group-alpha",
						entityScope: { type: "global", userId: "trusted-user" },
					}),
				]);
			}),
		testTimeout,
	);
});

const ownedRepositories = Layer.mergeAll(
	mockImportsRepository({
		getIngestionRunControl: (scope) =>
			Effect.succeed({
				...ingestionTestRun(),
				id: scope.runId,
				userId: scope.userId,
				pins: {
					scriptId: "script",
					executionId: "parent/execution",
					pluginRevisionId: ingestionTestRevision.revisionId,
					pluginConfigRevisionId: ingestionTestRevision.configRevisionId,
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
	test.effect(
		"keeps import handles opaque across the kernel child boundary",
		() =>
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
					"background",
					"child-execution",
					"parent/execution",
					yield* callerAuthority({ type: "user", userId: UserId.make("trusted-user") }),
				);

				expect(yield* (yield* RecordedWorkflowDispatches).payloads).toEqual([
					objectContaining({
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
		testTimeout,
	);
});

layer(referencesLayer(unownedRepositories).pipe(Layer.provideMerge(unusedEngineLayer)))((test) => {
	test.effect(
		"rejects user-scoped kernel workflows for system executions",
		() =>
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
						"interactive",
						"entity-import-execution",
						"parent-execution",
						yield* callerAuthority({ type: "system" }),
					),
				);

				expect(exit.toString()).toContain("is not available for system executions");
			}),
		testTimeout,
	);
});

layer(referencesLayer(unownedRepositories).pipe(Layer.provideMerge(unusedEngineLayer)))((test) => {
	test.effect(
		"rejects an import run owned by another user",
		() =>
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
						"background",
						"entity-import-execution",
						"parent-execution",
						yield* callerAuthority({ type: "user", userId: UserId.make("trusted-user") }),
					),
				);

				expect(exit.toString()).toContain(
					"import run 'victim-run' does not belong to the executing user",
				);
			}),
		testTimeout,
	);
});

layer(referencesLayer(unownedRepositories).pipe(Layer.provideMerge(unusedEngineLayer)))((test) => {
	test.effect(
		"rejects a trusted integration subject owned by another user",
		() =>
			Effect.gen(function* () {
				const references = yield* KernelWorkflowReferences;
				const exit = yield* Effect.exit(
					references.execute(
						KERNEL_EVENT_CREATE_WORKFLOW,
						{ payload: [] },
						"interactive",
						"event-create-execution",
						"parent-execution",
						yield* callerAuthority({
							type: "user",
							userId: UserId.make("trusted-user"),
							integrationId: IntegrationId.make("victim-integration"),
						}),
					),
				);

				expect(exit.toString()).toContain(
					"integration 'victim-integration' does not belong to the executing user",
				);
			}),
		testTimeout,
	);
});

layer(populationReferencesLayer().pipe(Layer.provideMerge(recordingPopulationLayer())))((test) => {
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
					"interactive",
					"population-reference",
					"parent-execution",
					yield* populationAuthority({ type: "system" }),
				);

				const dispatches = yield* RecordedWorkflowDispatches;
				expect(result).toMatchObject([
					{ id: populatedEntityId("population-reference-item-0") },
					{ id: populatedEntityId("population-reference-item-1") },
				]);
				expect(yield* dispatches.executionIds).toEqual([
					"population-reference-item-0",
					"population-reference-item-1",
				]);
				expect(yield* dispatches.payloads).toEqual([
					objectContaining({
						level: "full",
						mode: "refresh",
						externalId: "record-1",
						entitySchemaSlug: "record",
						providerId: "provider-record-catalog",
						executionId: "population-reference-item-0",
						entityScope: { userId: null, type: "global" },
						command: objectContaining({
							itemIdentity: "kernel:provider-entity-population:0",
							causation: objectContaining({
								source: "provider-refresh",
								executionId: "population-reference-item-0",
								providerExecutionId: "population-reference-item-0",
							}),
						}),
					}),
					objectContaining({ externalId: "record-2", executionId: "population-reference-item-1" }),
				]);
			}),
		testTimeout,
	);
});

layer(
	populationReferencesLayer().pipe(
		Layer.provideMerge(
			recordingPopulationLayer((executionId) => {
				if (executionId.endsWith("item-0")) {
					return { state: "failed", failureKind: "script-failure" };
				}
				if (executionId.endsWith("item-2")) {
					return { state: "failed", failureKind: "timeout" };
				}
				return { state: "succeeded" };
			}),
		),
	),
)((test) => {
	test.effect(
		"awaits every provider population exit and reports failures in input order",
		() =>
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
						"interactive",
						"population-reference",
						"parent-execution",
						yield* populationAuthority({ type: "system" }),
					),
				);

				expect(yield* (yield* RecordedWorkflowDispatches).executionIds).toHaveLength(5);
				assertExitFails(
					exit,
					new SandboxRunError({ kind: "script-failure", message: "Provider population failed" }),
				);
			}),
		testTimeout,
	);
});

const populationInput = {
	mode: "refresh" as const,
	items: [{ providerId: "foreign", externalId: "record-1", entitySchemaSlug: "record" }],
};

layer(
	populationReferencesLayer(undefined, "user").pipe(Layer.provideMerge(recordingPopulationLayer())),
)((test) => {
	test.effect(
		"keeps private ownership and exact caller pins through kernel provider children",
		() =>
			Effect.gen(function* () {
				const userId = UserId.make("private-owner");
				const subject = { userId, type: "user" } as const;
				const pinned = yield* populationAuthority(subject);
				const principal = yield* Schema.decodeUnknownEffect(ScriptExecutionPrincipal)({
					...pinned,
					pluginRevision: { ...pinned.pluginRevision, scope: "user", ownerId: userId },
				});
				yield* (yield* KernelWorkflowReferences).execute(
					KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
					populationInput,
					"background",
					"private-population",
					"private-parent",
					principal,
				);
				expect(yield* (yield* RecordedWorkflowDispatches).payloads).toMatchObject([
					{
						pluginId: "provider-owner",
						command: { writeContext: principal },
						entityScope: { userId, type: "user" },
					},
				]);
			}),
		testTimeout,
	);
});

layer(populationReferencesLayer(() => false).pipe(Layer.provideMerge(recordingPopulationLayer())))(
	(test) => {
		test.effect(
			"rejects unavailable user and unauthorized system provider population calls",
			() =>
				Effect.gen(function* () {
					const references = yield* KernelWorkflowReferences;
					const userExit = yield* Effect.exit(
						references.execute(
							KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
							populationInput,
							"interactive",
							"user-call",
							"parent-execution",
							yield* populationAuthority({ type: "user", userId: UserId.make("user-1") }),
						),
					);
					expect(userExit.toString()).toContain("is unavailable or has no exact binding");

					const ownershipExit = yield* Effect.exit(
						references.execute(
							KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
							populationInput,
							"interactive",
							"foreign-call",
							"parent-execution",
							yield* populationAuthority({ type: "system" }),
						),
					);
					expect(ownershipExit.toString()).toContain(
						"is unavailable or has no exact binding to entity schema 'record' owned by plugin 'provider-owner'",
					);
					expect(yield* (yield* RecordedWorkflowDispatches).executionIds).toHaveLength(0);
				}),
			testTimeout,
		);
	},
);

layer(
	populationReferencesLayer((providerId) => providerId === "owned").pipe(
		Layer.provideMerge(recordingPopulationLayer()),
	),
)((test) => {
	test.effect(
		"authorizes every provider population item before dispatching any child",
		() =>
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
						"interactive",
						"population-reference",
						"parent-execution",
						yield* populationAuthority({ type: "system" }),
					),
				);

				expect(exit.toString()).toContain(
					"is unavailable or has no exact binding to entity schema 'record' owned by plugin 'provider-owner'",
				);
				expect(yield* (yield* RecordedWorkflowDispatches).executionIds).toHaveLength(0);
			}),
		testTimeout,
	);
});

layer(populationReferencesLayer().pipe(Layer.provideMerge(recordingPopulationLayer())))((test) => {
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
						"interactive",
						`valid-batch-${items.length}`,
						"parent-execution",
						yield* populationAuthority({ type: "system" }),
					);
				}
				expect(yield* (yield* RecordedWorkflowDispatches).executionIds).toHaveLength(101);

				for (const items of [[], Array.from({ length: 101 }, () => item)]) {
					const exit = yield* Effect.exit(
						references.execute(
							KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
							{ items, mode: "ensure" },
							"interactive",
							"invalid-batch",
							"parent-execution",
							yield* populationAuthority({ type: "system" }),
						),
					);
					expect(exit.toString()).toContain("Invalid kernel workflow input");
				}
			});
		},
		testTimeout,
	);
});
