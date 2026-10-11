import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import {
	type ExecutionLane,
	LifecycleCommand,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	KERNEL_EVENT_CREATE_WORKFLOW,
	KERNEL_EVENT_STREAM_WORKFLOW,
	KERNEL_ENTITY_IMPORT_WORKFLOW,
	KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW,
	KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW,
} from "@ryot-app/contract/modules/plugins/execution";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	EntitySchemaSlug,
	ImportRunId,
	SandboxProviderId,
	type IntegrationId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { genericImportKernelInputSchema } from "@ryot-app/sandbox-sdk/imports";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import { SandboxExecutionAuthority } from "@ryot-app/sandbox/host/authority";
import { ExecutionFileStore } from "@ryot-app/sandbox/host/execution-files";
import {
	ScriptPluginRevision,
	samePluginPin,
	sameRevisionPin,
	sandboxSubjectUserId,
	type ScriptExecutionPrincipal,
} from "@ryot-app/sandbox/protocol/principal";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { DateTime, Effect, Exit, Layer, Option, Schema } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import {
	rootLifecycleCommand,
	lifecycleActor,
	automationLifecycleCausation,
} from "#modules/automations/lifecycle/command";
import {
	EntityImportWorkflow,
	type EntityImportError,
} from "#modules/entities/providers/entity-import-workflow";
import {
	ProviderEntityPopulationWorkflow,
	type ProviderEntityPopulationPayload,
} from "#modules/entities/providers/provider-entity-population-workflow";
import { ProviderEntityImportWorkflowPayload } from "#modules/entities/providers/schemas";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import {
	EventCreateWorkflow,
	EventCreateWorkflowPayload,
} from "#modules/events/event-create-workflow";
import { EventStreamRepository } from "#modules/events/stream-repository";
import { EventStreamDispatchWorkflow } from "#modules/events/stream-work";
import { ingestionArtifactGrants } from "#modules/imports/artifact-grants";
import { IngestionCaptures } from "#modules/imports/capture-service";
import {
	ProcessGenericImportChunksPayload,
	ProcessGenericImportChunksWorkflow,
} from "#modules/imports/generic-import-workflow";
import { ImportsRepository } from "#modules/imports/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { KernelWorkflowReferences } from "#modules/scripts/registry/kernel-workflow-references";
import { DatabaseSession } from "#platform/db/session";

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

const EventStreamDispatchReferenceInput = Schema.Struct({ id: Schema.String });

