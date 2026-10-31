import { DbError } from "@ryot-app/contract/errors";
import type { AutomationTrigger } from "@ryot-app/contract/modules/automations/lifecycle";
import type { EventStreamWorkRequest } from "@ryot-app/contract/modules/events/stream-work";
import {
	EVENT_STREAM_BATCH_LIMITS,
	EventStreamBatchInput,
	EventStreamBatchOutput,
	EventStreamUpdate,
} from "@ryot-app/contract/modules/events/stream-work";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import {
	AutomationExecutionId,
	EntityId,
	EventSchemaSlug,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { generateId } from "better-auth";
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
import { makeActivity } from "#platform/workflow/scope";
import * as tables from "#schema/tables/combined";

import { resolveEventCreateItemScopes } from "./event-creation";
import { EventProjectionRepository } from "./projection-repository";
import {
	type EventStreamBindingDeclaration,
	type EventStreamBindingKey,
	eventStreamId,
	EventStreamRepository,
	type EventStreamScope,
} from "./stream-repository";

const bindPageSize = 1000;

const EventProjectionJob = Schema.Struct({
	scriptSlug: Schema.String,
	eventSchemaSlug: EventSchemaSlug,
	processorScriptId: SandboxScriptId,
	accountGeneration: AccountGeneration,
	occurredAt: Schema.NullOr(IsoUtcString),
	pluginPin: Schema.Struct({
		...ScriptPluginRevision.fields,
		writeContext: ScriptExecutionPrincipal,
	}),
	streams: Schema.Array(
		Schema.Struct({
			id: Schema.String,
			entityId: EntityId,
			revision: Schema.Int,
			outputSchema: AppSchema,
		}),
	),
});
type EventProjectionJob = typeof EventProjectionJob.Type;

const decodeJob = (job: BackgroundWorkInput) =>
	Schema.decodeUnknownEffect(EventProjectionJob)(job.featureInput).pipe(
		Effect.mapError(() => new DbError({ message: "Invalid persisted projection job" })),
	);

const encodeJson = (value: unknown, message: string) =>
	Schema.encodeUnknownEffect(JsonValue)(value).pipe(
		Effect.mapError(() => new DbError({ message })),
	);

const jobScope = (job: EventProjectionJob): EventStreamScope => ({
	userId: job.accountGeneration.userId,
	eventSchemaSlug: job.eventSchemaSlug,
	eventSchemaPluginId: job.pluginPin.id,
});

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
			const assets = yield* ManagedAssetReferenceLocker.make;

			const resolve = Effect.fn("EventStreamWorkService.resolve")(function* (input: {
				userId: string;
				pluginId: string;
				scriptSlug: string;
			}) {
				const binding = yield* bindings.resolve({
					pluginId: input.pluginId,
					scriptSlug: input.scriptSlug,
					userId: UserId.make(input.userId),
				});
				if (!binding) {
					return null;
				}
				const pluginPin = { ...binding.pluginPin, writeContext: binding.principal };
				return {
					binding,
					pluginPin,
					record: {
						accountToken: binding.accountGeneration.token,
						processorScriptId: binding.principal.scriptId,
						pluginRevisionId: binding.pluginPin.revisionId,
						configRevisionId: binding.pluginPin.configRevisionId,
						pluginPin: yield* encodeJson(pluginPin, "Invalid projection binding"),
					},
				};
			});

			const admit = Effect.fn("EventStreamWorkService.admit")(function* (
				scope: EventStreamScope,
				scriptSlug: string,
				resolved: Effect.Success<ReturnType<typeof resolve>>,
			) {
				if (!resolved) {
					return null;
				}
				const account = resolved.binding.accountGeneration;
				yield* background.lockAccount(account);
				const queued = yield* background.lockQueued({
					userId: account.userId,
					purpose: "event-projection",
					scope: scope.eventSchemaSlug,
					pluginId: scope.eventSchemaPluginId,
				});
				if (queued) {
					return queued;
				}
				if (!(yield* repository.claimable(scope, resolved.record))) {
					return null;
				}
				const [target] = yield* session.run((db) =>
					db
						.select({
							slug: tables.sandboxScript.slug,
							contentHash: tables.sandboxScript.contentHash,
						})
						.from(tables.sandboxScript)
						.where(eq(tables.sandboxScript.id, resolved.record.processorScriptId)),
				);
				if (!target || resolved.pluginPin.compiledHashes[target.slug] !== target.contentHash) {
					return yield* new DbError({ message: "Projection executable pin is unavailable" });
				}
				const id = `event-projection-${generateId()}`;
				const job: EventProjectionJob = {
					scriptSlug,
					streams: [],
					occurredAt: null,
					accountGeneration: account,
					pluginPin: resolved.pluginPin,
					processorScriptId: resolved.binding.principal.scriptId,
					eventSchemaSlug: EventSchemaSlug.make(scope.eventSchemaSlug),
				};
				yield* background.admit({
					id,
					key: id,
					accountGeneration: account,
					purpose: "event-projection",
					scope: scope.eventSchemaSlug,
					contentHash: target.contentHash,
					featureInput: yield* encodeJson(job, "Invalid projection job"),
					execution: {
						lane: "background",
						resolutionMode: "exact",
						executionId: `${id}-script`,
						scriptId: job.processorScriptId,
						pluginRevision: resolved.binding.pluginPin,
						input: { streams: [], eventSchemaSlug: job.eventSchemaSlug },
						subject: { type: "projection", userId: account.userId, accountGeneration: account },
					},
				});
				return id;
			});

			const admitCurrent = Effect.fn("EventStreamWorkService.admitCurrent")(function* (
				scope: EventStreamScope,
				scriptSlug: string,
			) {
				return yield* admit(
					scope,
					scriptSlug,
					yield* resolve({ scriptSlug, userId: scope.userId, pluginId: scope.eventSchemaPluginId }),
				);
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
				const projection = scope.eventSchemaScope.projection;
				if (scope.eventSchemaScope.pluginId !== input.pluginPin.id || !projection) {
					return yield* new DbError({
						message: "Event stream processor must own its schema and declared output properties",
					});
				}
				const streamScope = {
					userId: input.accountGeneration.userId,
					eventSchemaPluginId: input.pluginPin.id,
					eventSchemaSlug: input.request.eventSchemaSlug,
				};
				const id = eventStreamId({ ...streamScope, entityId: input.request.entityId });
				const jobId = yield* session.transaction(
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
							target.slug !== projection.scriptSlug
						) {
							return yield* new DbError({
								message:
									"Event stream processor does not belong to the exact admitted plugin revision",
							});
						}
						const resolved = yield* resolve({
							userId: streamScope.userId,
							scriptSlug: projection.scriptSlug,
							pluginId: streamScope.eventSchemaPluginId,
						});
						if (!resolved) {
							return yield* new DbError({ message: "Projection binding is unavailable" });
						}
						yield* repository.ensureStreams([{ ...streamScope, entityId: input.request.entityId }]);
						yield* repository.bind({
							limit: 1,
							streamIds: [id],
							binding: resolved.record,
							outputSchema: projection.propertiesSchema,
							declaration: {
								...streamScope,
								entitySchemaSlug: scope.eventSchemaScope.entitySchemaSlug,
							},
						});
						yield* repository.retry(id);
						return yield* admit(streamScope, projection.scriptSlug, resolved);
					}),
				);
				if (jobId) {
					yield* background.dispatch(jobId);
				}
				return id;
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
				const declarations = new Map<
					string,
					{
						streamIds: Array<string>;
						declaration: EventStreamBindingKey;
						projection: NonNullable<(typeof candidates)[number]["projection"]>;
					}
				>();
				for (const { id, key, projection, entitySchemaSlug } of candidates) {
					if (key.eventSchemaPluginId === null || !projection) {
						continue;
					}
					const declaration = {
						entitySchemaSlug,
						userId: key.userId,
						eventSchemaSlug: key.eventSchemaSlug,
						eventSchemaPluginId: key.eventSchemaPluginId,
					};
					const identity = stableStringify(declaration);
					const current = declarations.get(identity);
					if (current) {
						current.streamIds.push(id);
					} else {
						declarations.set(identity, { projection, declaration, streamIds: [id] });
					}
				}
				const jobIds = new Set<string>();
				for (const { streamIds, projection, declaration } of declarations.values()) {
					const resolved = yield* resolve({
						userId: declaration.userId,
						scriptSlug: projection.scriptSlug,
						pluginId: declaration.eventSchemaPluginId,
					});
					if (!resolved) {
						continue;
					}
					yield* repository.bind({
						streamIds,
						declaration,
						limit: streamIds.length,
						binding: resolved.record,
						outputSchema: projection.propertiesSchema,
					});
					const jobId = yield* admit(declaration, projection.scriptSlug, resolved);
					if (jobId) {
						jobIds.add(jobId);
					}
				}
				return [...jobIds];
			});

			const prepare = Effect.fn("EventStreamWorkService.prepare")(function* (
				job: BackgroundWorkInput,
			) {
				const spec = yield* decodeJob(job);
				const scope = jobScope(spec);
				return yield* session
					.transaction(
						Effect.gen(function* () {
							yield* background.lockAccount(spec.accountGeneration);
							if (!(yield* background.start(job.id))) {
								return null;
							}
							const occurredAt = DateTime.formatIso(yield* DateTime.now);
							const claimed = yield* repository.claim({
								scope,
								jobId: job.id,
								limit: EVENT_STREAM_BATCH_LIMITS.streams,
								binding: {
									processorScriptId: spec.processorScriptId,
									accountToken: spec.accountGeneration.token,
									pluginRevisionId: spec.pluginPin.revisionId,
									configRevisionId: spec.pluginPin.configRevisionId,
								},
							});
							if (claimed.length === 0) {
								yield* admitCurrent(scope, spec.scriptSlug);
								yield* background.settle(job.id, "succeeded");
								return null;
							}
							const current: EventProjectionJob = {
								...spec,
								occurredAt,
								streams: claimed.map(({ id, entityId, revision, outputSchema }) => ({
									id,
									revision,
									outputSchema,
									entityId: EntityId.make(entityId),
								})),
							};
							const input = yield* Schema.decodeEffect(EventStreamBatchInput)({
								eventSchemaSlug: spec.eventSchemaSlug,
								streams: claimed.map(({ entityId, dirtyFrom, checkpoint }) => ({
									entityId,
									dirtyFrom,
									checkpoint,
								})),
							}).pipe(Effect.mapError(() => new DbError({ message: "Invalid projection batch" })));
							return {
								...job,
								execution: { ...job.execution, input },
								featureInput: yield* encodeJson(current, "Invalid projection job"),
							};
						}),
					)
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
			});

			const process = Effect.fn("EventStreamWorkService.process")(function* (
				job: BackgroundWorkInput,
				rawOutput: unknown,
			) {
				const spec = yield* decodeJob(job);
				const scope = jobScope(spec);
				const output = yield* Schema.decodeUnknownEffect(EventStreamBatchOutput)(rawOutput).pipe(
					Effect.mapError(
						() => new DbError({ message: "Event stream processor returned invalid output" }),
					),
				);
				const claims = new Map(spec.streams.map((stream) => [stream.entityId, stream]));
				const covered = new Set(output.streams.map(({ entityId }) => entityId));
				if (
					covered.size !== output.streams.length ||
					covered.size !== claims.size ||
					output.streams.some(({ entityId }) => !claims.has(entityId))
				) {
					return yield* new DbError({
						message: "Event stream processor must return each claimed stream once",
					});
				}
				const updates = output.streams.flatMap((stream) => stream.updates);
				if (updates.length > EVENT_STREAM_BATCH_LIMITS.updates) {
					return yield* new DbError({
						message: "Event stream processor returned too many updates",
					});
				}
				if (new Set(updates.map(({ eventId }) => eventId)).size !== updates.length) {
					return yield* new DbError({ message: "Event stream processor repeated an event" });
				}
				const results = yield* Effect.forEach(output.streams, (stream) =>
					Effect.gen(function* () {
						const claim = claims.get(stream.entityId);
						if (!claim) {
							return yield* new DbError({
								message: "Event stream processor returned an unclaimed stream",
							});
						}
						if (
							new TextEncoder().encode(stableStringify(stream.checkpoint)).byteLength >
							EVENT_STREAM_BATCH_LIMITS.checkpointBytes
						) {
							return yield* new DbError({
								message: "Event stream checkpoint exceeds its bounded size",
							});
						}
						const parsed = yield* Effect.forEach(stream.updates, (item) =>
							parseAppSchemaProperties({
								kind: "Projection",
								properties: item.properties,
								propertiesSchema: claim.outputSchema,
							}).pipe(
								Effect.flatMap((properties) =>
									Schema.decodeUnknownEffect(EventStreamUpdate)({ ...item, properties }),
								),
								Effect.mapError(
									() =>
										new DbError({
											message: "Projection output does not match its declared schema",
										}),
								),
							),
						);
						return { ...stream, claim, updates: parsed };
					}),
				);
				if (spec.occurredAt === null) {
					return yield* new DbError({ message: "Projection job was not prepared" });
				}
				const command = yield* Schema.decodeEffect(DomainLifecycleCommand)({
					occurredAt: spec.occurredAt,
					itemIdentity: "stream-batch",
					writeContext: spec.pluginPin.writeContext,
					accountGeneration: spec.accountGeneration,
					causation: rootLifecycleCausation({
						lane: "background",
						source: "bootstrap",
						executionId: AutomationExecutionId.make(job.id),
						initiator: { kind: "user", id: spec.accountGeneration.userId },
					}),
				}).pipe(
					Effect.mapError(() => new DbError({ message: "Invalid event stream lifecycle command" })),
				);
				yield* makeActivity({
					error: DbError,
					success: Schema.Void,
					name: "publish-projection",
					execute: session
						.transaction(
							Effect.gen(function* () {
								yield* background.lockAccount(spec.accountGeneration);
								yield* writes
									.check(command, definitionOwner(spec.pluginPin.id), scope.userId, true)
									.pipe(Effect.mapError((error) => new DbError({ message: error.message })));
								if (!(yield* repository.declared(scope, spec.scriptSlug))) {
									return yield* new DbError({ message: "Projection declaration is unavailable" });
								}
								const resolved = yield* resolve({
									userId: scope.userId,
									scriptSlug: spec.scriptSlug,
									pluginId: scope.eventSchemaPluginId,
								});
								if (!resolved) {
									return yield* new DbError({ message: "Projection binding is unavailable" });
								}
								if (
									!sameRevisionPin(resolved.binding.pluginPin, spec.pluginPin) ||
									resolved.binding.principal.scriptId !== spec.processorScriptId
								) {
									yield* admit(scope, spec.scriptSlug, resolved);
									yield* background.settle(job.id, "succeeded");
									return undefined;
								}
								yield* entities.lockEntityReferencesByIds(
									spec.streams.map(({ entityId }) => entityId),
								);
								const live = new Set(
									yield* repository.currentClaims(
										job.id,
										spec.streams.map(({ id, revision }) => ({ id, revision })),
									),
								);
								const published = results.filter(({ claim }) => live.has(claim.id));
								yield* assets
									.lock(
										published.flatMap(({ claim, updates: items }) =>
											items.map((item) => ({
												properties: item.properties,
												propertiesSchema: claim.outputSchema,
												ownerUserId: spec.accountGeneration.userId,
											})),
										),
									)
									.pipe(
										Effect.mapError(
											() =>
												new DbError({ message: "Projection output contains an unavailable asset" }),
										),
									);
								yield* projections.publish({
									userId: scope.userId,
									eventSchemaSlug: scope.eventSchemaSlug,
									eventSchemaPluginId: scope.eventSchemaPluginId,
									streams: published.map(({ claim, updates: items }) => ({
										updates: items,
										streamId: claim.id,
										entityId: claim.entityId,
									})),
								});
								yield* repository.finish(
									job.id,
									published.map(({ done, claim, checkpoint }) => ({
										done,
										checkpoint,
										id: claim.id,
										revision: claim.revision,
									})),
								);
								yield* admit(scope, spec.scriptSlug, resolved);
								yield* background.settle(job.id, "succeeded");
								return undefined;
							}),
						)
						.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die)),
				});
				return undefined;
			});

			const bindDeclaration = Effect.fn("EventStreamWorkService.bindDeclaration")(function* (
				declaration: EventStreamBindingDeclaration,
				projection: { readonly scriptSlug: string; readonly propertiesSchema: AppSchema },
			) {
				const resolved = yield* resolve({
					userId: declaration.userId,
					scriptSlug: projection.scriptSlug,
					pluginId: declaration.eventSchemaPluginId,
				});
				if (!resolved) {
					return false;
				}
				let after: string | undefined;
				for (;;) {
					const bound: ReadonlyArray<string> = yield* session
						.transaction(
							Effect.gen(function* () {
								yield* background.lockAccount(resolved.binding.accountGeneration);
								return yield* repository.bind({
									declaration,
									limit: bindPageSize,
									binding: resolved.record,
									outputSchema: projection.propertiesSchema,
									...(after === undefined ? {} : { after }),
								});
							}),
						)
						.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
					after = bound.at(-1);
					if (bound.length < bindPageSize || after === undefined) {
						return true;
					}
				}
			});

			const reconcile = Effect.fn("EventStreamWorkService.reconcile")(function* () {
				let after: undefined | EventStreamBindingKey;
				for (;;) {
					const declarations: Effect.Success<ReturnType<typeof repository.bindingDeclarations>> =
						yield* repository.bindingDeclarations({
							limit: 100,
							...(after === undefined ? {} : { after }),
						});
					for (const { projection, ...declaration } of declarations) {
						const bound = yield* bindDeclaration(declaration, projection).pipe(
							Effect.catchTag("DbError", (error) =>
								Effect.logWarning("Projection binding failed", {
									reason: error.message,
									eventSchemaSlug: declaration.eventSchemaSlug,
								}).pipe(Effect.as(false)),
							),
						);
						if (bound) {
							yield* repository.recordBinding(declaration);
						}
					}
					after = declarations.at(-1);
					if (declarations.length < 100 || after === undefined) {
						break;
					}
				}
				let scope: undefined | EventStreamScope;
				for (;;) {
					const scopes: Effect.Success<ReturnType<typeof repository.dirtyScopes>> =
						yield* repository.dirtyScopes({
							limit: 100,
							...(scope === undefined ? {} : { after: scope }),
						});
					for (const { scriptSlugs, ...current } of scopes) {
						for (const scriptSlug of scriptSlugs) {
							const jobId = yield* session
								.transaction(admitCurrent(current, scriptSlug))
								.pipe(
									Effect.catchTags({
										DatabaseSessionStateError: Effect.die,
										DbError: (error) =>
											Effect.logWarning("Projection admission failed", {
												reason: error.message,
												eventSchemaSlug: current.eventSchemaSlug,
											}).pipe(Effect.as(null)),
									}),
								);
							if (jobId) {
								yield* background
									.dispatch(jobId)
									.pipe(
										Effect.catchTag("DbError", (error) =>
											Effect.logWarning("Projection dispatch failed", {
												jobId,
												reason: error.message,
											}),
										),
									);
							}
						}
					}
					scope = scopes.at(-1);
					if (scopes.length < 100 || scope === undefined) {
						return;
					}
				}
			});
			return { prepare, process, request, reconcile, admitChange };
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
