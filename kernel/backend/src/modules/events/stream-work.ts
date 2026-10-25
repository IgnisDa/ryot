import { DbError } from "@ryot-app/contract/errors";
import type { AutomationTrigger } from "@ryot-app/contract/modules/automations/lifecycle";
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
	EventSchemaSlug,
	PluginId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, eq } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import { ManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import { rootLifecycleCausation } from "#modules/automations/lifecycle/command";
import { LifecycleWork } from "#modules/automations/lifecycle/planning";
import type { BackgroundWorkInput } from "#modules/background-work/model";
import { BackgroundWorkService } from "#modules/background-work/service";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { parseAppSchemaProperties } from "#modules/definitions/properties/runtime";
import { EntitiesRepository } from "#modules/entities/repository";
import { DomainLifecycleCommand, DomainWriteChecks } from "#modules/entities/write-context";
import {
	sameRevisionPin,
	ScriptExecutionPrincipal,
	ScriptPluginRevision,
} from "#modules/scripts/authorization/principal";
import { ProjectionBindings } from "#modules/scripts/executions/projection-bindings";
import { DatabaseSession } from "#platform/db/session";
import { redisKeys, RedisService } from "#platform/redis";
import { makeActivity } from "#platform/workflow/scope";
import * as tables from "#schema/tables/combined";

import { resolveEventCreateItemScopes } from "./event-creation";
import { EventProjectionRepository } from "./projection-repository";
import { type EventStreamBindingDeclaration, EventStreamRepository } from "./stream-repository";

const EventStreamClaim = Schema.Struct({
	id: Schema.String,
	jobId: Schema.String,
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

const loadPin = (pluginPin: unknown) =>
	Schema.decodeUnknownEffect(EventStreamClaim.fields.pluginPin)(pluginPin).pipe(
		Effect.mapError(() => new DbError({ message: "Invalid persisted projection binding" })),
	);

export class EventStreamWorkService extends Context.Service<EventStreamWorkService>()(
	"@ryot-app/kernel-backend/modules/events/stream-work/EventStreamWorkService",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const writes = yield* DomainWriteChecks;
			const repository = yield* EventStreamRepository;
			const projections = yield* EventProjectionRepository;
			const entities = yield* EntitiesRepository;
			const eventSchemas = yield* EventSchemaReader;
			const background = yield* BackgroundWorkService;
			const bindings = yield* ProjectionBindings;
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
			const claimFor = (
				work: NonNullable<Effect.Success<ReturnType<typeof repository.prepare>>>,
				jobId: string,
				pluginPin: typeof EventStreamClaim.fields.pluginPin.Type,
			) =>
				Schema.decodeEffect(EventStreamClaim)({
					jobId,
					pluginPin,
					id: work.id,
					revision: work.streamRevision,
					outputSchema: work.outputSchema,
					occurredAt: work.updatedAt.toISOString(),
					processorScriptId: work.processorScriptId,
					accountGeneration: { token: work.accountToken, userId: UserId.make(work.key.userId) },
					input: {
						entityId: work.key.entityId,
						checkpoint: work.checkpoint,
						eventSchemaSlug: work.key.eventSchemaSlug,
						dirtyFrom: work.dirtyFrom?.toISOString() ?? null,
					},
				}).pipe(Effect.mapError(() => new DbError({ message: "Invalid projection step" })));
			const arrange = Effect.fn("EventStreamWorkService.arrange")(function* (
				id: string,
				retry?: boolean,
			) {
				const candidate = yield* repository.get(id);
				if (!candidate) {
					return null;
				}
				yield* background.lockAccount({
					token: candidate.accountToken,
					userId: UserId.make(candidate.key.userId),
				});
				const work = yield* repository.prepare(id);
				if (
					!work ||
					work.completedRevision === work.streamRevision ||
					(work.currentJobId !== null && !(retry && work.status === "failed"))
				) {
					return work?.currentJobId ?? null;
				}
				const pin = yield* loadPin(work.pluginPin);
				const account = { token: work.accountToken, userId: UserId.make(work.key.userId) };
				const jobId = `event-projection-${sha256Hex(stableStringify([account, id, work.step + 1]))}`;
				const claim = yield* claimFor(work, jobId, pin);
				const [target] = yield* session.run((db) =>
					db
						.select({
							slug: tables.sandboxScript.slug,
							contentHash: tables.sandboxScript.contentHash,
						})
						.from(tables.sandboxScript)
						.where(eq(tables.sandboxScript.id, work.processorScriptId)),
				);
				if (!target || pin.compiledHashes[target.slug] !== target.contentHash) {
					return yield* new DbError({ message: "Projection executable pin is unavailable" });
				}
				yield* background.admit({
					id: jobId,
					key: jobId,
					scope: work.key.entityId,
					accountGeneration: account,
					purpose: "event-projection",
					contentHash: target.contentHash,
					featureInput: yield* Schema.encodeUnknownEffect(JsonValue)(claim).pipe(Effect.orDie),
					execution: {
						lane: "background",
						input: claim.input,
						pluginRevision: pin,
						resolutionMode: "exact",
						executionId: `${jobId}-script`,
						scriptId: claim.processorScriptId,
						subject: { type: "projection", userId: account.userId, accountGeneration: account },
					},
				});
				yield* repository.reserve(id, jobId);
				return jobId;
			});

			const request = Effect.fn("EventStreamWorkService.request")(function* (input: {
				pluginPin: ScriptPluginRevision;
				command: DomainLifecycleCommand;
				processorScriptId: SandboxScriptId;
				accountGeneration: AccountGeneration;
				request: typeof EventStreamWorkRequest.Type;
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
				const admitted = yield* session.transaction(
					Effect.gen(function* () {
						yield* background.lockAccount(input.accountGeneration);
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
						const id = yield* repository.request({
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
						return { id, jobId: yield* arrange(id, true) };
					}),
				);
				if (admitted.jobId) {
					yield* background.dispatch(admitted.jobId);
				}
				return admitted.id;
			});
			const admitChange = Effect.fn("EventStreamWorkService.admitChange")(function* (
				trigger: AutomationTrigger,
			) {
				const change = trigger.payload;
				const userId = trigger.scopeUserId;
				if (
					change?.category !== "change" ||
					change.resource !== "event" ||
					change.operation === "batch" ||
					userId === null
				) {
					return [];
				}
				yield* session.requireTransaction.pipe(
					Effect.mapError(
						() => new DbError({ message: "Projection admission requires a source transaction" }),
					),
				);
				const sources = [
					...(change.operation === "create" ? [] : [change.before]),
					...(change.operation === "delete" ? [] : [change.after]),
				];
				const candidates = yield* repository.sourceCandidates(
					sources.map((source) => Object.assign({}, source, { userId })),
				);
				const jobIds: Array<string> = [];
				for (const { id, key, projection } of candidates) {
					if (key.eventSchemaPluginId === null || !projection) {
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
					yield* repository.request({
						outputSchema: projection.propertiesSchema,
						processorScriptId: binding.principal.scriptId,
						accountToken: binding.accountGeneration.token,
						pluginRevisionId: binding.pluginPin.revisionId,
						key: {
							userId: UserId.make(key.userId),
							entityId: EntityId.make(key.entityId),
							eventSchemaPluginId: binding.pluginPin.id,
							eventSchemaSlug: EventSchemaSlug.make(key.eventSchemaSlug),
						},
						pluginPin: yield* Schema.encodeUnknownEffect(JsonValue)({
							...binding.pluginPin,
							writeContext: binding.principal,
						}).pipe(Effect.mapError(() => new DbError({ message: "Invalid projection binding" }))),
					});
					const jobId = yield* arrange(id);
					if (jobId) {
						jobIds.push(jobId);
					}
				}
				return jobIds;
			});

			const prepare = Effect.fn("EventStreamWorkService.prepare")(function* (
				job: BackgroundWorkInput,
			) {
				const claim = yield* Schema.decodeUnknownEffect(EventStreamClaim)(job.featureInput).pipe(
					Effect.mapError(() => new DbError({ message: "Invalid persisted projection claim" })),
				);
				return yield* session
					.transaction(
						Effect.gen(function* () {
							yield* background.lockAccount(claim.accountGeneration);
							yield* entities.lockEntityReferencesByIds([EntityId.make(claim.input.entityId)]);
							const work = yield* repository.prepare(claim.id);
							if (
								work?.currentJobId !== job.id ||
								work.status !== "running" ||
								work.accountToken !== claim.accountGeneration.token ||
								work.processorScriptId !== claim.processorScriptId ||
								stableStringify(yield* loadPin(work.pluginPin)) !== stableStringify(claim.pluginPin)
							) {
								yield* background.settle(job.id, "succeeded");
								yield* arrange(claim.id);
								return null;
							}
							const current = yield* claimFor(work, job.id, claim.pluginPin);
							return {
								...job,
								execution: { ...job.execution, input: current.input },
								featureInput: yield* Schema.encodeUnknownEffect(JsonValue)(current).pipe(
									Effect.orDie,
								),
							};
						}),
					)
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
			});

			const process = Effect.fn("EventStreamWorkService.process")(function* (
				job: BackgroundWorkInput,
				rawOutput: unknown,
			) {
				const workClaim = yield* Schema.decodeUnknownEffect(EventStreamClaim)(
					job.featureInput,
				).pipe(
					Effect.mapError(() => new DbError({ message: "Invalid persisted projection claim" })),
				);
				const executionId = job.id;
				const output = yield* Schema.decodeUnknownEffect(EventStreamStepOutput)(rawOutput).pipe(
					Effect.mapError(
						() => new DbError({ message: "Event stream processor returned invalid output" }),
					),
				);
				if (new TextEncoder().encode(stableStringify(output.checkpoint)).byteLength > 16_384) {
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
								yield* background.lockAccount(workClaim.accountGeneration);
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
										workClaim.jobId,
										workClaim.revision,
									))
								) {
									yield* background.settle(job.id, "succeeded");
									yield* arrange(workClaim.id);
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
									yield* background.settle(job.id, "succeeded");
									yield* arrange(workClaim.id);
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
										workClaim.jobId,
										workClaim.revision,
										output.checkpoint,
										output.done,
									))
								) {
									return yield* new DbError({
										message: "Event stream claim changed during commit",
									});
								}
								yield* background.settle(job.id, "succeeded");
								if (!output.done) {
									yield* arrange(workClaim.id);
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

			const failed = (job: BackgroundWorkInput) =>
				publishUpdate(EntityId.make(job.scope), job.accountGeneration.userId);
			const bindDeclaration = Effect.fn("EventStreamWorkService.bindDeclaration")(function* (
				declaration: EventStreamBindingDeclaration,
				scriptSlug: string,
			) {
				const binding = yield* bindings.resolve({
					scriptSlug,
					userId: UserId.make(declaration.userId),
					pluginId: PluginId.make(declaration.eventSchemaPluginId),
				});
				if (!binding) {
					return false;
				}
				let complete = true;
				let after: string | undefined;
				for (;;) {
					const candidates: Effect.Success<ReturnType<typeof repository.bindingCandidates>> =
						yield* repository.bindingCandidates({
							limit: 100,
							declaration,
							...(after === undefined ? {} : { after }),
						});
					for (const candidate of candidates) {
						const { key } = candidate;
						yield* Effect.gen(function* () {
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
								Effect.mapError(
									() => new DbError({ message: "Invalid projection binding command" }),
								),
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
						}).pipe(
							Effect.catchTag("DbError", (error) => {
								complete = false;
								return Effect.logWarning("Projection binding admission failed", {
									reason: error.message,
									streamId: candidate.id,
								});
							}),
						);
					}
					after = candidates.at(-1)?.id;
					if (candidates.length < 100 || after === undefined) {
						return complete;
					}
				}
			});

			const reconcile = Effect.fn("EventStreamWorkService.reconcile")(function* () {
				for (const { projection, ...declaration } of yield* repository.bindingDeclarations(100)) {
					if (yield* bindDeclaration(declaration, projection.scriptSlug)) {
						yield* repository.recordBinding(declaration);
					}
				}
				let after: string | undefined;
				for (;;) {
					const candidates: Effect.Success<ReturnType<typeof repository.listCandidates>> =
						yield* repository.listCandidates(100, after);
					for (const work of candidates) {
						const jobId = yield* session
							.transaction(arrange(work.id))
							.pipe(
								Effect.catchTags({
									DatabaseSessionStateError: Effect.die,
									DbError: (error) =>
										repository
											.postponeCandidate(work.id)
											.pipe(
												Effect.andThen(
													Effect.logWarning("Projection stream admission failed", {
														streamId: work.id,
														reason: error.message,
													}),
												),
												Effect.as(null),
											),
								}),
							);
						if (jobId) {
							yield* background
								.dispatch(jobId)
								.pipe(
									Effect.catchTag("DbError", (error) =>
										Effect.logWarning("Projection stream dispatch failed", {
											jobId,
											reason: error.message,
										}),
									),
								);
						}
					}
					if (candidates.length < 100) {
						break;
					}
					after = candidates.at(-1)?.id;
					if (after === undefined) {
						break;
					}
				}
			});
			return { failed, prepare, process, request, reconcile, admitChange };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const EventStreamLifecycleWorkLive = Layer.effect(
	LifecycleWork,
	Effect.gen(function* () {
		const streams = yield* EventStreamWorkService;
		const background = yield* BackgroundWorkService;
		return LifecycleWork.of({
			admit: streams.admitChange,
			dispatch: (ids) => Effect.forEach(ids, (id) => background.dispatch(id), { discard: true }),
		});
	}),
);