const wireLifecycleCommand = (
	callerAuthority: ScriptExecutionPrincipal,
	lane: ExecutionLane,
	executionId: string,
	itemIdentity: string,
	occurredAt: LifecycleCommand["occurredAt"],
	source: "api" | "import" | "integration" | "provider-refresh",
	attribution: { importRunId?: ImportRunId; integrationId?: IntegrationId } = {},
): LifecycleCommand => {
	const subject = callerAuthority.subject;
	if (subject.type === "automation-run") {
		return Schema.decodeSync(LifecycleCommand)({
			occurredAt,
			itemIdentity,
			accountGeneration: subject.accountGeneration,
			causation: automationLifecycleCausation(subject, AutomationExecutionId.make(executionId)),
		});
	}
	const integrationId = subject.type === "user" ? subject.integrationId : undefined;
	const attributedIntegrationId = integrationId ?? attribution.integrationId;
	return rootLifecycleCommand({
		...lifecycleActor(subject.type === "user" ? subject : null),
		lane,
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

const lifecycleCommand = (
	...args: Parameters<typeof wireLifecycleCommand>
): DomainLifecycleCommand => ({ ...wireLifecycleCommand(...args), writeContext: args[0] });

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
		const imports = yield* ImportsRepository;
		const eventStreams = yield* EventStreamRepository;
		const captures = yield* IngestionCaptures;
		const database = yield* DatabaseSession;
		const artifacts = yield* ExecutionFileStore;
		const integrations = yield* IntegrationsRepository;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const receipts = yield* MutationReceipts.make;
		const executionAuthority = yield* SandboxExecutionAuthority;
		const admit = (registration: ReturnType<typeof receipts.registerWorkflow>) =>
			registration.pipe(
				Effect.mapError(
					(error) => new SandboxRunError({ kind: "infrastructure", message: error.message }),
				),
			);

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
			resolveArtifactGrants: (input, subject, grants) =>
				ingestionArtifactGrants(input, subject, grants).pipe(
					Effect.provideService(ImportsRepository, imports),
					Effect.provideService(IngestionCaptures, captures),
					Effect.provideService(ExecutionFileStore, artifacts),
					Effect.mapError(
						(error) =>
							new SandboxRunError({ kind: "infrastructure", message: unknownToMessage(error) }),
					),
				),
			execute: (
				workflowSlug,
				input,
				lane,
				executionId,
				_parentExecutionId,
				callerAuthority,
				artifactOwnerExecutionId,
			) =>
				Effect.gen(function* () {
					const subject = callerAuthority.subject;
					yield* executionAuthority.resolve(callerAuthority);
					const callerPlugin = callerAuthority.pluginRevision;
					const userId = sandboxSubjectUserId(subject);
					const artifactOwner = artifactOwnerExecutionId ?? _parentExecutionId;
					const occurredAt = IsoUtcString.make((yield* DateTime.nowAsDate).toISOString());
					if (
						workflowSlug !== KERNEL_EVENT_CREATE_WORKFLOW &&
						workflowSlug !== KERNEL_EVENT_STREAM_WORKFLOW &&
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
						if (!callerPlugin || callerAuthority.metadata.kind !== "workflow") {
							return yield* new SandboxRunError({
								kind: "script-failure",
								message: "Provider entity population requires a pinned plugin workflow caller",
							});
						}
						if (callerPlugin.scope === "user" && userId === null) {
							return yield* new SandboxRunError({
								kind: "script-failure",
								message: "Private provider population requires its execution user",
							});
						}
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
							(userId === null
								? pluginRuntime
										.findAuthorizedSchemaProviderById({
											providerId: SandboxProviderId.make(item.providerId),
											entitySchema: {
												owner: definitionOwner(callerPlugin.id),
												slug: EntitySchemaSlug.make(item.entitySchemaSlug),
											},
										})
										.pipe(Effect.map((resolved) => resolved?.provider ?? null))
								: pluginRuntime.findProviderAvailableToUser(
										userId,
										SandboxProviderId.make(item.providerId),
									)
							).pipe(
								Effect.mapError(
									(error) =>
										new SandboxRunError({
											kind: "infrastructure",
											message: unknownToMessage(error),
										}),
								),
								Effect.flatMap((provider) =>
									provider &&
									provider.pluginId === callerPlugin.id &&
									provider.rootEntitySchemaSlug === item.entitySchemaSlug &&
									callerPlugin.schemaScope.entitySchemaSlugs.includes(item.entitySchemaSlug)
										? Effect.succeed({ item, provider })
										: Effect.fail(
												new SandboxRunError({
													kind: "script-failure",
													message: `Provider '${item.providerId}' is unavailable or has no exact binding to entity schema '${item.entitySchemaSlug}' owned by plugin '${callerPlugin.id}'`,
												}),
											),
								),
							),
						);
						const engine = yield* WorkflowEngine;
						const exits = yield* Effect.forEach(
							ownedItems,
							({ item, provider }, index) => {
								const childExecutionId = `${executionId}-item-${index}`;
								return dispatchAdmittedWorkflow(
									receipts,
									engine,
									ProviderEntityPopulationWorkflow,
									subject.type === "system" ? null : subject.accountGeneration,
									{
										executionId: childExecutionId,
										payload: {
											mode: decoded.mode,
											providerId: provider.id,
											pluginId: callerPlugin.id,
											externalId: item.externalId,
											executionId: childExecutionId,
											entitySchemaSlug: EntitySchemaSlug.make(item.entitySchemaSlug),
											entityScope:
												callerPlugin.scope === "user" && userId !== null
													? { userId, type: "user" }
													: { userId, type: "global" },
											command: lifecycleCommand(
												callerAuthority,
												lane,
												childExecutionId,
												`${KERNEL_PROVIDER_ENTITY_POPULATION_WORKFLOW}:${index}`,
												occurredAt,
												"provider-refresh",
											),
										} satisfies ProviderEntityPopulationPayload,
									},
									admit,
									(dispatch) =>
										dispatch.pipe(
											Effect.mapError(
												(error) =>
													new SandboxRunError({
														kind: "infrastructure",
														message: unknownToMessage(error),
													}),
											),
											Effect.exit,
										),
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
					if (userId === null) {
						return yield* new SandboxRunError({
							kind: "script-failure",
							message: `Kernel workflow '${workflowSlug}' is not available for system executions`,
						});
					}
					const engine = yield* WorkflowEngine;
					if (workflowSlug === KERNEL_EVENT_STREAM_WORKFLOW) {
						const decoded = yield* Schema.decodeUnknownEffect(EventStreamDispatchReferenceInput)(
							input,
						).pipe(
							Effect.mapError(
								(error) =>
									new SandboxRunError({
										kind: "invalid-input",
										message: `Invalid kernel workflow input: ${unknownToMessage(error)}`,
									}),
							),
						);
						const work = yield* eventStreams
							.get(decoded.id)
							.pipe(
								Effect.mapError(
									(error) =>
										new SandboxRunError({
											kind: "infrastructure",
											message: unknownToMessage(error),
										}),
								),
							);
						if (!work || work.key.userId !== userId) {
							return yield* new SandboxRunError({
								kind: "script-failure",
								message: "Event stream work does not belong to the executing user",
							});
						}
						const workPin = Option.getOrNull(
							Schema.decodeUnknownOption(ScriptPluginRevision)(work.pluginPin),
						);
						if (
							!callerPlugin ||
							work.key.eventSchemaPluginId !== callerPlugin.id ||
							workPin?.id !== callerPlugin.id ||
							!sameRevisionPin(workPin, callerPlugin)
						) {
							return yield* new SandboxRunError({
								kind: "script-failure",
								message: "Event stream work does not match the exact caller plugin pin",
							});
						}
						const accountGeneration =
							subject.type === "user" || subject.type === "automation-run"
								? subject.accountGeneration
								: undefined;
						if (!accountGeneration) {
							return yield* new SandboxRunError({
								kind: "script-failure",
								message: "Event stream work dispatch requires a user execution",
							});
						}
						yield* dispatchAdmittedWorkflow(
							receipts,
							engine,
							EventStreamDispatchWorkflow,
							accountGeneration,
							{ executionId, payload: { id: decoded.id, requestId: executionId } },
							admit,
							(execution) =>
								execution.pipe(
									Effect.mapError(
										(error) =>
											new SandboxRunError({
												kind: "infrastructure",
												message: unknownToMessage(error),
											}),
									),
								),
						);
						return null;
					}
					if (workflowSlug === KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW) {
						const rawInput = isObjectRecord(input) ? input : {};
						const rawRunId = Reflect.get(rawInput, "runId");
						const command = wireLifecycleCommand(
							callerAuthority,
							lane,
							typeof rawRunId === "string" ? rawRunId : executionId,
							KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW,
							occurredAt,
							"import",
							typeof rawRunId === "string" ? { importRunId: ImportRunId.make(rawRunId) } : {},
						);
						if (!command.accountGeneration || typeof rawRunId !== "string") {
							return yield* new SandboxRunError({
								kind: "invalid-input",
								message: "Ingestion requires an account-scoped run",
							});
						}
						const scope = {
							userId,
							runId: ImportRunId.make(rawRunId),
							accountGeneration: command.accountGeneration,
						};
						const run = yield* imports
							.getIngestionRun(scope)
							.pipe(
								Effect.mapError(
									(error) =>
										new SandboxRunError({
											kind: "infrastructure",
											message: unknownToMessage(error),
										}),
								),
							);
						if (!run) {
							return yield* new SandboxRunError({
								kind: "script-failure",
								message: `Kernel workflow import run '${rawRunId}' does not belong to the executing user`,
							});
						}
						if (run.status !== "running" || run.pins?.executionId !== artifactOwner) {
							return yield* new SandboxRunError({
								kind: "script-failure",
								message: "Ingestion run is not running",
							});
						}
						if (!callerPlugin || !samePluginPin(callerPlugin, run.pins)) {
							return yield* new SandboxRunError({
								kind: "script-failure",
								message: "Ingestion run does not match the exact caller plugin pin",
							});
						}
						const wireCommand = { ...command, occurredAt: IsoUtcString.make(run.acceptedAt) };
						const acceptedCommand = { ...wireCommand, writeContext: callerAuthority };
						const decodedInput = yield* Schema.decodeUnknownEffect(genericImportKernelInputSchema)({
							...rawInput,
							command: wireCommand,
						}).pipe(
							Effect.mapError(
								(error) =>
									new SandboxRunError({
										kind: "invalid-input",
										message: `Invalid kernel workflow input: ${unknownToMessage(error)}`,
									}),
							),
						);
						const operation = decodedInput.operation;
						if (operation.action !== "apply") {
							const result = yield* Effect.gen(function* () {
								if (operation.action === "seal") {
									yield* database.transaction(imports.sealCollection(scope));
									return {
										sealed: true,
										summary: (yield* imports.getIngestionRun(scope))?.summary ?? [],
									};
								}
								if (operation.action === "activity") {
									yield* database.transaction(imports.putActivity(scope, operation.activity));
									return { recorded: true };
								}
								if (operation.action === "captures") {
									const page = yield* imports.pageCaptures(
										scope,
										operation.after === null ? null : operation.after + 64,
										operation.limit,
									);
									const values = page.flatMap(({ data }) =>
										data.payload
											? [
													{
														captureId: data.id,
														ordinal: data.ordinal - 64,
														checkpoint: data.checkpoint,
														inputFingerprint: data.payload.checksum,
													},
												]
											: [],
									);
									return {
										captures: values,
										next:
											page.length === operation.limit
												? (page[page.length - 1]?.data.ordinal ?? 64) - 64
												: null,
									};
								}
								if (operation.action === "materialize") {
									const handle = yield* captures.stage({
										scope,
										outputIndex: 0,
										ownerExecutionId: artifactOwner,
										activityExecutionId: executionId,
										workflowExecutionId: _parentExecutionId,
										bytes: yield* captures.read(scope, operation.captureId, 4 * 1024 * 1024),
									});
									return { handle };
								}
								const publication = {
									scope,
									phase: operation.phase,
									id: operation.captureId,
									state: "sealed" as const,
									maxBytes: 4 * 1024 * 1024,
									ordinal: operation.ordinal + 64,
									checkpoint: operation.checkpoint,
								};
								let capture = yield* captures.resume(publication);
								capture ??= yield* captures.publish({
									...publication,
									bytes: yield* captures.readStaged(scope, artifactOwner, operation.handle),
								});
								if (!capture.payload) {
									return yield* new SandboxRunError({
										kind: "infrastructure",
										message: "Capture payload is missing",
									});
								}
								return {
									captureId: capture.id,
									handle: operation.handle,
									inputFingerprint: capture.payload.checksum,
								};
							}).pipe(
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
										new SandboxRunError({
											kind: "infrastructure",
											message: unknownToMessage(error),
										}),
								),
							);
						}
						const payload = yield* Schema.decodeEffect(ProcessGenericImportChunksPayload)({
							...operation,
							userId,
							executionId,
							runId: scope.runId,
							command: acceptedCommand,
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
						const result = yield* dispatchAdmittedWorkflow(
							receipts,
							engine,
							ProcessGenericImportChunksWorkflow,
							command.accountGeneration,
							{ payload, executionId },
							admit,
							(execution) =>
								execution.pipe(
									Effect.mapError(
										(error) =>
											new SandboxRunError({
												kind: "infrastructure",
												message: unknownToMessage(error),
											}),
									),
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
						if (!callerPlugin) {
							return yield* new SandboxRunError({
								kind: "script-failure",
								message: "Provider import requires a pinned plugin caller",
							});
						}
						const rawInput = isObjectRecord(input) ? input : {};
						const providerSlug = Reflect.get(rawInput, "providerSlug");
						const resolvedProvider =
							typeof providerSlug === "string"
								? yield* pluginRuntime
										.findProviderAvailableToUserByReference(userId, {
											slug: providerSlug,
											owner: definitionOwner(callerPlugin.id),
										})
										.pipe(
											Effect.map((provider) =>
												provider &&
												provider.pluginId === callerPlugin.id &&
												callerPlugin.schemaScope.entitySchemaSlugs.includes(
													provider.rootEntitySchemaSlug,
												)
													? {
															provider,
															entitySchemaSlug: EntitySchemaSlug.make(
																provider.rootEntitySchemaSlug,
															),
														}
													: null,
											),
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
							callerAuthority,
							lane,
							executionId,
							KERNEL_ENTITY_IMPORT_WORKFLOW,
							occurredAt,
							"api",
						);
						const payload = yield* Schema.decodeUnknownEffect(ProviderEntityImportWorkflowPayload)({
							...rawInput,
							command,
							executionId,
							pluginId: callerPlugin.id,
							entityScope: { userId, type: callerPlugin.scope === "user" ? "user" : "global" },
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
						const result = yield* dispatchAdmittedWorkflow(
							receipts,
							engine,
							EntityImportWorkflow,
							command.accountGeneration,
							{ payload, executionId },
							admit,
							(execution) =>
								execution.pipe(
									Effect.match({
										onSuccess: (entity) => ({ entity, status: "completed" as const }),
										onFailure: (error: EntityImportError) => ({
											stage: error.stage,
											message: error.message,
											status: "failed" as const,
										}),
									}),
								),
						);
						return yield* Schema.decodeUnknownEffect(jsonValueSchema)(result).pipe(
							Effect.mapError(
								(error) =>
									new SandboxRunError({ kind: "infrastructure", message: unknownToMessage(error) }),
							),
						);
					}
					const command = lifecycleCommand(
						callerAuthority,
						lane,
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
					const result = yield* dispatchAdmittedWorkflow(
						receipts,
						engine,
						EventCreateWorkflow,
						command.accountGeneration,
						{ payload, executionId },
						admit,
						(execution) =>
							execution.pipe(
								Effect.mapError(
									(error) =>
										new SandboxRunError({
											kind: "infrastructure",
											message: unknownToMessage(error),
										}),
								),
							),
					);
					return yield* Schema.decodeEffect(jsonValueSchema)(result).pipe(
						Effect.mapError(
							(error) =>
								new SandboxRunError({ kind: "infrastructure", message: unknownToMessage(error) }),
						),
					);
				}),
		};
	}),
);
