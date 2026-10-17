import { DbError } from "@ryot-app/contract/errors";
import { encodeEntityUpdatedMessage } from "@ryot-app/contract/modules/entity-watches/messages";
import {
	EventStreamStepInput,
	EventStreamStepOutput,
	EventStreamWorkRequest,
} from "@ryot-app/contract/modules/events/stream-work";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import {
	AutomationExecutionId,
	EntityId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, eq } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { ManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import { rootLifecycleCausation } from "#modules/automations/lifecycle/command";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { parseAppSchemaProperties } from "#modules/definitions/properties/runtime";
import { EntitiesRepository } from "#modules/entities/repository";
import { DomainLifecycleCommand, DomainWriteChecks } from "#modules/entities/write-context";
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import {
	sameRevisionPin,
	ScriptExecutionPrincipal,
	ScriptPluginRevision,
} from "#modules/scripts/authorization/principal";
import { DatabaseSession } from "#platform/db/session";
import { redisKeys, RedisService } from "#platform/redis";
import {
	asIndependentWorkflowRoot,
	implementWorkflow,
	makeActivity,
} from "#platform/workflow/scope";
import * as tables from "#schema/tables/combined";

import { resolveEventCreateItemScopes } from "./event-creation";
import { EventProjectionRepository } from "./projection-repository";
import { EventStreamRepository } from "./stream-repository";

const EventStreamClaim = Schema.Struct({
	id: Schema.String,
	attempt: Schema.Int,
	revision: Schema.Int,
	outputSchema: AppSchema,
	occurredAt: IsoUtcString,
	input: EventStreamStepInput,
	processorScriptId: SandboxScriptId,
	accountGeneration: AccountGeneration,
	pluginPin: Schema.Struct({
		...ScriptPluginRevision.fields,
		writeContext: ScriptExecutionPrincipal,
	}),
});

export class EventStreamProcessor extends Context.Service<
	EventStreamProcessor,
	{
		execute: (
			claim: typeof EventStreamClaim.Type,
			executionId: string,
		) => Effect.Effect<unknown, DbError>;
	}
>()("EventStreamProcessor") {}

export class EventProjectionBindings extends Context.Service<
	EventProjectionBindings,
	{
		resolve: (input: {
			userId: UserId;
			pluginId: string;
			scriptSlug: string;
		}) => Effect.Effect<
			{
				principal: ScriptExecutionPrincipal;
				pluginPin: ScriptPluginRevision;
				accountGeneration: AccountGeneration;
			} | null,
			DbError
		>;
	}
>()("EventProjectionBindings") {}

const StepPayload = Schema.Struct({ id: Schema.String, attempt: Schema.Int });
export const EventStreamStepWorkflow = Workflow.make("EventStreamStepWorkflow", {
	error: DbError,
	payload: StepPayload,
	success: Schema.Void,
	idempotencyKey: ({ id, attempt }) => `${id}:${attempt}`,
});
export const EventStreamDispatchWorkflow = Workflow.make("EventStreamDispatchWorkflow", {
	error: DbError,
	success: Schema.Void,
	idempotencyKey: ({ requestId }) => requestId,
	payload: Schema.Struct({ id: Schema.String, requestId: Schema.String }),
});

export class EventStreamWorkService extends Context.Service<EventStreamWorkService>()(
	"EventStreamWorkService",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const writes = yield* DomainWriteChecks;
			const repository = yield* EventStreamRepository;
			const projections = yield* EventProjectionRepository;
			const entities = yield* EntitiesRepository;
			const eventSchemas = yield* EventSchemaReader;
			const receipts = yield* MutationReceipts.make;
			const engine = yield* WorkflowEngine;
			const processor = yield* EventStreamProcessor;
			const bindings = yield* EventProjectionBindings;
			const redis = yield* RedisService;
			const assets = yield* ManagedAssetReferenceLocker.make;
			const publishUpdate = (entityId: EntityId, userId: UserId) =>
				redis
					.publish(
						redisKeys.entityUpdatedChannel,
						encodeEntityUpdatedMessage(entityId, "projection-updated", userId),
					)
					.pipe(
						Effect.catchCause((cause) =>
							Effect.logWarning("Projection refresh publication failed", cause),
						),
						Effect.asVoid,
					);

			const request = Effect.fn("EventStreamWorkService.request")(function* (input: {
				request: typeof EventStreamWorkRequest.Type;
				processorScriptId: SandboxScriptId;
				pluginPin: ScriptPluginRevision;
				accountGeneration: AccountGeneration;
				command: DomainLifecycleCommand;
			}) {
				if (
					!input.command.writeContext?.pluginRevision ||
					input.command.writeContext.pluginRevision.id !== input.pluginPin.id ||
					!sameRevisionPin(input.command.writeContext.pluginRevision, input.pluginPin)
				) {
					return yield* new DbError({
						message: "Event stream request requires its exact persisted execution authority",
					});
				}
				const scope = yield* resolveEventCreateItemScopes({
					command: input.command,
					userId: input.accountGeneration.userId,
					item: {
						properties: {},
						entityId: input.request.entityId,
						eventSchemaSlug: input.request.eventSchemaSlug,
					},
				}).pipe(
					Effect.provideService(DomainWriteChecks, writes),
					Effect.provideService(EntitiesRepository, entities),
					Effect.provideService(EventSchemaReader, eventSchemas),
				);
				if (
					scope.eventSchemaScope.pluginId !== input.pluginPin.id ||
					!scope.eventSchemaScope.projection
				) {
					return yield* new DbError({
						message: "Event stream processor must own its schema and declared output properties",
					});
				}
				return yield* session.transaction(
					Effect.gen(function* () {
						yield* writes
							.check(
								input.command,
								definitionOwner(input.pluginPin.id),
								input.accountGeneration.userId,
								true,
							)
							.pipe(Effect.mapError((error) => new DbError({ message: error.message })));
						const [target] = yield* session.run((db) =>
							db
								.select({
									slug: tables.sandboxScript.slug,
									contentHash: tables.sandboxScript.contentHash,
								})
								.from(tables.sandboxScript)
								.where(
									and(
										eq(tables.sandboxScript.id, input.processorScriptId),
										eq(tables.sandboxScript.pluginRevisionId, input.pluginPin.revisionId),
									),
								)
								.limit(1),
						);
						if (
							!target ||
							input.pluginPin.compiledHashes[target.slug] !== target.contentHash ||
							target.slug !== scope.eventSchemaScope.projection?.scriptSlug
						) {
							return yield* new DbError({
								message:
									"Event stream processor does not belong to the exact admitted plugin revision",
							});
						}
						return yield* repository.request({
							processorScriptId: input.processorScriptId,
							accountToken: input.accountGeneration.token,
							pluginRevisionId: input.pluginPin.revisionId,
							outputSchema: scope.eventSchemaScope.projection.propertiesSchema,
							key: {
								entityId: input.request.entityId,
								userId: input.accountGeneration.userId,
								eventSchemaPluginId: input.pluginPin.id,
								eventSchemaSlug: input.request.eventSchemaSlug,
							},
							pluginPin: yield* Schema.encodeUnknownEffect(JsonValue)({
								...input.pluginPin,
								writeContext: input.command.writeContext,
							}).pipe(Effect.mapError(() => new DbError({ message: "Invalid processor pin" }))),
						});
					}),
				);
			});

			const dispatch = Effect.fn("EventStreamWorkService.dispatch")(function* (id: string) {
				const work = yield* repository.get(id);
				if (!work || (work.status !== "queued" && work.status !== "running")) {
					return;
				}
				const attempt = work.status === "running" ? work.attempt - 1 : work.attempt;
				yield* dispatchAdmittedWorkflow(
					receipts,
					engine,
					EventStreamStepWorkflow,
					{ token: work.accountToken, userId: UserId.make(work.key.userId) },
					{
						discard: true,
						payload: { id, attempt },
						executionId: `event-stream-${id}-${attempt + 1}`,
					},
					(effect) => effect,
					(effect) => effect,
				).pipe(asIndependentWorkflowRoot);
			});

			const claim = Effect.fn("EventStreamWorkService.claim")(function* (
				payload: typeof StepPayload.Type,
			) {
				const work = yield* session.transaction(repository.claim(payload.id, payload.attempt));
				if (!work) {
					return null;
				}
				const account = yield* receipts.currentAccount(UserId.make(work.key.userId));
				if (account.token !== work.accountToken) {
					return null;
				}
				return yield* Schema.decodeUnknownEffect(EventStreamClaim)({
					id: work.id,
					attempt: work.attempt,
					pluginPin: work.pluginPin,
					accountGeneration: account,
					revision: work.streamRevision,
					outputSchema: work.outputSchema,
					occurredAt: work.updatedAt.toISOString(),
					processorScriptId: work.processorScriptId,
					input: {
						entityId: work.key.entityId,
						checkpoint: work.checkpoint,
						eventSchemaSlug: work.key.eventSchemaSlug,
						dirtyFrom: work.dirtyFrom?.toISOString() ?? null,
					},
				}).pipe(
					Effect.mapError(() => new DbError({ message: "Invalid persisted event stream claim" })),
				);
			});

			const process = Effect.fn("EventStreamWorkService.process")(function* (
				workClaim: typeof EventStreamClaim.Type,
			) {
				const executionId = `event-stream-${workClaim.id}-${workClaim.attempt}`;
				const rawOutput = yield* processor.execute(workClaim, `${executionId}-processor`);
				const output = yield* Schema.decodeUnknownEffect(EventStreamStepOutput)(rawOutput).pipe(
					Effect.mapError(
						() => new DbError({ message: "Event stream processor returned invalid output" }),
					),
				);
				if (stableStringify(output.checkpoint).length > 16_384) {
					return yield* new DbError({
						message: "Event stream checkpoint exceeds its bounded size",
					});
				}
				if (new Set(output.updates.map(({ eventId }) => eventId)).size !== output.updates.length) {
					return yield* new DbError({ message: "Event stream processor repeated an event" });
				}
				const command = yield* Schema.decodeEffect(DomainLifecycleCommand)({
					itemIdentity: "stream-step",
					occurredAt: workClaim.occurredAt,
					writeContext: workClaim.pluginPin.writeContext,
					accountGeneration: workClaim.accountGeneration,
					causation: rootLifecycleCausation({
						lane: "background",
						source: "bootstrap",
						executionId: AutomationExecutionId.make(executionId),
						initiator: { kind: "user", id: workClaim.accountGeneration.userId },
					}),
				}).pipe(
					Effect.mapError(() => new DbError({ message: "Invalid event stream lifecycle command" })),
				);
				const updates = yield* Effect.forEach(output.updates, (item) =>
					parseAppSchemaProperties({
						kind: "Projection",
						properties: item.properties,
						propertiesSchema: workClaim.outputSchema,
					}).pipe(
						Effect.flatMap((properties) =>
							Schema.decodeUnknownEffect(EventStreamStepOutput.fields.updates.value)({
								...item,
								properties,
							}),
						),
						Effect.mapError(
							() =>
								new DbError({ message: "Projection output does not match its declared schema" }),
						),
					),
				);
				const published = yield* makeActivity({
					error: DbError,
					success: Schema.Boolean,
					name: "publish-projection",
					execute: session
						.transaction(
							Effect.gen(function* () {
								yield* writes
									.check(
										command,
										definitionOwner(workClaim.pluginPin.id),
										workClaim.accountGeneration.userId,
										true,
									)
									.pipe(Effect.mapError((error) => new DbError({ message: error.message })));
								yield* entities.lockEntityReferencesByIds([
									EntityId.make(workClaim.input.entityId),
								]);
								if (
									!(yield* repository.currentClaim(
										workClaim.id,
										workClaim.attempt,
										workClaim.revision,
									))
								) {
									return false;
								}
								const source = yield* entities.getEntityScopeForUser({
									userId: workClaim.accountGeneration.userId,
									entityId: EntityId.make(workClaim.input.entityId),
								});
								if (!source) {
									return yield* new DbError({ message: "Projection source is unavailable" });
								}
								const currentSchema = yield* eventSchemas.getScopeForUser({
									entitySchemaSlug: source.entitySchemaSlug,
									userId: workClaim.accountGeneration.userId,
									eventSchemaSlug: workClaim.input.eventSchemaSlug,
									entitySchemaPluginId: source.entitySchemaPluginId,
								});
								if (!currentSchema?.projection) {
									return yield* new DbError({ message: "Projection declaration is unavailable" });
								}
								const binding = yield* bindings.resolve({
									pluginId: workClaim.pluginPin.id,
									userId: workClaim.accountGeneration.userId,
									scriptSlug: currentSchema.projection.scriptSlug,
								});
								if (!binding) {
									return yield* new DbError({ message: "Projection binding is unavailable" });
								}
								if (
									!sameRevisionPin(binding.pluginPin, workClaim.pluginPin) ||
									binding.principal.scriptId !== workClaim.processorScriptId
								) {
									yield* repository.request({
										processorScriptId: binding.principal.scriptId,
										accountToken: binding.accountGeneration.token,
										pluginRevisionId: binding.pluginPin.revisionId,
										outputSchema: currentSchema.projection.propertiesSchema,
										key: {
											userId: workClaim.accountGeneration.userId,
											eventSchemaPluginId: workClaim.pluginPin.id,
											eventSchemaSlug: workClaim.input.eventSchemaSlug,
											entityId: EntityId.make(workClaim.input.entityId),
										},
										pluginPin: yield* Schema.encodeUnknownEffect(JsonValue)({
											...binding.pluginPin,
											writeContext: binding.principal,
										}).pipe(
											Effect.mapError(() => new DbError({ message: "Invalid projection binding" })),
										),
									});
									return false;
								}
								yield* assets
									.lock(
										updates.map((item) => ({
											properties: item.properties,
											propertiesSchema: workClaim.outputSchema,
											ownerUserId: workClaim.accountGeneration.userId,
										})),
									)
									.pipe(
										Effect.mapError(
											() =>
												new DbError({ message: "Projection output contains an unavailable asset" }),
										),
									);
								yield* projections.publish({
									updates,
									streamId: workClaim.id,
									entityId: workClaim.input.entityId,
									userId: workClaim.accountGeneration.userId,
									eventSchemaPluginId: workClaim.pluginPin.id,
									eventSchemaSlug: workClaim.input.eventSchemaSlug,
								});
								if (
									!(yield* repository.finish(
										workClaim.id,
										workClaim.attempt,
										output.checkpoint,
										output.done,
									))
								) {
									return yield* new DbError({
										message: "Event stream claim changed during commit",
									});
								}
								return output.done;
							}),
						)
						.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die)),
				});
				if (published) {
					yield* publishUpdate(
						EntityId.make(workClaim.input.entityId),
						workClaim.accountGeneration.userId,
					);
				}
				return undefined;
			});

			const fail = Effect.fn("EventStreamWorkService.fail")(function* (
				id: string,
				attempt: number,
				message: string,
			) {
				const failed = yield* session.transaction(repository.fail(id, attempt, message));
				if (failed) {
					yield* Effect.logError("event stream processing failed").pipe(
						Effect.annotateLogs({ attempt, workId: id, reason: message }),
					);
					const work = yield* repository.get(id);
					if (work) {
						yield* publishUpdate(EntityId.make(work.key.entityId), UserId.make(work.key.userId));
					}
				}
				return failed;
			});
			const reconcile = Effect.fn("EventStreamWorkService.reconcile")(function* () {
				let after: string | undefined;
				for (;;) {
					const candidates = yield* repository.bindingCandidates({
						...(after === undefined ? {} : { after }),
						limit: 100,
					});
					for (const candidate of candidates) {
						const { key, projection } = candidate;
						if (!projection || key.eventSchemaPluginId === null) {
							continue;
						}
						const binding = yield* bindings.resolve({
							userId: UserId.make(key.userId),
							pluginId: key.eventSchemaPluginId,
							scriptSlug: projection.scriptSlug,
						});
						if (!binding) {
							continue;
						}
						const occurredAt = DateTime.formatIso(yield* DateTime.now);
						const command = yield* Schema.decodeEffect(DomainLifecycleCommand)({
							occurredAt,
							writeContext: binding.principal,
							itemIdentity: "projection-binding",
							accountGeneration: binding.accountGeneration,
							causation: rootLifecycleCausation({
								lane: "background",
								source: "bootstrap",
								initiator: { kind: "user", id: UserId.make(key.userId) },
								executionId: AutomationExecutionId.make(
									`projection-binding:${candidate.id}:${binding.pluginPin.revisionId}:${binding.pluginPin.configRevisionId}`,
								),
							}),
						}).pipe(
							Effect.mapError(() => new DbError({ message: "Invalid projection binding command" })),
						);
						yield* request({
							command,
							pluginPin: binding.pluginPin,
							accountGeneration: binding.accountGeneration,
							processorScriptId: binding.principal.scriptId,
							request: yield* Schema.decodeEffect(EventStreamWorkRequest)({
								entityId: key.entityId,
								eventSchemaSlug: key.eventSchemaSlug,
							}).pipe(
								Effect.mapError(() => new DbError({ message: "Invalid projection stream key" })),
							),
						});
					}
					if (candidates.length < 100) {
						break;
					}
					after = candidates[candidates.length - 1]?.id;
					if (after === undefined) {
						break;
					}
				}
				for (const work of yield* repository.listCandidates()) {
					yield* dispatch(work.id);
				}
			});
			return { fail, claim, process, request, dispatch, reconcile };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const EventStreamWorkflowDefinitionsLive = Layer.merge(
	implementWorkflow(
		EventStreamStepWorkflow,
		Effect.fn("EventStreamStepWorkflow")(function* (payload) {
			const service = yield* EventStreamWorkService;
			const claim = yield* makeActivity({
				name: "claim",
				error: DbError,
				execute: service.claim(payload),
				success: Schema.NullOr(EventStreamClaim),
			});
			if (!claim) {
				return;
			}
			yield* service
				.process(claim)
				.pipe(
					Effect.catchTag("DbError", (error) =>
						service.fail(claim.id, claim.attempt, error.message).pipe(Effect.asVoid),
					),
				);
			yield* service.dispatch(claim.id);
		}),
	),
	implementWorkflow(
		EventStreamDispatchWorkflow,
		Effect.fn("EventStreamDispatchWorkflow")(function* ({ id }) {
			yield* (yield* EventStreamWorkService).dispatch(id);
		}),
	),
);
