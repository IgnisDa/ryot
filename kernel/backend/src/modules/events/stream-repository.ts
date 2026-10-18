import { DbError } from "@ryot-app/contract/errors";
import {
	EntityId,
	type EventId,
	EventSchemaSlug,
	PluginId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, asc, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

export const StreamKeySchema = Schema.Struct({
	userId: UserId,
	entityId: EntityId,
	eventSchemaSlug: EventSchemaSlug,
	eventSchemaPluginId: Schema.NullOr(PluginId),
});

export type StreamKey = typeof StreamKeySchema.Type;

type StreamTouch = StreamKey & { readonly occurredAt: Date };

export const eventStreamId = (key: StreamKey) =>
	sha256Hex(
		stableStringify([key.userId, key.entityId, key.eventSchemaPluginId, key.eventSchemaSlug]),
	);

const toStreamKey = (row: {
	readonly userId: string;
	readonly entityId: string;
	readonly eventSchemaSlug: string;
	readonly eventSchemaPluginId: string | null;
}): StreamKey => ({
	userId: UserId.make(row.userId),
	entityId: EntityId.make(row.entityId),
	eventSchemaSlug: EventSchemaSlug.make(row.eventSchemaSlug),
	eventSchemaPluginId:
		row.eventSchemaPluginId === null ? null : PluginId.make(row.eventSchemaPluginId),
});

const currentSelection = {
	id: schema.eventStreamWork.id,
	step: schema.eventStreamWork.step,
	error: schema.backgroundWork.error,
	status: schema.backgroundWork.status,
	pluginPin: schema.eventStreamWork.pluginPin,
	streamRevision: schema.eventStream.revision,
	dirtyFrom: schema.eventStreamWork.dirtyFrom,
	updatedAt: schema.eventStreamWork.updatedAt,
	checkpoint: schema.eventStreamWork.checkpoint,
	currentJobId: schema.eventStreamWork.currentJobId,
	accountToken: schema.eventStreamWork.accountToken,
	outputSchema: schema.eventStreamWork.outputSchema,
	pluginRevisionId: schema.eventStreamWork.pluginRevisionId,
	completedRevision: schema.eventStreamWork.completedRevision,
	processorScriptId: schema.eventStreamWork.processorScriptId,
	key: {
		userId: schema.eventStream.userId,
		entityId: schema.eventStream.entityId,
		eventSchemaSlug: schema.eventStream.eventSchemaSlug,
		eventSchemaPluginId: schema.eventStream.eventSchemaPluginId,
	},
};

export class EventStreamRepository extends Context.Service<EventStreamRepository>()(
	"EventStreamRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const requireTransaction = session.requireTransaction.pipe(
				Effect.mapError(
					() => new DbError({ message: "Event stream writes require an active transaction" }),
				),
			);

			const ensureAndLockStreams = Effect.fn("EventStreamRepository.ensureAndLockStreams")(
				function* (keys: ReadonlyArray<StreamKey>) {
					const entries = [...new Map(keys.map((key) => [eventStreamId(key), key])).entries()].sort(
						([left], [right]) => left.localeCompare(right),
					);
					if (entries.length === 0) {
						return [];
					}
					const ids = entries.map(([id]) => id);

					yield* session.run((db) =>
						db
							.insert(schema.eventStream)
							.values(
								entries.map(([id, key]) => ({
									id,
									userId: key.userId,
									entityId: key.entityId,
									eventSchemaSlug: key.eventSchemaSlug,
									eventSchemaPluginId: key.eventSchemaPluginId,
								})),
							)
							.onConflictDoNothing(),
					);

					return yield* session.run((db) =>
						db
							.select()
							.from(schema.eventStream)
							.where(inArray(schema.eventStream.id, ids))
							.orderBy(asc(schema.eventStream.id))
							.for("update"),
					);
				},
			);
			const lock = Effect.fn("EventStreamRepository.lock")(function* (
				keys: ReadonlyArray<StreamKey>,
			) {
				yield* requireTransaction;
				return yield* ensureAndLockStreams(keys);
			});
			const lockForEvents = Effect.fn("EventStreamRepository.lockForEvents")(function* (
				eventIds: ReadonlyArray<EventId>,
			) {
				yield* requireTransaction;
				const ids = [...new Set(eventIds)].sort();
				if (ids.length === 0) {
					return;
				}
				const rows = yield* session.run((db) =>
					db
						.select({
							userId: schema.event.userId,
							entityId: schema.event.entityId,
							eventSchemaSlug: schema.event.eventSchemaSlug,
							eventSchemaPluginId: schema.event.eventSchemaPluginId,
						})
						.from(schema.event)
						.where(inArray(schema.event.id, ids))
						.orderBy(asc(schema.event.id)),
				);
				yield* lock(rows.map(toStreamKey));
			});

			const lockWorkRows = Effect.fn("EventStreamRepository.lockWorkRows")(function* (
				ids: ReadonlyArray<string>,
			) {
				if (ids.length === 0) {
					return [];
				}
				return yield* session.run((db) =>
					db
						.select()
						.from(schema.eventStreamWork)
						.where(inArray(schema.eventStreamWork.id, ids))
						.orderBy(asc(schema.eventStreamWork.id))
						.for("update"),
				);
			});

			const incrementStreams = Effect.fn("EventStreamRepository.incrementStreams")(function* (
				streams: ReadonlyArray<typeof schema.eventStream.$inferSelect>,
				now: Date,
			) {
				for (const stream of streams) {
					yield* session.run((db) =>
						db
							.update(schema.eventStream)
							.set({ updatedAt: now, revision: sql`${schema.eventStream.revision} + 1` })
							.where(eq(schema.eventStream.id, stream.id)),
					);
				}
			});

			const readState = (id: string) =>
				session
					.run((db) =>
						db
							.select(currentSelection)
							.from(schema.eventStreamWork)
							.innerJoin(schema.eventStream, eq(schema.eventStream.id, schema.eventStreamWork.id))
							.leftJoin(
								schema.backgroundWork,
								eq(schema.backgroundWork.id, schema.eventStreamWork.currentJobId),
							)
							.where(eq(schema.eventStreamWork.id, id))
							.limit(1),
					)
					.pipe(Effect.map((rows) => rows[0] ?? null));

			const lockStream = (id: string) =>
				session
					.run((db) =>
						db
							.select()
							.from(schema.eventStream)
							.where(eq(schema.eventStream.id, id))
							.limit(1)
							.for("update"),
					)
					.pipe(Effect.map((rows) => rows[0] ?? null));

			const lockWork = (id: string) =>
				lockWorkRows([id]).pipe(Effect.map((rows) => rows[0] ?? null));

			const listStreamsForEntity = Effect.fn("EventStreamRepository.listStreamsForEntity")(
				function* (entityId: EntityId) {
					const rows = yield* session.run((db) =>
						db
							.selectDistinct({
								userId: schema.event.userId,
								entityId: schema.event.entityId,
								eventSchemaSlug: schema.event.eventSchemaSlug,
								eventSchemaPluginId: schema.event.eventSchemaPluginId,
							})
							.from(schema.event)
							.where(
								or(eq(schema.event.entityId, entityId), eq(schema.event.sessionEntityId, entityId)),
							),
					);

					return rows.map((row) => ({
						userId: UserId.make(row.userId),
						entityId: EntityId.make(row.entityId),
						eventSchemaSlug: EventSchemaSlug.make(row.eventSchemaSlug),
						eventSchemaPluginId:
							row.eventSchemaPluginId === null ? null : PluginId.make(row.eventSchemaPluginId),
					}));
				},
			);

			const touch = Effect.fn("EventStreamRepository.touch")(function* (
				keys: ReadonlyArray<StreamTouch>,
			) {
				yield* requireTransaction;
				const occurredAtById = new Map<string, { readonly key: StreamKey; occurredAt: Date }>();
				for (const { occurredAt, ...key } of keys) {
					const id = eventStreamId(key);
					const current = occurredAtById.get(id);
					if (!current || occurredAt.getTime() < current.occurredAt.getTime()) {
						occurredAtById.set(id, { key, occurredAt });
					}
				}
				if (occurredAtById.size === 0) {
					return;
				}

				const streams = yield* lock([...occurredAtById.values()].map(({ key }) => key));
				const now = yield* DateTime.nowAsDate;
				yield* incrementStreams(streams, now);
				const workRows = yield* lockWorkRows(streams.map((stream) => stream.id));
				const workById = new Map(workRows.map((work) => [work.id, work]));

				for (const stream of streams) {
					const work = workById.get(stream.id);
					if (!work) {
						continue;
					}
					const occurredAt = occurredAtById.get(stream.id)?.occurredAt;
					if (!occurredAt) {
						continue;
					}
					let dirtyFrom = work.dirtyFrom;
					if (dirtyFrom === null && work.completedRevision === stream.revision) {
						dirtyFrom = occurredAt;
					} else if (dirtyFrom !== null && occurredAt < dirtyFrom) {
						dirtyFrom = occurredAt;
					}
					const checkpoint = work.completedRevision === stream.revision ? work.checkpoint : null;

					yield* session.run((db) =>
						db
							.update(schema.eventStreamWork)
							.set({ dirtyFrom, checkpoint, updatedAt: now, currentJobId: null })
							.where(eq(schema.eventStreamWork.id, stream.id)),
					);
				}
			});

			const invalidateEntity = Effect.fn("EventStreamRepository.invalidateEntity")(function* (
				entityId: EntityId,
			) {
				yield* requireTransaction;
				const keys = yield* listStreamsForEntity(entityId);
				const streams = yield* lock(keys);
				if (streams.length === 0) {
					return;
				}

				const now = yield* DateTime.nowAsDate;
				yield* incrementStreams(streams, now);
				const workRows = yield* lockWorkRows(streams.map((stream) => stream.id));
				for (const work of workRows) {
					yield* session.run((db) =>
						db
							.update(schema.eventStreamWork)
							.set({ updatedAt: now, dirtyFrom: null, checkpoint: null, currentJobId: null })
							.where(eq(schema.eventStreamWork.id, work.id)),
					);
				}
			});

			const request = Effect.fn("EventStreamRepository.request")(function* (input: {
				key: StreamKey;
				processorScriptId: string;
				pluginRevisionId: string;
				accountToken: string;
				outputSchema: AppSchema;
				pluginPin: JsonValue;
			}) {
				yield* requireTransaction;
				const id = eventStreamId(input.key);
				const [stream] = yield* ensureAndLockStreams([input.key]);
				if (!stream) {
					return yield* new DbError({ message: "Event stream insert returned no row" });
				}

				const now = yield* DateTime.nowAsDate;
				yield* session.run((db) =>
					db
						.insert(schema.eventStreamWork)
						.values({
							id,
							dirtyFrom: null,
							checkpoint: null,
							pluginPin: input.pluginPin,
							accountToken: input.accountToken,
							outputSchema: input.outputSchema,
							pluginRevisionId: input.pluginRevisionId,
							processorScriptId: input.processorScriptId,
						})
						.onConflictDoNothing(),
				);

				const work = yield* lockWork(id);
				if (!work) {
					return yield* new DbError({ message: "Event stream work insert returned no row" });
				}

				const changedBinding =
					work.accountToken !== input.accountToken ||
					work.processorScriptId !== input.processorScriptId ||
					work.pluginRevisionId !== input.pluginRevisionId ||
					stableStringify(work.pluginPin) !== stableStringify(input.pluginPin) ||
					stableStringify(work.outputSchema) !== stableStringify(input.outputSchema);
				if (changedBinding) {
					yield* session.run((db) =>
						db
							.update(schema.eventStreamWork)
							.set({
								updatedAt: now,
								dirtyFrom: null,
								checkpoint: null,
								currentJobId: null,
								completedRevision: null,
								pluginPin: input.pluginPin,
								accountToken: input.accountToken,
								outputSchema: input.outputSchema,
								pluginRevisionId: input.pluginRevisionId,
								processorScriptId: input.processorScriptId,
							})
							.where(eq(schema.eventStreamWork.id, id)),
					);
				} else {
					yield* session.run((db) =>
						db
							.update(schema.eventStreamWork)
							.set({
								updatedAt: now,
								accountToken: input.accountToken,
								outputSchema: input.outputSchema,
							})
							.where(eq(schema.eventStreamWork.id, id)),
					);
				}

				return id;
			});

			const get = Effect.fn("EventStreamRepository.get")(function* (id: string) {
				return yield* readState(id);
			});

			const listCandidates = Effect.fn("EventStreamRepository.listCandidates")(function* (
				limit = 500,
			) {
				return yield* session.run((db) =>
					db
						.select(currentSelection)
						.from(schema.eventStreamWork)
						.innerJoin(schema.eventStream, eq(schema.eventStream.id, schema.eventStreamWork.id))
						.leftJoin(
							schema.backgroundWork,
							eq(schema.backgroundWork.id, schema.eventStreamWork.currentJobId),
						)
						.where(
							and(
								isNull(schema.eventStreamWork.currentJobId),
								sql`${schema.eventStreamWork.completedRevision} is distinct from ${schema.eventStream.revision}`,
							),
						)
						.orderBy(asc(schema.eventStreamWork.updatedAt), asc(schema.eventStreamWork.id))
						.limit(limit),
				);
			});

			const postponeCandidate = Effect.fn("EventStreamRepository.postponeCandidate")(function* (
				id: string,
			) {
				const updatedAt = yield* DateTime.nowAsDate;
				yield* session.run((db) =>
					db
						.update(schema.eventStreamWork)
						.set({ updatedAt })
						.where(
							and(eq(schema.eventStreamWork.id, id), isNull(schema.eventStreamWork.currentJobId)),
						),
				);
			});

			const bindingCandidates = Effect.fn("EventStreamRepository.bindingCandidates")(
				function* (input: { after?: string; limit: number }) {
					return yield* session.run((db) =>
						db
							.select({
								id: schema.eventStream.id,
								projection: schema.userEventSchema.projection,
								key: {
									userId: schema.eventStream.userId,
									entityId: schema.eventStream.entityId,
									eventSchemaSlug: schema.eventStream.eventSchemaSlug,
									eventSchemaPluginId: schema.eventStream.eventSchemaPluginId,
								},
							})
							.from(schema.eventStream)
							.innerJoin(schema.entity, eq(schema.entity.id, schema.eventStream.entityId))
							.innerJoin(
								schema.userEventSchema,
								and(
									eq(schema.userEventSchema.userId, schema.eventStream.userId),
									eq(schema.userEventSchema.entitySchemaSlug, schema.entity.entitySchemaSlug),
									eq(schema.userEventSchema.slug, schema.eventStream.eventSchemaSlug),
									sql`${schema.userEventSchema.pluginId} is not distinct from ${schema.eventStream.eventSchemaPluginId}`,
								),
							)
							.innerJoin(
								schema.plugin,
								eq(schema.plugin.id, schema.eventStream.eventSchemaPluginId),
							)
							.leftJoin(
								schema.eventStreamWork,
								eq(schema.eventStreamWork.id, schema.eventStream.id),
							)
							.leftJoin(
								schema.pluginInstallation,
								and(
									eq(schema.pluginInstallation.userId, schema.eventStream.userId),
									eq(schema.pluginInstallation.pluginId, schema.eventStream.eventSchemaPluginId),
								),
							)
							.where(
								and(
									eq(schema.userEventSchema.isEffective, true),
									isNotNull(schema.userEventSchema.projection),
									input.after === undefined ? undefined : gt(schema.eventStream.id, input.after),
									or(
										isNull(schema.eventStreamWork.id),
										sql`${schema.eventStreamWork.pluginRevisionId} is distinct from ${schema.plugin.activeRevisionId}`,
										sql`${schema.eventStreamWork.pluginPin}->>'configRevisionId' is distinct from (case when ${schema.plugin.ownerId} is null then ${schema.plugin.environmentConfigRevisionId} else ${schema.pluginInstallation.activeConfigRevisionId} end)`,
									),
								),
							)
							.orderBy(asc(schema.eventStream.id))
							.limit(input.limit),
					);
				},
			);

			const prepare = Effect.fn("EventStreamRepository.prepare")(function* (id: string) {
				yield* requireTransaction;
				const stream = yield* lockStream(id);
				if (!stream) {
					return null;
				}
				yield* lockWork(id);
				return yield* readState(id);
			});
			const reserve = Effect.fn("EventStreamRepository.reserve")(function* (
				id: string,
				jobId: string,
			) {
				yield* requireTransaction;
				yield* session.run((db) =>
					db
						.update(schema.eventStreamWork)
						.set({ currentJobId: jobId, step: sql`${schema.eventStreamWork.step} + 1` })
						.where(eq(schema.eventStreamWork.id, id)),
				);
			});

			const currentClaim = Effect.fn("EventStreamRepository.currentClaim")(function* (
				id: string,
				jobId: string,
				revision: number,
			) {
				yield* requireTransaction;
				const stream = yield* lockStream(id);
				if (!stream) {
					return false;
				}
				const work = yield* lockWork(id);
				const job = yield* session.run((db) =>
					db
						.select({ status: schema.backgroundWork.status })
						.from(schema.backgroundWork)
						.where(eq(schema.backgroundWork.id, jobId))
						.for("update"),
				);
				return (
					work?.currentJobId === jobId &&
					stream.revision === revision &&
					job[0]?.status === "running"
				);
			});

			const finish = Effect.fn("EventStreamRepository.finish")(function* (
				id: string,
				jobId: string,
				revision: number,
				checkpoint: JsonValue,
				done: boolean,
			) {
				yield* requireTransaction;
				if (!(yield* currentClaim(id, jobId, revision))) {
					return false;
				}

				const now = yield* DateTime.nowAsDate;
				yield* session.run((db) =>
					db
						.update(schema.eventStreamWork)
						.set({
							checkpoint,
							updatedAt: now,
							completedRevision: done ? revision : null,
							...(done ? { dirtyFrom: null } : { currentJobId: null }),
						})
						.where(eq(schema.eventStreamWork.id, id)),
				);
				return true;
			});

			return {
				get,
				lock,
				touch,
				finish,
				prepare,
				reserve,
				request,
				currentClaim,
				lockForEvents,
				listCandidates,
				invalidateEntity,
				bindingCandidates,
				postponeCandidate,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
