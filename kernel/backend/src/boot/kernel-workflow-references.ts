import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import {
	AutomationExecutionId,
	ImportRunId,
	SandboxProviderId,
	type IntegrationId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { genericImportKernelInputSchema } from "@ryot-app/sandbox-sdk/imports";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { DateTime, Effect, Exit, Layer, Schema } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { LifecycleCommand, rootLifecycleCommand } from "#lib/domain/lifecycle-command";
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
import { ProviderEntityImportWorkflowPayload } from "#modules/provider-entities/schemas";
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

const lifecycleCommand = (
	subject: Parameters<KernelWorkflowReferences["Service"]["execute"]>[2],
	executionId: string,
	itemIdentity: string,
	occurredAt: LifecycleCommand["occurredAt"],
	source: "api" | "import" | "integration" | "provider-refresh",
	attribution: { importRunId?: ImportRunId; integrationId?: IntegrationId } = {},
): LifecycleCommand => {
	if (subject.type === "automation-run") {
		return Schema.decodeSync(LifecycleCommand)({
			occurredAt,
			itemIdentity,
			causation: {
				...subject.causation,
				source: "automation",
				parentRunId: subject.runId,
				depth: subject.causation.depth + 1,
				parentTriggerId: subject.triggerId,
				executionId: AutomationExecutionId.make(executionId),
			},
		});
	}
	const integrationId = subject.type === "user" ? subject.integrationId : undefined;
	let initiator: Parameters<typeof rootLifecycleCommand>[0]["initiator"] = {
		id: null,
		kind: "system",
	};
	if (subject.type === "user") {
		initiator =
			integrationId === undefined
				? { kind: "user", id: subject.userId }
				: { id: integrationId, kind: "integration" };
	}
	const attributedIntegrationId = integrationId ?? attribution.integrationId;
	return rootLifecycleCommand({
		initiator,
		occurredAt,
		itemIdentity,
		executionId: AutomationExecutionId.make(executionId),
		source: integrationId === undefined ? source : "integration",
		...(attribution.importRunId === undefined ? {} : { importRunId: attribution.importRunId }),
		...(attributedIntegrationId === undefined ? {} : { integrationId: attributedIntegrationId }),
		...(source === "provider-refresh"
			? { providerExecutionId: AutomationExecutionId.make(executionId) }
			: {}),
	});
};

const requireOwned = <A, E, R>(lookup: Effect.Effect<A | null, E, R>, message: string) =>
	lookup.pipe(
		Effect.mapError(
			(error) => new SandboxRunError({ kind: "infrastructure", message: unknownToMessage(error) }),
		),
		Effect.flatMap((owned) =>
			owned ? Effect.void : Effect.fail(new SandboxRunError({ message, kind: "script-failure" })),
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
					const occurredAt = IsoUtcString.make((yield* DateTime.nowAsDate).toISOString());
					if (
						workflowSlug !== KERNEL_EVENT_CREATE_WORKFLOW &&
						workflowSlug !== KERNEL_ENTITY_IMPORT_WORKFLOW &&
						workflowSlug !== KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW &&
						workflowSlug !== KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW
					) {
						return yield* new SandboxRunError({
							kind: "script-failure",
							message: `Unknown kernel workflow reference '${workflowSlug}'`,
						});
					}
					if (workflowSlug === KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW) {
						if (subject.type !== "system") {
							return yield* new SandboxRunError({
								kind: "script-failure",
								message: `Kernel workflow '${workflowSlug}' is available only for system executions`,
							});
						}
						const caller = yield* pluginRuntime
							.findActiveScriptById(callerScriptId)
							.pipe(
								Effect.mapError(
									(error) =>
										new SandboxRunError({
											kind: "infrastructure",
											message: unknownToMessage(error),
										}),
								),
							);
						if (!caller?.pluginSlug || caller.metadata.kind !== "workflow") {
							return yield* new SandboxRunError({
								kind: "script-failure",
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
										kind: "invalid-input",
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
										(error) =>
											new SandboxRunError({
												kind: "infrastructure",
												message: unknownToMessage(error),
											}),
									),
									Effect.flatMap((resolved) =>
										resolved
											? Effect.succeed({ item, resolved })
											: Effect.fail(
													new SandboxRunError({
														kind: "script-failure",
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
											entitySchemaSlug: resolved.entitySchemaSlug,
											entityScope: { userId: null, type: "global" },
											command: lifecycleCommand(
												subject,
												childExecutionId,
												`${KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW}:${index}`,
												occurredAt,
												"provider-refresh",
											),
										} satisfies ProviderEntityPopulationPayload,
									})
									.pipe(
										Effect.mapError(
											(error) =>
												new SandboxRunError({
													kind: "infrastructure",
													message: unknownToMessage(error),
												}),
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
							Effect.mapError(
								(error) =>
									new SandboxRunError({ kind: "infrastructure", message: unknownToMessage(error) }),
							),
						);
					}
					let userId = null;
					if (subject.type === "user") {
						userId = subject.userId;
					} else if (subject.type === "automation-run") {
						userId = subject.executionUserId;
					}
					if (userId === null) {
						return yield* new SandboxRunError({
							kind: "script-failure",
							message: `Kernel workflow '${workflowSlug}' is not available for system executions`,
						});
					}
					const engine = yield* WorkflowEngine;
					if (workflowSlug === KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW) {
						const rawInput = isObjectRecord(input) ? input : {};
						const rawRunId = Reflect.get(rawInput, "runId");
						const command = lifecycleCommand(
							subject,
							executionId,
							KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW,
							occurredAt,
							"import",
							typeof rawRunId === "string" ? { importRunId: ImportRunId.make(rawRunId) } : {},
						);
						const decodedInput = yield* Schema.decodeUnknownEffect(genericImportKernelInputSchema)({
							...rawInput,
							command,
						}).pipe(
							Effect.mapError(
								(error) =>
									new SandboxRunError({
										kind: "invalid-input",
										message: `Invalid kernel workflow input: ${unknownToMessage(error)}`,
									}),
							),
						);
						const payload = yield* Schema.decodeEffect(ProcessGenericImportChunksPayload)({
							...decodedInput,
							userId,
							executionId,
							artifactOwnerExecutionId: artifactOwner,
							artifactReferenceExecutionId: executionId,
							...("integrationId" in subject && subject.integrationId
								? { integrationId: subject.integrationId }
								: {}),
						}).pipe(
							Effect.mapError(
								(error) =>
									new SandboxRunError({
										kind: "invalid-input",
										message: `Invalid kernel workflow input: ${unknownToMessage(error)}`,
									}),
							),
						);
						yield* validateAttribution({
							userId,
							importRunIds: [ImportRunId.make(payload.runId)],
							integrationIds: payload.integrationId ? [payload.integrationId] : [],
						});
						const result = yield* engine
							.execute(ProcessGenericImportChunksWorkflow, { payload, executionId })
							.pipe(
								Effect.mapError(
									(error) =>
										new SandboxRunError({
											kind: "infrastructure",
											message: unknownToMessage(error),
										}),
								),
							);
						return yield* Schema.decodeEffect(jsonValueSchema)(result).pipe(
							Effect.mapError(
								(error) =>
									new SandboxRunError({ kind: "infrastructure", message: unknownToMessage(error) }),
							),
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
												(error) =>
													new SandboxRunError({
														kind: "infrastructure",
														message: unknownToMessage(error),
													}),
											),
										)
								: null;
						if (typeof providerSlug === "string" && !resolvedProvider) {
							return yield* new SandboxRunError({
								kind: "script-failure",
								message: `Plugin provider not found: ${providerSlug}`,
							});
						}
						const command = lifecycleCommand(
							subject,
							executionId,
							KERNEL_ENTITY_IMPORT_WORKFLOW,
							occurredAt,
							"api",
						);
						const payload = yield* Schema.decodeUnknownEffect(ProviderEntityImportWorkflowPayload)({
							...rawInput,
							command,
							executionId,
							entityScope: { userId, type: "global" },
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
										kind: "invalid-input",
										message: `Invalid kernel workflow input: ${unknownToMessage(error)}`,
									}),
							),
						);
						yield* validateAttribution({
							userId,
							importRunIds: command.causation.importRunId ? [command.causation.importRunId] : [],
							integrationIds: command.causation.integrationId
								? [command.causation.integrationId]
								: [],
						});
						const result = yield* engine
							.execute(EntityImportWorkflow, { payload, executionId })
							.pipe(
								Effect.match({
									onSuccess: (entity) => ({ entity, status: "completed" as const }),
									onFailure: (error: EntityImportError) => ({
										stage: error.stage,
										message: error.message,
										status: "failed" as const,
									}),
								}),
							);
						return yield* Schema.decodeUnknownEffect(jsonValueSchema)(result).pipe(
							Effect.mapError(
								(error) =>
									new SandboxRunError({ kind: "infrastructure", message: unknownToMessage(error) }),
							),
						);
					}
					const command = lifecycleCommand(
						subject,
						executionId,
						KERNEL_EVENT_CREATE_WORKFLOW,
						occurredAt,
						"api",
					);
					const payload = yield* Schema.decodeUnknownEffect(EventCreateWorkflowPayload)({
						userId,
						command,
						payload: isObjectRecord(input) ? Reflect.get(input, "payload") : undefined,
					}).pipe(
						Effect.mapError(
							(error) =>
								new SandboxRunError({
									kind: "invalid-input",
									message: `Invalid kernel workflow input: ${unknownToMessage(error)}`,
								}),
						),
					);
					yield* validateAttribution({
						userId,
						importRunIds: command.causation.importRunId ? [command.causation.importRunId] : [],
						integrationIds: command.causation.integrationId
							? [command.causation.integrationId]
							: [],
					});
					const result = yield* engine
						.execute(EventCreateWorkflow, { payload, executionId })
						.pipe(
							Effect.mapError(
								(error) =>
									new SandboxRunError({ kind: "infrastructure", message: unknownToMessage(error) }),
							),
						);
					return yield* Schema.decodeEffect(jsonValueSchema)(result).pipe(
						Effect.mapError(
							(error) =>
								new SandboxRunError({ kind: "infrastructure", message: unknownToMessage(error) }),
						),
					);
				}).pipe(Effect.provideService(Database, database)),
		};
	}),
);
