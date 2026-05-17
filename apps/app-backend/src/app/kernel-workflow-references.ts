import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import type { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import {
	ImportRunId,
	SandboxProviderId,
	type IntegrationId,
	type UserId,
} from "@ryot/contract/schema/brands";
import { genericImportKernelInputSchema } from "@ryot/sandbox-sdk/imports";
import { jsonValueSchema } from "@ryot/sandbox-sdk/wire";
import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { Effect, Exit, FileSystem, Layer, Schema, Path } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DbRunner } from "#lib/infrastructure/db/service";
import {
	SANDBOX_HARVEST_DIRECTORY_PREFIX,
	sandboxHarvestPathError,
	sanitizeSandboxExecutionSegment,
} from "#lib/infrastructure/sandbox-runtime/filesystem-grants";
import { SandboxHarvestHandleStore } from "#lib/infrastructure/sandbox-runtime/harvest-handles";
import { ServerRun } from "#lib/infrastructure/server-run";
import type { EntityImportError } from "#modules/entity-import/entity-import-workflow";
import { EntityImportWorkflow } from "#modules/entity-import/entity-import-workflow";
import {
	ProviderEntityPopulationWorkflow,
	type ProviderEntityPopulationPayload,
} from "#modules/entity-import/provider-entity-population-workflow";
import { EntityImportPayload } from "#modules/entity-import/schemas";
import {
	EventCreateWorkflow,
	EventCreateWorkflowPayload,
} from "#modules/events/event-create-workflow";
import {
	ProcessGenericImportChunksPayload,
	ProcessGenericImportChunksWorkflow,
} from "#modules/imports/generic-import-workflow";
import { ImportsRepository } from "#modules/imports/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import {
	KERNEL_EVENT_CREATE_WORKFLOW,
	KERNEL_ENTITY_IMPORT_WORKFLOW,
	KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW,
	KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
	KernelWorkflowReferences,
} from "#modules/sandbox/kernel-workflow-references";

const PROVIDER_ENTITY_POPULATION_MAX_ITEMS = 100;
const PROVIDER_ENTITY_POPULATION_CONCURRENCY = 4;

const ProviderEntityPopulationReferenceInput = Schema.Struct({
	mode: Schema.Literals(["ensure", "refresh"]),
	items: Schema.Array(
		Schema.Struct({
			externalId: Schema.String,
			providerId: Schema.String,
			entitySchemaSlug: Schema.String,
		}),
	).pipe(
		Schema.check(Schema.isMinLength(1)),
		Schema.check(Schema.isMaxLength(PROVIDER_ENTITY_POPULATION_MAX_ITEMS)),
	),
});

const attributionIds = (origin: AutomationOrigin | undefined) => ({
	integrationIds: origin?.kind === "integration" ? [origin.integrationId] : [],
	importRunIds:
		(origin?.kind === "import" || origin?.kind === "integration") && origin.importRunId
			? [origin.importRunId]
			: [],
});

const requireOwned = <A, E>(lookup: Effect.Effect<A | null, E>, message: string) =>
	lookup.pipe(
		Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
		Effect.flatMap((owned) =>
			owned ? Effect.void : Effect.fail(new SandboxRunError({ message })),
		),
	);

