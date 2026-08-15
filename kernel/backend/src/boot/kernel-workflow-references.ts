import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import type { AutomationOrigin } from "@ryot-app/contract/modules/automations/schemas";
import {
	ImportRunId,
	SandboxProviderId,
	type IntegrationId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { genericImportKernelInputSchema } from "@ryot-app/sandbox-sdk/imports";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Effect, Exit, Layer, Schema } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { Database } from "#lib/infrastructure/db/service";
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
import type { EntityImportError } from "#modules/provider-entities/entity-import-workflow";
import { EntityImportWorkflow } from "#modules/provider-entities/entity-import-workflow";
import {
	ProviderEntityPopulationWorkflow,
	type ProviderEntityPopulationPayload,
} from "#modules/provider-entities/provider-entity-population-workflow";
import { EntityImportPayload } from "#modules/provider-entities/schemas";
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

const requireOwned = <A, E, R>(lookup: Effect.Effect<A | null, E, R>, message: string) =>
	lookup.pipe(
		Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
		Effect.flatMap((owned) =>
			owned ? Effect.void : Effect.fail(new SandboxRunError({ message })),
		),
	);

export const KernelWorkflowReferencesLive = Layer.effect(
	KernelWorkflowReferences,
	Effect.gen(function* () {
		const database = yield* Database;
		const imports = yield* ImportsRepository;
		const integrations = yield* IntegrationsRepository;
		const pluginRuntime = yield* PluginRuntimeResolver;

		const validateAttribution = (input: {
			userId: UserId;
			importRunIds: ReadonlyArray<ImportRunId>;
			integrationIds: ReadonlyArray<IntegrationId>;
		}) =>
			Effect.all([
				Effect.forEach(input.importRunIds, (runId) =>
					requireOwned(
						imports.getRunById({ runId, userId: input.userId }),
						`Kernel workflow import run '${runId}' does not belong to the executing user`,
					),
				),
				Effect.forEach(input.integrationIds, (integrationId) =>
					requireOwned(
						integrations.getForUser({ integrationId, userId: input.userId }),
						`Kernel workflow integration '${integrationId}' does not belong to the executing user`,
					),
				),
			]);

		return {
			execute: (
				workflowSlug,
				input,
				subject,
				executionId,
				_parentExecutionId,
				callerScriptId,
				artifactOwnerExecutionId,
			) =>
				Effect.gen(function* () {
					const artifactOwner = artifactOwnerExecutionId ?? _parentExecutionId;
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
						if (subject.type !== "system") {
							return yield* new SandboxRunError({
								message: `Kernel workflow '${workflowSlug}' is available only for system executions`,
							});
						}
						const caller = yield* pluginRuntime
							.findActiveScriptById(callerScriptId)
							.pipe(
								Effect.mapError(
									(error) => new SandboxRunError({ message: unknownToMessage(error) }),
								),
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
							pluginRuntime
								.findAuthorizedSchemaProviderById({
									pluginSlug: callerPluginSlug,
									entitySchemaSlug: item.entitySchemaSlug,
									providerId: SandboxProviderId.make(item.providerId),
								})
								.pipe(
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
											mode: decoded.mode,
											externalId: item.externalId,
											executionId: childExecutionId,
											providerId: resolved.provider.id,
											origin: { kind: "provider_refresh" },
											entitySchemaSlug: resolved.entitySchemaSlug,
											entityScope: { type: "global", userId: null },
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
					if (!("userId" in subject)) {
						return yield* new SandboxRunError({
							message: `Kernel workflow '${workflowSlug}' is not available for system executions`,
						});
					}
					const engine = yield* WorkflowEngine;
					if (workflowSlug === KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW) {
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
						const payload = yield* Schema.decodeUnknownEffect(ProcessGenericImportChunksPayload)({
							...decodedInput,
							executionId,
							userId: subject.userId,
							artifactOwnerExecutionId: artifactOwner,
							artifactReferenceExecutionId: executionId,
							...("integrationId" in subject && subject.integrationId
								? { integrationId: subject.integrationId }
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
							userId: subject.userId,
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
								? yield* pluginRuntime
										.findSchemaProviderBySlug(providerSlug)
										.pipe(
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
							entityScope: { type: "global", userId: subject.userId },
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
							userId: subject.userId,
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
						userId: subject.userId,
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
						userId: subject.userId,
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
				}).pipe(Effect.provideService(Database, database)),
		};
	}),
);