export const KernelWorkflowReferencesLive = Layer.effect(
	KernelWorkflowReferences,
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const config = yield* AppConfig;
		const runWithDb = yield* DbRunner;
		const serverRun = yield* ServerRun;
		const fs = yield* FileSystem.FileSystem;
		const imports = yield* ImportsRepository;
		const integrations = yield* IntegrationsRepository;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const harvestHandles = yield* SandboxHarvestHandleStore;
		const localTempRoot = yield* fs.realPath(config.fileStorage.localTempDir).pipe(Effect.orDie);

		const validateAttribution = (input: {
			userId: UserId;
			importRunIds: ReadonlyArray<ImportRunId>;
			integrationIds: ReadonlyArray<IntegrationId>;
		}) =>
			Effect.all([
				Effect.forEach(input.importRunIds, (runId) =>
					requireOwned(
						runWithDb(imports.getRunById({ runId, userId: input.userId })),
						`Kernel workflow import run '${runId}' does not belong to the executing user`,
					),
				),
				Effect.forEach(input.integrationIds, (integrationId) =>
					requireOwned(
						runWithDb(integrations.getForUser({ integrationId, userId: input.userId })),
						`Kernel workflow integration '${integrationId}' does not belong to the executing user`,
					),
				),
			]);

		return {
			execute: (workflowSlug, input, authority, executionId, parentExecutionId, callerScriptId) =>
				Effect.gen(function* () {
					if (
						workflowSlug !== KERNEL_EVENT_CREATE_WORKFLOW &&
						workflowSlug !== KERNEL_ENTITY_IMPORT_WORKFLOW &&
						workflowSlug !== KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW &&
						workflowSlug !== KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW
					) {
						return yield* new SandboxRunError({
							message: `Unknown kernel workflow reference '${workflowSlug}'`,
						});
					}
					if (workflowSlug === KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW) {
						if (authority.type !== "system") {
							return yield* new SandboxRunError({
								message: `Kernel workflow '${workflowSlug}' is available only for system executions`,
							});
						}
						const caller = yield* runWithDb(
							pluginRuntime.findActiveScriptById(callerScriptId),
						).pipe(
							Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
						);
						if (!caller?.pluginSlug || caller.metadata.kind !== "workflow") {
							return yield* new SandboxRunError({
								message: "Provider entity population requires an active plugin workflow caller",
							});
						}
						const callerPluginSlug = caller.pluginSlug;
						const decoded = yield* Schema.decodeUnknownEffect(
							ProviderEntityPopulationReferenceInput,
						)(input).pipe(
							Effect.mapError(
								(error) =>
									new SandboxRunError({
										message: `Invalid kernel workflow input: ${unknownToMessage(error)}`,
									}),
							),
						);
						const ownedItems = yield* Effect.forEach(decoded.items, (item) =>
							runWithDb(
								pluginRuntime.findAuthorizedSchemaProviderById({
									pluginSlug: callerPluginSlug,
									entitySchemaSlug: item.entitySchemaSlug,
									providerId: SandboxProviderId.make(item.providerId),
								}),
							).pipe(
								Effect.mapError(
									(error) => new SandboxRunError({ message: unknownToMessage(error) }),
								),
								Effect.flatMap((resolved) =>
									resolved
										? Effect.succeed({ item, resolved })
										: Effect.fail(
												new SandboxRunError({
													message: `Provider '${item.providerId}' is not active or has no exact binding to entity schema '${item.entitySchemaSlug}' owned by plugin '${callerPluginSlug}'`,
												}),
											),
								),
							),
						);
						const engine = yield* WorkflowEngine;
						const exits = yield* Effect.forEach(
							ownedItems,
							({ item, resolved }, index) => {
								const childExecutionId = `${executionId}-item-${index}`;
								return engine
									.execute(ProviderEntityPopulationWorkflow, {
										executionId: childExecutionId,
										payload: {
											userId: null,
											mode: decoded.mode,
											externalId: item.externalId,
											executionId: childExecutionId,
											providerId: resolved.provider.id,
											origin: { kind: "provider_refresh" },
											entitySchemaSlug: resolved.entitySchemaSlug,
										} satisfies ProviderEntityPopulationPayload,
									})
									.pipe(
										Effect.mapError(
											(error) => new SandboxRunError({ message: unknownToMessage(error) }),
										),
										Effect.exit,
									);
							},
							{ concurrency: PROVIDER_ENTITY_POPULATION_CONCURRENCY },
						);
						const results = yield* Effect.forEach(exits, (exit) =>
							Exit.match(exit, { onSuccess: Effect.succeed, onFailure: Effect.failCause }),
						);
						return yield* Schema.decodeUnknownEffect(jsonValueSchema)(results).pipe(
							Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
						);
					}
					if (!("userId" in authority)) {
						return yield* new SandboxRunError({
							message: `Kernel workflow '${workflowSlug}' is not available for system executions`,
						});
					}
					const engine = yield* WorkflowEngine;
					if (workflowSlug === KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW) {
						const expectedHarvestDirectoryPrefix = path.join(
							localTempRoot,
							`${SANDBOX_HARVEST_DIRECTORY_PREFIX}${serverRun.id}`,
							`${sanitizeSandboxExecutionSegment(parentExecutionId)}-activity-`,
						);
						const decodedInput = yield* Schema.decodeUnknownEffect(genericImportKernelInputSchema)(
							isObjectRecord(input) ? input : {},
						).pipe(
							Effect.mapError(
								(error) =>
									new SandboxRunError({
										message: `Invalid kernel workflow input: ${unknownToMessage(error)}`,
									}),
							),
						);
						const chunkFiles = yield* harvestHandles
							.resolve(parentExecutionId, decodedInput.chunkHandles)
							.pipe(
								Effect.mapError(
									(error) => new SandboxRunError({ message: unknownToMessage(error) }),
								),
							);
						const invalidChunkPath = chunkFiles.find((chunkFile) =>
							sandboxHarvestPathError(path, chunkFile, expectedHarvestDirectoryPrefix),
						);
						if (invalidChunkPath) {
							return yield* new SandboxRunError({
								message:
									sandboxHarvestPathError(path, invalidChunkPath, expectedHarvestDirectoryPrefix) ??
									"Import chunk path is outside the trusted harvest",
							});
						}
						const { chunkHandles: _chunkHandles, ...kernelInput } = decodedInput;
						const payload = yield* Schema.decodeUnknownEffect(ProcessGenericImportChunksPayload)({
							...kernelInput,
							chunkFiles,
							executionId,
							userId: authority.userId,
							expectedHarvestDirectoryPrefix,
							...("integrationId" in authority && authority.integrationId
								? { integrationId: authority.integrationId }
								: {}),
						}).pipe(
							Effect.mapError(
								(error) =>
									new SandboxRunError({
										message: `Invalid kernel workflow input: ${unknownToMessage(error)}`,
									}),
							),
						);
						yield* validateAttribution({
							userId: authority.userId,
							importRunIds: [ImportRunId.make(payload.runId)],
							integrationIds: payload.integrationId ? [payload.integrationId] : [],
						});
						const result = yield* engine
							.execute(ProcessGenericImportChunksWorkflow, { executionId, payload })
							.pipe(
								Effect.mapError(
									(error) => new SandboxRunError({ message: unknownToMessage(error) }),
								),
							);
						return yield* Schema.decodeUnknownEffect(jsonValueSchema)(result).pipe(
							Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
						);
					}
					if (workflowSlug === KERNEL_ENTITY_IMPORT_WORKFLOW) {
						const rawInput = isObjectRecord(input) ? input : {};
						const providerSlug = Reflect.get(rawInput, "providerSlug");
						const resolvedProvider =
							typeof providerSlug === "string"
								? yield* runWithDb(pluginRuntime.findSchemaProviderBySlug(providerSlug)).pipe(
										Effect.mapError(
											(error) => new SandboxRunError({ message: unknownToMessage(error) }),
										),
									)
								: null;
						if (typeof providerSlug === "string" && !resolvedProvider) {
							return yield* new SandboxRunError({
								message: `Plugin provider not found: ${providerSlug}`,
							});
						}
						const payload = yield* Schema.decodeUnknownEffect(EntityImportPayload)({
							...rawInput,
							executionId,
							userId: authority.userId,
							...(resolvedProvider
								? {
										providerId: resolvedProvider.provider.id,
										entitySchemaSlug: resolvedProvider.entitySchemaSlug,
									}
								: {}),
						}).pipe(
							Effect.mapError(
								(error) =>
									new SandboxRunError({
										message: `Invalid kernel workflow input: ${unknownToMessage(error)}`,
									}),
							),
						);
						yield* validateAttribution({
							userId: authority.userId,
							...attributionIds(payload.origin),
						});
						const result = yield* engine
							.execute(EntityImportWorkflow, { executionId, payload })
							.pipe(
								Effect.match({
									onFailure: (error: EntityImportError) => ({
										stage: error.stage,
										message: error.message,
										status: "failed" as const,
									}),
									onSuccess: (entity) => ({ status: "completed" as const, entity }),
								}),
							);
						return yield* Schema.decodeUnknownEffect(jsonValueSchema)(result).pipe(
							Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
						);
					}
					const payload = yield* Schema.decodeUnknownEffect(EventCreateWorkflowPayload)({
						...(isObjectRecord(input) ? input : {}),
						executionId,
						userId: authority.userId,
					}).pipe(
						Effect.mapError(
							(error) =>
								new SandboxRunError({
									message: `Invalid kernel workflow input: ${unknownToMessage(error)}`,
								}),
						),
					);
					const lifecycle = attributionIds(payload.lifecycleOrigin);
					yield* validateAttribution({
						userId: authority.userId,
						importRunIds: [
							...lifecycle.importRunIds,
							...(payload.importRunId ? [payload.importRunId] : []),
						],
						integrationIds: [
							...lifecycle.integrationIds,
							...(payload.integrationId ? [payload.integrationId] : []),
						],
					});
					const result = yield* engine
						.execute(EventCreateWorkflow, { executionId, payload })
						.pipe(
							Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
						);
					return yield* Schema.decodeUnknownEffect(jsonValueSchema)(result).pipe(
						Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
					);
				}),
		};
	}),
);
